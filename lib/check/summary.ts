import { redactCredentials } from "../../packages/rt-client/src/redact.ts";

export type CheckSummary = {
  mode: string;
  selected: number | null;
  passed: number | null;
  failed: number | null;
  durationMs: number;
  failures: string[];
};

export type CheckVerdict = "green" | "red" | "error";

const MAX_LENGTH = 140;

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export function parseSummary(stdout: string, _exitCode: number, wallMs: number): CheckSummary {
  const fallback: CheckSummary = { mode: "exit", selected: null, passed: null, failed: null, durationMs: wallMs, failures: [] };
  const last = stdout.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  if (!last) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch {
    return fallback;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
  const o = parsed as Record<string, unknown>;
  return {
    mode: typeof o.mode === "string" ? o.mode : "exit",
    selected: num(o.selected),
    passed: num(o.passed),
    failed: num(o.failed),
    durationMs: typeof o.durationMs === "number" ? o.durationMs : wallMs,
    failures: Array.isArray(o.failures) ? o.failures.filter((f): f is string => typeof f === "string") : [],
  };
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

// Redaction comes first: a clip can cut a token short of the shape the redactor knows.
function clip(text: string): string {
  const safe = redactCredentials(text);
  return safe.length <= MAX_LENGTH ? safe : `${safe.slice(0, MAX_LENGTH - 3)}...`;
}

export function testCount(n: number): string {
  return `${n} ${n === 1 ? "test" : "tests"}`;
}

/** The text a forge shows anyone who can read the repo, so an error is rt's own sentence and never the local reason. */
export function describe(verdict: CheckVerdict, summary: CheckSummary, machine: string, timedOutAfter?: number): string {
  if (verdict === "error") return timedOutAfter === undefined ? "error: the check could not run" : `error: timed out after ${timedOutAfter}s`;
  const time = duration(summary.durationMs);
  if (verdict === "green") {
    if (summary.mode === "skip") return clip("skip: nothing to run for this diff");
    if (summary.mode === "exit") return clip(`exit 0 in ${time} on ${machine}`);
    return clip(`${summary.mode}: ${testCount(summary.selected ?? 0)} in ${time} on ${machine}`);
  }
  if (!summary.failed) return clip(`red: command failed in ${time} on ${machine}`);
  const of = summary.selected === null ? "" : ` of ${summary.selected}`;
  const first = summary.failures[0];
  const tail = first ? `, ${first}${summary.failures.length > 1 ? ` +${summary.failures.length - 1}` : ""}` : "";
  return clip(`red: ${summary.failed}${of} failed${tail}`);
}
