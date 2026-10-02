import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { captureSkills, runExpectingCleanExit } from "../../lib/skills/__tests__/helpers.ts";
import { SkillsUsageError, skillsCheck, skillsCompile, skillsFailure } from "../skills.ts";

let io: CapturedOut;
let root: string;
const cwd = process.cwd();

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-failures-")));
  io = captureSkills();
});

afterEach(() => {
  process.chdir(cwd);
  io.restore();
  process.exitCode = 0;
  rmSync(root, { recursive: true, force: true });
});

test("a message with no shown copy is the title, unprefixed", () => {
  expect(skillsFailure(new SkillsUsageError('unrecognized argument "--bogus"'))).toEqual({ title: 'unrecognized argument "--bogus"' });
});

test("a multi-line message keeps every line", () => {
  expect(skillsFailure(new SkillsUsageError("first chain error\nsecond chain error\nthird"))).toEqual({ title: "first chain error", details: "second chain error\nthird" });
});

test("shown copy wins, and the message stays what it was", () => {
  const err = new SkillsUsageError("--preview needs a single --verb", { title: "Which verb should be previewed?" });
  expect(skillsFailure(err)).toEqual({ title: "Which verb should be previewed?" });
  expect(err.message).toBe("--preview needs a single --verb");
});

test("a usage error prints one failure on stderr, exits 1 and writes nothing to stdout", async () => {
  const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(["--bogus-flag"]));
  expect(exitCode).toBe(1);
  expect(errors).toEqual(['unrecognized argument "--bogus-flag"']);
  expect(io.stdout()).toBe("");
});

test("--preview without one verb asks which", async () => {
  const { exitCode, errors } = await runExpectingCleanExit(() => skillsCompile(["--preview"]));
  expect(exitCode).toBe(1);
  expect(errors).toEqual(["Which verb should be previewed?", "  next: rt skills compile --preview --verb <name>"]);
});

test("no packs found names both ways to say which pack", async () => {
  process.chdir(root);
  const { exitCode, errors } = await runExpectingCleanExit(() => skillsCheck(["--mattstack-dir", root]));
  expect(exitCode).toBe(1);
  expect(errors).toEqual([
    "No packs found",
    "  why: A pack is a plugin from a directory marketplace that has a surface file.",
    "  next: Run it again with --pack <name> or --pack-dir <folder>",
  ]);
});

test("a pack folder that is not there says so, with the folder under it", async () => {
  const missing = join(root, "nope");
  const { exitCode, errors } = await runExpectingCleanExit(() => skillsCheck(["--pack-dir", missing]));
  expect(exitCode).toBe(1);
  expect(errors).toEqual(["That pack folder does not exist", `  ${missing}`]);
});

test("the enclosing-pack note goes to stderr and stdout stays one JSON line", async () => {
  const pack = join(root, "acme");
  mkdirSync(join(pack, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pack, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "1.0.0" }));
  mkdirSync(join(pack, "pack"), { recursive: true });
  writeFileSync(join(pack, "pack", "surface.jsonc"), '{ "public": [] }');
  mkdirSync(join(pack, "skills", "x"), { recursive: true });
  writeFileSync(join(pack, "skills", "x", "SKILL.md"), "---\nname: x\n---\nNo commands here.\n");
  process.chdir(pack);

  await skillsCheck(["--json"]);

  expect(io.errLines()).toEqual([`  note: Using the pack this folder is inside: ${pack}`]);
  const text = io.stdout();
  expect(text.endsWith("\n")).toBe(true);
  expect(text.slice(0, -1)).not.toContain("\n");
  expect(JSON.parse(text).pack).toBe("acme");
});
