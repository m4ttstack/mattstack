import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expandSkills } from "../expand.ts";
import { resolveHarnessTarget, type SkillTarget } from "../harness-target.ts";
import { resolvePluginRootsFromDir } from "../sources.ts";

const REPO = join(import.meta.dir, "..", "..", "..");
const MATTSTACK = join(REPO, "plugins", "mattstack");
const BOARD_CODEX = join(REPO, "apps", "board", "skills-targets", "codex");
const BOARD_CLAUDE = join(REPO, "apps", "board", "skills");

type Harness = "claude" | "codex";

/** What each harness's artifact must never carry: the other harness's native tools, effort spellings and paths. */
const FOREIGN: Record<Harness, RegExp[]> = {
  codex: [/AskUserQuestion/, /\bSendMessage\b/, /run_in_background/, /\bAgent tool\b/, /--effort\b/, /\$\{CLAUDE_SKILL_DIR\}/],
  claude: [/codex exec/, /request_user_input/, /model_reasoning_effort/, /<skill-dir>/],
};

function expectNoForeign(text: string, harness: Harness): void {
  for (const re of FOREIGN[harness]) expect(text).not.toMatch(re);
}

async function realTarget(harness: Harness): Promise<SkillTarget> {
  const resolved = await resolveHarnessTarget(harness, { roots: resolvePluginRootsFromDir(REPO) });
  if (!resolved.ok) throw new Error(resolved.error.message);
  return resolved.data;
}

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "rt-harness-workflow-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeSkill(src: string, name: string, body: string, frontmatter = ""): void {
  mkdirSync(join(src, name), { recursive: true });
  writeFileSync(join(src, name, "SKILL.md"), `---\nname: ${name}\ndescription: test\n${frontmatter}---\n\n${body}\n`);
}

/** One expanded SKILL.md per harness from a skill dir under `src`. */
async function expandBoth(src: string, name: string): Promise<Record<Harness, string>> {
  const out: Partial<Record<Harness, string>> = {};
  for (const harness of ["claude", "codex"] as const) {
    const skills = expandSkills({ srcDir: src, outDir: join(scratch, `out-${harness}`), roots: resolvePluginRootsFromDir(REPO), target: await realTarget(harness) });
    out[harness] = skills.find((s) => s.name === name)!.skillMd;
  }
  return out as Record<Harness, string>;
}

