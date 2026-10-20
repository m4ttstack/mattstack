import {
  JqError,
  asciiUpper,
  cpLength,
  cpSlice,
  jqCompare,
  tojson,
  truthy,
  utf8Bytes,
  isObject,
  jqEqual,
  jqGet,
  jqGroupBy,
  jqHas,
  jqSort,
  jqValuesOpt,
  hasNonSpace,
  ok,
  tostring,
} from "./jq.ts";

export type GateCtxSource = { context?: unknown; questions: unknown[]; [k: string]: unknown };

export const GATE_SHAPES = ["plan@1", "post@1", "review@1", "boards@1"];
export const QUESTION_SHAPES = ["thread@1", "reply@1", "findings@1", "carryover@1", "skipped@1"];
const PER_THREAD = ["reply@1", "carryover@1"];
const TIERS = ["critical", "important", "minor"];

export const chk = (f: () => unknown, msg: string): string[] => (ok(f) ? [] : [msg]);
const str = (v: unknown): boolean => typeof v === "string" && hasNonSpace(v);
export const int = (v: unknown): boolean => typeof v === "number" && v === Math.floor(v) && v >= 0;
export const atLeastOne = (v: unknown): boolean => typeof v === "number" && v === Math.floor(v) && v >= 1;
export const optional = (o: unknown, k: string, f: (v: unknown) => boolean): boolean => !jqHas(o, k) || f(jqGet(o, k));
export const among = (v: unknown, xs: string[]): boolean => xs.some((x) => jqEqual(x, v));
const contains = (xs: unknown[], v: unknown): boolean => xs.some((x) => jqEqual(x, v));
export const at = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((o, k) => jqGet(o, k), v);

export function entries(o: unknown, k: string): unknown[] {
  const v = jqGet(o, k);
  return Array.isArray(v) ? v : [];
}

/** jq's `.<key>?`: an entry jq cannot index contributes nothing. */
export function optionalIds(xs: unknown[], key = "id"): unknown[] {
  return xs.flatMap((x) => {
    try {
      return [jqGet(x, key)];
    } catch (e) {
      if (e instanceof JqError) return [];
      throw e;
    }
  });
}

export function duplicates(ids: unknown[]): unknown[] {
  return jqGroupBy(ids, (x) => x)
    .filter((g) => g.length > 1)
    .map((g) => g[0]);
}

function planErrs(c: unknown): string[] {
  return [
    ...chk(() => str(at(c, "reviewer")), "reviewer: required non-empty string"),
    ...chk(() => isObject(at(c, "threads")), "threads: required object"),
    ...chk(() => int(at(c, "threads", "total")), "threads.total: required integer"),
    ...chk(() => optional(at(c, "threads"), "blocking", int), "threads.blocking: integer when present"),
    ...chk(() => optional(c, "round", int), "round: integer when present"),
    ...chk(() => optional(c, "adjudication", str), "adjudication: non-empty string when present"),
  ];
}

function postErrs(c: unknown): string[] {
  return [
    ...chk(() => str(at(c, "reviewer")), "reviewer: required non-empty string"),
    ...chk(() => int(at(c, "replies")), "replies: required integer"),
    ...chk(() => optional(c, "round", int), "round: integer when present"),
    ...chk(
      () => optional(c, "fixes", (v) => Array.isArray(v) && v.every((x) => isObject(x) && str(at(x, "sha")))),
      "fixes: array of {sha} when present",
    ),
  ];
}

