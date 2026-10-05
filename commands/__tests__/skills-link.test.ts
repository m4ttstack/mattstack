import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { linkBlocks, resolveSkillsDir, skillsLink } from "../skills-link.ts";
import { captureSkills, runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rt-skills-link-cmd-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveSkillsDir", () => {
  test("a repo checkout resolves to <repoRoot>/skills", () => {
    const skills = join(root, "repo", "skills");
    mkdirSync(skills, { recursive: true });
    expect(resolveSkillsDir({ repoRoot: () => join(root, "repo") })).toEqual({ dir: skills });
  });

  test("--from wins over the repo, so a bundled dir needs no checkout", () => {
    const bundled = join(root, "Helpers", "skills", "gitq");
    mkdirSync(bundled, { recursive: true });
    const repoSkills = join(root, "repo", "skills");
    mkdirSync(repoSkills, { recursive: true });
    expect(resolveSkillsDir({ from: bundled, repoRoot: () => join(root, "repo") })).toEqual({ dir: bundled });
  });

  test("--from is honored outside any git repo", () => {
    const bundled = join(root, "Helpers", "skills", "deck");
    mkdirSync(bundled, { recursive: true });
    expect(resolveSkillsDir({ from: bundled, repoRoot: () => null })).toEqual({ dir: bundled });
  });

  test("--from is resolved to an absolute path", () => {
    const bundled = join(root, "rel");
    mkdirSync(bundled, { recursive: true });
    const got = resolveSkillsDir({ from: bundled + "/.", repoRoot: () => null });
    expect(got).toEqual({ dir: bundled });
  });

  test("a missing --from dir is an error naming the dir", () => {
    const missing = join(root, "nope");
    const got = resolveSkillsDir({ from: missing, repoRoot: () => null });
    expect(got).toEqual({ error: `${missing} does not exist` });
  });

  test("a --from that is a file, not a directory, is an error", () => {
    const file = join(root, "SKILL.md");
    writeFileSync(file, "x");
    expect(resolveSkillsDir({ from: file, repoRoot: () => null })).toEqual({ error: `${file} is not a directory` });
  });

  test("outside a git repo with no --from, the error names --from as the way out", () => {
    const got = resolveSkillsDir({ repoRoot: () => null });
    expect(got).toEqual({ error: "You are not inside a git repo", next: "rt skills link --from <folder>" });
  });

  test("a repo with no skills/ dir is an error", () => {
    mkdirSync(join(root, "repo"), { recursive: true });
    const got = resolveSkillsDir({ repoRoot: () => join(root, "repo") });
    expect(got).toEqual({ error: `This repo has no skills folder (${join(root, "repo", "skills")})` });
  });
});

describe("linkBlocks", () => {
  const action = { link: "/h/.claude/skills/x", target: "/r/skills/x" };

  test("one line per skill, in plain words, under where the links go", () => {
    const result = {
      changed: true,
      actions: [
        { ...action, kind: "create" as const, name: "alpha", detail: null },
        { ...action, kind: "ok" as const, name: "beta", detail: null },
        { ...action, kind: "prune" as const, name: "gamma", target: null, detail: "the skill it pointed at is gone: /r/skills/gamma" },
        { ...action, kind: "conflict" as const, name: "delta", detail: "a file or folder already has this name, and rt did not make it" },
        { ...action, kind: "skip" as const, name: "epsilon", detail: "its SKILL.md header has no name" },
      ],
    };
    expect(renderPlain(linkBlocks("/r/skills", "/h/.claude/skills", result, false))).toBe(
      [
        "Skill links",
        "From: /r/skills",
        "To: /h/.claude/skills",
        "[ok] alpha  linked",
        "[ok] beta  already linked",
        "[off] gamma  link removed: the skill it pointed at is gone: /r/skills/gamma",
        "[needs you] delta  left alone: a file or folder already has this name, and rt did not make it",
        "[skipped] epsilon  not linked: its SKILL.md header has no name",
        "  note: rt left those alone. Move or rename them by hand, then run this again.",
        "",
      ].join("\n"),
    );
  });

  test("a dry run says would, and nothing to do ends with one summary", () => {
    expect(renderPlain(linkBlocks("/r/skills", "/h/.claude/skills", { changed: true, actions: [{ ...action, kind: "create", name: "alpha", detail: null }] }, true))).toBe(
      "Skill links (dry run)\nFrom: /r/skills\nTo: /h/.claude/skills\n[not yet] alpha  would link\n",
    );
    expect(renderPlain(linkBlocks("/r/skills", "/h/.claude/skills", { changed: false, actions: [{ ...action, kind: "ok", name: "alpha", detail: null }] }, false))).toBe(
      "Skill links\nFrom: /r/skills\nTo: /h/.claude/skills\n[ok] alpha  already linked\n\n[ok] Everything is already linked\n",
    );
  });
});

describe("rt skills link", () => {
  let io: CapturedOut;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
    process.env.HOME = root;
    io = captureSkills();
  });

  afterEach(() => {
    io.restore();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });

  test("--from with no value asks which folder to link", async () => {
    const r = await runExpectingCleanExit(() => skillsLink(["--from"]));
    expect(r.exitCode).toBe(1);
    expect(r.errors).toEqual(["Which folder should the links come from?", "  next: rt skills link --from <folder>"]);
    expect(io.stdout()).toBe("");
  });

  test.each(["--dry-run", "--json"])("--from rejects %s as a missing folder without creating links", async (option) => {
    const source = join(root, option, "alpha");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: alpha\ndescription: alpha\n---\n");
    const previousCwd = process.cwd();
    process.chdir(root);
    try {
      const r = await runExpectingCleanExit(() => skillsLink(["--from", option]));
      expect(r.exitCode).toBe(1);
      expect(r.errors).toEqual(["Which folder should the links come from?", "  next: rt skills link --from <folder>"]);
      expect(io.stdout()).toBe("");
      expect(readdirSync(root)).toEqual([option]);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("an unknown option is a hint under a plain title", async () => {
    const r = await runExpectingCleanExit(() => skillsLink(["--unknown"]));
    expect(r.exitCode).toBe(1);
    expect(r.errors).toEqual(["rt skills link does not take that option  --unknown"]);
    expect(io.stdout()).toBe("");
  });

  test("the JSON conflict detail explains why rt leaves the directory alone", async () => {
    const source = join(root, "skills");
    const target = join(source, "alpha");
    const claudeSkillsDir = join(root, ".claude", "skills");
    mkdirSync(target, { recursive: true });
    mkdirSync(join(claudeSkillsDir, "alpha"), { recursive: true });
    writeFileSync(join(target, "SKILL.md"), "---\nname: alpha\ndescription: alpha\n---\n");
    await skillsLink(["--from", source, "--json"]);
    expect(JSON.parse(io.stdout())).toEqual({
      contract: 1,
      at: expect.any(String),
      ok: true,
      dryRun: false,
      skillsDir: source,
      claudeSkillsDir,
      changed: false,
      actions: [{
        kind: "conflict",
        name: "alpha",
        link: join(claudeSkillsDir, "alpha"),
        target: realpathSync(target),
        detail: "a file or folder already has this name, and rt did not make it",
      }],
    });
    expect(io.stderr()).toBe("");
  });
});
