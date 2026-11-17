import { describe, expect, test } from "bun:test";
import { HEADER_COMMENT } from "../compile.ts";
import { huskFor, isHuskText, LOAD_SKILL_TOOL } from "../husk.ts";
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
        'Before anything else, call `mcp__mattstack__load_skill {skill: "acme:work", dir: "${CLAUDE_SKILL_DIR}"}`. ' +
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
