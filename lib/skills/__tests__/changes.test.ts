import { describe, expect, test } from "bun:test";
import { bindingChanges, describeGitFailure, inScope, isNotARepo, parsePorcelain, relativeToPrefix, surfaceChanges } from "../changes.ts";

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

describe("parsePorcelain quoting", () => {
  test("decodes octal byte escapes as UTF-8", () => {
    expect(parsePorcelain('?? "caf\\303\\251.md"\n')).toEqual([{ path: "café.md", status: "??" }]);
  });

  test("decodes git's named escapes", () => {
    expect(parsePorcelain('?? "a\\tb\\nc\\rd\\ae\\bf\\fg\\vh\\"i\\\\j.md"\n')).toEqual([
      { path: 'a\tb\nc\rd\x07e\x08f\x0cg\x0bh"i\\j.md', status: "??" },
    ]);
  });

  test("keeps a name outside the basic plane whole", () => {
    expect(parsePorcelain('?? "attachments/\u{1F600} notes.md"\n')).toEqual([{ path: "attachments/\u{1F600} notes.md", status: "??" }]);
  });
});

describe("parsePorcelain arrows", () => {
  test("an untracked name containing an arrow is one path", () => {
    expect(parsePorcelain('?? "a -> b.md"\n?? c -> d.md\n')).toEqual([
      { path: "a -> b.md", status: "??" },
      { path: "c -> d.md", status: "??" },
    ]);
  });

  test("a copy splits on the arrow like a rename", () => {
    expect(parsePorcelain("C  a.md -> b.md\n")).toEqual([{ path: "b.md", status: "C" }]);
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

describe("bindingChanges malformed shapes", () => {
  test("keeps only string slot values under object engine entries", () => {
    const before = { bindings: { "mattstack:a": ["acme:x"], "mattstack:b": { domain: 3, forge: "acme:forge" }, "mattstack:c": "acme:y" } };
    expect(bindingChanges(before, { bindings: {} })).toEqual([
      { engineRef: "mattstack:b", slot: "forge", from: "acme:forge", to: null },
    ]);
  });

  test("a bindings value that is an array reads as no bindings", () => {
    expect(bindingChanges({ bindings: ["acme:x"] }, { bindings: {} })).toEqual([]);
  });
});

describe("git failures", () => {
  test("only git's own wording marks a missing repository", () => {
    expect(isNotARepo({ exitCode: 128, stderr: "fatal: not a git repository (or any of the parent directories): .git\n" })).toBe(true);
    expect(isNotARepo({ exitCode: 128, stderr: "fatal: bad config line 1 in file .git/config\n" })).toBe(false);
  });

  test("a child that never started or never answered is named as such", () => {
    expect(describeGitFailure({ exitCode: -1, stderr: "" })).toBe("git could not run");
    expect(describeGitFailure({ exitCode: -1, stderr: "", timedOut: true })).toBe("git did not answer in time");
    expect(describeGitFailure({ exitCode: 128, stderr: "fatal: bad config line 1\n" })).toBe("fatal: bad config line 1");
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
