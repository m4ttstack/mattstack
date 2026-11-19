import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRealProbes, type Probes } from "../../setup/probes.ts";
import { claudeRulesDir, distinctConfigDirs, linkConfigDir, mattstackRulesSource, packEntryName } from "../paths.ts";

let home: string;
let outside: string;
let p: Probes;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "claude-rules-home-"));
  outside = mkdtempSync(join(tmpdir(), "claude-rules-outside-"));
  p = { ...createRealProbes(), home, env: { HOME: home } };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function writeKnown(configDir: string, body: string): void {
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  writeFileSync(join(configDir, "plugins", "known_marketplaces.json"), body);
}

function marketplaceAt(loc: string, withRules = true): void {
  mkdirSync(join(loc, "plugins", "mattstack", withRules ? "rules" : ""), { recursive: true });
}

describe("names", () => {
  test("claudeRulesDir sits under ~/.mattstack/claude/rules", () => {
    expect(claudeRulesDir("/h")).toBe("/h/.mattstack/claude/rules");
  });

  test("packEntryName prefixes the org", () => {
    expect(packEntryName("acme", "widgets")).toBe("acme-widgets");
  });
});

describe("mattstackRulesSource", () => {
  test("a mattstack marketplace under home with rules/ resolves to its rules folder", () => {
    const configDir = join(home, ".claude");
    const loc = join(configDir, "plugins", "marketplaces", "mattstack");
    marketplaceAt(loc);
    writeKnown(configDir, JSON.stringify({ mattstack: { source: { source: "github" }, installLocation: loc } }));
    expect(mattstackRulesSource(p, configDir)).toEqual({ path: join(loc, "plugins", "mattstack", "rules") });
  });

  test.each([
    ["missing file", null],
    ["unparsable file", "{not json"],
    ["no mattstack marketplace", JSON.stringify({ other: { installLocation: "/x" } })],
  ])("%s is skipped with a reason", (_name, body) => {
    const configDir = join(home, ".claude");
    if (body !== null) writeKnown(configDir, body);
    const r = mattstackRulesSource(p, configDir);
    expect("skipped" in r && r.skipped.length > 0).toBe(true);
  });

  test("a location outside home is skipped", () => {
    const configDir = join(home, ".claude");
    marketplaceAt(outside);
    writeKnown(configDir, JSON.stringify({ mattstack: { installLocation: outside } }));
    const r = mattstackRulesSource(p, configDir);
    expect("skipped" in r && r.skipped.length > 0).toBe(true);
  });

  test("a marketplace with no rules/ folder is skipped", () => {
    const configDir = join(home, ".claude");
    const loc = join(home, "mkt");
    marketplaceAt(loc, false);
    writeKnown(configDir, JSON.stringify({ mattstack: { installLocation: loc } }));
    const r = mattstackRulesSource(p, configDir);
    expect("skipped" in r && r.skipped.length > 0).toBe(true);
  });
});

describe("linkConfigDir", () => {
  test("creates the link, then reports ok", () => {
    const configDir = join(home, ".claude");
    const target = claudeRulesDir(home);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "x.md"), "hello");

    expect(linkConfigDir(p, configDir, target)).toBe("created");
    expect(readFileSync(join(configDir, "rules", "mattstack", "x.md"), "utf8")).toBe("hello");
    expect(linkConfigDir(p, configDir, target)).toBe("ok");
  });

  test("a real folder at rules/mattstack is foreign and left alone", () => {
    const configDir = join(home, ".claude");
    const mine = join(configDir, "rules", "mattstack");
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, "own.md"), "mine");

    expect(linkConfigDir(p, configDir, claudeRulesDir(home))).toBe("foreign");
    expect(lstatSync(mine).isDirectory()).toBe(true);
    expect(readFileSync(join(mine, "own.md"), "utf8")).toBe("mine");
  });

  test("a link elsewhere at rules/mattstack is foreign and left alone", () => {
    const configDir = join(home, ".claude");
    mkdirSync(join(configDir, "rules"), { recursive: true });
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(configDir, "rules", "mattstack"));

    expect(linkConfigDir(p, configDir, claudeRulesDir(home))).toBe("foreign");
    expect(readlinkSync(join(configDir, "rules", "mattstack"))).toBe(elsewhere);
  });
});

describe("distinctConfigDirs", () => {
  test("keeps the first of dirs sharing a plugins folder", () => {
    const a = join(home, "a");
    const b = join(home, "b");
    mkdirSync(join(a, "plugins"), { recursive: true });
    mkdirSync(b);
    symlinkSync(join(a, "plugins"), join(b, "plugins"));
    expect(distinctConfigDirs([a, b, join(home, "c")])).toEqual([a, join(home, "c")]);
  });
});
