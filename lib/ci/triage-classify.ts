import type { CompiledPatterns } from "./triage-config.ts";

export type Verdict = "REAL" | "INFRA" | "UNCLEAR";

const REAL_HIT_CAP = 5;
const INFRA_HIT_CAP = 3;
const SGR = /\x1b\[[0-9;]*m/g;
const NONZERO_COUNT = /(^|[^0-9])[1-9][0-9]* (failed|error)/;
const PASS_OR_ZERO = /passed|(^|[^0-9])0 (failed|error)/;

export function stripAnsi(text: string): string {
  return text.replace(SGR, "");
}

function firstHits(lines: string[], patterns: RegExp[], cap: number): string[] {
  const hits: string[] = [];
  for (const line of lines) {
    if (patterns.some((p) => p.test(line))) {
      hits.push(line);
      if (hits.length === cap) break;
    }
  }
  return hits;
}

function keptByExclusionFilter(line: string): boolean {
  const lower = line.toLowerCase();
  if (NONZERO_COUNT.test(lower)) return true;
  return !PASS_OR_ZERO.test(lower);
}

export function classifyTrace(
  raw: string,
  p: CompiledPatterns,
): { verdict: Verdict; realHits: string[]; infraHits: string[] } {
  const lines = stripAnsi(raw).split("\n");
  if (lines.at(-1) === "") lines.pop();
  const realHits = firstHits(lines.filter(keptByExclusionFilter), p.real, REAL_HIT_CAP);
  const infraHits = firstHits(lines, p.infra, INFRA_HIT_CAP);
  const verdict: Verdict = realHits.length > 0 ? "REAL" : infraHits.length > 0 ? "INFRA" : "UNCLEAR";
  return { verdict, realHits, infraHits };
}

export function isNoisy(name: string, allowFailure: boolean, noisyJobs: string[]): boolean {
  return allowFailure && noisyJobs.some((entry) => entry !== "" && name.includes(entry));
}
