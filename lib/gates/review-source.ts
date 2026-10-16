import {
  type GateCtxSource,
  among,
  at,
  atLeastOne,
  chk,
  duplicates,
  entries,
  int,
  optional,
  optionalIds,
} from "./ctx.ts";
import {
  JqError,
  asciiLower,
  isObject,
  isSpace,
  jqEqual,
  jqGet,
  jqHas,
  tostring,
  truthy,
  utf8Bytes,
} from "./jq.ts";

type Obj = Record<string, any>;

const TIERS = ["Critical", "Important", "Minor"];
const str = (v: unknown): boolean => typeof v === "string" && v.length > 0;
const structured = (f: unknown): boolean => jqEqual(at(f, "version"), 2) || jqEqual(at(f, "version"), 3);

/** jq's `.[]`: elements or values, an error on anything else. */
function iterate(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isObject(v)) return Object.values(v);
  throw new JqError("Cannot iterate");
}

function startsWith(v: unknown, prefix: string): boolean {
  if (typeof v !== "string") throw new JqError("startswith() requires string inputs");
  return v.startsWith(prefix);
}

function findingErrs(e: unknown, i: number, v2: boolean): string[] {
  const p = `findings[${i}]`;
  return [
    ...chk(() => str(at(e, "id")), `${p}.id: required non-empty string`),
    ...chk(() => among(at(e, "tier"), TIERS), `${p}.tier: Critical|Important|Minor`),
    ...chk(() => str(at(e, "title")), `${p}.title: required non-empty string`),
    ...(v2 ? chk(() => str(at(e, "body")), `${p}.body: required non-empty string`) : []),
    ...chk(() => optional(e, "evidence", str), `${p}.evidence: non-empty string when present`),
    ...chk(
      () => optional(e, "disposition", (v) => among(v, ["new", "still-open", "addressed-check"])),
      `${p}.disposition: new|still-open|addressed-check`,
    ),
    ...chk(() => optional(e, "file", str), `${p}.file: non-empty string when present`),
    ...chk(() => optional(e, "line", int), `${p}.line: integer when present`),
    ...chk(() => optional(e, "fileLabel", str), `${p}.fileLabel: non-empty string when present`),
    ...chk(() => optional(e, "fix", str), `${p}.fix: non-empty string when present`),
    ...chk(() => optional(e, "kind", str), `${p}.kind: non-empty string when present`),
  ];
}

function threadErrs(t: unknown, i: number): string[] {
  const p = `threads[${i}]`;
  return [
    ...chk(() => str(at(t, "discussionId")), `${p}.discussionId: required non-empty string`),
    ...chk(() => atLeastOne(at(t, "round")), `${p}.round: integer of at least 1`),
    ...chk(
      () => among(at(t, "call"), ["fixed", "not-fixed", "pushback-accepted", "pushback-rejected"]),
      `${p}.call: fixed|not-fixed|pushback-accepted|pushback-rejected`,
    ),
    ...chk(() => str(at(t, "original")), `${p}.original: required non-empty string`),
    ...chk(() => str(at(t, "reply")), `${p}.reply: required non-empty string`),
    ...chk(() => optional(t, "file", str), `${p}.file: non-empty string when present`),
    ...chk(() => optional(t, "line", atLeastOne), `${p}.line: integer of at least 1 when present`),
    ...chk(() => optional(t, "authorReply", str), `${p}.authorReply: non-empty string when present`),
    ...chk(() => optional(t, "note", str), `${p}.note: non-empty string when present`),
  ];
}

function skipErrs(s: unknown, i: number): string[] {
  const p = `skipped[${i}]`;
  return [
    ...chk(() => str(at(s, "id")), `${p}.id: required non-empty string`),
    ...chk(() => atLeastOne(at(s, "round")), `${p}.round: integer of at least 1`),
    ...chk(() => among(at(s, "tier"), TIERS), `${p}.tier: Critical|Important|Minor`),
    ...chk(() => str(at(s, "title")), `${p}.title: required non-empty string`),
    ...chk(() => typeof at(s, "changed") === "boolean", `${p}.changed: required boolean`),
    ...chk(() => optional(s, "file", str), `${p}.file: non-empty string when present`),
    ...chk(() => optional(s, "line", atLeastOne), `${p}.line: integer of at least 1 when present`),
  ];
}

