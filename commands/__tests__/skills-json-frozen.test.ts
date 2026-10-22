import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";
import { checkPack, skillsCheck, skillsCompile, skillsComposition, skillsPacks, skillsSurface } from "../skills.ts";
import { skillsLink } from "../skills-link.ts";
import { ORG_LAYOUT } from "../../lib/team/org-marker.ts";

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

/** A rosterless widgets team pack in an acme org whose base copies one attachment asking for a section the team has not written. */
function makeTeamPackMissingASection(): string {
  const org = join(root, "orgs", "acme");
  mkdirSync(join(org, ".git"), { recursive: true });
  mkdirSync(join(org, "mattstack"), { recursive: true });
  writeFileSync(join(org, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "org", org: "acme", layout: ORG_LAYOUT }));
  const base = join(org, "mattstack", "org", "packs", "acme-base");
  mkdirSync(join(base, "pack"), { recursive: true });
  writeFileSync(join(base, "pack", "skills.jsonc"), JSON.stringify({ base: true }));
  mkdirSync(join(base, "attachments", "ci-notes"), { recursive: true });
  writeFileSync(join(base, "attachments", "ci-notes", "SKILL.md"), "---\nname: ci-notes\ndescription: CI notes\n---\nExtra jobs:\n{{team.section:ci-extra}}\n");
  const pack = join(org, "mattstack", "teams", "widgets", "plugin");
  mkdirSync(join(pack, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pack, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "widgets", version: "0.1.0" }));
  mkdirSync(join(pack, "pack"), { recursive: true });
  writeFileSync(join(pack, "pack", "skills.jsonc"), JSON.stringify({ extends: "acme-base" }));
  return pack;
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

test("skills check --json is the check payload minus drift, in this key order, ending with attachments, baseErrors, compileErrors and fieldContract", async () => {
  const dir = makePack();
  const { pack, packDir, verbs, chainErrors, installed, mcpLint, scriptLint, strictLint, attachments, baseErrors, compileErrors, fieldContract } = await checkPack({ packDir: dir });
  expect(baseErrors).toEqual([]);
  expect(compileErrors).toEqual([]);
  io.clear();
  await skillsCheck(["--pack-dir", dir, "--json"]);
  expect(io.stdout()).toBe(JSON.stringify({ pack, packDir, verbs, chainErrors, installed, mcpLint, scriptLint, strictLint, attachments, baseErrors, compileErrors, fieldContract }) + "\n");
  expect(Object.keys(oneJsonLine().value).slice(-4)).toEqual(["attachments", "baseErrors", "compileErrors", "fieldContract"]);
  expect(io.stdout()).toContain('"baseErrors":[],"compileErrors":[],"fieldContract":[]');
});

test("skills compile --json is one line with these keys", async () => {
  await skillsCompile(["--pack-dir", makePack(), "--dry-run", "--json"]);
  expect(Object.keys(oneJsonLine().value)).toEqual(["pack", "packDir", "manifestPath", "repoKey", "written", "verbs", "misplaced", "fieldContract"]);
});

test("skills compile --json with missing team values adds missing after fieldContract and exits 1", async () => {
  await skillsCompile(["--pack-dir", makeTeamPackMissingASection(), "--dry-run", "--json"]);
  const { value } = oneJsonLine();
  expect(Object.keys(value)).toEqual(["pack", "packDir", "manifestPath", "repoKey", "written", "verbs", "misplaced", "fieldContract", "missing"]);
  expect(value.written).toBe(false);
  expect(value.missing).toEqual([{ kind: "section", name: "ci-extra", file: "pack/sections/ci-extra.md", askedBy: ["acme-base:attachments/ci-notes/SKILL.md"] }]);
  expect(process.exitCode).toBe(1);
});

test("skills check --json with missing team values keeps its keys and names the refusal in compileErrors", async () => {
  await skillsCheck(["--pack-dir", makeTeamPackMissingASection(), "--json"]);
  const { value } = oneJsonLine();
  expect(Object.keys(value).slice(-4)).toEqual(["attachments", "baseErrors", "compileErrors", "fieldContract"]);
  expect((value.compileErrors as string[]).slice(0, 2)).toEqual([
    "The widgets pack is missing values the acme-base pack asks for",
    "pack/sections/ci-extra.md (acme-base:attachments/ci-notes/SKILL.md)",
  ]);
  expect(process.exitCode).toBe(1);
});

test("skills composition --json is one line with these keys", async () => {
  await skillsComposition(["--pack-dir", makePack(), "--json"]);
  const { value } = oneJsonLine();
  expect(Object.keys(value)).toEqual(["pack", "packDir", "manifestPath", "verbs", "fills", "binders", "pipelines", "targets", "extends"]);
  expect(value.extends).toBeNull();
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
