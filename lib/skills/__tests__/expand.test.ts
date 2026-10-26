import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { UserActionableError } from "../../errors.ts";
import { checkExpanded, EXPAND_HEADER, expandSkills, writeExpanded, type ExpandedSkill } from "../expand.ts";
import { openingLine, type PointerMap } from "../pointers.ts";
import { resolvePluginRootsFromDir } from "../sources.ts";
import { MAP_FILE } from "../unit-maps.ts";

let root: string;
let src: string;
let out: string;

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

const NOTE = "---\nname: note\ndescription: shared note\n---\n\n# Note\n\nShared rule one.\n";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rt-expand-"));
  src = join(root, "skills-src");
  out = join(root, "skills");
  write(join(root, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "9.9.9" }));
  write(join(root, "plugins", "mattstack", "attachments", "note", "SKILL.md"), NOTE);
  write(
    join(src, "review", "SKILL.md"),
    "---\nname: board:review\ndescription: r\nallowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/go.sh:*)\nmetadata:\n  slots: \"review\"\n---\n\n# Review\n\nRead `${CLAUDE_SKILL_DIR}/../recipes/SKILL.md` first.\n\n{{include:note}}\n\nTail.\n",
  );
  write(join(src, "review", "scripts", "go.sh"), "#!/bin/sh\necho go\n");
  write(join(src, "recipes", "SKILL.md"), "---\nname: board:recipes\ndescription: plain\n---\n\n# Recipes\n\nNo includes here.\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function roots() {
  return resolvePluginRootsFromDir(root);
}

