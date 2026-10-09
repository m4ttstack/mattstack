import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { skillsCheck, skillsCompile } from "../../../commands/skills.ts";
import { compileSkill } from "../compile.ts";
import { checkExpanded, expandSkills, writeExpanded } from "../expand.ts";
import { parseFragments, resolveHarnessTarget, TARGET_MARKER, type SkillTarget } from "../harness-target.ts";
import { outDirFor } from "../layout.ts";
import { resolvePluginRootsFromDir } from "../sources.ts";
import type { AttachmentSource, CompiledFile, StepSource, VerbDef } from "../types.ts";
import { captureSkills, runExpectingCleanExit } from "./helpers.ts";

const FRAGMENTS = {
  claude: { questions: "Ask with one AskUserQuestion call.\nRead the answer from the tool result." },
  codex: { questions: "Open a gate with the gate_ask tool.\nThen wait with `rt gate wait` until it answers." },
};

async function target(harness: "claude" | "codex", fragments: Record<string, string> = FRAGMENTS[harness]): Promise<SkillTarget> {
  const resolved = await resolveHarnessTarget(harness, { fragments });
  if (!resolved.ok) throw new Error(resolved.error.message);
  return resolved.data;
}

const verb: VerbDef = { name: "ask", engine: "ask", description: "Ask the operator" };

// A real step dir: a non-Claude compile reads its shipped scripts for advisories.
const STEP_DIR = mkdtempSync(join(tmpdir(), "rt-harness-step-"));
mkdirSync(join(STEP_DIR, "scripts"), { recursive: true });
writeFileSync(join(STEP_DIR, "scripts", "ask.sh"), "#!/bin/sh\n# Invoke: \"${CLAUDE_SKILL_DIR}/scripts/ask.sh\"\necho ask\n");

afterAll(() => {
  rmSync(STEP_DIR, { recursive: true, force: true });
});

function attachment(binding: string, body: string, provides = ""): AttachmentSource {
  return {
    binding, plugin: binding.split(":")[0]!, version: "1.0.0", dir: STEP_DIR, srcPath: `attachments/${binding.split(":")[1]}/SKILL.md`,
    bodyStartLine: 5, body, provides, allowedTools: [], extraFiles: [], registered: false,
  };
}

function step(body: string, requires: string[] = []): StepSource {
  return {
    name: "ask",
    plugin: "mattstack",
    version: "1.0.0",
    dir: STEP_DIR,
    srcPath: "skills/flow/ask/SKILL.md",
    bodyStartLine: 6,
    body,
    slots: {},
    allowedTools: ["Bash(${CLAUDE_SKILL_DIR}/scripts/ask.sh:*)"],
    stepFiles: ["scripts/ask.sh"],
    stageMeta: null,
    description: "",
    requires,
  };
}

const BODY = "# Ask\n\nRun `${CLAUDE_SKILL_DIR}/scripts/ask.sh` first.\n\n{{harness:questions}}\n\nThen continue.";

function skillMd(files: CompiledFile[]): string {
  const f = files.find((x) => x.path === "SKILL.md");
  if (!f || !("content" in f)) throw new Error("no SKILL.md");
  return f.content;
}

describe("resolveHarnessTarget", () => {
  test("an unknown harness has no target", async () => {
    const r = await resolveHarnessTarget("emacs");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unsupported");
  });

  test("reads fragments from the mattstack plugin's harness attachment", async () => {
    const root = mkdtempSync(join(tmpdir(), "rt-harness-target-"));
    try {
      mkdirSync(join(root, "plugins", "mattstack", "attachments", "harness"), { recursive: true });
      writeFileSync(
        join(root, "plugins", "mattstack", "attachments", "harness", "codex.md"),
        "---\nname: harness-codex\n---\n\n# Codex\n\nIntro text.\n\n## questions\n\nOpen a gate.\n\n## wait\n\nWait on it.\n",
      );
      const r = await resolveHarnessTarget("codex", { roots: resolvePluginRootsFromDir(root) });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.fragments).toEqual({ questions: "Open a gate.", wait: "Wait on it." });
      expect(r.data.fragmentSpans?.questions).toEqual({ path: "attachments/harness/codex.md", start: 11, end: 11 });
      const none = await resolveHarnessTarget("claude", { roots: resolvePluginRootsFromDir(root) });
      expect(none.ok && none.data.fragments).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a fragment declared twice is invalid", () => {
    const r = parseFragments("## questions\n\na\n\n## questions\n\nb\n", "harness/codex.md");
    expect(r.ok).toBe(false);
  });
});

