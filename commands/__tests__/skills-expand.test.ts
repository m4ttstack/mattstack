import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { skillsExpand } from "../skills-expand.ts";
import { captureSkills, runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

let root: string;
let io: CapturedOut;

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rt-expand-cli-"));
  write(join(root, "plugins", "mattstack", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "1.2.3" }));
  write(join(root, "plugins", "mattstack", "attachments", "note", "SKILL.md"), "---\nname: note\ndescription: n\n---\n\nShared.\n");
  write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\n{{include:note}}\n");
  io = captureSkills();
});

afterEach(() => {
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

const base = () => ["--src", join(root, "src"), "--out", join(root, "out"), "--mattstack-dir", root];

describe("rt skills expand", () => {
  test("writes the output and reports each skill", async () => {
    await skillsExpand(base());
    expect(readFileSync(join(root, "out", "a", "SKILL.md"), "utf8")).toContain("Shared.");
    expect(io.lines().join("\n")).toContain("+ a");
  });

  test("--check is clean after expand and exits 1 naming the drift after an edit", async () => {
    await skillsExpand(base());
    const clean = await runExpectingCleanExit(() => skillsExpand([...base(), "--check"]));
    expect(clean.exitCode).toBeUndefined();
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nNew line.\n\n{{include:note}}\n");
    const drifted = await runExpectingCleanExit(() => skillsExpand([...base(), "--check"]));
    expect(drifted.exitCode).toBe(1);
    expect(drifted.errors.join("\n")).toContain("a: source");
  });

  test("--check --json prints the drift envelope", async () => {
    await skillsExpand(base());
    rmSync(join(root, "out", "a"), { recursive: true });
    await runExpectingCleanExit(() => skillsExpand([...base(), "--check", "--json"]));
    const parsed = JSON.parse(io.lines().at(-1)!);
    expect(parsed).toMatchObject({ ok: false, mode: "check", drift: [{ skill: "a", causes: ["missing"] }] });
  });

  test("--dry-run writes nothing", async () => {
    await skillsExpand([...base(), "--dry-run"]);
    expect(existsSync(join(root, "out"))).toBe(false);
    expect(io.lines().join("\n")).toContain("+ a");
  });

  test("a hand-written dir in --out fails the write and the dry run, naming it, and survives", async () => {
    const mine = join(root, "out", "mine", "SKILL.md");
    write(mine, "---\nname: app:mine\ndescription: m\n---\n\nHand-written.\n");
    for (const extra of [[], ["--dry-run"]]) {
      const r = await runExpectingCleanExit(() => skillsExpand([...base(), ...extra]));
      expect(r.exitCode).toBe(1);
      expect(r.errors.join("\n")).toContain(`${join(root, "out", "mine")} is not expand output`);
    }
    expect(readFileSync(mine, "utf8")).toContain("Hand-written.");
    expect(existsSync(join(root, "out", "a"))).toBe(false);
  });

  test("--check names a vendored drift by path", async () => {
    await skillsExpand(base());
    write(join(root, "out", "a", "scripts", "old.sh"), "echo old\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--check"]));
    expect(r.exitCode).toBe(1);
    expect(r.errors.join("\n")).toContain("a: vendored (scripts/old.sh)");
  });

  test("--check reports drift as one failure that names the fix", async () => {
    await skillsExpand(base());
    io.clear();
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nNew line.\n\n{{include:note}}\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--check"]));
    expect(r.exitCode).toBe(1);
    expect(r.errors[0]).toBe("The expanded skills are out of date");
    expect(r.errors[1]).toBe(`  next: rt skills expand --src ${join(root, "src")} --out ${join(root, "out")} --mattstack-dir ${root}`);
    expect(io.stdout()).toBe("");
  });

  test("a missing --src asks for it", async () => {
    const r = await runExpectingCleanExit(() => skillsExpand(["--out", join(root, "out")]));
    expect(r.exitCode).toBe(1);
    expect(r.errors).toEqual(["Which folder holds the skills to expand?", "  next: rt skills expand --src <dir> --out <dir>"]);
  });

  test("a missing --out is a usage error", async () => {
    const r = await runExpectingCleanExit(() => skillsExpand(["--src", join(root, "src")]));
    expect(r.exitCode).toBe(1);
    expect(r.errors.join("\n")).toContain("--out");
  });

  test("--mattstack-dir with no value is a usage error", async () => {
    const r = await runExpectingCleanExit(() => skillsExpand(["--src", join(root, "src"), "--out", join(root, "out"), "--mattstack-dir"]));
    expect(r.exitCode).toBe(1);
    expect(r.errors).toEqual(["Which mattstack folder?", "  next: rt skills expand --mattstack-dir <dir>"]);
  });

  test.each([
    ["--src", undefined, "Which folder holds the skills to expand?"],
    ["--src", "--check", "Which folder holds the skills to expand?"],
    ["--out", undefined, "Which folder should the expanded skills go in?"],
    ["--out", "--check", "Which folder should the expanded skills go in?"],
  ])("%s with next argument %s asks for its folder", async (flag, next, title) => {
    const args = next === undefined ? [flag] : [flag, next];
    const r = await runExpectingCleanExit(() => skillsExpand(args));
    expect(r.exitCode).toBe(1);
    expect(r.errors).toEqual([title, "  next: rt skills expand --src <dir> --out <dir>"]);
    expect(io.stdout()).toBe("");
  });

  test("an unknown option is a hint under a plain title", async () => {
    const r = await runExpectingCleanExit(() => skillsExpand(["--unknown"]));
    expect(r.exitCode).toBe(1);
    expect(r.errors).toEqual(["rt skills expand does not take that option  --unknown"]);
    expect(io.stdout()).toBe("");
  });

  test("--strict fails on a shell form in the expanded output, dry run included", async () => {
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nPost with `glab mr note 3 -m hi`.\n\n{{include:note}}\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--strict", "--dry-run", "--json"]));
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(io.lines().at(-1)!);
    expect(parsed.ok).toBe(false);
    expect(parsed.lint).toHaveLength(1);
    expect(parsed.lint[0]).toContain(join(root, "out", "a", "SKILL.md"));
    expect(parsed.lint[0]).toContain("glab mr note");
  });

  test("--strict fails on a shell form in a vendored markdown file", async () => {
    write(join(root, "src", "a", "stage.md"), "# Stage\n\nPost with `glab mr note 3 -m hi`.\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--strict", "--json"]));
    expect(r.exitCode).toBe(1);
    const parsed = JSON.parse(io.lines().at(-1)!);
    expect(parsed.ok).toBe(false);
    expect(parsed.lint).toHaveLength(1);
    expect(parsed.lint[0]).toContain(`${join(root, "out", "a", "stage.md")}:3`);
  });

  test("--strict honours the allow marker", async () => {
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nPost with `glab mr note 3 -m hi`. <!-- mcp-lint: allow -->\n\n{{include:note}}\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--strict", "--json"]));
    expect(r.exitCode).toBeUndefined();
    expect(JSON.parse(io.lines().at(-1)!)).toMatchObject({ ok: true, lint: [] });
  });

  test("--strict reports script hits as advisory without failing", async () => {
    write(join(root, "src", "a", "scripts", "post.sh"), "glab mr note 3 -m hi\n");
    await skillsExpand(base());
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--check", "--strict", "--json"]));
    expect(r.exitCode).toBeUndefined();
    expect(r.errors.join("\n")).toContain(`advisory:\n  ${join(root, "out", "a", "scripts", "post.sh")}:1`);
    expect(JSON.parse(io.lines().at(-1)!).lint).toEqual([]);
  });

  test("an expand error exits 1 with the file named", async () => {
    write(join(root, "src", "b", "SKILL.md"), "---\nname: app:b\ndescription: b\n---\n\n{{include:nope}}\n");
    const r = await runExpectingCleanExit(() => skillsExpand(base()));
    expect(r.exitCode).toBe(1);
    expect(r.errors.join("\n")).toContain('include "nope"');
  });
});