describe("expandSkills", () => {
  test("keeps frontmatter verbatim, stamps compiled, pastes the include under its marker", () => {
    const [recipes, review] = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    expect(review!.name).toBe("review");
    expect(review!.includes).toEqual(["note"]);
    expect(review!.skillMd).toContain("name: board:review\n");
    expect(review!.skillMd).toContain("allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/go.sh:*)\n");
    expect(review!.skillMd).toContain("metadata:\n  slots: \"review\"\n  compiled: \"mattstack:note@9.9.9\"\n---");
    expect(review!.skillMd).toContain(`\n${EXPAND_HEADER}\n`);
    expect(review!.skillMd).toMatch(/<!-- part: step source=review\/SKILL\.md path=review\/SKILL\.md lines=\d+-\d+ -->/);
    expect(review!.skillMd).toContain("<!-- part: include:note source=mattstack:note version=9.9.9 path=attachments/note/SKILL.md lines=");
    expect(review!.skillMd).toContain("Shared rule one.");
    expect(review!.skillMd).not.toContain("{{");
    expect(review!.files.map((f) => f.path)).toEqual(["scripts/go.sh", MAP_FILE]);
    expect(review!.files[0]).toEqual({ path: "scripts/go.sh", copyFrom: join(src, "review", "scripts", "go.sh") });
    expect(recipes!.includes).toEqual([]);
    expect(recipes!.skillMd).not.toContain("compiled:");
    expect(recipes!.skillMd).toContain("No includes here.");
  });

  test("a frontmatter with no metadata block gets one", () => {
    write(join(src, "plain", "SKILL.md"), "---\nname: board:plain\ndescription: p\n---\n\n{{include:note}}\n");
    const plain = expandSkills({ srcDir: src, outDir: out, roots: roots() }).find((s) => s.name === "plain")!;
    expect(plain.skillMd).toContain("description: p\nmetadata:\n  compiled: \"mattstack:note@9.9.9\"\n---");
  });

  test("refuses a source that already carries metadata.compiled", () => {
    write(join(src, "copied", "SKILL.md"), "---\nname: board:copied\ndescription: c\nmetadata:\n  compiled: \"x\"\n---\n\nbody\n");
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/copied\/SKILL\.md: metadata\.compiled is set by expand/);
  });

  test("refuses an include that is not alone on its line", () => {
    write(join(src, "inline", "SKILL.md"), "---\nname: board:inline\ndescription: i\n---\n\nSee {{include:note}} here.\n");
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/inline\/SKILL\.md: \{\{include:note\}\} must be alone on its line \(line 6\)/);
  });

  test("refuses any placeholder that is not an include", () => {
    write(join(src, "slotty", "SKILL.md"), "---\nname: board:slotty\ndescription: s\n---\n\n{{slot:domain}}\n");
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/slotty\/SKILL\.md: \{\{slot:domain\}\} at line 6 .* only \{\{include:<name>\}\}/);
  });

  test("refuses a literal {{ that is not a placeholder, at its file line", () => {
    write(join(src, "stray", "SKILL.md"), "---\nname: board:stray\ndescription: s\n---\n\n# Stray\n\nSee {{not a placeholder here.\n");
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/stray\/SKILL\.md: literal "\{\{" at line 8 is not a placeholder/);
  });

  test("refuses an include whose body carries a literal {{", () => {
    write(join(root, "plugins", "mattstack", "attachments", "note", "SKILL.md"), `${NOTE}\nOpen {{brace.\n`);
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(
      /review\/SKILL\.md: include "note" carries a literal "\{\{" at attachments\/note\/SKILL\.md line 10/,
    );
  });

  test("refuses an out dir that equals, contains, or sits inside the src dir", () => {
    const overlap = /overlaps src dir/;
    expect(() => expandSkills({ srcDir: src, outDir: src, roots: roots() })).toThrow(overlap);
    expect(() => expandSkills({ srcDir: src, outDir: root, roots: roots() })).toThrow(overlap);
    expect(() => expandSkills({ srcDir: src, outDir: join(src, "out"), roots: roots() })).toThrow(overlap);
  });

  test("refuses an unknown include by name", () => {
    write(join(src, "missing", "SKILL.md"), "---\nname: board:missing\ndescription: m\n---\n\n{{include:nope}}\n");
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/include "nope" not found/);
  });

  test("refuses a CLAUDE_SKILL_DIR path that leaves the output dir, names it, and passes a sibling", () => {
    write(
      join(src, "escape", "SKILL.md"),
      "---\nname: board:escape\ndescription: e\n---\n\nRun `cat ${CLAUDE_SKILL_DIR}/../../../../plugins/mattstack/attachments/note/SKILL.md`.\n",
    );
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(
      /escape\/SKILL\.md: "\$\{CLAUDE_SKILL_DIR\}\/\.\.\/\.\.\/\.\.\/\.\.\/plugins\/mattstack\/attachments\/note\/SKILL\.md" resolves outside/,
    );
    rmSync(join(src, "escape"), { recursive: true });
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).not.toThrow();
  });

  test("refuses a CLAUDE_SKILL_DIR path in the frontmatter that leaves the output dir", () => {
    write(
      join(src, "escape", "SKILL.md"),
      "---\nname: board:escape\ndescription: e\nallowed-tools: Bash(${CLAUDE_SKILL_DIR}/../../../../plugins/mattstack/scripts/x.sh:*)\n---\n\nBody.\n",
    );
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(
      /escape\/SKILL\.md: "\$\{CLAUDE_SKILL_DIR\}\/\.\.\/\.\.\/\.\.\/\.\.\/plugins\/mattstack\/scripts\/x\.sh:\*" resolves outside/,
    );
  });

  test("refuses a source dir with no SKILL.md and a src that does not exist", () => {
    mkdirSync(join(src, "empty"));
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/empty: no SKILL\.md/);
    expect(() => expandSkills({ srcDir: join(root, "nowhere"), outDir: out, roots: roots() })).toThrow(/nowhere does not exist/);
  });
});

const EXPANDED_ORPHAN = `---\nname: board:stale\n---\n\n${EXPAND_HEADER}\n\nold\n`;
const HAND_WRITTEN = "---\nname: board:mine\n---\n\n# Mine\n\nWritten by hand.\n";

