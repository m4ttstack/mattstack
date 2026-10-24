import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, orgDir } from "../../lib/rt-paths.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { seedOrg } from "../../packages/rt-client/test/org-fixture.ts";

const MARKER = "mattstack/mattstack.jsonc";
const BASE_PACK = "mattstack/org/packs/acme-base/pack/skills.jsonc";
const teamPack = (team: string) => `mattstack/teams/${team}/plugin/pack/skills.jsonc`;
const TRIAL = "mattstack-trial";
const script = join(import.meta.dir, "..", "move-to-block-packs.ts");
const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

const origHome = process.env.HOME;
let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-block-packs-home-")));
  process.env.HOME = home;
});
afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

const env = () => ({ ...childEnv(), HOME: home, ...GIT_ENV });
const git = (dir: string, ...argv: string[]) => execFileSync("git", ["-C", dir, ...argv], { encoding: "utf8", env: env(), stdio: "pipe" });

function put(dir: string, rel: string, value: unknown): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

const BLOCK_PACKS: Record<string, unknown> = {
  [BASE_PACK]: { base: true, bindings: { "mattstack:work/sub-agent-tiering": { tiering: "acme:tiering" } } },
  [teamPack("widgets")]: { extends: "acme-base", bindings: { "mattstack:review/criteria": { criteria: "widgets:criteria" } } },
  [teamPack("gadgets")]: { extends: "acme-base", pipelines: { bugfix: { stages: ["mattstack:stage-plan"], bindings: { "mattstack:stage-ship/domain-rules": { rules: "gadgets:ship" } } } } },
};

