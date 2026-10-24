import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { brokenSkillPathDiagnostics, handPathDiagnostics, teamInputPathDiagnostics } from "../hand-paths.ts";

const VERBS = new Set(["ship", "review"]);
const SOURCE = { verbs: VERBS, packSource: () => true };
const FILE = "attachments/widget-rules/SKILL.md";

describe("handPathDiagnostics", () => {
  test("a ../ path into attachments/ is hand-typed-path with a pack.path fix spanning the whole path", () => {
    const text = "Intro line.\nRead `../../attachments/capture-evidence/SKILL.md` first.";
    expect(handPathDiagnostics(text, FILE, { startLine: 5, ...SOURCE })).toEqual([
      {
        file: FILE,
        line: 6,
        col: 7,
        code: "hand-typed-path",
        message: "hand-typed path ../../attachments/capture-evidence/SKILL.md breaks when its target moves; write {{pack.path:capture-evidence/SKILL.md}} instead",
        fix: { length: "../../attachments/capture-evidence/SKILL.md".length, text: "{{pack.path:capture-evidence/SKILL.md}}" },
      },
    ]);
  });

  test("a ${CLAUDE_SKILL_DIR}/../ path gets the same pack.path fix", () => {
    const [d] = handPathDiagnostics("Run ${CLAUDE_SKILL_DIR}/../../attachments/x/y.md now.", FILE, SOURCE);
    expect(d).toMatchObject({ line: 1, col: 5, code: "hand-typed-path" });
    expect(d!.fix).toEqual({ length: "${CLAUDE_SKILL_DIR}/../../attachments/x/y.md".length, text: "{{pack.path:x/y.md}}" });
  });

  test("$CLAUDE_SKILL_DIR and ${CLAUDE_PLUGIN_ROOT} forms are refused too", () => {
    const text = "sh $CLAUDE_SKILL_DIR/../../skills/gadgets/run.sh\ncat ${CLAUDE_PLUGIN_ROOT}/attachments/x/y.md\ncat $CLAUDE_PLUGIN_ROOT/skills/gadgets/z.md";
    const ds = handPathDiagnostics(text, FILE, SOURCE);
    expect(ds.map((d) => [d.line, d.col, d.fix?.text])).toEqual([
      [1, 4, "{{pack.path:gadgets/run.sh}}"],
      [2, 5, "{{pack.path:x/y.md}}"],
      [3, 5, "{{pack.path:gadgets/z.md}}"],
    ]);
  });

  test("../<verb>/SKILL.md naming a compiled verb gets a verb.path fix", () => {
    const [d] = handPathDiagnostics("Then follow ../ship/SKILL.md.", FILE, { verbs: VERBS });
    expect(d).toMatchObject({ line: 1, col: 13, code: "hand-typed-path" });
    expect(d!.fix).toEqual({ length: "../ship/SKILL.md".length, text: "{{verb.path:ship}}" });
    expect(d!.message).toContain("write {{verb.path:ship}} instead");
  });

  test("a sibling folder's SKILL.md that is neither a compiled verb nor pack source gets no fix", () => {
    const [d] = handPathDiagnostics("Follow `../map-open-mrs/SKILL.md` for the table.", FILE, { verbs: VERBS, packSource: () => false });
    expect(d).toMatchObject({ code: "hand-typed-path" });
    expect(d!.fix).toBeUndefined();
    expect(d!.message).toContain("{{verb.path:<verb>}}");
  });

  test("a sibling folder the pack holds as source gets pack.path, not verb.path", () => {
    const [d] = handPathDiagnostics("Read ../gadget-rules/SKILL.md.", FILE, { verbs: VERBS, packSource: (arg) => arg === "gadget-rules/SKILL.md" });
    expect(d!.fix!.text).toBe("{{pack.path:gadget-rules/SKILL.md}}");
  });

  test("a compiled verb named through skills/ takes verb.path over pack.path", () => {
    const [d] = handPathDiagnostics("Read ../../skills/ship/SKILL.md.", FILE, SOURCE);
    expect(d!.fix!.text).toBe("{{verb.path:ship}}");
  });

  test("a target the compile cannot place gets no fix rather than a wrong one", () => {
    const [d] = handPathDiagnostics("Read ../../attachments/x/y.md.", FILE, { verbs: VERBS });
    expect(d).toMatchObject({ code: "hand-typed-path" });
    expect(d!.fix).toBeUndefined();
  });

  test("a shell-anchored path to a compiled verb keeps its anchor in the fix", () => {
    const [d] = handPathDiagnostics("cat ${CLAUDE_SKILL_DIR}/../../skills/review/SKILL.md", FILE, { verbs: VERBS });
    expect(d!.fix!.text).toBe("${CLAUDE_SKILL_DIR}/{{verb.path:review}}");
  });

  test("paths inside the skill's own folder and paths inside pack.path or verb.path are allowed", () => {
    const text = [
      "Run ${CLAUDE_SKILL_DIR}/parts/a.sh, read ./x.md and x.md.",
      "Read {{pack.path:x/y.md}} and {{verb.path:ship}}.",
      "```sh",
      "sh ${CLAUDE_SKILL_DIR}/scripts/go.sh",
      "```",
      "The `...` stand-in in .../plugin/attachments/x is prose, and so is a bare `../`.",
      'PACK_DIRS="$(cd "${CLAUDE_SKILL_DIR}/../.." && pwd -P)"; cd ${CLAUDE_SKILL_DIR}/../../ && pwd',
      'FORGE=$(dirname "$STAGE")/../forge/ci-forge.sh',
      "Read ${CLAUDE_SKILL_DIR}/../../pack/params.jsonc and ../../website/docs/x.md.",
    ].join("\n");
    expect(handPathDiagnostics(text, FILE, { verbs: VERBS })).toEqual([]);
  });

  test("a hand-typed path in a fenced block is refused like prose", () => {
    const ds = handPathDiagnostics("```sh\nsh ../../attachments/x/run.sh\n```", FILE, { verbs: VERBS });
    expect(ds.map((d) => [d.line, d.col])).toEqual([[2, 4]]);
  });

  test("a path holding a placeholder is an error with no fix", () => {
    const [d] = handPathDiagnostics("Read ../../attachments/{{team.x}}/SKILL.md.", FILE, { verbs: VERBS });
    expect(d).toMatchObject({ line: 1, col: 6, code: "hand-typed-path" });
    expect(d!.fix).toBeUndefined();
    expect(d!.message).toBe(
      "hand-typed path ../../attachments/{{team.x}}/SKILL.md breaks when its target moves; name it with {{pack.path:<attachment>/<file>}} or {{verb.path:<verb>}}",
    );
  });

  test("an attachment segment that is one team value gets a pack.path fix when the value resolves", () => {
    const text = "Read ../../attachments/{{team.gates-fill}}/SKILL.md.";
    const teamValue = (key: string) => (key === "gates-fill" ? "widgets-gates" : undefined);
    const [d] = handPathDiagnostics(text, FILE, { verbs: VERBS, packSource: (arg) => arg === "widgets-gates/SKILL.md", teamValue });
    expect(d).toMatchObject({ code: "hand-typed-path", fix: { length: 46, text: "{{pack.path:{{team.gates-fill}}/SKILL.md}}" } });
    expect(d!.message).toBe(
      "hand-typed path ../../attachments/{{team.gates-fill}}/SKILL.md breaks when its target moves; write {{pack.path:{{team.gates-fill}}/SKILL.md}} instead",
    );
  });

  test("a team value the compile cannot resolve to pack source gets no fix", () => {
    const text = "Read ../../attachments/{{team.gates-fill}}/SKILL.md.";
    const unknown = handPathDiagnostics(text, FILE, { verbs: VERBS, packSource: () => true, teamValue: () => undefined });
    const missing = handPathDiagnostics(text, FILE, { verbs: VERBS, packSource: () => false, teamValue: () => "widgets-gates" });
    const optional = handPathDiagnostics("Read ../../attachments/{{team.gates-fill?}}/SKILL.md.", FILE, { verbs: VERBS, packSource: () => true, teamValue: () => "widgets-gates" });
    const mixed = handPathDiagnostics("Read ../../attachments/{{team.gates-fill}}/<file>.", FILE, { verbs: VERBS, packSource: () => true, teamValue: () => "widgets-gates" });
    for (const [d] of [unknown, missing, optional, mixed]) {
      expect(d).toMatchObject({ code: "hand-typed-path" });
      expect(d!.fix).toBeUndefined();
    }
  });

  test("a file below its unit's root measures relative paths from its own depth", () => {
    const inside = "Run `../scripts/run.sh`, then read ../SKILL.md.";
    expect(handPathDiagnostics(inside, "references/guide.md", { verbs: VERBS, depth: 1 })).toEqual([]);
    expect(handPathDiagnostics(inside, "references/guide.md", { verbs: VERBS })).toMatchObject([{ code: "hand-typed-path" }]);
    const [d] = handPathDiagnostics("Read ../../other-kit/SKILL.md.", "references/guide.md", { verbs: VERBS, packSource: (arg) => arg === "other-kit/SKILL.md", depth: 1 });
    expect(d).toMatchObject({ code: "hand-typed-path", fix: { length: 24, text: "{{pack.path:other-kit/SKILL.md}}" } });
    expect(handPathDiagnostics("Read ../../../attachments/x/y.md.", "a/b/c.md", { verbs: VERBS, depth: 2 })).toMatchObject([{ code: "hand-typed-path" }]);
    expect(handPathDiagnostics("Read ${CLAUDE_SKILL_DIR}/../x/y.md.", "references/guide.md", { verbs: VERBS, depth: 1 })).toMatchObject([{ code: "hand-typed-path" }]);
  });

  test("a compiled verb's file other than SKILL.md has no form to name it, so no fix", () => {
    const [d] = handPathDiagnostics("Read ../ship/notes.md.", FILE, { verbs: VERBS });
    expect(d!.fix).toBeUndefined();
  });

  test("a first-line indent counts in that line's col", () => {
    const [d] = handPathDiagnostics("Read ../x/y.md", FILE, { startLine: 3, indent: 2, verbs: VERBS });
    expect(d).toMatchObject({ line: 3, col: 8 });
    const [e] = handPathDiagnostics("a\nRead ../x/y.md", FILE, { startLine: 3, indent: 2, verbs: VERBS });
    expect(e).toMatchObject({ line: 4, col: 6 });
  });
});

