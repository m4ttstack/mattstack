import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { redactDeep } from "../../../lib/mcp/redact";

export type QuestionId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7";
export type CaseResult = {
  question: QuestionId;
  verdict: "proven" | "partial" | "blocked" | "not-run";
  observations: string[];
  consequence: string;
  evidenceRefs: string[];
};
export type CleanupRow = { resource: string; ok: boolean; detail?: string };
export type Evidence = ReturnType<typeof createEvidence>;
export function requireLive(argv: string[]): void {
  if (!argv.includes("--live")) throw new Error("requires --live");
}
export function readJsonl(file: string): any[] {
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(s => JSON.parse(s))
    : [];
}
export function safeAppend(file: string, row: unknown): void {
  appendFileSync(file, JSON.stringify(redactDeep(row)) + "\n", { mode: 0o600 });
}
export function createEvidence(dir: string, versions: Record<string, string>) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const report = {
    runId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    versions,
    baseline: "2026-10-04-codex-compatibility-evidence.json",
    cases: [] as CaseResult[],
    cleanup: [] as CleanupRow[],
  };
  return {
    dir,
    record(kind: string, data: unknown) {
      safeAppend(join(dir, "events.jsonl"), { at: Date.now(), kind, data });
    },
    addCase(r: CaseResult) {
      report.cases.push(r);
    },
    addCleanup(r: CleanupRow) {
      report.cleanup.push(r);
    },
    write() {
      const path = join(dir, "report.json");
      writeFileSync(path, JSON.stringify(redactDeep(report), null, 2) + "\n", {
        mode: 0o600,
      });
      return path;
    },
  };
}
export function assembleReport(paths: string[]) {
  const runs = paths.map(p => JSON.parse(readFileSync(p, "utf8")));
  const cases: CaseResult[] = runs.flatMap(r => r.cases);
  const ids = cases.map(c => c.question);
  if (new Set(ids).size !== ids.length)
    throw new Error("duplicate case; select reruns explicitly");
  return {
    baseline: "2026-10-04-codex-compatibility-evidence.json",
    runs,
    cases,
  };
}
