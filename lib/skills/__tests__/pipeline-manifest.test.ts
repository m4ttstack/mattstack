import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StageEntry } from "../types";
import { PIPELINES_REL, parsePipelinesManifest, pipelinesWrite, renderPipelinesManifest } from "../pipeline-manifest";

const entry = (name: string, side: string, stage = "plan"): StageEntry => ({
  name, engine: name, stage, dir: `\${CLAUDE_SKILL_DIR}/../../${side}/${name}`, consumes: ["ticket"], produces: ["plan"],
});

describe("renderPipelinesManifest", () => {
  test("renders each pipeline's stages with a pack-relative file", () => {
    const text = renderPipelinesManifest({
      feature: [entry("stage-plan", "attachments")],
      review: [entry("stage-look", "skills", "look")],
    });
    const m = JSON.parse(text as string);
    expect(m.version).toBe(1);
    expect(m.pipelines.feature[0]).toEqual({
      stage: "plan", name: "stage-plan", file: "attachments/stage-plan/SKILL.md", consumes: ["ticket"], produces: ["plan"],
    });
    expect(m.pipelines.review[0].file).toBe("skills/stage-look/SKILL.md");
    expect(text as string).toEndWith("\n");
  });

  test("renders null for no pipelines", () => {
    expect(renderPipelinesManifest({})).toBeNull();
    expect(renderPipelinesManifest({ feature: [] })).toBeNull();
  });
});

describe("parsePipelinesManifest", () => {
  const valid = (over: object = {}) => JSON.stringify({
    version: 1,
    pipelines: { feature: [{ stage: "plan", name: "stage-plan", file: "attachments/stage-plan/SKILL.md", consumes: [], produces: [] }] },
    ...over,
  });
  const withStage = (s: object) => valid({ pipelines: { feature: [s] } });
  const stage = { stage: "plan", name: "n", file: "attachments/n/SKILL.md", consumes: [], produces: [] };

  test("parse round-trips the rendered text", () => {
    const text = renderPipelinesManifest({ feature: [entry("stage-plan", "attachments")] }) as string;
    const r = parsePipelinesManifest(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.manifest, null, 2) + "\n").toBe(text);
  });

  test("parse refuses an unknown version, a non-array pipeline, a stage without a string stage, non-string consumes", () => {
    expect(parsePipelinesManifest("not json").ok).toBe(false);
    expect(parsePipelinesManifest(valid({ version: 2 })).ok).toBe(false);
    expect(parsePipelinesManifest(valid({ pipelines: { feature: {} } })).ok).toBe(false);
    expect(parsePipelinesManifest(withStage({ ...stage, stage: 3 })).ok).toBe(false);
    expect(parsePipelinesManifest(withStage({ ...stage, consumes: [1] })).ok).toBe(false);
    expect(parsePipelinesManifest(withStage({ ...stage, produces: "x" })).ok).toBe(false);
  });

  test("parse refuses a file that is absolute or has a .. segment", () => {
    for (const file of ["/etc/passwd", "../x/SKILL.md", "a/../../x", "a\\..\\x"]) {
      const r = parsePipelinesManifest(withStage({ ...stage, file }));
      expect(r.ok).toBe(false);
    }
    expect(parsePipelinesManifest(withStage(stage)).ok).toBe(true);
  });
});

describe("pipelinesWrite", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const readFile = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const setup = () => { const d = mkdtempSync(join(tmpdir(), "acme-pipelines-")); dirs.push(d); return d; };
  const stageEntries = { feature: [entry("stage-plan", "attachments")] };

  test("missing file is stale without write, written with write, then current", () => {
    const packDir = setup();
    expect(pipelinesWrite({ packDir, stageEntries }, readFile, false)).toEqual({ written: [], removed: [], stale: true });
    expect(existsSync(join(packDir, PIPELINES_REL))).toBe(false);
    expect(pipelinesWrite({ packDir, stageEntries }, readFile, true)).toEqual({ written: [PIPELINES_REL], removed: [], stale: false });
    expect(readFileSync(join(packDir, PIPELINES_REL), "utf8")).toBe(renderPipelinesManifest(stageEntries) as string);
    expect(pipelinesWrite({ packDir, stageEntries }, readFile, false)).toEqual({ written: [], removed: [], stale: false });
  });

  test("a differing file is stale and rewritten", () => {
    const packDir = setup();
    mkdirSync(join(packDir, "pack"));
    writeFileSync(join(packDir, PIPELINES_REL), "{}\n");
    expect(pipelinesWrite({ packDir, stageEntries }, readFile, false).stale).toBe(true);
    expect(pipelinesWrite({ packDir, stageEntries }, readFile, true).written).toEqual([PIPELINES_REL]);
  });

  test("no pipelines and a file present removes it; no file does nothing", () => {
    const packDir = setup();
    expect(pipelinesWrite({ packDir, stageEntries: {} }, readFile, true)).toEqual({ written: [], removed: [], stale: false });
    mkdirSync(join(packDir, "pack"));
    writeFileSync(join(packDir, PIPELINES_REL), "{}\n");
    expect(pipelinesWrite({ packDir, stageEntries: {} }, readFile, false).stale).toBe(true);
    expect(pipelinesWrite({ packDir, stageEntries: {} }, readFile, true)).toEqual({ written: [], removed: [PIPELINES_REL], stale: false });
    expect(existsSync(join(packDir, PIPELINES_REL))).toBe(false);
  });
});
