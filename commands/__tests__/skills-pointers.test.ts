import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { checkBlocks, checkPack, compilePackAll, computeRows, skillsCheck, skillsCompile } from "../skills.ts";
import { syncCheckOf } from "../skills-sync.ts";
import { HEADER_COMMENT } from "../../lib/skills/compile.ts";
import { isEmittedAttachmentDir } from "../../lib/skills/base-attachments.ts";
import { closeUnits, keyFiles, stageReadsOf, withMapFile, type UnitPointers } from "../../lib/skills/unit-maps.ts";
import { openingLine } from "../../lib/skills/pointers.ts";
import type { CompiledFile } from "../../lib/skills/types.ts";
import { POINTER_KEYS_MIN_ENGINE } from "../../lib/skills/team-params.ts";
import { compareVersions } from "../../lib/skills/installed-plugins.ts";
import { ORG_LAYOUT } from "../../lib/team/org-marker.ts";
import { captureSkills, runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";

const TOKEN = "${CLAUDE_SKILL_DIR}";
const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  process.exitCode = 0;
});

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

function stage(name: string, stageName: string, consumes: string, produces: string, extra = ""): string {
  return `---\nname: ${name}\ndescription: "${stageName} stage"\ntype: pipeline-step\nmetadata:\n  stage: ${stageName}\n  stage-consumes: ${consumes}\n  stage-produces: ${produces}\n${extra}---\n\n{{stage.fields}}\n`;
}

type Fixture = { packDir: string; mattstackDir: string; manifest: string; baseDir: string; partsDir: string };

/**
 * An invented widgets pack 0.4.2 in an org: a public `work` verb, an internal
 * `receive-review` verb with its own script, a pipeline of `stage-plan`
 * (internal, no pointers) and `stage-x` (public, bound to a fill that vendors
 * a script and a `.md`), a team `references/` source, and a grouped base copy
 * `tools/widget` that work names by `{{pack.path:}}`.
 */
