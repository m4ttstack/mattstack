import { describe, expect, test } from "bun:test";
import { bindingChanges, inScope, parsePorcelain, relativeToPrefix, surfaceChanges } from "../changes.ts";

describe("parsePorcelain", () => {
  test("reads status and path, including renames and untracked", () => {
    expect(parsePorcelain(" M pack/skills.jsonc\n?? attachments/stage-plan/new.md\nR  a.md -> b.md\n")).toEqual([
      { path: "pack/skills.jsonc", status: "M" },
      { path: "attachments/stage-plan/new.md", status: "??" },
      { path: "b.md", status: "R" },
    ]);
  });

  test("unquotes a path git wrapped in quotes", () => {
    expect(parsePorcelain('?? "attachments/my skill/SKILL.md"\nR  "a b.md" -> "c d.md"\n')).toEqual([
      { path: "attachments/my skill/SKILL.md", status: "??" },
      { path: "c d.md", status: "R" },
    ]);
  });
});

describe("relativeToPrefix", () => {
  const files = [{ path: "packs/acme/pack/skills.jsonc", status: "M" }, { path: "packs/other/x.md", status: "M" }];

  test("strips the pack prefix and drops paths outside it", () => {
    expect(relativeToPrefix(files, "packs/acme/")).toEqual([{ path: "pack/skills.jsonc", status: "M" }]);
  });

  test("an empty prefix leaves the paths alone", () => {
    expect(relativeToPrefix(files, "")).toEqual(files);
  });
});

describe("inScope", () => {
  test("pack files are in scope, a README is not", () => {
    expect(inScope("pack/skills.jsonc")).toBe(true);
    expect(inScope("attachments/stage-plan/SKILL.md")).toBe(true);
    expect(inScope("surface.jsonc")).toBe(true);
    expect(inScope("README.md")).toBe(false);
  });

  test("a sibling that merely shares a prefix is not in scope", () => {
    expect(inScope("packaging/notes.md")).toBe(false);
    expect(inScope("skills-old/SKILL.md")).toBe(false);
  });
});

describe("bindingChanges", () => {
  test("lists rebinds, new bindings and removed bindings", () => {
    const before = { bindings: { "mattstack:stage-plan": { domain: "acme:plan-policy" }, "mattstack:review": { criteria: "acme:review-criteria" } } };
    const after = { bindings: { "mattstack:stage-plan": { domain: "acme:plan-policy-strict" }, "mattstack:ship": { domain: "acme:ship-domain" } } };
    expect(bindingChanges(before, after)).toEqual([
      { engineRef: "mattstack:review", slot: "criteria", from: "acme:review-criteria", to: null },
      { engineRef: "mattstack:ship", slot: "domain", from: null, to: "acme:ship-domain" },
      { engineRef: "mattstack:stage-plan", slot: "domain", from: "acme:plan-policy", to: "acme:plan-policy-strict" },
    ]);
  });

  test("a missing or malformed file reads as no bindings", () => {
    expect(bindingChanges(null, { bindings: {} })).toEqual([]);
  });
});

describe("surfaceChanges", () => {
  test("public list additions and removals become flips", () => {
    expect(surfaceChanges({ public: ["work", "review"] }, { public: ["work", "ship"] })).toEqual([
      { skill: "review", from: "public", to: "internal" },
      { skill: "ship", from: "internal", to: "public" },
    ]);
  });
});