describe("teamInputPathDiagnostics", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function pack(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "rt-team-inputs-"));
    made.push(dir);
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return dir;
  }

  test("a section line is checked at depth 0 and points at the section file's own line", () => {
    const dir = pack({ "pack/sections/gates.md": "Gates.\nRead ../../attachments/widgets-gates/SKILL.md first.\n" });
    expect(teamInputPathDiagnostics(dir, SOURCE)).toEqual([
      {
        file: "pack/sections/gates.md",
        line: 2,
        col: 6,
        code: "hand-typed-path",
        message: "hand-typed path ../../attachments/widgets-gates/SKILL.md breaks when its target moves; write {{pack.path:widgets-gates/SKILL.md}} instead",
        fix: { length: "../../attachments/widgets-gates/SKILL.md".length, text: "{{pack.path:widgets-gates/SKILL.md}}" },
      },
    ]);
  });

  test("a sibling path one level up is hand-typed in a section, since it lands at the verb's root", () => {
    const dir = pack({ "pack/sections/gates.md": "See ../ship/SKILL.md.\n" });
    expect(teamInputPathDiagnostics(dir, SOURCE)).toMatchObject([{ line: 1, col: 5, fix: { text: "{{verb.path:ship}}" } }]);
  });

  test("a params value points at its own line and column in params.jsonc", () => {
    const dir = pack({ "pack/params.jsonc": '{\n  "params": { "gates": "see ../../attachments/widgets-gates/SKILL.md" }\n}\n' });
    expect(teamInputPathDiagnostics(dir, SOURCE)).toMatchObject([{ file: "pack/params.jsonc", line: 2, col: 29, code: "hand-typed-path" }]);
  });

  test("pack.path and verb.path in a section are clean", () => {
    const dir = pack({ "pack/sections/gates.md": "Read {{pack.path:widgets-gates/SKILL.md}} and {{verb.path:ship}}.\n" });
    expect(teamInputPathDiagnostics(dir, SOURCE)).toEqual([]);
  });
});

