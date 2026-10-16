import {
  JqError,
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

const GATE_SHAPES = ["plan@1", "post@1", "review@1"];
const QUESTION_SHAPES = ["thread@1", "reply@1", "findings@1", "carryover@1", "skipped@1"];
const PER_THREAD = ["reply@1", "carryover@1"];
const TIERS = ["critical", "important", "minor"];

const chk = (f: () => unknown, msg: string): string[] => (ok(f) ? [] : [msg]);
const str = (v: unknown): boolean => typeof v === "string" && hasNonSpace(v);
const int = (v: unknown): boolean => typeof v === "number" && v === Math.floor(v) && v >= 0;
const atLeastOne = (v: unknown): boolean => typeof v === "number" && v === Math.floor(v) && v >= 1;
const optional = (o: unknown, k: string, f: (v: unknown) => boolean): boolean => !jqHas(o, k) || f(jqGet(o, k));
const among = (v: unknown, xs: string[]): boolean => xs.some((x) => jqEqual(x, v));
const contains = (xs: unknown[], v: unknown): boolean => xs.some((x) => jqEqual(x, v));
const at = (v: unknown, ...path: string[]): unknown => path.reduce<unknown>((o, k) => jqGet(o, k), v);

function entries(o: unknown, k: string): unknown[] {
  const v = jqGet(o, k);
  return Array.isArray(v) ? v : [];
}

/** jq's `.id?`: an entry jq cannot index contributes nothing. */
function optionalIds(xs: unknown[]): unknown[] {
  return xs.flatMap((x) => {
    try {
      return [jqGet(x, "id")];
    } catch (e) {
      if (e instanceof JqError) return [];
      throw e;
    }
  });
}

function duplicates(ids: unknown[]): unknown[] {
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
    () => jqEqual(jqSort(values), [`post:${t}`, `resolve:${t}`]),
    `options: exactly post:${t} and resolve:${t}`,
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
  const restores = optionalIds(list).map((id) => `restore:${tostring(id)}`);
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
    ...duplicates(optionalIds(list)).map((id) => `skipped: id ${tostring(id)} appears more than once`),
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