describe("writeExpanded and checkExpanded", () => {
  test("writes SKILL.md and vendored files, removes an orphan output dir, then checks clean", () => {
    write(join(out, "stale", "SKILL.md"), EXPANDED_ORPHAN);
    const skills = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    const result = writeExpanded(out, skills);
    expect(result.written.sort()).toEqual(["recipes", "review"]);
    expect(result.removed).toEqual(["stale"]);
    expect(existsSync(join(out, "stale"))).toBe(false);
    expect(readFileSync(join(out, "review", "SKILL.md"), "utf8")).toBe(skills.find((s) => s.name === "review")!.skillMd);
    expect(readFileSync(join(out, "review", "scripts", "go.sh"), "utf8")).toBe("#!/bin/sh\necho go\n");
    expect(checkExpanded(out, skills)).toEqual([]);
  });

  test("a second write is idempotent", () => {
    const skills = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    writeExpanded(out, skills);
    const again = writeExpanded(out, skills);
    expect(again.removed).toEqual([]);
    expect(checkExpanded(out, skills)).toEqual([]);
  });

  test("a dir expand did not write makes the write throw, naming it, and touches nothing", () => {
    const skills = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    writeExpanded(out, skills);
    write(join(out, "stale", "SKILL.md"), EXPANDED_ORPHAN);
    write(join(out, "mine", "SKILL.md"), HAND_WRITTEN);
    write(join(out, "review", "scripts", "go.sh"), "changed\n");
    expect(() => writeExpanded(out, skills)).toThrow(`${join(out, "mine")} is not expand output; move it or choose another --out`);
    expect(readFileSync(join(out, "mine", "SKILL.md"), "utf8")).toBe(HAND_WRITTEN);
    expect(readFileSync(join(out, "stale", "SKILL.md"), "utf8")).toBe(EXPANDED_ORPHAN);
    expect(readFileSync(join(out, "review", "scripts", "go.sh"), "utf8")).toBe("changed\n");
  });

  test("a hand-written dir sharing a source skill's name is refused too", () => {
    write(join(out, "review", "SKILL.md"), HAND_WRITTEN);
    const skills = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    expect(() => writeExpanded(out, skills)).toThrow(/review is not expand output/);
    expect(readFileSync(join(out, "review", "SKILL.md"), "utf8")).toBe(HAND_WRITTEN);
    expect(checkExpanded(out, skills)).toContainEqual({ skill: "review", causes: ["foreign"] });
  });

  test("a plugin version bump alone is not drift, and the write still stamps the new version", () => {
    writeExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));
    write(join(root, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "9.9.10" }));
    const bumped = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    expect(checkExpanded(out, bumped)).toEqual([]);
    writeExpanded(out, bumped);
    const md = readFileSync(join(out, "review", "SKILL.md"), "utf8");
    expect(md).toContain('compiled: "mattstack:note@9.9.10"');
    expect(md).toContain("source=mattstack:note version=9.9.10 ");
  });

  test("check names the cause: source, include, frontmatter, vendored, missing, orphan, foreign", () => {
    const skills = expandSkills({ srcDir: src, outDir: out, roots: roots() });
    writeExpanded(out, skills);

    write(join(src, "review", "SKILL.md"), readFileSync(join(src, "review", "SKILL.md"), "utf8").replace("# Review", "# Review v2"));
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([{ skill: "review", causes: ["source"] }]);
    writeExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));

    write(join(src, "review", "SKILL.md"), readFileSync(join(src, "review", "SKILL.md"), "utf8").replace("Tail.", "Tail v2."));
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([{ skill: "review", causes: ["include"] }]);
    writeExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));

    write(join(root, "plugins", "mattstack", "attachments", "note", "SKILL.md"), NOTE.replace("rule one", "rule two"));
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([{ skill: "review", causes: ["include"] }]);
    writeExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));

    write(join(src, "review", "SKILL.md"), readFileSync(join(src, "review", "SKILL.md"), "utf8").replace("description: r", "description: r2"));
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([{ skill: "review", causes: ["frontmatter"] }]);
    writeExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));

    write(join(out, "review", "scripts", "go.sh"), "changed\n");
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([
      { skill: "review", causes: ["vendored (scripts/go.sh)"] },
    ]);

    rmSync(join(out, "recipes"), { recursive: true });
    write(join(out, "orphan", "SKILL.md"), EXPANDED_ORPHAN);
    write(join(out, "mine", "SKILL.md"), HAND_WRITTEN);
    const drift = checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));
    expect(drift).toContainEqual({ skill: "recipes", causes: ["missing"] });
    expect(drift).toContainEqual({ skill: "orphan", causes: ["orphan"] });
    expect(drift).toContainEqual({ skill: "mine", causes: ["foreign"] });
  });

  test("check names the vendored path that is extra or missing", () => {
    writeExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));
    rmSync(join(src, "review", "scripts", "go.sh"));
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([
      { skill: "review", causes: ["vendored (scripts/go.sh)"] },
    ]);
    write(join(src, "review", "scripts", "go.sh"), "#!/bin/sh\necho go\n");
    write(join(src, "review", "scripts", "new.sh"), "#!/bin/sh\n");
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([
      { skill: "review", causes: ["vendored (scripts/new.sh)"] },
    ]);
  });
});

