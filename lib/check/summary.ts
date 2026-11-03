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

function clip(text: string): string {
  return text.length <= MAX_LENGTH ? text : `${text.slice(0, MAX_LENGTH - 3)}...`;
}

export function describe(verdict: CheckVerdict, summary: CheckSummary, machine: string, reason?: string): string {
  if (verdict === "error") return clip(`error: ${reason ?? "check did not complete"}`);
  const time = duration(summary.durationMs);
  if (verdict === "green") {
    if (summary.mode === "skip") return clip("skip: nothing to run for this diff");
    if (summary.mode === "exit") return clip(`exit 0 in ${time} on ${machine}`);
    return clip(`${summary.mode}: ${summary.selected ?? 0} tests in ${time} on ${machine}`);
  }
  if (summary.failed === null) return clip(`red: command failed in ${time} on ${machine}`);
  const of = summary.selected === null ? "" : ` of ${summary.selected}`;
  const first = summary.failures[0];
  const tail = first ? `, ${first}${summary.failures.length > 1 ? ` +${summary.failures.length - 1}` : ""}` : "";
  return clip(`red: ${summary.failed}${of} failed${tail}`);
}