describe("expanded skill diagnostics lists", () => {
  test.each([1, 2])("check prints %i drift entries after the remedy under diagnostics", async (count) => {
    if (count === 2) write(join(root, "src", "b", "SKILL.md"), "---\nname: app:b\ndescription: b\n---\n\nShared.\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--check"]));
    expect(r.exitCode).toBe(1);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe(
      "The expanded skills are out of date\n" +
      `  next: rt skills expand --src ${join(root, "src")} --out ${join(root, "out")} --mattstack-dir ${root}\n` +
      "diagnostics:\n  a: missing\n" + (count === 2 ? "  b: missing\n" : ""),
    );
  });

  test.each([
    ["check", 1], ["check", 2], ["expand", 1], ["expand", 2],
  ] as const)("strict %s prints %i lint entries as a list", async (mode, count) => {
    write(join(root, "src", "a", "SKILL.md"),
      "---\nname: app:a\ndescription: a\n---\n\nPost with `glab mr note 3 -m hi`.\n" +
      (count === 2 ? "Post with `glab mr note 4 -m bye`.\n" : ""),
    );
    if (mode === "check") await skillsExpand(base());
    io.clear();
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--strict", ...(mode === "check" ? ["--check"] : [])]));
    expect(r.exitCode).toBe(1);
    const title = mode === "check" ? `The expanded skills have ${count} lint ${count === 1 ? "hit" : "hits"}` : `${count} lint ${count === 1 ? "hit" : "hits"} in the expanded skills`;
    expect(io.stderr()).toBe(
      `${title}\n${mode === "check" ? "diagnostics" : "lint"}:\n` +
      `  ${join(root, "out", "a", "SKILL.md")}:9: \`glab mr note 3 -m hi\` shells out for glab mr note; use the mr_comment tool\n` +
      (count === 2 ? `  ${join(root, "out", "a", "SKILL.md")}:10: \`glab mr note 4 -m bye\` shells out for glab mr note; use the mr_comment tool\n` : ""),
    );
    expect(io.stdout()).toBe(mode === "check" ? "" : "+ a\n");
  });

  test("strict check puts drift then lint in one diagnostics list after the remedy and keeps its JSON envelope", async () => {
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nPost with `glab mr note 3 -m hi`.\n");
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--strict", "--check"]));
    expect(r.exitCode).toBe(1);
    expect(io.stderr()).toBe(
      "The expanded skills are out of date\n" +
      `  next: rt skills expand --src ${join(root, "src")} --out ${join(root, "out")} --mattstack-dir ${root}\n` +
      "diagnostics:\n  a: missing\n" +
      `  ${join(root, "out", "a", "SKILL.md")}:9: \`glab mr note 3 -m hi\` shells out for glab mr note; use the mr_comment tool\n`,
    );
    io.clear();
    const json = await runExpectingCleanExit(() => skillsExpand([...base(), "--strict", "--check", "--json"]));
    expect(json.exitCode).toBe(1);
    expect(io.stdout()).toBe(JSON.stringify({
      ok: false, mode: "check", skills: ["a"], removed: [], drift: [{ skill: "a", causes: ["missing"] }],
      lint: [`${join(root, "out", "a", "SKILL.md")}:9: \`glab mr note 3 -m hi\` shells out for glab mr note; use the mr_comment tool`],
    }) + "\n");
  });

  test.each(["check", "expand"])("strict %s preserves the exact JSON envelope", async (mode) => {
    write(join(root, "src", "a", "SKILL.md"), "---\nname: app:a\ndescription: a\n---\n\nPost with `glab mr note 3 -m hi`.\n");
    if (mode === "check") await skillsExpand(base());
    io.clear();
    const r = await runExpectingCleanExit(() => skillsExpand([...base(), "--strict", "--json", ...(mode === "check" ? ["--check"] : [])]));
    expect(r.exitCode).toBe(1);
    expect(io.stdout()).toBe(JSON.stringify({
      ok: false, mode, skills: ["a"], removed: [], drift: [],
      lint: [`${join(root, "out", "a", "SKILL.md")}:9: \`glab mr note 3 -m hi\` shells out for glab mr note; use the mr_comment tool`],
    }) + "\n");
  });

  test("clean check and expand do not print empty diagnostics or lint captions", async () => {
    await skillsExpand([...base(), "--strict"]);
    expect(io.stdout()).toBe("+ a\n");
    expect(io.stderr()).toBe("");
    io.clear();
    await skillsExpand([...base(), "--strict", "--check"]);
    expect(io.stdout()).toBe("[ok] The expanded skills are current  1 skill\n");
    expect(io.stderr()).toBe("");
  });
});
