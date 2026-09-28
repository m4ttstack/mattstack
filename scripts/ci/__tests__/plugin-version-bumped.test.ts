import { describe, expect, test } from "bun:test";
import { checkVersionBump } from "../plugin-version-bumped.ts";

describe("checkVersionBump", () => {
  test("passes when the PR changed nothing under the plugin", () => {
    expect(checkVersionBump({ plugin: "plugins/mattstack", changed: [], baseVersion: "1.0.0", headVersion: "1.0.0" }).ok).toBe(true);
  });

  test("fails when the plugin changed and its version did not", () => {
    const result = checkVersionBump({
      plugin: "plugins/mattstack",
      changed: ["plugins/mattstack/skills/a/SKILL.md"],
      baseVersion: "1.0.0",
      headVersion: "1.0.0",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("plugins/mattstack/.claude-plugin/plugin.json");
    expect(result.message).toContain("1.0.0");
  });

  test("passes when the plugin changed and its version moved", () => {
    expect(
      checkVersionBump({ plugin: "plugins/mattstack", changed: ["plugins/mattstack/README.md"], baseVersion: "1.0.0", headVersion: "1.0.1" }).ok,
    ).toBe(true);
  });

  test("passes when the plugin is new in the PR", () => {
    expect(
      checkVersionBump({ plugin: "plugins/mattstack", changed: ["plugins/mattstack/README.md"], baseVersion: null, headVersion: "0.1.0" }).ok,
    ).toBe(true);
  });

  test("fails when the head manifest has no version", () => {
    expect(
      checkVersionBump({ plugin: "plugins/mattstack", changed: ["plugins/mattstack/README.md"], baseVersion: "1.0.0", headVersion: null }).ok,
    ).toBe(false);
  });
});
