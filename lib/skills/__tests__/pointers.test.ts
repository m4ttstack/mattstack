import { describe, expect, test } from "bun:test";
import { closeMap, ID_RE, isKey, keyBody, leftoverTokens, openingLine, skillsId, spellFrom, unitId, type PointerMap, type UnitTable } from "../pointers.ts";

const units: UnitTable = {
  "receive-review": "attachments/receive-review",
  "stage-plan": "attachments/stage-plan",
  "stage-x": "skills/stage-x",
  work: "skills/work",
  widget: "attachments/tools/widget",
};

const TOKEN = "${CLAUDE_SKILL_DIR}";
const everything = () => true;
const writes = (...targets: string[]) => (target: string) => targets.includes(target);

describe("keyBody: scripts", () => {
  const at = { dir: "attachments/receive-review", fileRel: "SKILL.md", units, written: everything };

  test("an internal verb's script token becomes a key", () => {
    const out = keyBody(`Run \`bash "${TOKEN}/../../attachments/receive-review/scripts/gate-ctx.sh"\``, at);
    expect(out.text).toBe('Run `bash "@receive-review/scripts/gate-ctx.sh"`');
    expect(out.targets).toEqual({ "receive-review/scripts/gate-ctx.sh": "attachments/receive-review/scripts/gate-ctx.sh" });
  });

  test("a token inside a fenced block converts too", () => {
    const text = `Steps:\n\n\`\`\`bash\nbash "${TOKEN}/../../attachments/receive-review/scripts/gate-ctx.sh" --json\n\`\`\`\n`;
    const out = keyBody(text, at);
    expect(out.text).toBe('Steps:\n\n```bash\nbash "@receive-review/scripts/gate-ctx.sh" --json\n```\n');
    expect(out.targets).toEqual({ "receive-review/scripts/gate-ctx.sh": "attachments/receive-review/scripts/gate-ctx.sh" });
  });
});

describe("keyBody: an attachment's own token without ../../", () => {
  test("is left as written and reported as a leftover", () => {
    const text = `Run ${TOKEN}/scripts/gate-ctx.sh now.`;
    const out = keyBody(text, { dir: "attachments/receive-review", fileRel: "SKILL.md", units, written: everything });
    expect(out.text).toBe(text);
    expect(out.targets).toEqual({});
    expect(leftoverTokens(out.text)).toEqual([{ line: 1, col: 5 }]);
  });
});

describe("keyBody: units", () => {
  const at = { dir: "skills/work", fileRel: "SKILL.md", units, written: everything };

  test("a public skill's own token keys to that skill", () => {
    const out = keyBody(`Run ${TOKEN}/scripts/x.sh now.`, at);
    expect(out.text).toBe("Run @work/scripts/x.sh now.");
    expect(out.targets).toEqual({ "work/scripts/x.sh": "skills/work/scripts/x.sh" });
  });

  test("a sibling public stage keys to that stage", () => {
    const out = keyBody(`See ${TOKEN}/../../skills/stage-x/parts/d/y.sh.`, at);
    expect(out.text).toBe("See @stage-x/parts/d/y.sh.");
    expect(out.targets).toEqual({ "stage-x/parts/d/y.sh": "skills/stage-x/parts/d/y.sh" });
  });

  test("a grouped base copy keys by its leaf", () => {
    const out = keyBody(`Read ${TOKEN}/../../attachments/tools/widget/SKILL.md: then go on.`, at);
    expect(out.text).toBe("Read @widget/SKILL.md: then go on.");
    expect(out.targets).toEqual({ "widget/SKILL.md": "attachments/tools/widget/SKILL.md" });
  });

  test("a path that leaves the plugin or names no unit is left as written", () => {
    const text = `A ${TOKEN}/../../../outside.sh and ${TOKEN}/../../skills/nobody/x.sh stay.`;
    const out = keyBody(text, at);
    expect(out.text).toBe(text);
    expect(out.targets).toEqual({});
  });

  test("a path ends at a comma, semicolon, angle bracket or square bracket", () => {
    const out = keyBody(`A ${TOKEN}/scripts/a.sh, ${TOKEN}/scripts/b.sh; <${TOKEN}/scripts/c.sh> [${TOKEN}/scripts/d.sh]`, at);
    expect(out.text).toBe("A @work/scripts/a.sh, @work/scripts/b.sh; <@work/scripts/c.sh> [@work/scripts/d.sh]");
    expect(Object.keys(out.targets)).toEqual(["work/scripts/a.sh", "work/scripts/b.sh", "work/scripts/c.sh", "work/scripts/d.sh"]);
  });

  test("a path ends at a backslash, so an escaped quote in a graph label stays after the key", () => {
    const out = keyBody(`label="sh \\"${TOKEN}/scripts/a.sh\\" <dir>"`, at);
    expect(out.text).toBe('label="sh \\"@work/scripts/a.sh\\" <dir>"');
    expect(out.targets).toEqual({ "work/scripts/a.sh": "skills/work/scripts/a.sh" });
  });

  test("an allowed-tools example in a body fence keys the file and keeps its :*", () => {
    const out = keyBody(`\`\`\`yaml\nallowed-tools: Bash(bash ${TOKEN}/scripts/x.sh:*)\n\`\`\`\n`, at);
    expect(out.text).toBe("```yaml\nallowed-tools: Bash(bash @work/scripts/x.sh:*)\n```\n");
    expect(out.targets).toEqual({ "work/scripts/x.sh": "skills/work/scripts/x.sh" });
  });

  test("frontmatter is never rewritten", () => {
    const head = `---\nname: work\nallowed-tools: Bash(bash ${TOKEN}/scripts/x.sh:*)\n---\n`;
    const out = keyBody(`${head}Run ${TOKEN}/scripts/x.sh`, at);
    expect(out.text).toBe(`${head}Run @work/scripts/x.sh`);
  });
});

