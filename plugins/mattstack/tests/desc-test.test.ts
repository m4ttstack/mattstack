import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRoster, parseFrontmatter, scoreRuns } from "./desc-test";

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
});

describe("scoreRuns", () => {
  test("all correct passes, one miss fails", () => {
    expect(scoreRuns(["a", "a"], "a").pass).toBe(true);
    expect(scoreRuns(["a", "b"], "a").pass).toBe(false);
  });
});