describe("pointers", () => {
  const ALLOWED = "allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)";

  beforeEach(() => {
    rmSync(src, { recursive: true, force: true });
    write(
      join(src, "widget", "SKILL.md"),
      `---\nname: board:widget\ndescription: w\n${ALLOWED}\n---\n\n# Widget\n\nRun \`"\${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"\`.\n\nRead \`\${CLAUDE_SKILL_DIR}/../gate-cli-recipes/SKILL.md\` first.\n`,
    );
    write(join(src, "widget", "scripts", "resolve-args.sh"), "#!/bin/sh\n# lives at ${CLAUDE_SKILL_DIR}/scripts\n");
    write(join(src, "widget", "launch.md"), "# Launch\n\nThen run `${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh`.\n");
    write(join(src, "gate-cli-recipes", "SKILL.md"), "---\nname: board:gate-cli-recipes\ndescription: g\n---\n\n# Recipes\n\nNo pointers.\n");
  });

  const expanded = () => expandSkills({ srcDir: src, outDir: out, roots: roots() });
  const widget = () => expanded().find((s) => s.name === "widget")!;
  const fileText = (s: ExpandedSkill, path: string) => {
    const f = s.files.find((x) => x.path === path)!;
    return "content" in f ? f.content : readFileSync(f.copyFrom, "utf8");
  };
  const mapOf = (s: ExpandedSkill) => JSON.parse(fileText(s, MAP_FILE)) as PointerMap;

  test("bodies carry @keys and the opening line; frontmatter and scripts keep the token", () => {
    const w = widget();
    expect(w.skillMd).toContain(`\n${ALLOWED}\n`);
    expect(w.skillMd).toContain('Run `"@widget/scripts/resolve-args.sh"`.');
    expect(w.skillMd).toContain("Read `@gate-cli-recipes/SKILL.md` first.");
    expect(w.skillMd).toContain(`${EXPAND_HEADER}\n\n${openingLine("skills:board:widget")}\n`);
    expect(fileText(w, "launch.md")).toBe(`${openingLine("skills:board:widget")}\n\n# Launch\n\nThen run \`@widget/scripts/resolve-args.sh\`.\n`);
    expect(w.files).toContainEqual({ path: "scripts/resolve-args.sh", copyFrom: join(src, "widget", "scripts", "resolve-args.sh") });
  });

  test("compiled.json names the skill's id, keys its own files and a sibling by skill name", () => {
    expect(mapOf(widget())).toEqual({
      id: "skills:board:widget",
      dir: "skills/widget",
      covers: ["skills:board:widget", "skills:board:gate-cli-recipes"],
      keys: {
        "widget/scripts/resolve-args.sh": "skills/widget/scripts/resolve-args.sh",
        "gate-cli-recipes/SKILL.md": { skill: "board:gate-cli-recipes", path: "SKILL.md" },
      },
    });
    const recipes = expanded().find((s) => s.name === "gate-cli-recipes")!;
    expect(recipes.skillMd).not.toContain("Pointers here are");
    expect(mapOf(recipes)).toEqual({ id: "skills:board:gate-cli-recipes", dir: "skills/gate-cli-recipes", covers: ["skills:board:gate-cli-recipes"], keys: {} });
  });

  test("the written compiled.json and keyed .md are part of the skill for check", () => {
    const skills = expanded();
    writeExpanded(out, skills);
    expect(JSON.parse(readFileSync(join(out, "widget", MAP_FILE), "utf8")).id).toBe("skills:board:widget");
    expect(checkExpanded(out, skills)).toEqual([]);
    write(join(out, "widget", MAP_FILE), "{}\n");
    expect(checkExpanded(out, skills)).toEqual([{ skill: "widget", causes: [`vendored (${MAP_FILE})`] }]);
    rmSync(join(out, "widget", MAP_FILE));
    expect(checkExpanded(out, skills)).toEqual([{ skill: "widget", causes: [`vendored (${MAP_FILE})`] }]);
    writeExpanded(out, skills);
    write(join(out, "widget", "launch.md"), "# Launch\n");
    expect(checkExpanded(out, skills)).toEqual([{ skill: "widget", causes: ["vendored (launch.md)"] }]);
  });

  test("refuses a pointer at a file no board skill writes", () => {
    write(join(src, "widget", "extra.md"), "See `${CLAUDE_SKILL_DIR}/scripts/gone.sh`.\n");
    expect(() => expanded()).toThrow(/widget\/extra\.md: @widget\/scripts\/gone\.sh points at scripts\/gone\.sh in board:widget, which expand does not write/);
  });

  test("a relative path expand does not write stays as written; one it writes is a key", () => {
    write(join(src, "widget", "extra.md"), "From the repo root, run `./gradlew test`, then `./scripts/resolve-args.sh`.\n");
    expect(fileText(widget(), "extra.md")).toBe(`${openingLine("skills:board:widget")}\n\nFrom the repo root, run \`./gradlew test\`, then \`@widget/scripts/resolve-args.sh\`.\n`);
  });

  test("compiled.json lists its keys sorted, whatever order the text names them in", () => {
    expect(Object.keys(mapOf(widget()).keys)).toEqual(["gate-cli-recipes/SKILL.md", "widget/scripts/resolve-args.sh"]);
  });

  test("an include-vendored .md is keyed as the skill's own, and refuses a pointer at a file nothing writes", () => {
    const NOTE_DIR = join(root, "plugins", "mattstack", "attachments", "note");
    write(join(NOTE_DIR, "tool.sh"), "echo\n");
    write(join(NOTE_DIR, "guide.md"), "Run `${CLAUDE_SKILL_DIR}/parts/include-note/tool.sh`.\n");
    write(join(src, "widget", "SKILL.md"), "---\nname: board:widget\ndescription: w\n---\n\n{{include:note}}\n");
    const w = widget();
    expect(fileText(w, "parts/include-note/guide.md")).toBe(`${openingLine("skills:board:widget")}\n\nRun \`@widget/parts/include-note/tool.sh\`.\n`);
    expect(mapOf(w).keys["widget/parts/include-note/tool.sh"]).toBe("skills/widget/parts/include-note/tool.sh");
    write(join(NOTE_DIR, "guide.md"), "Run `${CLAUDE_SKILL_DIR}/parts/include-note/gone.sh`.\n");
    expect(() => expanded()).toThrow(/widget\/parts\/include-note\/guide\.md: @widget\/parts\/include-note\/gone\.sh points at parts\/include-note\/gone\.sh in board:widget/);
  });

  test("refuses a source that carries its own compiled.json", () => {
    write(join(src, "widget", MAP_FILE), "{}\n");
    expect(() => expanded()).toThrow(`widget/${MAP_FILE}: expand writes this file; remove it from the source`);
  });

  test("each pointer refusal is actionable: it carries a why, and leaves the command to its caller", () => {
    const refusal = (): UserActionableError => {
      try {
        expanded();
      } catch (err) {
        return err as UserActionableError;
      }
      throw new Error("expand did not refuse");
    };
    const cases: [string, string][] = [
      [join(src, "widget", "extra.md"), "See `${CLAUDE_SKILL_DIR}/../elsewhere/x.md`.\n"],
      [join(src, "widget", "extra.md"), "See `${CLAUDE_SKILL_DIR}/scripts/gone.sh`.\n"],
      [join(src, "widget", MAP_FILE), "{}\n"],
    ];
    for (const [path, text] of cases) {
      write(path, text);
      const err = refusal();
      expect(err).toBeInstanceOf(UserActionableError);
      expect(err.why).toBeTruthy();
      expect(err.next).toBeUndefined();
      rmSync(path);
    }
  });

  test("refuses a skill-dir path that lands in no board skill", () => {
    write(join(src, "widget", "extra.md"), "See `${CLAUDE_SKILL_DIR}/../elsewhere/x.md`.\n");
    expect(() => expanded()).toThrow(/widget\/extra\.md: \$\{CLAUDE_SKILL_DIR\} at line 1 does not point into a board skill/);
  });

  test("a stray unbraced token is named as written", () => {
    write(join(src, "widget", "extra.md"), "Intro.\nSee `$CLAUDE_SKILL_DIR/../elsewhere/x.md`.\n");
    expect(() => expanded()).toThrow("widget/extra.md: $CLAUDE_SKILL_DIR at line 2 does not point into a board skill");
  });
});