describe("keyBody: verb paths", () => {
  test("a file-relative verb path becomes a key", () => {
    const out = keyBody("Follow [receive](../receive-review/SKILL.md) next.", { dir: "attachments/board-respond", fileRel: "SKILL.md", units, written: everything });
    expect(out.text).toBe("Follow [receive](@receive-review/SKILL.md) next.");
    expect(out.targets).toEqual({ "receive-review/SKILL.md": "attachments/receive-review/SKILL.md" });
  });

  test("a pointer in a reference copy anchors at that file's folder", () => {
    const out = keyBody("Then read `../../../stage-plan/SKILL.md`.", { dir: "attachments/receive-review", fileRel: "references/widget-gates/SKILL.md", units, written: everything });
    expect(out.text).toBe("Then read `@stage-plan/SKILL.md`.");
    expect(out.targets).toEqual({ "stage-plan/SKILL.md": "attachments/stage-plan/SKILL.md" });
  });

  test("a markdown anchor stays after the key and the target is the file", () => {
    const out = keyBody("See [step 2](../receive-review/SKILL.md#step-2).", { dir: "attachments/board-respond", fileRel: "SKILL.md", units, written: everything });
    expect(out.text).toBe("See [step 2](@receive-review/SKILL.md#step-2).");
    expect(out.targets).toEqual({ "receive-review/SKILL.md": "attachments/receive-review/SKILL.md" });
  });

  test("the same reference file in two units gives two keys", () => {
    const twoUnits: UnitTable = { "stage-gates": "attachments/stage-gates", "watch-ci": "attachments/watch-ci" };
    const text = "Read `./references/widget-gates/SKILL.md`.";
    const written = writes("attachments/stage-gates/references/widget-gates/SKILL.md", "attachments/watch-ci/references/widget-gates/SKILL.md");
    const gates = keyBody(text, { dir: "attachments/stage-gates", fileRel: "SKILL.md", units: twoUnits, written });
    const ci = keyBody(text, { dir: "attachments/watch-ci", fileRel: "SKILL.md", units: twoUnits, written });
    expect(gates.text).toBe("Read `@stage-gates/references/widget-gates/SKILL.md`.");
    expect(ci.text).toBe("Read `@watch-ci/references/widget-gates/SKILL.md`.");
    expect({ ...gates.targets, ...ci.targets }).toEqual({
      "stage-gates/references/widget-gates/SKILL.md": "attachments/stage-gates/references/widget-gates/SKILL.md",
      "watch-ci/references/widget-gates/SKILL.md": "attachments/watch-ci/references/widget-gates/SKILL.md",
    });
  });

  test("a relative path that names no unit, or a bare one, stays", () => {
    const text = "Go up with ../somewhere/else.md or read scripts/x.sh.";
    const out = keyBody(text, { dir: "attachments/board-respond", fileRel: "SKILL.md", units, written: everything });
    expect(out.text).toBe(text);
    expect(out.targets).toEqual({});
  });
  test("a relative path is a key only when the build writes its target", () => {
    const at = { dir: "skills/work", fileRel: "SKILL.md", units, written: writes("skills/work/scripts/x.sh", "attachments/receive-review/SKILL.md") };
    const out = keyBody("From the repo root, run `./gradlew test`, `./scripts/lint.sh` and `./scripts/x.sh`, then read ../../attachments/receive-review/SKILL.md.", at);
    expect(out.text).toBe("From the repo root, run `./gradlew test`, `./scripts/lint.sh` and `@work/scripts/x.sh`, then read @receive-review/SKILL.md.");
    expect(out.targets).toEqual({ "work/scripts/x.sh": "skills/work/scripts/x.sh", "receive-review/SKILL.md": "attachments/receive-review/SKILL.md" });
  });

  test("a skill-dir token keys whether or not the build writes its target", () => {
    const out = keyBody(`Run ${TOKEN}/scripts/gone.sh.`, { dir: "skills/work", fileRel: "SKILL.md", units, written: () => false });
    expect(out.text).toBe("Run @work/scripts/gone.sh.");
  });
});

