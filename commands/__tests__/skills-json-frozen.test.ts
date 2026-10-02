import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";
import { checkPack, skillsCheck, skillsCompile, skillsComposition, skillsPacks, skillsSurface } from "../skills.ts";
import { skillsLink } from "../skills-link.ts";

let io: CapturedOut;
let root: string;
const origHome = process.env.HOME;

function makePack(): string {
  const dir = join(root, "acme");
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "1.0.0" }));
  mkdirSync(join(dir, "skills", "x"), { recursive: true });
  writeFileSync(join(dir, "skills", "x", "SKILL.md"), "---\nname: x\n---\nNo commands here.\n");
  return dir;
}

/** stdout is exactly one line, and that line is compact JSON. */
function oneJsonLine(): { line: string; value: Record<string, unknown> } {
  const text = io.stdout();
  expect(text.endsWith("\n")).toBe(true);
  const line = text.slice(0, -1);
  expect(line).not.toContain("\n");
  const value = JSON.parse(line) as Record<string, unknown>;
  expect(JSON.stringify(value)).toBe(line);
  return { line, value };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-frozen-")));
  process.env.HOME = join(root, "home");
  mkdirSync(process.env.HOME, { recursive: true });
  io = captureSkills();
});

afterEach(() => {
  io.restore();
  process.env.HOME = origHome;
  process.exitCode = 0;
  rmSync(root, { recursive: true, force: true });
});

test("skills check --json is the check payload minus drift, in this key order", async () => {
  const dir = makePack();
  const { pack, packDir, verbs, chainErrors, installed, mcpLint, scriptLint, strictLint } = await checkPack({ packDir: dir });
  io.clear();
  await skillsCheck(["--pack-dir", dir, "--json"]);
  expect(io.stdout()).toBe(JSON.stringify({ pack, packDir, verbs, chainErrors, installed, mcpLint, scriptLint, strictLint }) + "\n");
});

test("skills compile --json is one line with these keys", async () => {
  await skillsCompile(["--pack-dir", makePack(), "--dry-run", "--json"]);
  expect(Object.keys(oneJsonLine().value)).toEqual(["pack", "packDir", "manifestPath", "repoKey", "written", "verbs", "misplaced"]);
});

test("skills composition --json is one line with these keys", async () => {
  await skillsComposition(["--pack-dir", makePack(), "--json"]);
  expect(Object.keys(oneJsonLine().value)).toEqual(["pack", "packDir", "manifestPath", "verbs", "fills", "binders", "pipelines"]);
});

test("skills surface list --json is one line with these keys", async () => {
  await skillsSurface(["list", "--pack-dir", makePack(), "--json"]);
  expect(Object.keys(oneJsonLine().value)).toEqual(["pack", "packDir", "rows"]);
});

test("skills surface --json with no mode is the one error envelope", async () => {
  await skillsSurface(["--json", "--pack-dir", makePack()]);
  expect(io.stdout()).toBe('{"ok":false,"error":"rt skills surface --json needs a mode: list, set <name...> --public|--internal, or apply"}\n');
  expect(process.exitCode).toBe(1);
});

test("skills packs --json with no marketplaces is an empty list", async () => {
  const settings = join(root, "settings.json");
  writeFileSync(settings, "{}");
  await skillsPacks(["--json", "--settings-path", settings]);
  expect(io.stdout()).toBe('{"packs":[]}\n');
});

test("skills link --json is one contract envelope with these keys", async () => {
  const from = join(root, "bundle");
  mkdirSync(join(from, "alpha"), { recursive: true });
  writeFileSync(join(from, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: a\n---\nbody\n");
  await skillsLink(["--from", from, "--dry-run", "--json"]);
  const { value } = oneJsonLine();
  expect(Object.keys(value)).toEqual(["contract", "at", "ok", "dryRun", "skillsDir", "claudeSkillsDir", "changed", "actions"]);
  expect(value.contract).toBe(1);
});