describe("block-tree includes", () => {
  const GP = join("plugins", "mattstack", "attachments", "gp");

  function gateProtocol(): void {
    write(join(root, GP, "index.block.md"), "---\n---\n\n# Gate protocol\n\nGate intro.\n");
    write(join(root, GP, "ask.block.md"), "---\n---\n\n# Ask\n\nAsk it.\n");
  }

  function launcher(body: string): void {
    write(join(src, "gates", "SKILL.md"), `---\nname: board:gates\ndescription: g\n---\n\n${body}\n`);
  }

  const headings = (md: string) => md.split("\n").filter((l) => /^#+ /.test(l));
  const gatesSkill = () => expandSkills({ srcDir: src, outDir: out, roots: roots() }).find((s) => s.name === "gates")!;

  test("an include repeating the heading above it keeps that heading once and its child one level down", () => {
    gateProtocol();
    launcher("# Gates\n\n## Gate protocol\n\n{{include:gp}}");
    const skill = gatesSkill();
    expect(headings(skill.skillMd)).toEqual(["# Gates", "## Gate protocol", "### Ask"]);
    expect(skill.skillMd).toContain("Gate intro.");
    expect(skill.skillMd).toContain(`${EXPAND_HEADER}`);
    expect(skill.skillMd).toContain('  compiled: "mattstack:gp@9.9.9"');
    expect(skill.skillMd).not.toContain("{{");
  });

  test("under a different heading the root renders one level down and its child below it", () => {
    gateProtocol();
    launcher("# Top\n\n## Gates\n\n{{include:gp}}");
    expect(headings(gatesSkill().skillMd)).toEqual(["# Top", "## Gates", "### Gate protocol", "#### Ask"]);
  });

  test("a heading inside a code fence is not the nearest heading", () => {
    gateProtocol();
    launcher("## Gates\n\n```\n# Gate protocol\n```\n\n{{include:gp}}");
    const md = gatesSkill().skillMd;
    expect(md.split("\n").filter((l) => l === "# Gate protocol")).toHaveLength(1);
    expect(headings(md).filter((h) => h !== "# Gate protocol")).toEqual(["## Gates", "### Gate protocol", "#### Ask"]);
  });

  test("with no heading above, the root renders at level 1", () => {
    gateProtocol();
    launcher("Intro.\n\n{{include:gp}}");
    expect(headings(gatesSkill().skillMd)).toEqual(["# Gate protocol", "## Ask"]);
  });

  test("a diagnostic from the include surfaces as the thrown error", () => {
    write(join(root, GP, "index.block.md"), "---\n---\n\n# Gate protocol\n\n{{include:gp}}\n");
    launcher("## Gates\n\n{{include:gp}}");
    expect(() => gatesSkill()).toThrow(/would include itself/);
  });

  test("an empty optional prop drops its titled block, a skill default is inlined and its files vendor", () => {
    write(join(root, "plugins", "mattstack", "attachments", "rules", "SKILL.md"), "---\nname: rules\ndescription: r\nmetadata:\n  provides: \"rules@1\"\n---\n\nFollow ${CLAUDE_SKILL_DIR}/lint.sh.\n");
    write(join(root, "plugins", "mattstack", "attachments", "rules", "lint.sh"), "echo lint\n");
    write(join(root, GP, "index.block.md"), '---\n---\n\n# Gate protocol\n\nGate intro.\n');
    write(join(root, GP, "extra.block.md"), '---\nprops:\n  extra:\n    merge: add\n    default: ""\n---\n\n# Extra\n\n{{props.extra}}\n');
    write(join(root, GP, "rules.block.md"), '---\nprops:\n  rules:\n    merge: replace\n    default: "mattstack:rules"\n---\n\n# Rules\n\n{{props.rules}}\n');
    launcher("## Gates\n\n{{include:gp}}");
    const skill = gatesSkill();
    expect(headings(skill.skillMd)).toEqual(["## Gates", "### Gate protocol", "#### Rules"]);
    expect(skill.skillMd).toContain("Follow @gates/parts/+gp/rules/rules/lint.sh.");
    expect(skill.files).toContainEqual({
      path: "parts/+gp/rules/rules/lint.sh",
      copyFrom: join(root, "plugins", "mattstack", "attachments", "rules", "lint.sh"),
    });
  });

  test("a required prop with no default throws at the include file's line and column", () => {
    write(join(root, GP, "index.block.md"), "---\nprops:\n  need:\n    merge: replace\n---\n\n# Gate protocol\n\n{{props.need}}\n");
    launcher("## Gates\n\n{{include:gp}}");
    expect(() => gatesSkill()).toThrow(/gp\/index\.block\.md:\d+:\d+/);
  });

  test("a nested tree include is stamped and vendors its extra files", () => {
    write(join(root, GP, "index.block.md"), "---\n---\n\n# Gate protocol\n\n{{include:inner}}\n");
    const inner = join("plugins", "mattstack", "attachments", "inner");
    write(join(root, inner, "index.block.md"), "---\n---\n\n# Inner\n\nInner text.\n");
    write(join(root, inner, "tool.sh"), "echo\n");
    launcher("## Gates\n\n{{include:gp}}");
    const skill = gatesSkill();
    expect(skill.skillMd).toContain("Inner text.");
    expect(skill.skillMd).toContain("mattstack:gp@9.9.9 + mattstack:inner@9.9.9");
    expect(skill.files.map((f) => f.path)).toContain("parts/include-inner/tool.sh");
  });

  test("a tree include's skill-dir paths point at its vendored files, nested includes too", () => {
    write(join(root, GP, "index.block.md"), "---\n---\n\n# Gate protocol\n\nOpen `${CLAUDE_SKILL_DIR}/ctx.txt`.\n\n{{include:inner}}\n");
    write(join(root, GP, "ctx.txt"), "x\n");
    const inner = join("plugins", "mattstack", "attachments", "inner");
    write(join(root, inner, "index.block.md"), "---\n---\n\n# Inner\n\nRun `${CLAUDE_SKILL_DIR}/tool.sh`.\n");
    write(join(root, inner, "tool.sh"), "echo\n");
    launcher("## Gates\n\n{{include:gp}}");
    const skill = gatesSkill();
    expect(skill.skillMd).toContain("Open `@gates/parts/include-gp/ctx.txt`.");
    expect(skill.skillMd).toContain("Run `@gates/parts/include-inner/tool.sh`.");
    expect(skill.files.map((f) => f.path)).toEqual(expect.arrayContaining(["parts/include-gp/ctx.txt", "parts/include-inner/tool.sh"]));
  });
});