function seed(opts: { receiveExtra?: string } = {}): Fixture {
  const root = tmp("rt-pointers-org-");
  writeFile(join(root, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme", layout: ORG_LAYOUT }));
  const baseDir = join(root, "mattstack", "org", "packs", "acme-base");
  writeFile(join(baseDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme-base", version: "0.1.0" }));
  writeFile(join(baseDir, "pack", "skills.jsonc"), JSON.stringify({ base: true }));
  writeFile(join(baseDir, "attachments", "tools", "widget", "SKILL.md"), "---\nname: widget\ndescription: widget notes\n---\nThen follow {{verb.path:receive-review}}.\n");

  const packDir = join(root, "mattstack", "teams", "widgets", "plugin");
  writeFile(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.4.2" }));
  writeFile(join(packDir, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
  writeFile(join(packDir, "pack", "stubs.jsonc"), JSON.stringify({
    verbs: {
      work: { engine: "work", description: "Run a unit of work" },
      "receive-review": { engine: "receive-review", description: "Receive a review" },
    },
  }));
  writeFile(join(packDir, "pack", "surface.jsonc"), JSON.stringify({ public: ["work", "stage-x"] }));
  writeFile(join(packDir, "attachments", "x-policy", "SKILL.md"), [
    "---",
    "name: x-policy",
    'description: "x rules"',
    "metadata:",
    '  provides: "x-rules@1"',
    "allowed-tools:",
    `  - "Bash(bash ${TOKEN}/y.sh:*)"`,
    "---",
    "",
    `Run \`bash ${TOKEN}/y.sh\` before you start. Styles come from @mantine/core.`,
    "",
  ].join("\n"));
  writeFile(join(packDir, "attachments", "x-policy", "y.sh"), "#!/bin/sh\necho y\n");
  chmodSync(join(packDir, "attachments", "x-policy", "y.sh"), 0o755);
  writeFile(join(packDir, "attachments", "x-policy", "notes.md"), "Run `./y.sh` first.\n");
  writeFile(join(packDir, "attachments", "docs", "guide.md"), "Back to {{verb.path:stage-plan}}.\n");

  const mattstackDir = tmp("rt-pointers-mattstack-");
  const engines = join(mattstackDir, "plugins", "mattstack");
  writeFile(join(engines, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  writeFile(join(engines, "attachments", "pipeline", "work", "index.block.md"), [
    "---",
    "name: work",
    'description: "w"',
    "type: pipeline-step",
    "---",
    "",
    "{{work-type}}",
    "",
    "Read {{verb.path:stage-plan}}, then {{verb.path:stage-x}}.",
    "",
    "Notes: {{pack.path:tools/widget/SKILL.md}} and {{pack.path:docs/guide.md}}.",
    "",
  ].join("\n"));
  writeFile(join(engines, "attachments", "pipeline", "receive-review", "index.block.md"), [
    "---",
    "name: receive-review",
    'description: "rr"',
    "type: pipeline-step",
    "allowed-tools:",
    `  - "Bash(bash ${TOKEN}/scripts/gate-ctx.sh:*)"`,
    "---",
    "",
    `Run \`bash "${TOKEN}/scripts/gate-ctx.sh"\` for the gate context.${opts.receiveExtra ?? ""}`,
    "",
  ].join("\n"));
  writeFile(join(engines, "attachments", "pipeline", "receive-review", "scripts", "gate-ctx.sh"), "#!/bin/sh\necho ctx\n");
  chmodSync(join(engines, "attachments", "pipeline", "receive-review", "scripts", "gate-ctx.sh"), 0o755);
  writeFile(join(engines, "attachments", "pipeline", "stage-plan", "index.block.md"), stage("stage-plan", "plan", "ticket", "approach"));
  writeFile(join(engines, "attachments", "pipeline", "stage-x", "index.block.md"), stage("stage-x", "x", "approach", "commits", 'props:\n  rules:\n    merge: add\n    default: ""\n') + "\n{{props.rules}}\n");

  const manifest = join(tmp("rt-pointers-manifest-"), "skills.jsonc");
  writeFile(manifest, JSON.stringify({
    pipelines: { feature: ["mattstack:stage-plan", "mattstack:stage-x"] },
    bindings: { "mattstack:stage-x": { rules: "widgets:x-policy" } },
  }));
  const partsDir = join(packDir, "skills", "stage-x", "parts");
  return { packDir, mattstackDir, manifest, baseDir, partsDir };
}

const flags = (f: Fixture) => ["--pack-dir", f.packDir, "--mattstack-dir", f.mattstackDir, "--manifest", f.manifest];

async function compile(f: Fixture, ...extra: string[]): Promise<{ exitCode: number | undefined; errors: string[] }> {
  return runExpectingCleanExit(() => skillsCompile([...flags(f), ...extra]));
}

const check = (f: Fixture) => checkPack({ packDir: f.packDir, mattstackDir: f.mattstackDir, manifest: f.manifest });

const read = (f: Fixture, rel: string) => readFileSync(join(f.packDir, rel), "utf8");
const map = (f: Fixture, rel: string) => JSON.parse(read(f, `${rel}/compiled.json`)) as { id: string; dir: string; covers: string[]; keys: Record<string, string> };

/** The one parts folder the stage-x fill vendors into. */
function partsName(f: Fixture): string {
  const [only] = readdirSync(f.partsDir);
  return only!;
}

function mdFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).filter((p) => p.endsWith(".md")).map((p) => join(dir, p));
}

function bodyOf(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}

describe("compile writes keys, ids and closure maps", () => {
  test("each written skill opens with its id, and no body keeps the token", async () => {
    const f = seed();
    expect((await compile(f)).errors).toEqual([]);

    const lines = read(f, "skills/work/SKILL.md").split("\n");
    expect(lines[lines.indexOf(HEADER_COMMENT) + 1]).toBe(openingLine("widgets@0.4.2:work"));

    for (const rel of ["skills/work", "skills/stage-x", "attachments/stage-plan", "attachments/receive-review", "attachments/tools/widget"]) {
      for (const file of mdFiles(join(f.packDir, rel))) expect(bodyOf(readFileSync(file, "utf8"))).not.toContain(TOKEN);
    }
    expect(read(f, "skills/work/references/docs/guide.md")).toStartWith(openingLine("widgets@0.4.2:work"));
    expect(read(f, "attachments/tools/widget/SKILL.md")).toContain(`---\n${openingLine("widgets@0.4.2:widget")}\n`);
  });

  test("a vendored parts .md is keyed from where it lands", async () => {
    const f = seed();
    await compile(f);
    const parts = partsName(f);
    expect(read(f, `skills/stage-x/parts/${parts}/notes.md`)).toBe(`${openingLine("widgets@0.4.2:stage-x")}\n\nRun \`@stage-x/parts/${parts}/y.sh\` first.\n`);
  });

  test("work's map covers both stages and the grouped base copy, and carries the public stage's script", async () => {
    const f = seed();
    await compile(f);
    const parts = partsName(f);
    const work = map(f, "skills/work");
    expect(work.id).toBe("widgets@0.4.2:work");
    expect(work.dir).toBe("skills/work");
    expect(work.covers[0]).toBe("widgets@0.4.2:work");
    expect(work.covers).toEqual(expect.arrayContaining(["widgets@0.4.2:stage-plan", "widgets@0.4.2:stage-x", "widgets@0.4.2:widget", "widgets@0.4.2:receive-review"]));
    expect(work.keys[`stage-x/parts/${parts}/y.sh`]).toBe(`skills/stage-x/parts/${parts}/y.sh`);
    expect(work.keys["stage-plan/SKILL.md"]).toBe("attachments/stage-plan/SKILL.md");
    expect(work.keys["work/references/docs/guide.md"]).toBe("skills/work/references/docs/guide.md");
  });

  test("a repo-relative path no unit writes stays as written and never reaches a pointer gate", async () => {
    const f = seed({ receiveExtra: " Before shipping, run `./gradlew test` and `./scripts/lint.sh` from the repo root." });
    expect((await compile(f)).errors).toEqual([]);
    expect(read(f, "attachments/receive-review/SKILL.md")).toContain("run `./gradlew test` and `./scripts/lint.sh` from the repo root.");
    expect(Object.keys(map(f, "attachments/receive-review").keys)).toEqual(["receive-review/scripts/gate-ctx.sh"]);
    const payload = await check(f);
    expect(payload.pointerErrors ?? []).toEqual([]);
    expect(payload.sourcePointerErrors ?? []).toEqual([]);
  });

  test("a stage's map holds only its own closure", async () => {
    const f = seed();
    await compile(f);
    expect(map(f, "attachments/stage-plan")).toEqual({ id: "widgets@0.4.2:stage-plan", dir: "attachments/stage-plan", covers: ["widgets@0.4.2:stage-plan"], keys: {} });
  });

  test("a base copy that reads a verb by path covers that verb, and keeps its provenance", async () => {
    const f = seed();
    await compile(f);
    expect(map(f, "attachments/tools/widget")).toEqual({
      base: "acme-base",
      version: "0.1.0",
      files: ["SKILL.md"],
      id: "widgets@0.4.2:widget",
      dir: "attachments/tools/widget",
      covers: ["widgets@0.4.2:widget", "widgets@0.4.2:receive-review"],
      keys: {
        "receive-review/SKILL.md": "attachments/receive-review/SKILL.md",
        "receive-review/scripts/gate-ctx.sh": "attachments/receive-review/scripts/gate-ctx.sh",
      },
    } as never);
    expect(read(f, "attachments/tools/widget/SKILL.md")).toContain("Then follow @receive-review/SKILL.md.");
  });

  test("a verb folder with compiled.json is a compiled verb, never an emitted attachment", async () => {
    const f = seed();
    await compile(f);
    const verbDir = join(f.packDir, "attachments", "receive-review");
    expect(existsSync(join(verbDir, "compiled.json"))).toBe(true);
    expect(isEmittedAttachmentDir(verbDir)).toBe(false);
    const { rows } = computeRows(f.packDir, new Set(), null, new Set());
    expect(rows.find((r) => r.name === "receive-review")?.kind).toBe("compiled");
  });

  test("allowed-tools stays byte for byte, and the floor is at least the pointer-keys release", async () => {
    const f = seed();
    await compile(f);
    const tools = (rel: string) => read(f, rel).split("\n").filter((l) => l.startsWith("  - "));
    const parts = partsName(f);
    expect(tools("skills/stage-x/SKILL.md")).toEqual([`  - "Bash(bash ${TOKEN}/../../skills/stage-x/parts/${parts}/y.sh:*)"`]);
    expect(tools("attachments/receive-review/SKILL.md")).toEqual([`  - "Bash(bash ${TOKEN}/scripts/gate-ctx.sh:*)"`]);
    const floor = (JSON.parse(read(f, "pack/requires.json")) as { minEngine: string }).minEngine;
    expect(compareVersions(floor, POINTER_KEYS_MIN_ENGINE)).toBeGreaterThanOrEqual(0);
  });
});

describe("the opening line goes only where a key is", () => {
  const site = { id: "widgets@0.4.2:work", dir: "skills/work", units: { work: "skills/work", "stage-plan": "attachments/stage-plan" }, writtenElsewhere: () => false };
  const skillMd = `---\nname: work\n---\n\n${HEADER_COMMENT}\n\n# Work\n`;
  const textOf = (files: CompiledFile[], path: string) => {
    const file = files.find((f) => f.path === path);
    return file && "content" in file ? file.content : "";
  };
  const keyed = (refBody: string) => keyFiles([{ path: "SKILL.md", content: skillMd }, { path: "references/guide.md", content: refBody }], site);
  const mapOf = (keys: Record<string, string>) => ({ id: site.id, dir: site.dir, covers: [site.id], keys });

  test("a reference with no key gets no line", () => {
    expect(textOf(keyed("# Guide\n").files, "references/guide.md")).toBe("# Guide\n");
  });

  test("a reference that holds a key opens with the unit's line", () => {
    expect(textOf(keyed(`Run \`${TOKEN}/scripts/go.sh\`.\n`).files, "references/guide.md")).toBe(`${openingLine(site.id)}\n\nRun \`@work/scripts/go.sh\`.\n`);
  });

  test("a SKILL.md whose closed map holds a key opens with the line, even with no key of its own", () => {
    const files = withMapFile(keyed("# Guide\n").files, mapOf({ "stage-plan/scripts/x.sh": "attachments/stage-plan/scripts/x.sh" }));
    expect(textOf(files, "SKILL.md")).toBe(`---\nname: work\n---\n\n${HEADER_COMMENT}\n${openingLine(site.id)}\n\n# Work\n`);
  });

  test("a SKILL.md whose closed map is empty gets no line", () => {
    const files = withMapFile(keyed("# Guide\n").files, mapOf({}));
    expect(textOf(files, "SKILL.md")).toBe(skillMd);
    expect(files.map((f) => f.path)).toContain("compiled.json");
  });

  test("a compiled stage with an empty map has no line", async () => {
    const f = seed();
    await compile(f);
    expect(read(f, "attachments/stage-plan/SKILL.md")).not.toContain("Pointers here are");
  });
});

describe("stageReadsOf", () => {
  const entry = (name: string) => ({ name, engine: name, stage: name, dir: `x/${name}`, consumes: [], produces: [] });
  const entries = { feature: [entry("stage-plan"), entry("stage-x")], bugfix: [entry("stage-plan"), entry("stage-y")] };

  test("an orchestrator reaches its pipeline's stages, or every pipeline's for pipeline.stages, whatever its text renders", () => {
    expect(stageReadsOf(entries, "feature", false)).toEqual(["stage-plan", "stage-x"]);
    expect(stageReadsOf(entries, null, true)).toEqual(["stage-plan", "stage-x", "stage-y"]);
    expect(stageReadsOf(entries, null, false)).toEqual([]);
  });
});

describe("check reads keys and stamps", () => {
  test("a clean build has no pointer rows, and a scoped npm name is never a key", async () => {
    const f = seed();
    await compile(f);
    expect(read(f, "skills/stage-x/SKILL.md")).toContain("@mantine/core");
    const payload = await check(f);
    expect(payload.drift).toBe(false);
    expect(payload.pointerErrors ?? []).toEqual([]);
  });

  test("an npm scope that matches a unit's name is not a key, so it never dangles", async () => {
    const f = seed({ receiveExtra: " Its helpers come from @work/core." });
    await compile(f);
    expect(read(f, "attachments/receive-review/SKILL.md")).toContain("@work/core.");
    const payload = await check(f);
    expect(payload.pointerErrors ?? []).toEqual([]);
    expect(payload.sourcePointerErrors ?? []).toEqual([]);
  });

  test("a plugin.json bumped after the compile makes the verbs out of date", async () => {
    const f = seed();
    await compile(f);
    writeFile(join(f.packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.4.3" }));
    const payload = await check(f);
    expect(payload.drift).toBe(true);
    expect(payload.verbs.filter((row) => row.status === "stale").map((row) => row.name).sort()).toEqual(["receive-review", "stage-plan", "stage-x", "work"]);
    expect(payload.attachments.find((row) => row.name === "tools/widget")?.status).toBe("stale");
  });

  async function oneRow(f: Fixture, code: string): Promise<void> {
    const payload = await check(f);
    expect((payload.pointerErrors ?? []).map((d) => d.code)).toEqual([code]);
    expect(renderPlain(checkBlocks(payload, false))).toContain("compiled skills, pointers:");
    const io = captureSkills();
    try {
      await skillsCheck(flags(f));
    } finally {
      io.restore();
    }
    expect(process.exitCode).toBe(1);
  }

  test("a key no map holds is a dangling key", async () => {
    const f = seed();
    await compile(f);
    writeFile(join(f.packDir, "skills", "work", "SKILL.md"), read(f, "skills/work/SKILL.md") + "\nAlso read @work/nope.md.\n");
    await oneRow(f, "dangling-key");
    expect((await check(f)).pointerErrors![0]).toMatchObject({ file: "skills/work/SKILL.md", code: "dangling-key" });
  });

  test("a key whose target file is gone is a missing target", async () => {
    const f = seed();
    await compile(f);
    rmSync(join(f.packDir, "attachments", "receive-review", "scripts", "gate-ctx.sh"));
    await oneRow(f, "missing-target");
  });

  test("a key whose target is a folder is a missing target", async () => {
    const f = seed({ receiveExtra: ` Its scripts live in \`${TOKEN}/scripts\`.` });
    await compile(f);
    expect(read(f, "attachments/receive-review/SKILL.md")).toContain("`@receive-review/scripts`");
    await oneRow(f, "missing-target");
  });

  test("an entry no body uses is checked too, and reported at its compiled.json", async () => {
    const f = seed();
    await compile(f);
    const mapPath = join(f.packDir, "attachments", "stage-plan", "compiled.json");
    const m = JSON.parse(readFileSync(mapPath, "utf8"));
    m.keys["stage-plan/gone.sh"] = "attachments/stage-plan/gone.sh";
    writeFile(mapPath, JSON.stringify(m, null, 2) + "\n");
    const rows = (await check(f)).pointerErrors ?? [];
    expect(rows).toEqual([{ file: "attachments/stage-plan/compiled.json", line: 8, col: 5, code: "missing-target", message: "@stage-plan/gone.sh points at attachments/stage-plan/gone.sh, which is not a file" }]);
  });

  test("a token left in a compiled body is a leftover", async () => {
    const f = seed();
    await compile(f);
    writeFile(join(f.packDir, "attachments", "stage-plan", "SKILL.md"), read(f, "attachments/stage-plan/SKILL.md") + `\nSee ${TOKEN}/x.sh.\n`);
    await oneRow(f, "leftover-token");
  });
});

describe("what sync and init refuse on", () => {
  test("a folder pointer in the sources reaches sync's pointer gate", async () => {
    const f = seed({ receiveExtra: ` Its scripts live in \`${TOKEN}/scripts\`.` });
    await compile(f);
    const payload = await check(f);
    expect((payload.sourcePointerErrors ?? []).map((d) => `${d.file}:${d.code}`)).toEqual(["attachments/receive-review/SKILL.md:missing-target"]);
    expect(syncCheckOf(payload).pointerErrors).toHaveLength(1);
  });

  test("a hand-edited body is drift a recompile clears, never a pointer gate", async () => {
    const f = seed();
    await compile(f);
    writeFile(join(f.packDir, "skills", "work", "SKILL.md"), read(f, "skills/work/SKILL.md") + "\nAlso read @work/nope.md.\n");
    const payload = await check(f);
    expect(payload.pointerErrors!.map((d) => d.code)).toEqual(["dangling-key"]);
    expect(payload.sourcePointerErrors).toEqual([]);
    expect(payload.drift).toBe(true);
  });

  test("a pack compiled before keys is drift with no pointer gate, so sync recompiles it", async () => {
    const f = seed();
    await compile(f);
    // What an earlier rt wrote: the token where the key is now, no compiled.json in a verb, and a base copy's with provenance only.
    for (const rel of ["skills/work", "skills/stage-x", "attachments/stage-plan", "attachments/receive-review"]) rmSync(join(f.packDir, rel, "compiled.json"));
    writeFile(join(f.packDir, "attachments", "tools", "widget", "compiled.json"), JSON.stringify({ base: "acme-base", version: "0.1.0", files: ["SKILL.md"] }, null, 2) + "\n");
    const rr = join(f.packDir, "attachments", "receive-review", "SKILL.md");
    writeFile(rr, readFileSync(rr, "utf8").replace("@receive-review/scripts/gate-ctx.sh", `${TOKEN}/../../attachments/receive-review/scripts/gate-ctx.sh`));
    const payload = await check(f);
    expect((payload.pointerErrors ?? []).some((d) => d.code === "leftover-token")).toBe(true);
    expect(payload.sourcePointerErrors).toEqual([]);
    expect(payload.drift).toBe(true);
    expect(syncCheckOf(payload)).toMatchObject({ drift: true, handErrors: [], pointerErrors: [] });
  });
});

describe("check's source scan", () => {
  test("a target with no folder yet compiles in memory, so a pointer to it is drift and never a source error", async () => {
    const f = seed();
    await compile(f);
    rmSync(join(f.packDir, "attachments", "stage-plan"), { recursive: true });
    const payload = await check(f);
    expect(payload.verbs.find((row) => row.name === "stage-plan")?.status).toBe("never-compiled");
    expect(payload.drift).toBe(true);
    expect(payload.sourcePointerErrors).toEqual([]);
    expect(syncCheckOf(payload)).toMatchObject({ drift: true, handErrors: [], pointerErrors: [], pointerConflicts: [] });
  });

  test("a target with no folder yet still has its own body scanned", async () => {
    const f = seed({ receiveExtra: ` Its scripts live in \`${TOKEN}/scripts\`.` });
    await compile(f);
    rmSync(join(f.packDir, "attachments", "receive-review"), { recursive: true });
    const payload = await check(f);
    expect((payload.sourcePointerErrors ?? []).map((d) => `${d.file}:${d.code}`)).toEqual(["attachments/receive-review/SKILL.md:missing-target"]);
  });

  test("a pointer conflict in check is its own failure, and the source scan is skipped", async () => {
    const f = seed({ receiveExtra: " Then {{verb.path:stage-x}}." });
    await compile(f);
    // receive-review no longer compiles, so check reads the map its last compile wrote, from before stage-x moved.
    writeFile(join(f.packDir, "pack", "surface.jsonc"), JSON.stringify({ public: ["work"] }));
    const engine = join(f.mattstackDir, "plugins", "mattstack", "attachments", "pipeline", "receive-review", "index.block.md");
    writeFile(engine, readFileSync(engine, "utf8").replace("Then {{verb.path:stage-x}}.", "Then {{verb.path:nope}}."));
    const payload = await check(f);
    expect(payload.pointerConflicts).toEqual([
      'pointer key @stage-x/SKILL.md has two targets in work\'s closure: widgets@0.4.2:work names "attachments/stage-x/SKILL.md" and widgets@0.4.2:receive-review names "skills/stage-x/SKILL.md"',
    ]);
    expect(payload.sourcePointerErrors).toEqual([]);
    const seen = syncCheckOf(payload);
    expect(seen.pointerConflicts).toEqual(payload.pointerConflicts!);
    expect(payload.compileErrors).toContain("pack/pipelines.json is out of date with the pack's pipelines");
    expect(seen.brokenSkills).toEqual(["attachments/pipeline/receive-review/index.block.md:9:114: {{verb.path:nope}} -- nope is not a compiled verb of this pack"]);
  });
});

describe("refusals", () => {
  test("two units claiming one key with different targets fail, naming both", () => {
    const units: UnitPointers[] = [
      { leaf: "work", dir: "skills/work", keys: {}, reads: ["stage-plan", "stage-x"] },
      { leaf: "stage-plan", dir: "attachments/stage-plan", keys: { "shared/x.sh": "attachments/stage-plan/x.sh" }, reads: [] },
      { leaf: "stage-x", dir: "skills/stage-x", keys: { "shared/x.sh": "skills/stage-x/x.sh" }, reads: [] },
    ];
    expect(() => closeUnits(units, (leaf) => `widgets@0.4.2:${leaf}`, () => null)).toThrow(/stage-plan.*stage-x|stage-x.*stage-plan/);
  });

  test("a scoped compile against a sibling compiled from another side fails, naming both units", async () => {
    const f = seed({ receiveExtra: " Then {{verb.path:stage-x}}." });
    expect((await compile(f)).errors).toEqual([]);
    writeFile(join(f.packDir, "pack", "surface.jsonc"), JSON.stringify({ public: ["work"] }));
    const { exitCode, errors } = await compile(f, "--verb", "work");
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("pointer key @stage-x/SKILL.md has two targets in work's closure: widgets@0.4.2:work names \"attachments/stage-x/SKILL.md\" and widgets@0.4.2:receive-review names \"skills/stage-x/SKILL.md\"");
    expect(errors.join("\n")).toContain("Compile the whole pack, with no --verb: rt skills compile");
  });

  test("an empty roster with no plugin.json compiles and checks clean", async () => {
    const packDir = tmp("rt-pointers-empty-");
    writeFile(join(packDir, "pack", "stubs.jsonc"), `{ "verbs": {} }\n`);
    const { mattstackDir, manifest } = seed();
    expect(await compilePackAll({ packDir, mattstackDir, manifest, write: false })).toEqual({ ok: true, errors: [], written: [], removed: [] });
    const payload = await checkPack({ packDir, mattstackDir, manifest });
    expect(payload.drift).toBe(false);
    expect(payload.compileErrors).toEqual([]);
  });

  for (const [label, body, fault] of [
    ["JSON it cannot read", "{ name: widgets", "cannot be read as JSON"],
    ["an uppercase name", JSON.stringify({ name: "Widgets", version: "0.4.2" }), 'has the name "Widgets", which a skill id cannot carry'],
    ["a prerelease version", JSON.stringify({ name: "widgets", version: "1.0.0-rc.1" }), 'has the version "1.0.0-rc.1", which a skill id cannot carry'],
  ] as const) {
    test(`a plugin.json with ${label} refuses to compile, naming the file and the value`, async () => {
      const f = seed();
      const file = join(f.packDir, ".claude-plugin", "plugin.json");
      writeFile(file, body);
      const result = await compilePackAll({ packDir: f.packDir, mattstackDir: f.mattstackDir, manifest: f.manifest, write: false });
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toStartWith(`${file} ${fault}`);
    });
  }

  for (const [label, manifest] of [["no plugin.json", null], ["no version in it", { name: "widgets" }]] as const) {
    test(`a pack with ${label} refuses to compile, naming the file`, async () => {
      const f = seed();
      const file = join(f.packDir, ".claude-plugin", "plugin.json");
      if (manifest === null) rmSync(file);
      else writeFile(file, JSON.stringify(manifest));
      const { exitCode, errors } = await compile(f);
      expect(exitCode).toBe(1);
      expect(errors.join("\n")).toContain(file);
      expect(existsSync(join(f.packDir, "skills", "work"))).toBe(false);
    });
  }
});
