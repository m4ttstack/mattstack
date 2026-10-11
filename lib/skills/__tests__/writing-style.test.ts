import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDef } from "../../settings/registry.ts";
import type { Resolved } from "../../settings/resolve.ts";
import { FALLBACK_WRITING_STYLE, isPresetId, isValidSkillId, resolveWritingStyle } from "../writing-style.ts";

const unset = (): Resolved<unknown> => ({ value: undefined, provenance: [] });
const onDefault = (): Resolved<unknown> => ({ value: FALLBACK_WRITING_STYLE, provenance: [{ scope: "default", file: null }] });
const at = (value: unknown, scope: "user" | "team" | "org"): Resolved<unknown> => ({ value, provenance: [{ scope, file: `/x/${scope}.jsonc` }] });

describe("isValidSkillId", () => {
  test("accepts plugin:name and bare names; refuses flags and paths", () => {
    for (const ok of ["mattstack:writing-style-sparse", "acme:team-writing-style", "team-voice", "a.b_c"]) expect(isValidSkillId(ok)).toBe(true);
    for (const bad of ["-rf", "../x", "a/b", "", "Upper", "a:b:c", " x"]) expect(isValidSkillId(bad)).toBe(false);
  });
});

describe("resolveWritingStyle", () => {
  test("a user value is yours", () => {
    expect(resolveWritingStyle({ read: () => at("mattstack:writing-style-sparse", "user") })).toEqual({ skill: "mattstack:writing-style-sparse", source: "user" });
  });
  test("a team or org value reads as the team default", () => {
    expect(resolveWritingStyle({ read: () => at("mattstack:writing-style-structured", "team") }).source).toBe("team");
    expect(resolveWritingStyle({ read: () => at("mattstack:writing-style-conversational", "org") }).source).toBe("team");
  });
  test("the registry default, or nothing at all, reads as not chosen", () => {
    expect(resolveWritingStyle({ read: onDefault })).toEqual({ skill: FALLBACK_WRITING_STYLE, source: "fallback" });
    expect(resolveWritingStyle({ read: unset })).toEqual({ skill: FALLBACK_WRITING_STYLE, source: "fallback" });
  });
  test("choosing conversational on purpose reads as chosen", () => {
    expect(resolveWritingStyle({ read: () => at(FALLBACK_WRITING_STYLE, "user") })).toEqual({ skill: FALLBACK_WRITING_STYLE, source: "user" });
  });
  test("an invalid stored value is skipped, not returned", () => {
    expect(resolveWritingStyle({ read: () => at("-rf", "user") }).source).toBe("fallback");
  });
  test("the fallback is the registry default and a preset", () => {
    expect(FALLBACK_WRITING_STYLE).toBe(getDef("skills.writingStyle")!.default as string);
    expect(isPresetId(FALLBACK_WRITING_STYLE)).toBe(true);
  });
});

describe("preferences.md", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-writing-style-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("its writing-style line is no longer read", () => {
    const dir = join(home, ".mattstack", "user", "skills");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "preferences.md"), "## Writing style\nwriting-style: `mattstack:writing-style-sparse`\n");
    expect(resolveWritingStyle()).toEqual({ skill: FALLBACK_WRITING_STYLE, source: "fallback" });
  });
});