describe("compiled workflow uses executable native sequence", () => {
  test("attended questions and unattended gates: Claude asks with its form tool, Codex asks in words, both keep the gate policy", async () => {
    const src = join(scratch, "src");
    writeSkill(src, "gated", "# Gated\n\n{{include:gate-protocol}}");
    const { claude, codex } = await expandBoth(src, "gated");

    expect(claude).toContain("Ask with the AskUserQuestion tool");
    expect(codex).toContain("ask in words");
    expect(codex).toContain("not an answer anyone gave");
    expect(codex).not.toMatch(/request_user_input_async/);
    for (const md of [claude, codex]) {
      expect(md).toContain("gate_ask {questions, kind: <scope>, context?, subject?}");
      expect(md).toContain("run_field_set {key: waiting-gate, value: <id>, stage}");
      expect(md).toContain("STOP: never invent an answer or re-ask a closed gate");
      expect(md).toContain("`cancelled by the human` edge");
      expect(md).toContain("or the questions went out in words");
    }
    expectNoForeign(claude, "claude");
    expectNoForeign(codex, "codex");
  });

  test("background wait: Claude backgrounds the wait and ends the turn, Codex stays with it in the foreground", async () => {
    const src = join(scratch, "src");
    writeSkill(src, "gated", "# Gated\n\n{{include:gate-protocol}}");
    const { claude, codex } = await expandBoth(src, "gated");

    expect(claude).toContain("`run_in_background: true`");
    expect(claude).toContain("Claude Code re-invokes this session");
    expect(codex).toContain("a wait never runs in the background here");
    expect(codex).toContain("Never end the turn with the wait unfinished");
    for (const md of [claude, codex]) expect(md).toContain("`rt gate wait <id>`");
  });

  test("subagent review: one reviewer across rounds, started and re-messaged natively", async () => {
    const src = join(scratch, "src");
    mkdirSync(join(src, "subagent-review-loop"), { recursive: true });
    copyFileSync(join(MATTSTACK, "attachments", "review", "subagent-review-loop", "SKILL.md"), join(src, "subagent-review-loop", "SKILL.md"));
    const { claude, codex } = await expandBoth(src, "subagent-review-loop");

    expect(claude).toContain("Start the helper with the Agent tool");
    expect(claude).toContain("SendMessage with the agent id");
    expect(codex).toContain("codex exec --json --sandbox read-only");
    expect(codex).toContain("codex exec resume <thread_id>");
    for (const md of [claude, codex]) {
      expect(md).toContain("One reviewer, all rounds.");
      expect(md).toContain("Message the SAME reviewer helper started in step 3");
    }
    expectNoForeign(claude, "claude");
    expectNoForeign(codex, "codex");
  });

  test("model selection: tiers resolve to each harness's own models and effort", async () => {
    const src = join(scratch, "src");
    writeSkill(src, "tiered", "# Tiered\n\n{{include:model-tiering}}");
    const { claude, codex } = await expandBoth(src, "tiered");

    expect(claude).toMatch(/\| deep \| `opus` \|/);
    expect(claude).toContain("`--effort` flag");
    expect(codex).toContain("Codex has no tier aliases");
    expect(codex).toContain("-c model_reasoning_effort=<effort>");
    expect(codex).toContain("Codex takes no account");
    expect(codex).not.toMatch(/`(haiku|sonnet|opus|fable)`/);
    for (const md of [claude, codex]) {
      expect(md).toContain("| Review -- disposable artifact or diff reviewer | standard |");
      expect(md).toContain("**Wrong conclusion despite full context** -> next tier up.");
    }
    expectNoForeign(claude, "claude");
    expectNoForeign(codex, "codex");
  });

  test("a changed shared decision rule reaches both targets", async () => {
    const src = join(scratch, "src");
    const rule = (n: number) => `# Rule\n\nHold at most ${n} rounds before you ask.\n\n{{harness:questions}}`;
    writeSkill(src, "rule", rule(3));
    const before = await expandBoth(src, "rule");
    writeSkill(src, "rule", rule(5));
    const after = await expandBoth(src, "rule");
    for (const harness of ["claude", "codex"] as const) {
      expect(before[harness]).toContain("Hold at most 3 rounds before you ask.");
      expect(after[harness]).toContain("Hold at most 5 rounds before you ask.");
      expect(after[harness]).not.toContain("Hold at most 3 rounds");
    }
  });

  test("the committed board targets carry each harness's sequence and no foreign tool", () => {
    for (const skill of ["review", "respond", "doctor"]) {
      const codex = readFileSync(join(BOARD_CODEX, skill, "SKILL.md"), "utf8");
      const claude = readFileSync(join(BOARD_CLAUDE, skill, "SKILL.md"), "utf8");
      expectNoForeign(codex, "codex");
      expectNoForeign(claude, "claude");
      expect(codex).toContain("`<skill-dir>` is this skill's own folder");
      expect(codex).toContain("a Codex\nbuild of it reads");
      expect(codex).not.toContain("allowed-tools");
    }
    for (const companion of ["respond/gate-step.md", "doctor/diagnose.md", "doctor/entry.md", "gate-cli-recipes/SKILL.md"]) {
      const codex = readFileSync(join(BOARD_CODEX, companion), "utf8");
      expectNoForeign(codex, "codex");
      expect(readFileSync(join(BOARD_CLAUDE, companion), "utf8")).not.toContain("{{");
    }
    expect(readFileSync(join(BOARD_CODEX, "gate-cli-recipes", "SKILL.md"), "utf8")).toContain("a wait never runs in the background here");
    expect(readFileSync(join(BOARD_CODEX, "doctor", "diagnose.md"), "utf8")).toContain("a wait never runs in the background here");
  });
});