describe("spellFrom", () => {
  test("spells every target from the unit's folder", () => {
    expect(spellFrom("skills/work", "attachments/stage-plan/parts/d/x.sh")).toBe("../../attachments/stage-plan/parts/d/x.sh");
    expect(spellFrom("skills/work", "skills/stage-x/parts/d/y.sh")).toBe("../../skills/stage-x/parts/d/y.sh");
    expect(spellFrom("attachments/tools/widget", "attachments/receive-review/SKILL.md")).toBe("../../../attachments/receive-review/SKILL.md");
    expect(spellFrom("skills/work", "skills/work/scripts/x.sh")).toBe("scripts/x.sh");
  });
});

describe("closeMap", () => {
  const map = (id: string, dir: string, keys: PointerMap["keys"]): PointerMap => ({ id, dir, covers: [id], keys });

  test("two copies of one reference in two units give two keys", () => {
    const own = map("widgets@0.1.0:work", "skills/work", {});
    const gates = map("widgets@0.1.0:stage-gates", "attachments/stage-gates", { "stage-gates/references/widget-gates/SKILL.md": "attachments/stage-gates/references/widget-gates/SKILL.md" });
    const ci = map("widgets@0.1.0:watch-ci", "attachments/watch-ci", { "watch-ci/references/widget-gates/SKILL.md": "attachments/watch-ci/references/widget-gates/SKILL.md" });
    const out = closeMap(own, [gates, ci]);
    expect(out.keys).toEqual({
      "stage-gates/references/widget-gates/SKILL.md": "attachments/stage-gates/references/widget-gates/SKILL.md",
      "watch-ci/references/widget-gates/SKILL.md": "attachments/watch-ci/references/widget-gates/SKILL.md",
    });
    expect(out.covers).toEqual(["widgets@0.1.0:work", "widgets@0.1.0:stage-gates", "widgets@0.1.0:watch-ci"]);
    expect(out.id).toBe("widgets@0.1.0:work");
    expect(out.dir).toBe("skills/work");
  });

  test("a reached unit with no keys still appears in covers", () => {
    const out = closeMap(map("widgets@0.1.0:work", "skills/work", {}), [map("widgets@0.1.0:stage-plan", "attachments/stage-plan", {})]);
    expect(out.covers).toEqual(["widgets@0.1.0:work", "widgets@0.1.0:stage-plan"]);
  });

  test("covers lead with the unit's own id even when own.covers is empty", () => {
    const own: PointerMap = { id: "widgets@0.1.0:work", dir: "skills/work", covers: [], keys: {} };
    const out = closeMap(own, [map("widgets@0.1.0:stage-plan", "attachments/stage-plan", {})]);
    expect(out.covers).toEqual(["widgets@0.1.0:work", "widgets@0.1.0:stage-plan"]);
  });

  test("one key with two targets throws", () => {
    const own = map("widgets@0.1.0:work", "skills/work", { "work/x.sh": "skills/work/x.sh" });
    const other = map("widgets@0.1.0:stage-plan", "attachments/stage-plan", { "work/x.sh": { skill: "work", path: "x.sh" } });
    expect(() => closeMap(own, [other])).toThrow("work/x.sh");
  });
});

describe("isKey", () => {
  test("only a unit of the table makes a key", () => {
    expect(isKey("@work/scripts/x.sh", units)).toBe(true);
    expect(isKey("@widget/SKILL.md", units)).toBe(true);
  });

  test("scoped npm names, versions and emails are not keys", () => {
    for (const token of ["@mantine/core", "@acme/ui", "mattstack@0.32.28", "name@acme.dev"]) expect(isKey(token, units)).toBe(false);
  });
});

describe("ids", () => {
  test("ID_RE takes pinned unit ids and skills ids only", () => {
    expect(ID_RE.test("widgets@0.4.2:receive-review")).toBe(true);
    expect(ID_RE.test("skills:board:respond")).toBe(true);
    for (const id of ["widgets@latest:x", "../x", "skills:../x"]) expect(ID_RE.test(id)).toBe(false);
  });

  test("the builders spell ids ID_RE accepts", () => {
    expect(unitId("widgets", "0.4.2", "receive-review")).toBe("widgets@0.4.2:receive-review");
    expect(skillsId("board:respond")).toBe("skills:board:respond");
    expect(ID_RE.test(unitId("widgets", "0.4.2", "receive-review"))).toBe(true);
  });
});

describe("openingLine", () => {
  test("fills the id into the one-line instruction", () => {
    expect(openingLine("widgets@0.4.2:work")).toBe(
      'Pointers here are `@keys`. Resolve them once per run: if you already hold a `skills_resolve` map that covers `widgets@0.4.2:work`, use it; otherwise call `skills_resolve {id: "widgets@0.4.2:work"}` and use the path it returns for each key. If it fails, stop and say so; never look for the file another way.',
    );
  });
});

describe("leftoverTokens", () => {
  test("ignores frontmatter and finds the token in the body", () => {
    const text = `---\nname: work\nallowed-tools: Bash(bash ${TOKEN}/scripts/x.sh:*)\n---\nIntro.\nRun ${TOKEN}/nowhere.sh\n`;
    expect(leftoverTokens(text)).toEqual([{ line: 6, col: 5 }]);
  });
});