/** A layout 4 org clone on its published trial branch, every pack already in block form. */
function org(opts: { layout?: number; dataBranch?: string | null; packs?: Record<string, unknown> } = {}): string {
  seedOrg({
    layout: opts.layout ?? 4,
    username: "me",
    roles: { admins: ["me"], teams: { widgets: { owners: ["owner1"] }, gadgets: { owners: ["me"] } } },
    roster: [{ username: "me", teams: ["widgets"] }],
    teams: { widgets: { "board.title": "Widgets" }, gadgets: { "board.title": "Gadgets" } },
  });
  mkdirSync(dirname(machineSettingsPath()), { recursive: true });
  writeFileSync(machineSettingsPath(), JSON.stringify({ "rt.teamSnapshot": { enabled: false } }));
  const dir = orgDir("acme");
  const dataBranch = opts.dataBranch === undefined ? "mattstack" : opts.dataBranch;
  put(dir, MARKER, { role: "org", org: "acme", layout: opts.layout ?? 4, ...(dataBranch ? { dataBranch } : {}) });
  for (const [rel, value] of Object.entries({ ...BLOCK_PACKS, ...opts.packs })) put(dir, rel, value);
  git(dir, "init", "-q", "-b", dataBranch ?? "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "seed");
  const origin = join(home, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", origin], { env: env() });
  git(dir, "remote", "add", "origin", origin);
  git(dir, "push", "-q", "origin", dataBranch ?? "main");
  git(dir, "switch", "-q", "-c", TRIAL);
  git(dir, "push", "-q", "-u", "origin", TRIAL);
  return dir;
}

const runAs = (admin: string, dir: string, ...extra: string[]) => Bun.spawnSync(["bun", script, dir, "--admin", admin, ...extra], { env: env(), stdout: "pipe", stderr: "pipe" });
const run = (dir: string, ...extra: string[]) => runAs("me", dir, ...extra);

function snapshot(dir: string): string {
  const files: string[][] = [];
  const walk = (parent: string): void => {
    for (const name of readdirSync(join(dir, parent)).sort()) {
      if (parent === "" && name === ".git") continue;
      const rel = parent ? `${parent}/${name}` : name;
      if (lstatSync(join(dir, rel)).isDirectory()) walk(rel);
      else files.push([rel, readFileSync(join(dir, rel), "base64")]);
    }
  };
  walk("");
  return JSON.stringify({ head: git(dir, "rev-parse", "HEAD"), branch: git(dir, "branch", "--show-current"), status: git(dir, "status", "--porcelain", "--ignored"), files });
}

test("plans the bump when every pack is in block form", () => {
  const dir = org();
  const plan = run(dir);
  expect(plan.exitCode).toBe(0);
  for (const name of ["org acme-base", "widgets", "gadgets"]) expect(plan.stdout.toString()).toContain(`${name}: block form`);
  expect(plan.stdout.toString()).toContain(`marker: layout 5 on ${TRIAL}`);

  const head = git(dir, "rev-parse", "HEAD").trim();
  const result = run(dir, "--write");
  expect(result.stderr.toString()).not.toContain("refused");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(readFileSync(join(dir, MARKER), "utf8"))).toEqual({ role: "org", org: "acme", layout: 5, dataBranch: "mattstack" });
  expect(git(dir, "branch", "--show-current").trim()).toBe(TRIAL);
  expect(git(dir, "rev-parse", "HEAD~1").trim()).toBe(head);
  expect(git(dir, "diff", "--name-only", "HEAD~1", "HEAD").trim()).toBe(MARKER);
  expect(git(dir, "status", "--porcelain").trim()).toBe("");
});

test("plans only without --write", () => {
  const dir = org();
  const before = snapshot(dir);
  const result = run(dir);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Nothing was written");
  expect(snapshot(dir)).toBe(before);
});

test("refuses when a pack still has an old slot binding", () => {
  const dir = org({ packs: { [teamPack("widgets")]: { extends: "acme-base", bindings: { "mattstack:stage-ship": { domain: "widgets:ship" } } } } });
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  const stderr = result.stderr.toString();
  expect(stderr).toContain("refused");
  expect(stderr).toContain("widgets");
  expect(stderr).toContain("mattstack:stage-ship domain");
  expect(stderr).not.toContain("gadgets");
  expect(snapshot(dir)).toBe(before);
});

test("refuses on an old slot binding inside a pipeline object", () => {
  const dir = org({ packs: { [teamPack("gadgets")]: { extends: "acme-base", pipelines: { bugfix: { bindings: { "mattstack:stage-ship": { domain: "gadgets:ship" } } } } } } });
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("gadgets: mattstack:stage-ship domain in pipeline bugfix");
  expect(snapshot(dir)).toBe(before);
});

test("refuses on a pack whose fragment does not parse, and skips a folder with none", () => {
  const dir = org({ packs: { [BASE_PACK]: "{ not json", "mattstack/org/packs/notes/README.md": "not a pack\n" } });
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("The org acme-base pack cannot be read");
  expect(result.stderr.toString()).toContain("not valid JSONC");
  expect(result.stderr.toString()).not.toContain("notes");
  expect(snapshot(dir)).toBe(before);
});

test("refuses on a layout 3 org", () => {
  const dir = org({ layout: 3, dataBranch: null });
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("This org is on layout 3");
  expect(result.stderr.toString()).toContain(`bun scripts/move-to-data-branch.ts ${dir} --admin me`);
  expect(snapshot(dir)).toBe(before);
});

test("refuses while team sync is on", () => {
  const dir = org();
  writeFileSync(machineSettingsPath(), JSON.stringify({ "rt.teamSnapshot": { enabled: true } }));
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("Team sync is on for this Mac");
  expect(result.stderr.toString()).toContain("rt settings set rt.teamSnapshot");
  expect(snapshot(dir)).toBe(before);
});

test("refuses with uncommitted changes", () => {
  const dir = org();
  writeFileSync(join(dir, "stray.txt"), "x\n");
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("The clone has uncommitted changes");
  expect(result.stderr.toString()).toContain(`git -C ${dir} status`);
  expect(snapshot(dir)).toBe(before);
});

test("refuses with unpublished commits", () => {
  const dir = org();
  put(dir, "mattstack/org/note.txt", "x\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "local");
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("The clone has commits origin does not have");
  expect(result.stderr.toString()).toContain(`git -C ${dir} log --oneline origin/${TRIAL}..HEAD`);
  expect(snapshot(dir)).toBe(before);
});

test("refuses when --admin is not an org admin", () => {
  const dir = org();
  const before = snapshot(dir);
  for (const admin of ["stranger", "owner1"]) {
    const result = runAs(admin, dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(`${admin} is not an admin of this org`);
  }
  expect(snapshot(dir)).toBe(before);
});

test("refuses an org store with a syntax error, naming the store", () => {
  const dir = org({ packs: { "mattstack/org/settings.org.jsonc": '{ "mattstack.org": ' } });
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("The org store cannot be read");
  expect(result.stderr.toString()).toContain("mattstack/org/settings.org.jsonc has a syntax error. Fix it, then run this again.");
  expect(result.stderr.toString()).not.toContain("not an admin");
  expect(result.stderr.toString()).not.toContain("malformed settings store");
  expect(snapshot(dir)).toBe(before);
});

test("refuses a layout 4 marker that names no data branch", () => {
  const dir = org({ dataBranch: null });
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("This org's marker names no data branch");
  expect(result.stderr.toString()).not.toContain("on layout 4");
  expect(result.stderr.toString()).toContain(`git -C ${dir} show origin/main:.mattstack.jsonc`);
  expect(snapshot(dir)).toBe(before);
});

test("refuses a detached HEAD", () => {
  const dir = org();
  git(dir, "switch", "-q", "--detach");
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("The clone has no branch checked out");
  expect(result.stderr.toString()).toContain(`git -C ${dir} switch mattstack`);
  expect(snapshot(dir)).toBe(before);
});

test("refuses an old slot binding in an org pack, naming it as the org's", () => {
  const dir = org({ packs: { [BASE_PACK]: { base: true, bindings: { "mattstack:work": { tiering: "acme:tiering" } } } } });
  const before = snapshot(dir);
  const result = run(dir, "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("The org acme-base pack still uses old slot keys");
  expect(result.stderr.toString()).toContain("org acme-base: mattstack:work tiering.");
  expect(snapshot(dir)).toBe(before);
});

test("an org pack and a team with the same name are reported apart", () => {
  const dir = org({ packs: { "mattstack/org/packs/widgets/pack/skills.jsonc": { base: true } } });
  const result = run(dir);
  expect(result.exitCode).toBe(0);
  const lines = result.stdout.toString().split("\n").map((line) => line.trim());
  expect(lines).toContain("org widgets: block form");
  expect(lines).toContain("widgets: block form");
});