function fileErrs(f: Obj): string[] {
  const v2 = structured(f);
  const findings = entries(f, "findings");
  const threads = entries(f, "threads");
  const skips = entries(f, "skipped");
  return [
    ...chk(
      () => optional(f, "version", (v) => jqEqual(v, 2) || jqEqual(v, 3)),
      "version: 2 or 3 when present (absent is a legacy file)",
    ),
    ...chk(() => among(at(f, "summary", "readiness"), ["yes", "no", "with-fixes"]), "summary.readiness: yes|no|with-fixes"),
    ...chk(() => str(at(f, "summary", "reasoning")), "summary.reasoning: required non-empty string"),
    ...chk(() => Array.isArray(at(f, "findings")), "findings: required array"),
    ...chk(() => optional(f, "re_review", (v) => typeof v === "boolean"), "re_review: boolean when present"),
    ...chk(
      () => optional(f, "prior", (v) => isObject(v) && int(at(v, "addressed")) && int(at(v, "still_open"))),
      "prior: {addressed, still_open} integers when present",
    ),
    ...findings.flatMap((e, i) => findingErrs(e, i, v2)),
    ...chk(() => optional(f, "threads", Array.isArray), "threads: array when present"),
    ...threads.flatMap(threadErrs),
    ...duplicates(optionalIds(threads, "discussionId")).map(
      (d) => `threads: discussion ${tostring(d)} appears more than once`,
    ),
    ...chk(() => optional(f, "skipped", Array.isArray), "skipped: array when present"),
    ...skips.flatMap(skipErrs),
    ...duplicates(optionalIds(skips)).map((d) => `skipped: id ${tostring(d)} appears more than once`),
    ...duplicates(optionalIds(findings)).map((d) => `findings: id ${tostring(d)} appears more than once`),
  ];
}

function extrasErrs(x: Obj): string[] {
  return [
    ...chk(() => str(at(x, "target")), "target: required non-empty string"),
    ...chk(() => optional(x, "reviewer", str), "reviewer: non-empty string when present"),
    ...chk(() => optional(x, "round", atLeastOne), "round: integer of at least 1 when present"),
    ...chk(() => {
      const qs = at(x, "questions");
      return Array.isArray(qs) && qs.length > 0 && qs.every((q) => isObject(q) && str(at(q, "id")));
    }, "questions: required non-empty array of questions with an id"),
    ...chk(
      () =>
        iterate(at(x, "questions")).every((q) => {
          const id = jqGet(q, "id");
          return !(startsWith(id, "findings-") || startsWith(id, "thread-") || startsWith(id, "skipped-"));
        }),
      "questions: findings-*, thread-* and skipped-* ids are built from the findings file",
    ),
  ];
}

export function reviewSourceErrors(findings: unknown, extras: unknown): string[] {
  if (!isObject(findings)) return ["findings file: not a JSON object"];
  if (!isObject(extras)) return ["extras: not a JSON object"];
  return [
    ...fileErrs(findings).map((e) => `findings file: ${e}`),
    ...extrasErrs(extras).map((e) => `extras: ${e}`),
  ];
}

/** Byte totals of the first k codepoints, so each cut is measured in O(1). */
function prefixBytes(cs: string[]): number[] {
  const pre = [0];
  for (const c of cs) pre.push(pre[pre.length - 1]! + utf8Bytes(c));
  return pre;
}

const ELLIPSIS = "…";
const ELLIPSIS_BYTES = utf8Bytes(ELLIPSIS);

export function midTrunc(s: string, maxBytes: number): string {
  if (utf8Bytes(s) <= maxBytes) return s;
  const cs = Array.from(s);
  const n = cs.length;
  const pre = prefixBytes(cs);
  for (let k = n - 1; k >= 0; k--) {
    const head = Math.floor((k + 1) / 2);
    const tail = n - Math.floor(k / 2);
    if (pre[head]! + ELLIPSIS_BYTES + pre[n]! - pre[tail]! <= maxBytes) {
      return cs.slice(0, head).join("") + ELLIPSIS + cs.slice(tail).join("");
    }
  }
  return "";
}

export function endTrunc(s: string, maxBytes: number): string {
  if (utf8Bytes(s) <= maxBytes) return s;
  if (maxBytes < 3) return "";
  const cs = Array.from(s);
  const pre = prefixBytes(cs);
  let k = cs.length - 1;
  while (k > 0 && pre[k]! + ELLIPSIS_BYTES > maxBytes) k--;
  return cs.slice(0, k).join("") + ELLIPSIS;
}

function pick(o: Obj, keys: string[]): Obj {
  return Object.fromEntries(Object.keys(o).filter((k) => keys.includes(k)).map((k) => [k, o[k]]));
}

function joinLine(o: Obj): string {
  return `${tostring(o.file)}:${tostring(o.line)}`;
}

function anchor(e: Obj): unknown {
  if (jqHas(e, "file") && jqHas(e, "line")) return joinLine(e);
  if (jqHas(e, "file")) return e.file;
  return jqGet(e, "fileLabel");
}

function kindWord(e: Obj): string {
  const raw = truthy(e.kind) ? asciiLower(e.kind) : "";
  let hyphened = "";
  let inRun = false;
  for (const ch of raw) {
    const sep = ch === "_" || isSpace(ch);
    if (sep && !inRun) hyphened += "-";
    else if (!sep) hyphened += ch;
    inRun = sep;
  }
  let w = hyphened.replace(/[^a-z-]/g, "").replace(/-+/g, "-");
  if (w.startsWith("-")) w = w.slice(1);
  if (w.endsWith("-")) w = w.slice(0, -1);
  return w;
}

