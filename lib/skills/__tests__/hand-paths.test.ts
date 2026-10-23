import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { brokenSkillPathDiagnostics, handPathDiagnostics } from "../hand-paths.ts";

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

  test("a sibling folder's SKILL.md the pack holds no source for is a verb, even off this roster", () => {
    const [d] = handPathDiagnostics("Follow `../map-open-mrs/SKILL.md` for the table.", FILE, { verbs: VERBS, packSource: () => false });
    expect(d!.fix).toEqual({ length: "../map-open-mrs/SKILL.md".length, text: "{{verb.path:map-open-mrs}}" });
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