describe("brokenSkillPathDiagnostics", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function plugin(): { root: string; skillDir: string } {
    const root = mkdtempSync(join(tmpdir(), "rt-hand-paths-"));
    made.push(root);
    const skillDir = join(root, "plugin", "skills", "gadgets");
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(join(root, "attachments", "widgets"), { recursive: true });
    writeFileSync(join(root, "attachments", "widgets", "reference.md"), "ref\n");
    mkdirSync(join(root, "tests"), { recursive: true });
    writeFileSync(join(root, "tests", "certify.sh"), "\n");
    return { root, skillDir };
  }

  test("a cross-skill path that resolves from the skill's folder is clean", () => {
    const { root, skillDir } = plugin();
    const text = "Read `${CLAUDE_SKILL_DIR}/../../../attachments/widgets/reference.md`.\nRun `sh ${CLAUDE_PLUGIN_ROOT}/tests/certify.sh <folder>`.";
    expect(brokenSkillPathDiagnostics(text, "plugin/skills/gadgets/SKILL.md", { skillDir, pluginRoot: root })).toEqual([]);
  });

  test("a cross-skill path to a missing file is broken-skill-path at the path", () => {
    const { root, skillDir } = plugin();
    const text = "x\nRead `${CLAUDE_SKILL_DIR}/../../../attachments/widgets/gone.md`.";
    expect(brokenSkillPathDiagnostics(text, "plugin/skills/gadgets/SKILL.md", { skillDir, pluginRoot: root, startLine: 4 })).toEqual([
      {
        file: "plugin/skills/gadgets/SKILL.md",
        line: 5,
        col: 7,
        code: "broken-skill-path",
        message: "${CLAUDE_SKILL_DIR}/../../../attachments/widgets/gone.md does not resolve to a file from the skill's folder",
      },
    ]);
  });

  test("a path holding a placeholder or a <name> stand-in is a doc example and is skipped", () => {
    const { root, skillDir } = plugin();
    const text = "`../../attachments/{{team.gates-fill}}/SKILL.md` and `../<name>/SKILL.md` and `${CLAUDE_PLUGIN_ROOT}/tests/<x>.sh`";
    expect(brokenSkillPathDiagnostics(text, "plugin/skills/gadgets/SKILL.md", { skillDir, pluginRoot: root })).toEqual([]);
  });
});
