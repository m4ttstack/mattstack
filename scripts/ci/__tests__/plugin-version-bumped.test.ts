import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkVersionBump, readHeadVersion } from "../plugin-version-bumped.ts";

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

describe("readHeadVersion", () => {
  function root(manifest: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), "plugin-version-bumped-"));
    if (manifest !== null) {
      mkdirSync(join(dir, "plugins", "p", ".claude-plugin"), { recursive: true });
      writeFileSync(join(dir, "plugins", "p", ".claude-plugin", "plugin.json"), manifest);
    }
    return dir;
  }

  test("reads the version", () => {
    expect(readHeadVersion(root('{"version":"1.2.3"}'), "plugins/p")).toEqual({ version: "1.2.3" });
  });

  test("a missing manifest is a one-line error", () => {
    expect(readHeadVersion(root(null), "plugins/p")).toEqual({ error: "plugins/p/.claude-plugin/plugin.json is missing" });
  });

  test("bad JSON is a one-line error", () => {
    const result = readHeadVersion(root("{nope"), "plugins/p");
    const error = "error" in result ? result.error : "";
    expect(error).toStartWith("plugins/p/.claude-plugin/plugin.json is not valid JSON");
    expect(error).not.toContain("\n");
  });
});
