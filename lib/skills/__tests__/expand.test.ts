import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkExpanded, EXPAND_HEADER, expandSkills, writeExpanded } from "../expand.ts";
import { resolvePluginRootsFromDir } from "../sources.ts";

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
    expect(review!.files).toEqual([{ path: "scripts/go.sh", copyFrom: join(src, "review", "scripts", "go.sh") }]);
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

  test("refuses a source dir with no SKILL.md and a src that does not exist", () => {
    mkdirSync(join(src, "empty"));
    expect(() => expandSkills({ srcDir: src, outDir: out, roots: roots() })).toThrow(/empty: no SKILL\.md/);
    expect(() => expandSkills({ srcDir: join(root, "nowhere"), outDir: out, roots: roots() })).toThrow(/nowhere does not exist/);
  });
});

describe("writeExpanded and checkExpanded", () => {
  test("writes SKILL.md and vendored files, removes an orphan output dir, then checks clean", () => {
    write(join(out, "stale", "SKILL.md"), "---\nname: board:stale\n---\n\nold\n");
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

  test("check names the cause: source, include, frontmatter, vendored, missing, orphan", () => {
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
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([{ skill: "review", causes: ["vendored"] }]);

    rmSync(join(out, "recipes"), { recursive: true });
    write(join(out, "orphan", "SKILL.md"), "---\nname: x\n---\n");
    const drift = checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));
    expect(drift).toContainEqual({ skill: "recipes", causes: ["missing"] });
    expect(drift).toContainEqual({ skill: "orphan", causes: ["orphan"] });
  });

  test("check reports a stale vendored file whose source was deleted", () => {
    writeExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }));
    rmSync(join(src, "review", "scripts", "go.sh"));
    expect(checkExpanded(out, expandSkills({ srcDir: src, outDir: out, roots: roots() }))).toEqual([{ skill: "review", causes: ["vendored"] }]);
  });
});