function threadErrs(c: unknown): string[] {
  return [
    ...chk(() => str(at(c, "author")), "author: required non-empty string"),
    ...chk(() => among(at(c, "severity"), ["blocking", "non-blocking", "question", "none"]), "severity: blocking|non-blocking|question|none"),
    ...chk(() => isObject(at(c, "claim")), "claim: required object"),
    ...chk(() => str(at(c, "claim", "summary")), "claim.summary: required non-empty string"),
    ...chk(
      () => optional(at(c, "claim"), "points", (v) => Array.isArray(v) && v.every(str)),
      "claim.points: array of strings when present",
    ),
    ...chk(() => isObject(at(c, "verdict")), "verdict: required object"),
    ...chk(
      () => among(at(c, "verdict", "call"), ["valid", "valid-low-value", "pushback", "needs-clarification", "no-ask"]),
      "verdict.call: valid|valid-low-value|pushback|needs-clarification|no-ask",
    ),
    ...chk(() => optional(at(c, "verdict"), "note", str), "verdict.note: non-empty string when present"),
    ...chk(() => isObject(at(c, "reply")), "reply: required object"),
    ...chk(() => among(at(c, "reply", "kind"), ["verbatim", "direction", "none"]), "reply.kind: verbatim|direction|none"),
    ...chk(
      () => jqEqual(at(c, "reply", "kind"), "none") || str(at(c, "reply", "text")),
      "reply.text: required unless reply.kind is none",
    ),
  ];
}

function optionPairErrs(c: unknown, values: unknown[]): string[] {
  const t = at(c, "thread");
  if (!str(t)) return [];
  return chk(
    () => jqEqual(jqSort(values), [`post:${t}`]) || jqEqual(jqSort(values), [`post:${t}`, `resolve:${t}`]),
    `options: exactly post:${t}, or post:${t} and resolve:${t}`,
  );
}

function replyErrs(c: unknown, values: unknown[]): string[] {
  return [
    ...chk(() => str(at(c, "thread")), "thread: required non-empty string"),
    ...chk(() => str(at(c, "file")), "file: required non-empty string"),
    ...chk(() => among(at(c, "verb"), ["reply", "fix"]), "verb: reply|fix"),
    ...chk(() => str(at(c, "text")), "text: required non-empty string"),
    ...chk(() => optional(c, "sha", str), "sha: non-empty string when present"),
    ...chk(() => jqEqual(at(c, "verb"), "fix") || !jqHas(c, "sha"), "sha: only a fix carries sha"),
    ...optionPairErrs(c, values),
  ];
}

function carryoverErrs(c: unknown, values: unknown[]): string[] {
  return [
    ...chk(() => str(at(c, "thread")), "thread: required non-empty string"),
    ...chk(() => atLeastOne(at(c, "round")), "round: integer of at least 1"),
    ...chk(
      () => among(at(c, "call"), ["fixed", "not-fixed", "pushback-accepted", "pushback-rejected"]),
      "call: fixed|not-fixed|pushback-accepted|pushback-rejected",
    ),
    ...chk(() => str(at(c, "original")), "original: required non-empty string"),
    ...chk(() => str(at(c, "reply")), "reply: required non-empty string"),
    ...chk(() => optional(c, "file", str), "file: non-empty string when present"),
    ...chk(() => optional(c, "authorReply", str), "authorReply: non-empty string when present"),
    ...chk(() => optional(c, "note", str), "note: non-empty string when present"),
    ...optionPairErrs(c, values),
  ];
}

