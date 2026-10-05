import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

import { assembleReport, createEvidence, requireLive } from "../evidence";

test("requires explicit live and redacts nested evidence before disk", () => {
  expect(() => requireLive([])).toThrow("--live");
  const dir = mkdtempSync(join(tmpdir(), "ev-"));
  const ev = createEvidence(dir, { codex: "test" });
  ev.record("metadata", {
    nested: { url: "https://x.test/?private_token=glpat-abcdefghijklmnopqrst" },
  });
  expect(readFileSync(join(dir, "events.jsonl"), "utf8")).not.toContain(
    "glpat-abcdefghijklmnopqrst"
  );
});
test("assembles all case groups without overwriting conflicting reruns", () => {
  const reports = [["G1", "G2", "G6"], ["G3", "G4", "G7"], ["G5"]].map(
    (ids, i) => {
      const ev = createEvidence(mkdtempSync(join(tmpdir(), "ev-")), {
        codex: String(i),
      });
      for (const id of ids)
        ev.addCase({
          question: id as any,
          verdict: "partial",
          observations: [],
          consequence: "pending",
          evidenceRefs: [],
        });
      ev.addCleanup({ resource: "owned pane", ok: false });
      return ev.write();
    }
  );
  const all = assembleReport(reports);
  expect(all.cases).toHaveLength(7);
  expect(all.runs).toHaveLength(3);
  expect(all.cases.every((c: any) => c.verdict === "partial")).toBe(true);
  expect(() => assembleReport([...reports, reports[0]!])).toThrow("duplicate");
});
