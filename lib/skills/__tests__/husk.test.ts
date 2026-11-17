import { describe, expect, test } from "bun:test";
import { HEADER_COMMENT } from "../compile.ts";
import { huskFor, huskToolPathErrors, isHuskText, LOAD_SKILL_TOOL } from "../husk.ts";
import { stripFrontmatter } from "../sources.ts";

const compiled = [
  "---",
  'name: "work"',
  'description: "Run a unit of work"',
  "allowed-tools:",
  '  - "Bash(git log:*)"',
  '  - "Bash(${CLAUDE_SKILL_DIR}/scripts/x.sh:*)"',
  "disable-model-invocation: true",
  "metadata:",
  '  compiled: "mattstack"',
  "---",
  "",
  HEADER_COMMENT,
  "",
  "The full body, with @keys.",
  "",
].join("\n");

describe("huskFor", () => {
  test("huskFor keeps frontmatter and adds the tool", () => {
    const husk = huskFor(compiled, "acme:work");
    const { frontmatter, body } = stripFrontmatter(husk);
    expect(frontmatter.name).toBe("work");
    expect(frontmatter.description).toBe("Run a unit of work");
    expect(frontmatter["disable-model-invocation"]).toBe(true);
    expect(frontmatter.metadata).toEqual({ compiled: "mattstack" });
    expect(frontmatter["allowed-tools"]).toEqual(["Bash(git log:*)", "Bash(${CLAUDE_SKILL_DIR}/scripts/x.sh:*)", LOAD_SKILL_TOOL]);
    expect(body).toBe(
      `${HEADER_COMMENT}\n\n` +
        'Before anything else, call `mcp__mattstack__load_skill {skill: "acme:work", dir: "<this skill\'s directory>"}`. ' +
        "What it returns is this skill's full text: follow it as the skill. " +
        "If the tool says any part was saved to a file, Read that whole file first. If the call fails, stop and say so.",
    );
    expect(husk).not.toContain("The full body");
  });

  test("a skill with no allowed-tools gets the tool alone", () => {
    const husk = huskFor('---\nname: "a"\ndescription: "A"\nmetadata:\n  compiled: "mattstack"\n---\n\nBody.\n', "acme:a");
    expect(stripFrontmatter(husk).frontmatter["allowed-tools"]).toEqual([LOAD_SKILL_TOOL]);
    expect(stripFrontmatter(husk).frontmatter.metadata).toEqual({ compiled: "mattstack" });
  });

  test("a string allowed-tools becomes a list with the tool once", () => {
    const husk = huskFor(`---\nname: a\ndescription: A\nallowed-tools: Read, ${LOAD_SKILL_TOOL}\n---\nBody.\n`, "acme:a");
    expect(stripFrontmatter(husk).frontmatter["allowed-tools"]).toEqual(["Read", LOAD_SKILL_TOOL]);
  });

  test("a husk is idempotent and reads as one", () => {
    const husk = huskFor(compiled, "acme:work");
    expect(huskFor(husk, "acme:work")).toBe(husk);
    expect(isHuskText(husk)).toBe(true);
    expect(isHuskText(compiled)).toBe(false);
    expect(isHuskText("---\nname: x\ndescription: Use when: x\n---\nBody.\n")).toBe(false);
  });
});

describe("huskToolPathErrors", () => {
  test("a rule naming a cache-only folder fails, braced or not", () => {
    const text = [
      "---",
      "name: a",
      "allowed-tools:",
      '  - "Bash(${CLAUDE_SKILL_DIR}/scripts/x.sh:*)"',
      '  - "Read($CLAUDE_SKILL_DIR/references/notes.md)"',
      '  - "Bash($CLAUDE_SKILL_DIR/parts/y.sh:*)"',
      '  - "Bash(${CLAUDE_SKILL_DIR}/../shared/z.sh:*)"',
      "---",
      "Body.",
    ].join("\n");
    expect(huskToolPathErrors("skills/a/SKILL.md", text).map((d) => [d.line, d.code, d.message])).toEqual([
      [4, "husk-tool-path", "allowed-tools rule Bash(${CLAUDE_SKILL_DIR}/scripts/x.sh:*) names ${CLAUDE_SKILL_DIR}/scripts/, which a husk pack keeps only in each member's render"],
      [5, "husk-tool-path", "allowed-tools rule Read($CLAUDE_SKILL_DIR/references/notes.md) names $CLAUDE_SKILL_DIR/references/, which a husk pack keeps only in each member's render"],
      [6, "husk-tool-path", "allowed-tools rule Bash($CLAUDE_SKILL_DIR/parts/y.sh:*) names $CLAUDE_SKILL_DIR/parts/, which a husk pack keeps only in each member's render"],
    ]);
  });
});
