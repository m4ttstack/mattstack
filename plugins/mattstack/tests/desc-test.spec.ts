import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrompt, buildRoster, expectedPick, parseFrontmatter, scoreRuns } from "./desc-test";

describe("parseFrontmatter", () => {
  test("reads single-line name and description", () => {
    const p = parseFrontmatter('---\nname: fake:a\ndescription: "Use when a."\n---\nbody');
    expect(p).toEqual({ name: "fake:a", description: '"Use when a."', hidden: false });
  });
  test("flags disable-model-invocation", () => {
    const p = parseFrontmatter(
      "---\nname: fake:b\ndescription: Use when b.\ndisable-model-invocation: true\n---\n",
    );
    expect(p?.hidden).toBe(true);
  });
});

describe("buildRoster", () => {
  test("walks nested category dirs and skips hidden skills", () => {
    const root = mkdtempSync(join(tmpdir(), "roster-"));
    mkdirSync(join(root, "skills", "cat", "vis"), { recursive: true });
    writeFileSync(
      join(root, "skills", "cat", "vis", "SKILL.md"),
      "---\nname: fake:vis\ndescription: Use when visible.\n---\n",
    );
    mkdirSync(join(root, "skills", "cat", "hid"), { recursive: true });
    writeFileSync(
      join(root, "skills", "cat", "hid", "SKILL.md"),
      "---\nname: fake:hid\ndescription: Use when hidden.\ndisable-model-invocation: true\n---\n",
    );
    mkdirSync(join(root, "plugin", "skills", "flat"), { recursive: true });
    writeFileSync(
      join(root, "plugin", "skills", "flat", "SKILL.md"),
      "---\nname: fake:flat\ndescription: Use when flat.\n---\n",
    );
    const roster = buildRoster(root);
    expect(roster).toContain("fake:vis");
    expect(roster).toContain("fake:flat");
    expect(roster).not.toContain("fake:hid");
  });

  test("a compiled verb at skills/<name>/SKILL.md (no category dir) is in the roster", () => {
    const root = mkdtempSync(join(tmpdir(), "roster-"));
    mkdirSync(join(root, "skills", "verb", "parts"), { recursive: true });
    writeFileSync(
      join(root, "skills", "verb", "SKILL.md"),
      "---\nname: fake:verb\ndescription: Use when compiled.\n---\n",
    );
    const roster = buildRoster(root);
    expect(roster).toContain("fake:verb");
  });
});

describe("expectedPick", () => {
  test("a null expect resolves to NONE", () => {
    expect(expectedPick({ task: "x", expect: null })).toBe("NONE");
  });
  test("a string expect passes through unchanged", () => {
    expect(expectedPick({ task: "x", expect: "shepherdr" })).toBe("shepherdr");
  });
});

describe("buildPrompt", () => {
  test("offers NONE as a valid answer alongside the roster names", () => {
    const prompt = buildPrompt("- **foo**: bar\n", "some task");
    expect(prompt).toContain("NONE");
  });
});

describe("scoreRuns", () => {
  test("all correct passes, one miss fails", () => {
    expect(scoreRuns(["a", "a"], "a").pass).toBe(true);
    expect(scoreRuns(["a", "b"], "a").pass).toBe(false);
  });

  test("a pick is its first line: MCP warnings claude -p prints after it do not count against it", () => {
    const noisy = "shepherdr\nClient.listTools() called but server does not advertise tools capability - returning empty list\n";
    expect(scoreRuns([noisy], "shepherdr").pass).toBe(true);
  });
});