function reviewErrs(c: unknown): string[] {
  return [
    ...chk(() => among(at(c, "readiness"), ["yes", "no", "with-fixes"]), "readiness: yes|no|with-fixes"),
    ...chk(() => str(at(c, "summary")), "summary: required non-empty string"),
    ...chk(() => isObject(at(c, "findings")), "findings: required object"),
    ...TIERS.flatMap((s) => chk(() => optional(at(c, "findings"), s, int), `findings.${s}: integer when present`)),
    ...chk(() => optional(c, "reviewer", str), "reviewer: non-empty string when present"),
    ...chk(() => optional(c, "round", atLeastOne), "round: integer of at least 1 when present"),
    ...chk(() => optional(c, "re_review", (v) => typeof v === "boolean"), "re_review: boolean when present"),
    ...chk(
      () => optional(c, "prior", (v) => isObject(v) && int(at(v, "addressed")) && int(at(v, "still_open"))),
      "prior: {addressed, still_open} integers when present",
    ),
  ];
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const imagePath = (v: unknown): boolean =>
  typeof v === "string" && v.startsWith("/") && IMAGE.test(v) && !v.split("/").includes("..");

function boardsErrs(c: unknown): string[] {
  const list = entries(c, "boards");
  return [
    ...chk(() => optional(c, "summary", str), "summary: non-empty string when present"),
    ...chk(() => {
      const b = at(c, "boards");
      return Array.isArray(b) && b.length > 0;
    }, "boards: required non-empty array"),
    ...list.flatMap((e, i) => [
      ...chk(() => str(at(e, "case")), `boards[${i}].case: required non-empty string`),
      ...chk(() => among(at(e, "slot"), ["before", "after", "crop"]), `boards[${i}].slot: before|after|crop`),
      ...chk(
        () => imagePath(at(e, "path")),
        `boards[${i}].path: required absolute path to a .png, .jpg, .jpeg, .gif or .webp image`,
      ),
      ...chk(() => str(at(e, "caption")), `boards[${i}].caption: required non-empty string`),
      ...chk(() => optional(e, "theme", (v) => among(v, ["light", "dark"])), `boards[${i}].theme: light|dark when present`),
    ]),
  ];
}

function findingsErrs(c: unknown, values: unknown[]): string[] {
  const list = entries(c, "findings");
  const ids = optionalIds(list);
  return [
    ...chk(() => {
      const f = at(c, "findings");
      return Array.isArray(f) && f.length > 0;
    }, "findings: required non-empty array"),
    ...list.flatMap((e, i) => [
      ...chk(() => str(at(e, "id")), `findings[${i}].id: required non-empty string`),
      ...chk(() => among(at(e, "severity"), TIERS), `findings[${i}].severity: critical|important|minor`),
      ...chk(() => str(at(e, "title")), `findings[${i}].title: required non-empty string`),
      ...chk(() => str(at(e, "body")), `findings[${i}].body: required non-empty string`),
      ...chk(() => optional(e, "file", str), `findings[${i}].file: non-empty string when present`),
      ...chk(() => optional(e, "fix", str), `findings[${i}].fix: non-empty string when present`),
      ...chk(() => optional(e, "evidence", str), `findings[${i}].evidence: non-empty string when present`),
      ...chk(
        () => optional(e, "disposition", (v) => among(v, ["new", "still-open", "addressed-check"])),
        `findings[${i}].disposition: new|still-open|addressed-check`,
      ),
      ...chk(() => contains(values, at(e, "id")), `findings[${i}].id: matches no option value of this question`),
    ]),
    ...values.filter((v) => !contains(ids, v)).map((v) => `option ${tostring(v)}: no findings entry carries its value`),
    ...duplicates(ids).map((id) => `findings: id ${tostring(id)} appears more than once`),
  ];
}

function skippedErrs(c: unknown, values: unknown[]): string[] {
  const list = entries(c, "skipped");
  const ids = optionalIds(list);
  const restores = ids.map((id) => `restore:${tostring(id)}`);
  return [
    ...chk(() => {
      const s = at(c, "skipped");
      return Array.isArray(s) && s.length > 0;
    }, "skipped: required non-empty array"),
    ...list.flatMap((e, i) => [
      ...chk(() => str(at(e, "id")), `skipped[${i}].id: required non-empty string`),
      ...chk(() => atLeastOne(at(e, "round")), `skipped[${i}].round: integer of at least 1`),
      ...chk(() => among(at(e, "severity"), TIERS), `skipped[${i}].severity: critical|important|minor`),
      ...chk(() => str(at(e, "title")), `skipped[${i}].title: required non-empty string`),
      ...chk(() => typeof at(e, "changed") === "boolean", `skipped[${i}].changed: required boolean`),
      ...chk(() => optional(e, "file", str), `skipped[${i}].file: non-empty string when present`),
      ...chk(
        () => contains(values, `restore:${tostring(at(e, "id"))}`),
        `skipped[${i}].id: matches no option value of this question`,
      ),
    ]),
    ...values.filter((v) => !contains(restores, v)).map((v) => `option ${tostring(v)}: no skipped entry carries its value`),
    ...duplicates(ids).map((id) => `skipped: id ${tostring(id)} appears more than once`),
  ];
}

export function contextShapeErrors(ctx: unknown, where: string, allowed: string[], values: unknown[]): string[] {
  if (!isObject(ctx)) return [`${where}: context must be an object`];
  const shape = jqGet(ctx, "gate-ctx");
  if (!among(shape, allowed)) return [`${where}: gate-ctx must be one of ${allowed.join(", ")}`];
  const errs =
    shape === "plan@1" ? planErrs(ctx)
    : shape === "post@1" ? postErrs(ctx)
    : shape === "review@1" ? reviewErrs(ctx)
    : shape === "boards@1" ? boardsErrs(ctx)
    : shape === "thread@1" ? threadErrs(ctx)
    : shape === "reply@1" ? replyErrs(ctx, values)
    : shape === "carryover@1" ? carryoverErrs(ctx, values)
    : shape === "skipped@1" ? skippedErrs(ctx, values)
    : findingsErrs(ctx, values);
  return errs.map((e) => `${where}: ${e}`);
}

function optionValues(q: unknown): unknown[] {
  return jqValuesOpt(jqGet(q, "options")).map((o) => (isObject(o) ? jqGet(o, "value") : o));
}

/** jq's `.context["gate-ctx"]?`: undefined (jq's empty) when the context cannot be indexed. */
function questionShape(q: unknown): unknown {
  const c = jqGet(q, "context");
  if (c === null || c === undefined) return null;
  return isObject(c) ? jqGet(c, "gate-ctx") : undefined;
}

export function ctxErrors(source: unknown): string[] {
  const questions = jqGet(source, "questions");
  if (!Array.isArray(questions)) return ["questions: required array"];
  const gate = jqHas(source, "context") ? contextShapeErrors(jqGet(source, "context"), "gate", GATE_SHAPES, []) : [];
  const perQuestion = questions
    .filter((q) => jqHas(q, "context"))
    .flatMap((q) =>
      contextShapeErrors(jqGet(q, "context"), tostring(jqGet(q, "id")), QUESTION_SHAPES, optionValues(q)),
    );
  const perThread = questions.filter((q) => {
    const shape = questionShape(q);
    return shape !== undefined && among(shape, PER_THREAD);
  });
  const notMulti = perThread
    .filter((q) => jqGet(q, "multi") !== true)
    .map((q) => `${tostring(jqGet(q, "id"))}: multi: a per-thread question is multi`);
  const offeredTwice = jqGroupBy(
    perThread.map((q) => ({ id: jqGet(q, "id"), t: at(q, "context", "thread") })),
    (x) => x.t,
  )
    .filter((g) => g.length > 1)
    .flatMap((g) => g.slice(1))
    .map((x) => `${tostring(x.id)}: thread ${tostring(x.t)} is offered by more than one question`);
  return [...gate, ...perQuestion, ...notMulti, ...offeredTwice];
}

export function checkSource(source: unknown): { ok: true } | { ok: false; problems: string[] } {
  let problems: string[];
  try {
    problems = ctxErrors(source);
  } catch (e) {
    if (e instanceof JqError) return { ok: false, problems: ["source is not a JSON object"] };
    throw e;
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

export const GATE_CTX_LIMIT = 8192;

export interface FitResult {
  mode: "structured" | "prose";
  trimmed: string[];
  context?: string;
  questions: Record<string, unknown>[];
  bytes: number;
  fits: boolean;
}

type Obj = Record<string, any>;
type Working = { context?: Obj; questions: Obj[]; trimmed?: unknown; [k: string]: unknown };

const SEV: Record<string, string> = {
  blocking: "BLOCKING",
  "non-blocking": "NON-BLOCKING",
  question: "QUESTION",
  none: "NO ASK",
};
const TIER_NAME: Record<string, string> = { critical: "Critical", important: "Important", minor: "Minor" };
const CALL: Record<string, string> = {
  fixed: "fixed by author",
  "not-fixed": "waiting on author",
  "pushback-accepted": "author pushed back, accept",
  "pushback-rejected": "author pushed back, hold firm",
};

const s = (v: unknown): string => tostring(v ?? null);
const plural = (n: unknown, one: string, many: string): string => `${s(n)} ${n === 1 ? one : many}`;
const or = (v: unknown, d: unknown): unknown => (truthy(v) ? v : d);
const has = (o: unknown, k: string): boolean => jqHas(o, k);

function planProse(c: Obj): string {
  return [
    `Responding to ${s(c.reviewer)}'s review`,
    ...(has(c, "round") ? [`round ${s(c.round)}`] : []),
    `${plural(c.threads.total, "thread", "threads")}, ${s(or(c.threads.blocking, 0))} blocking`,
    ...(has(c, "adjudication") ? [s(c.adjudication)] : []),
  ].join(" · ");
}

function postProse(c: Obj): string {
  const fixes = or(c.fixes, []) as Obj[];
  return [
    `Posting replies to ${s(c.reviewer)}'s review`,
    ...(has(c, "round") ? [`round ${s(c.round)}`] : []),
    plural(c.replies, "reply", "replies"),
    ...(fixes.length >= 3 ? [`${fixes.length} fixes pushed`] : fixes.map((f) => `fix pushed ${s(f.sha)}`)),
  ].join(" · ");
}

function reviewProse(c: Obj): string {
  const header = [
    ...(has(c, "reviewer") ? [`Review by ${s(c.reviewer)}`] : []),
    ...(has(c, "round") ? [`round ${s(c.round)}`] : []),
    ...(c.re_review === true ? ["re-review"] : []),
    ...(has(c, "prior") ? [`prior: ${s(c.prior.addressed)} addressed, ${s(c.prior.still_open)} still open`] : []),
  ];
  const counts = TIERS.filter((t) => jqCompare(or(c.findings[t], 0), 0) > 0).map(
    (t) => `${TIER_NAME[t]} (${s(c.findings[t])})`,
  );
  return [
    ...(header.length > 0 ? [header.join(" · ")] : []),
    `Ready to merge: ${s(c.readiness)} -- ${s(c.summary)}`,
    counts.length > 0 ? counts.join(", ") : "No findings",
  ].join("\n");
}

function findingsProse(c: Obj): string {
  return (c.findings as Obj[])
    .map((f) =>
      [
        `[${asciiUpper(s(f.severity))}] ${s(f.title)}` +
          (has(f, "file") ? ` (${s(f.file)})` : "") +
          (has(f, "disposition") ? ` · ${s(f.disposition)}` : ""),
        f.body,
        ...(has(f, "fix") ? [`Fix: ${s(f.fix)}`] : []),
        ...(has(f, "evidence") ? [`Evidence: ${s(f.evidence)}`] : []),
      ].join("\n"),
    )
    .join("\n\n");
}

function carryoverProse(c: Obj): string {
  return [
    [has(c, "file") ? c.file : "General thread", `round ${s(c.round)}`, CALL[c.call]].join(" · "),
    `You wrote: ${s(c.original)}`,
    has(c, "authorReply") ? `Author replied: ${s(c.authorReply)}` : "The author has not replied in this thread.",
    ...(has(c, "note") ? [`Checked: ${s(c.note)}`] : []),
    `Will post as reply: ${s(c.reply)}`,
  ].join("\n");
}

function skippedProse(c: Obj): string {
  return (c.skipped as Obj[])
    .map(
      (e) =>
        `[${asciiUpper(s(e.severity))}] ${s(e.title)}` +
        (has(e, "file") ? ` (${s(e.file)})` : "") +
        ` · skipped in round ${s(e.round)}` +
        (truthy(e.changed) ? " · code changed since" : ""),
    )
    .join("\n");
}

function threadProse(c: Obj): string {
  const kind = c.reply.kind;
  return [
    `[${s(SEV[c.severity])}] ${s(c.author)}: ${s(c.claim.summary)}`,
    ...(or(c.claim.points, []) as unknown[]).map((p) => `- ${s(p)}`),
    `Verdict: ${s(c.verdict.call)}` + (has(c.verdict, "note") ? ` -- ${s(c.verdict.note)}` : ""),
    ...(kind === "verbatim"
      ? [`Will post as reply: ${s(c.reply.text)}`]
      : kind === "direction"
        ? [`Reply direction: ${s(c.reply.text)}`]
        : []),
  ].join("\n");
}

function boardsProse(c: Obj): string {
  return [
    ...(has(c, "summary") ? [s(c.summary)] : []),
    ...(c.boards as Obj[]).flatMap((b) => [
      `- ${[b.case, b.slot, ...(has(b, "theme") ? [b.theme] : [])].map(s).join("/")}: ${s(b.caption)}`,
      `  ${s(b.path)}`,
    ]),
  ].join("\n");
}

function replyProse(c: Obj): string {
  const verb = c.verb === "fix" ? "FIX" + (has(c, "sha") ? ` · ${s(c.sha)}` : "") : "REPLY";
  return `${s(c.file)} ${verb}: ${s(c.text)}`;
}

export function proseContext(ctx: Record<string, unknown>): string {
  const c = ctx as Obj;
  switch (c["gate-ctx"]) {
    case "plan@1":
      return planProse(c);
    case "post@1":
      return postProse(c);
    case "review@1":
      return reviewProse(c);
    case "boards@1":
      return boardsProse(c);
    case "findings@1":
      return findingsProse(c);
    case "carryover@1":
      return carryoverProse(c);
    case "skipped@1":
      return skippedProse(c);
    case "thread@1":
      return threadProse(c);
    default:
      return replyProse(c);
  }
}

const jsonBytes = (v: unknown): number => utf8Bytes(tojson(v));
const shapeOf = (q: Obj): unknown => (isObject(q.context) ? q.context["gate-ctx"] : null);

function ctxBytes(w: Working): number {
  let n = has(w, "context") ? jsonBytes(w.context) : 0;
  for (const q of w.questions) if (has(q, "context")) n += jsonBytes(q.context);
  return n;
}

/** jq's `sort_by(-.b, ...) | first` over candidates already in position order. */
function largest<T extends { b: number }>(cs: T[]): T | undefined {
  return cs.reduce<T | undefined>((best, c) => (best === undefined || c.b > best.b ? c : best), undefined);
}

type Candidate = { i: number; b: number };

function trimUntil(w: Working, limit: number, candidates: () => Candidate[], cut: (i: number) => void): void {
  for (;;) {
    if (ctxBytes(w) < limit) return;
    const c = largest(candidates());
    if (c === undefined) return;
    cut(c.i);
  }
}

function questionCandidates(w: Working, pick: (q: Obj) => boolean): Candidate[] {
  return w.questions.flatMap((q, i) => (pick(q) ? [{ i, b: jsonBytes(q.context) }] : []));
}

const trimmedList = (w: Working): string[] => w.trimmed as string[];

function trimThread(w: Working, f: "points" | "note", limit: number): void {
  const holds = (c: Obj): boolean => (f === "points" ? has(c.claim, "points") : has(c.verdict, "note"));
  trimUntil(
    w,
    limit,
    () => questionCandidates(w, (q) => shapeOf(q) === "thread@1" && holds(q.context)),
    (i) => {
      const c = w.questions[i]!.context;
      if (f === "points") delete c.claim.points;
      else delete c.verdict.note;
      trimmedList(w).push(`${s(w.questions[i]!.id)}:${f}`);
    },
  );
}

function trimCarry(w: Working, f: string, limit: number): void {
  trimUntil(
    w,
    limit,
    () => questionCandidates(w, (q) => shapeOf(q) === "carryover@1" && has(q.context, f)),
    (i) => {
      delete w.questions[i]!.context[f];
      trimmedList(w).push(`${s(w.questions[i]!.id)}:${f}`);
    },
  );
}

function middle(v: string): string {
  const n = cpLength(v);
  const k = Math.floor(n / 4);
  return cpSlice(v, 0, k) + " ... " + cpSlice(v, n - k);
}

/** Shortens, never deletes: carryover@1 reads an absent authorReply as "the author never replied". */
function shortenCarry(w: Working, f: string, limit: number): void {
  trimUntil(
    w,
    limit,
    () =>
      questionCandidates(
        w,
        (q) => shapeOf(q) === "carryover@1" && typeof q.context[f] === "string" && cpLength(q.context[f]) > 80,
      ),
    (i) => {
      const c = w.questions[i]!.context;
      c[f] = middle(c[f]);
      const tag = `${s(w.questions[i]!.id)}:${f}`;
      if (!trimmedList(w).includes(tag)) trimmedList(w).push(tag);
    },
  );
}

function trimEntries(w: Working, f: string, limit: number): void {
  const candidates = (): { i: number; j: number; b: number }[] =>
    w.questions.flatMap((q, i) =>
      shapeOf(q) === "findings@1"
        ? (q.context.findings as Obj[]).flatMap((e, j) => (has(e, f) ? [{ i, j, b: jsonBytes(e[f]) }] : []))
        : [],
    );
  for (;;) {
    if (ctxBytes(w) < limit) return;
    const c = largest(candidates());
    if (c === undefined) return;
    const q = w.questions[c.i]!;
    const entry = q.context.findings[c.j];
    trimmedList(w).push(`${s(q.id)}:${s(entry.id)}:${f}`);
    delete entry[f];
  }
}

function structurable(w: Working): boolean {
  if (!(isObject(w.context) && w.context["gate-ctx"] === "review@1")) return true;
  return w.questions
    .filter((q) => tostring(jqGet(q, "id")).startsWith("findings-"))
    .every((q) => shapeOf(q) === "findings@1");
}

function render(w: Working, mode: FitResult["mode"], limit: number): FitResult {
  const flat = (c: Obj): string => (mode === "prose" ? proseContext(c) : tojson(c));
  const trimmed = (truthy(w.trimmed) ? w.trimmed : []) as string[];
  const context = has(w, "context") ? { context: flat(w.context!) } : {};
  const questions = w.questions.map((q) => (has(q, "context") ? { ...q, context: flat(q.context) } : q));
  let bytes = context.context === undefined ? 0 : utf8Bytes(context.context);
  for (const q of questions) if (has(q, "context")) bytes += utf8Bytes(q.context as string);
  return { mode, trimmed, ...context, questions, bytes, fits: bytes < limit };
}

export function proseOpen(source: GateCtxSource): FitResult {
  return render(structuredClone(source) as Working, "prose", GATE_CTX_LIMIT);
}

/** The most boards one gate carries: twelve realistic entries (a run-folder
    path under a long home, a full-sentence claim, a theme) sit near 4 KB. */
export const BOARDS_PER_GATE = 12;

const isBoards = (w: Working): boolean => isObject(w.context) && w.context["gate-ctx"] === "boards@1";

/** A boards gate the human cannot see in full is never opened: past the
    cap, or past the budget, it is refused so the site splits it. */
export function boardsBudgetError(source: GateCtxSource, fit: FitResult): string | null {
  if (!isBoards(source as Working)) return null;
  const n = ((source.context as Obj).boards as unknown[]).length;
  if (n > BOARDS_PER_GATE) return `boards@1: ${n} boards; open at most ${BOARDS_PER_GATE} per gate`;
  return fit.fits ? null : `boards@1: ${n} boards do not fit the ${GATE_CTX_LIMIT}-byte budget`;
}

export function fitOpen(source: GateCtxSource, limit: number = GATE_CTX_LIMIT): FitResult {
  const src = structuredClone(source) as Working;
  if (isBoards(src)) return render(src, "structured", limit);
  if (!structurable(src)) return render(src, "prose", limit);
  const fitted = { ...structuredClone(src), trimmed: [] } as Working;
  trimThread(fitted, "points", limit);
  trimThread(fitted, "note", limit);
  trimCarry(fitted, "note", limit);
  shortenCarry(fitted, "authorReply", limit);
  shortenCarry(fitted, "original", limit);
  trimEntries(fitted, "evidence", limit);
  trimEntries(fitted, "fix", limit);
  if (ctxBytes(fitted) < limit) return render(fitted, "structured", limit);
  const full = render(src, "prose", limit);
  return full.bytes < limit ? full : render(fitted, "prose", limit);
}
