import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildStageEntries, hostDir, outDirFor, otherSideDir } from "../layout.ts";

test("outDirFor places public under skills/ and internal under attachments/", () => {
  expect(outDirFor("/pack", "work", true)).toBe("/pack/skills/work");
  expect(outDirFor("/pack", "stage-plan", false)).toBe("/pack/attachments/stage-plan");
});

test("otherSideDir names the stale location for a name that flipped sides", () => {
  expect(otherSideDir("/pack", "work", true)).toBe("/pack/attachments/work");
  expect(otherSideDir("/pack", "checkout", false)).toBe("/pack/skills/checkout");
});

test("hostDir names the token-relative dir a pack-side reader reaches a target at, on either side", () => {
  expect(hostDir("stage-plan", "attachments")).toBe("${CLAUDE_SKILL_DIR}/../../attachments/stage-plan");
  expect(hostDir("checkout", "skills")).toBe("${CLAUDE_SKILL_DIR}/../../skills/checkout");
});

function stageEngine(name: string, stage: string): string {
  return `---\nname: ${name}\ndescription: "${name}"\ntype: pipeline-step\nmetadata:\n  stage: "${stage}"\n  stage-consumes: "ticket"\n  stage-produces: "${stage}"\n---\n\n${name} body\n`;
}

test("a pipeline whose stage has a copy points its entry at the copy; the default pipeline keeps the stage", () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-layout-"));
  for (const [name, stage] of [["stage-plan", "plan"], ["stage-evidence", "evidence"]] as const) {
    mkdirSync(join(dir, "attachments", "pipeline", name), { recursive: true });
    writeFileSync(join(dir, "attachments", "pipeline", name, "SKILL.md"), stageEngine(name, stage));
  }
  const stages = ["mattstack:stage-plan", "mattstack:stage-evidence"];

  const entries = buildStageEntries({
    pipelines: { feature: stages, accessibility: stages },
    pluginRoots: { byName: { mattstack: { dir, version: "1.0.0" } }, list: [] },
    publicSet: null,
    copies: new Set(["stage-evidence--accessibility"]),
  });

  const evidence = (type: string) => entries[type]!.find((e) => e.stage === "evidence")!;
  expect(evidence("accessibility").name).toBe("stage-evidence--accessibility");
  expect(evidence("accessibility").engine).toBe("stage-evidence");
  expect(evidence("accessibility").dir.endsWith("/attachments/stage-evidence--accessibility")).toBe(true);
  expect(evidence("feature").name).toBe("stage-evidence");
  expect(evidence("feature").engine).toBe("stage-evidence");
  expect(evidence("feature").dir.endsWith("/attachments/stage-evidence")).toBe(true);
  expect(entries.accessibility!.find((e) => e.stage === "plan")!.name).toBe("stage-plan");
});