describe("compiling one source for two harnesses", () => {
  test("same source compiles distinct native sequences", async () => {
    const claude = compileSkill(verb, step(BODY, ["skill-resources"]), {}, new Set(), { target: await target("claude") });
    const codex = compileSkill(verb, step(BODY, ["skill-resources"]), {}, new Set(), { target: await target("codex") });
    expect(claude.errors).toHaveLength(0);
    expect(codex.errors).toHaveLength(0);

    const claudeMd = skillMd(claude.files);
    expect(claudeMd).toContain("Ask with one AskUserQuestion call.\nRead the answer from the tool result.");
    expect(claudeMd).toContain("Run `${CLAUDE_SKILL_DIR}/scripts/ask.sh` first.");
    expect(claudeMd).toContain('  - "Bash(${CLAUDE_SKILL_DIR}/scripts/ask.sh:*)"');

    const codexMd = skillMd(codex.files);
    expect(codexMd).toContain("Open a gate with the gate_ask tool.\nThen wait with `rt gate wait` until it answers.");
    expect(codexMd).toContain("Run `scripts/ask.sh` first.");
    expect(codexMd).toContain('  - "Bash(scripts/ask.sh:*)"');
    expect(codexMd).not.toContain("AskUserQuestion");
    expect(codexMd).not.toContain("${CLAUDE_SKILL_DIR}");
    expect(codexMd).not.toContain("{{");
    // The shared prose around the fragment is the same in both.
    expect(codexMd).toContain("Then continue.");
    expect(claudeMd).toContain("Then continue.");
  });

  test("omitting the target keeps the legacy Claude artifact", async () => {
    const plain = "# Ask\n\nRun `${CLAUDE_SKILL_DIR}/scripts/ask.sh` first.";
    const legacy = compileSkill(verb, step(plain), {}, new Set());
    const claude = compileSkill(verb, step(plain), {}, new Set(), { target: await target("claude") });
    expect(skillMd(claude.files)).toBe(skillMd(legacy.files));
  });

  test("missing required capability rejects compilation", async () => {
    const codex = compileSkill(verb, step(BODY, ["native-question-tool"]), {}, new Set(), { target: await target("codex") });
    expect(codex.errors).toEqual(['verb "ask": needs the "native-question-tool" capability, which the codex target does not have']);
    const claude = compileSkill(verb, step(BODY, ["native-question-tool"]), {}, new Set(), { target: await target("claude") });
    expect(claude.errors).toHaveLength(0);
  });

  test("a fragment the target does not supply rejects compilation", async () => {
    const codex = compileSkill(verb, step(BODY), {}, new Set(), { target: await target("codex", {}) });
    expect(codex.errors).toEqual(['verb "ask": {{harness:questions}} at line 5 has no "questions" fragment in the codex target']);
    const legacy = compileSkill(verb, step(BODY), {}, new Set());
    expect(legacy.errors).toEqual(['verb "ask": {{harness:questions}} at line 5 has no "questions" fragment in the claude target']);
  });

  test("a script line that uses a Claude variable is reported for codex, a comment line is not", async () => {
    writeFileSync(join(STEP_DIR, "scripts", "live.sh"), "#!/bin/sh\n# see ${CLAUDE_SKILL_DIR}\nexec \"${CLAUDE_SKILL_DIR}/scripts/ask.sh\"\n");
    const withScript = { ...step("Run it."), stepFiles: ["scripts/ask.sh", "scripts/live.sh"] };
    const codex = compileSkill(verb, withScript, {}, new Set(), { target: await target("codex") });
    expect(codex.warnings.filter((w) => w.includes("does not set"))).toEqual([
      "scripts/live.sh:3 uses ${CLAUDE_SKILL_DIR}, which the codex target does not set",
    ]);
    const claude = compileSkill(verb, withScript, {}, new Set(), { target: await target("claude") });
    expect(claude.warnings.filter((w) => w.includes("does not set"))).toEqual([]);
  });

  test("a companion file that names a Claude-only tool is reported for codex", async () => {
    mkdirSync(join(STEP_DIR, "references"), { recursive: true });
    writeFileSync(join(STEP_DIR, "references", "notes.md"), "Ask with AskUserQuestion.\n");
    const withNotes = { ...step("Run it."), stepFiles: ["references/notes.md"] };
    const codex = compileSkill(verb, withNotes, {}, new Set(), { target: await target("codex") });
    expect(codex.warnings).toContain("references/notes.md: body names AskUserQuestion, which the codex target does not have");
  });

  test("a missing fragment in an include or a fill names that source", async () => {
    const t = await target("codex");
    const viaInclude = compileSkill(verb, step("# Ask\n\n{{include:note}}"), {}, new Set(), {
      target: t, includes: { note: attachment("mattstack:note", "Shared.\n{{harness:wait}}") },
    });
    expect(viaInclude.errors).toEqual(['verb "ask": mattstack:note: {{harness:wait}} at line 2 has no "wait" fragment in the codex target']);

    const slotted = { ...step("# Ask"), slots: { domain: { contract: "domain@1" } } };
    const viaFill = compileSkill(verb, slotted, { domain: attachment("acme:domain", "Domain.\n{{harness:wait}}", "domain@1") }, new Set(), { target: t });
    expect(viaFill.errors).toEqual(['verb "ask": acme:domain: {{harness:wait}} at line 2 has no "wait" fragment in the codex target']);
  });

  test("a codex body that still names a Claude-only tool is reported", async () => {
    const codex = compileSkill(verb, step("Use AskUserQuestion here."), {}, new Set(), { target: await target("codex") });
    expect(codex.warnings).toContain("body names AskUserQuestion, which the codex target does not have");
  });

  test("a path escaping the pack keeps its source coordinate under either target", async () => {
    const root = mkdtempSync(join(tmpdir(), "rt-harness-pack-"));
    try {
      const body = "# Ask\n\nRead `${CLAUDE_SKILL_DIR}/../../../outside.md`.";
      for (const t of [await target("claude"), await target("codex")]) {
        expect(() =>
          compileSkill(verb, step(body), {}, new Set(), { target: t, packRoot: root, compiledDir: join(root, "skills", "ask") }),
        ).toThrow(/at skills\/flow\/ask\/SKILL\.md:8 resolves outside the pack root/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("target outputs never overwrite each other", () => {
  let root: string;
  let src: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rt-harness-expand-"));
    src = join(root, "skills-src");
    mkdirSync(join(root, "plugins", "mattstack", ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "1.0.0" }));
    mkdirSync(join(src, "ask", "scripts"), { recursive: true });
    writeFileSync(
      join(src, "ask", "SKILL.md"),
      "---\nname: board:ask\ndescription: a\nallowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/ask.sh:*)\nmetadata:\n  harness-requires: skill-resources\n---\n\n# Ask\n\nRun `${CLAUDE_SKILL_DIR}/scripts/ask.sh`.\n\n{{harness:questions}}\n",
    );
    writeFileSync(join(src, "ask", "step.md"), "Then read `${CLAUDE_SKILL_DIR}/../ask/SKILL.md` again.\n");
    writeFileSync(join(src, "ask", "scripts", "ask.sh"), "#!/bin/sh\necho ask\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("each target writes its own root and refuses the other's", async () => {
    const roots = resolvePluginRootsFromDir(root);
    const claudeOut = join(root, "skills");
    const codexOut = join(root, "skills-targets", "codex");
    const claude = expandSkills({ srcDir: src, outDir: claudeOut, roots, target: await target("claude") });
    const codex = expandSkills({ srcDir: src, outDir: codexOut, roots, target: await target("codex") });
    writeExpanded(claudeOut, claude);
    writeExpanded(codexOut, codex);

    const claudeMd = readFileSync(join(claudeOut, "ask", "SKILL.md"), "utf8");
    const codexMd = readFileSync(join(codexOut, "ask", "SKILL.md"), "utf8");
    expect(claudeMd).toContain("AskUserQuestion");
    expect(claudeMd).toContain("allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/ask.sh:*)");
    expect(codexMd).not.toContain("AskUserQuestion");
    expect(codexMd).not.toContain("${CLAUDE_SKILL_DIR}");
    expect(codexMd).toContain("allowed-tools: Bash(scripts/ask.sh:*)");
    expect(readFileSync(join(codexOut, "ask", "step.md"), "utf8")).toBe("Then read `../ask/SKILL.md` again.\n");
    expect(readFileSync(join(claudeOut, "ask", "step.md"), "utf8")).toContain("${CLAUDE_SKILL_DIR}/../ask/SKILL.md");

    expect(existsSync(join(claudeOut, TARGET_MARKER))).toBe(false);
    expect(JSON.parse(readFileSync(join(codexOut, TARGET_MARKER), "utf8"))).toEqual({ harness: "codex" });

    expect(checkExpanded(claudeOut, claude)).toEqual([]);
    expect(checkExpanded(codexOut, codex)).toEqual([]);

    expect(() => writeExpanded(claudeOut, codex)).toThrow(/holds claude output; .*delete it and run expand again/);
    expect(() => writeExpanded(codexOut, claude)).toThrow(/holds codex output/);
    expect(readFileSync(join(claudeOut, "ask", "SKILL.md"), "utf8")).toBe(claudeMd);
    expect(readFileSync(join(codexOut, "ask", "SKILL.md"), "utf8")).toBe(codexMd);
  });

  test("a check against the other target's root reports it", async () => {
    const roots = resolvePluginRootsFromDir(root);
    const codexOut = join(root, "skills-targets", "codex");
    writeExpanded(codexOut, expandSkills({ srcDir: src, outDir: codexOut, roots, target: await target("codex") }));
    const claude = expandSkills({ srcDir: src, outDir: codexOut, roots, target: await target("claude") });
    expect(checkExpanded(codexOut, claude)).toContainEqual({ skill: TARGET_MARKER, causes: ["holds codex output"] });
  });

  test("codex advisories cover companion files and live script lines; claude has none", async () => {
    writeFileSync(join(src, "ask", "step.md"), "Ask with AskUserQuestion.\n");
    writeFileSync(join(src, "ask", "scripts", "ask.sh"), "#!/bin/sh\n# Invoke: ${CLAUDE_SKILL_DIR}/scripts/ask.sh\ncd \"${CLAUDE_SKILL_DIR}\"\n");
    const roots = resolvePluginRootsFromDir(root);
    const [codex] = expandSkills({ srcDir: src, outDir: join(root, "codex"), roots, target: await target("codex") });
    expect(codex!.advisories).toEqual([
      "ask/scripts/ask.sh:3 uses ${CLAUDE_SKILL_DIR}, which the codex target does not set",
      "ask/step.md: body names AskUserQuestion, which the codex target does not have",
    ]);
    const [claude] = expandSkills({ srcDir: src, outDir: join(root, "claude"), roots, target: await target("claude") });
    expect(claude!.advisories).toEqual([]);
  });

  test("an expand source missing a capability is refused", async () => {
    writeFileSync(
      join(src, "ask", "SKILL.md"),
      "---\nname: board:ask\ndescription: a\nmetadata:\n  harness-requires: [native-question-tool]\n---\n\n# Ask\n",
    );
    const roots = resolvePluginRootsFromDir(root);
    const codex = await target("codex");
    expect(() => expandSkills({ srcDir: src, outDir: join(root, "out"), roots, target: codex }))
      .toThrow('ask/SKILL.md: needs the "native-question-tool" capability, which the codex target does not have');
  });

  test("a compiled pack verb for another harness lands under its own target root", () => {
    expect(outDirFor("/pack", "watch", true)).toBe("/pack/skills/watch");
    expect(outDirFor("/pack", "watch", true, "claude")).toBe("/pack/skills/watch");
    expect(outDirFor("/pack", "watch", true, "codex")).toBe("/pack/targets/codex/skills/watch");
    expect(outDirFor("/pack", "watch", false, "codex")).toBe("/pack/targets/codex/attachments/watch");
  });
});

describe("pack compile per harness", () => {
  let root: string;

  function fixture(): { pack: string; base: string[] } {
    root = mkdtempSync(join(tmpdir(), "rt-harness-pack-"));
    cpSync(join(import.meta.dir, "fixtures", "compile-native"), root, { recursive: true });
    const pack = join(root, "pack");
    const ms = join(root, "mattstack-home");
    return { pack, base: ["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", join(ms, "repos", "my-repo", "skills.jsonc")] };
  }

  afterEach(() => {
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  test("a codex compile writes its own target root and checks clean, leaving Claude's untouched", async () => {
    const { pack, base } = fixture();
    mkdirSync(join(pack, "attachments", "evidence", "scripts"), { recursive: true });
    writeFileSync(join(pack, "attachments", "evidence", "scripts", "capture.sh"), "#!/bin/sh\n");
    const policy = join(pack, "attachments", "plan-policy", "SKILL.md");
    writeFileSync(policy, readFileSync(policy, "utf8").replace("policy text", "policy text\n\nCapture with {{pack.path:evidence/scripts/capture.sh}}."));

    const io = captureSkills();
    try {
      await skillsCompile([...base, "--harness", "claude"]);
      const claudeWork = readFileSync(join(pack, "skills", "work", "SKILL.md"), "utf8");
      const claudePlan = readFileSync(join(pack, "attachments", "stage-plan", "SKILL.md"), "utf8");
      await skillsCompile([...base, "--harness", "codex"]);
      expect(readFileSync(join(pack, "skills", "work", "SKILL.md"), "utf8")).toBe(claudeWork);
      expect(claudePlan).toContain("Capture with ${CLAUDE_SKILL_DIR}/../../attachments/evidence/scripts/capture.sh.");

      const codexRoot = join(pack, "targets", "codex");
      expect(JSON.parse(readFileSync(join(codexRoot, TARGET_MARKER), "utf8"))).toEqual({ harness: "codex" });
      const work = readFileSync(join(codexRoot, "skills", "work", "SKILL.md"), "utf8");
      const plan = readFileSync(join(codexRoot, "attachments", "stage-plan", "SKILL.md"), "utf8");
      expect(work).toContain("../../attachments/stage-plan");
      expect(plan).toContain("Capture with ../../../../attachments/evidence/scripts/capture.sh.");
      for (const md of [work, plan]) expect(md).not.toContain("${CLAUDE_");

      const before = io.lines().length;
      await skillsCheck([...base, "--harness", "codex", "--json"]);
      const payload = JSON.parse(io.lines().slice(before).at(-1) ?? "null") as { verbs: { name: string; status: string }[] };
      expect(payload.verbs.length).toBeGreaterThan(0);
      expect(payload.verbs.filter((v) => v.status !== "in-sync")).toEqual([]);
    } finally {
      io.restore();
    }
  });

  test("an unknown harness is a usage failure that writes nothing", async () => {
    const { pack, base } = fixture();
    const run = await runExpectingCleanExit(() => skillsCompile([...base, "--harness", "emacs"]));
    expect(run.exitCode).toBe(1);
    expect(run.errors.join("\n")).toContain("There is no emacs skill target");
    expect(existsSync(join(pack, "targets"))).toBe(false);
  });
});