function optLabel(e: Obj): string {
  const prefix = `[${tostring(e.tier)}] `;
  return prefix + midTrunc(e.title, 200 - utf8Bytes(prefix));
}

function optDescription(e: Obj): string | null {
  const a = anchor(e);
  const head = truthy(a) ? `${a} · ` : "";
  const kind = kindWord(e);
  const tail = kind === "" ? "" : ` · kind:${kind}`;
  const fix = jqHas(e, "fix") ? endTrunc(e.fix, 1024 - utf8Bytes(head) - utf8Bytes(tail)) : "";
  if (fix !== "") return head + fix + tail;
  if (truthy(a)) return `${a}${tail}`;
  return null;
}

function option(e: Obj): Obj {
  const d = optDescription(e);
  return { value: e.id, label: optLabel(e), ...(d !== null ? { description: d } : {}) };
}

function entry(e: Obj): Obj {
  const kind = kindWord(e);
  return {
    id: jqGet(e, "id"),
    severity: asciiLower(e.tier),
    title: jqGet(e, "title"),
    body: jqGet(e, "body"),
    ...(jqHas(e, "file") ? { file: jqHas(e, "line") ? joinLine(e) : e.file } : {}),
    ...pick(e, ["fix", "evidence", "disposition"]),
    ...(kind === "" ? {} : { kind }),
  };
}

const rank = (e: Obj): number => TIERS.indexOf(e.tier);

function threadAnchor(t: Obj): string | null {
  if (jqHas(t, "file") && jqHas(t, "line")) return joinLine(t);
  if (jqHas(t, "file")) return t.file;
  return null;
}

const settled = (t: Obj): boolean => t.call === "fixed" || t.call === "pushback-accepted";

function threadQuestion(t: Obj, n: number): Obj {
  const a = threadAnchor(t);
  return {
    id: `thread-${n}`,
    label: a ?? "General thread",
    multi: true,
    context: {
      "gate-ctx": "carryover@1",
      thread: jqGet(t, "discussionId"),
      round: jqGet(t, "round"),
      call: jqGet(t, "call"),
      original: jqGet(t, "original"),
      reply: jqGet(t, "reply"),
      ...(a !== null ? { file: a } : {}),
      ...pick(t, ["authorReply", "note"]),
    },
    options: [
      { value: `post:${tostring(t.discussionId)}`, label: "Post reply (recommended)" },
      {
        value: `resolve:${tostring(t.discussionId)}`,
        label: settled(t) ? "Resolve thread (recommended)" : "Resolve thread",
      },
    ],
  };
}

function skipOption(s: Obj): Obj {
  const a = threadAnchor(s);
  const parts = [a, `skipped in round ${tostring(s.round)}`, truthy(s.changed) ? "code changed since" : null];
  return {
    value: `restore:${tostring(s.id)}`,
    label: optLabel(s),
    description: parts.filter((p) => p !== null).join(" · "),
  };
}

function skipEntry(s: Obj): Obj {
  const a = threadAnchor(s);
  return {
    id: jqGet(s, "id"),
    round: jqGet(s, "round"),
    severity: asciiLower(s.tier),
    title: jqGet(s, "title"),
    ...(a !== null ? { file: a } : {}),
    changed: jqGet(s, "changed"),
  };
}

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Assumes inputs that passed `reviewSourceErrors`. */
export function buildReviewSource(findings: Record<string, unknown>, extras: Record<string, unknown>): GateCtxSource {
  const f = findings as Obj;
  const x = extras as Obj;
  const v2 = structured(f);
  const ordered = (f.findings as Obj[])
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .map(({ e }) => e);
  const counts: Obj = {};
  for (const e of ordered) {
    const tier = asciiLower(e.tier);
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  const context = {
    "gate-ctx": "review@1",
    ...pick(x, ["reviewer"]),
    readiness: f.summary.readiness,
    summary: f.summary.reasoning,
    findings: counts,
    ...pick(x, ["round"]),
    ...pick(f, ["re_review", "prior"]),
  };
  const threadQs = (entries(f, "threads") as Obj[]).map((t, i) => threadQuestion(t, i + 1));
  const findingQs = chunks(ordered, 4).map((chunk, i) => ({
    id: `findings-${i + 1}`,
    label: `Post which findings to ${tostring(x.target)}?`,
    multi: true,
    ...(v2 ? { context: { "gate-ctx": "findings@1", findings: chunk.map(entry) } } : {}),
    options: chunk.map(option),
  }));
  const skipQs = chunks(entries(f, "skipped") as Obj[], 4).map((chunk, i) => ({
    id: `skipped-${i + 1}`,
    label: "Bring back a finding you skipped earlier?",
    multi: true,
    context: { "gate-ctx": "skipped@1", skipped: chunk.map(skipEntry) },
    options: chunk.map(skipOption),
  }));
  return { context, questions: [...threadQs, ...findingQs, ...skipQs, ...(x.questions as unknown[])] };
}
