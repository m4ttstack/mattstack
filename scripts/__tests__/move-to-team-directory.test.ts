import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { parse } from "jsonc-parser";
import { machineSettingsPath, orgDir } from "../../lib/rt-paths.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { seedOrg } from "../../packages/rt-client/test/org-fixture.ts";

const ORG_STORE = "mattstack/org/settings.org.jsonc";
const CLAIM_STORE = "mattstack/teams/claim/settings.team.jsonc";
const MARKER = "mattstack/mattstack.jsonc";
const GIT_IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const TABS = [
  { id: "team", label: "Team", source: { kind: "authors" } },
  { id: "q", label: "Q", source: { kind: "codeowners", section: "Claim - #pod-claim" }, slackChannel: "pod-claim" },
];
const script = join(import.meta.dir, "..", "move-to-team-directory.ts");

const origHome = process.env.HOME;
let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-directory-home-")));
  process.env.HOME = home;
});
afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function git(dir: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", dir, ...argv], { encoding: "utf8", env: { ...childEnv(), HOME: home, ...GIT_IDENTITY } });
}

function org(opts: { layout?: number; settings?: Record<string, unknown> } = {}): string {
  seedOrg({
    layout: opts.layout ?? 2,
    username: "me",
    roles: { admins: ["me"], teams: { claim: { owners: ["owner1"] }, gadgets: { owners: ["me"] } } },
    roster: [{ username: "me", teams: ["claim"] }, { username: "owner1", teams: ["claim"] }],
    settings: opts.settings,
    teams: {
      claim: {
        "mattstack.integrations": { linear: { teamKey: "CV" } },
        "board.slack": { channel: "claim-internal", singleTemplate: "{title}: {url}" },
        "board.title": "Claim",
        // The v1 store name; board.tabs is stored as board.tabs@2 now.
        "board.tabs": TABS,
      },
      gadgets: { "board.title": "Gadgets" },
    },
  });
  mkdirSync(dirname(machineSettingsPath()), { recursive: true });
  writeFileSync(machineSettingsPath(), JSON.stringify({ "rt.teamSnapshot": { enabled: false } }));
  const dir = orgDir("acme");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "seed");
  const origin = join(home, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: { ...childEnv(), HOME: home } });
  git(dir, "remote", "add", "origin", origin);
  git(dir, "push", "-q", "origin", "main");
  return dir;
}

function commitAndPush(dir: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "change");
  git(dir, "push", "-q", "origin", "main");
}

const run = (dir: string, admin: string, ...extra: string[]) =>
  Bun.spawnSync(["bun", script, dir, "--admin", admin, ...extra], { env: { ...childEnv(), HOME: home }, stdout: "pipe", stderr: "pipe" });

function snapshot(dir: string): string {
  const files: string[][] = [];
  const walk = (parent: string): void => {
    for (const name of readdirSync(join(dir, parent)).sort()) {
      if (parent === "" && name === ".git") continue;
      const rel = parent ? `${parent}/${name}` : name;
      const stat = lstatSync(join(dir, rel));
      if (stat.isSymbolicLink()) files.push([rel, "link", readlinkSync(join(dir, rel))]);
      else if (stat.isDirectory()) walk(rel);
      else files.push([rel, readFileSync(join(dir, rel), "base64")]);
    }
  };
  walk("");
  return JSON.stringify({ head: git(dir, "rev-parse", "HEAD"), status: git(dir, "status", "--porcelain", "--ignored"), files });
}

const read = (dir: string, rel: string) => parse(readFileSync(join(dir, rel), "utf8"));

test("plan mode prints each entry and each removed key, and changes no file", () => {
  const dir = org();
  const before = snapshot(dir);
  const result = run(dir, "me");
  expect(result.exitCode).toBe(0);
  const stdout = result.stdout.toString();
  expect(stdout).toContain("directory: add claim");
  expect(stdout).toContain("team claim: remove board.slack.channel, mattstack.integrations.linear.teamKey, board.tabs[].slackChannel");
  expect(stdout).toContain("Nothing was written");
  expect(snapshot(dir)).toBe(before);
});

test("--write writes the directory, deletes the moved keys, writes layout 3, and makes one commit", () => {
  const dir = org();
  const result = run(dir, "me", "--write");
  expect(result.stderr.toString()).not.toContain("[failed]");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Moved this org onto the team directory in one commit");
  expect(read(dir, ORG_STORE)["mattstack.directory"]).toEqual({
    teams: { claim: { linear: { team: "CV" }, slack: { codeOwnersChannel: "pod-claim", channels: [{ name: "claim-internal", kind: "review" }] } } },
  });
  const claim = read(dir, CLAIM_STORE);
  expect(claim["mattstack.integrations"]).toBeUndefined();
  expect(claim["board.slack"]).toEqual({ singleTemplate: "{title}: {url}" });
  expect(claim["board.title"]).toBe("Claim");
  expect(claim["board.tabs@2"]).toEqual([TABS[0], { id: "q", label: "Q", source: TABS[1]!.source }]);
  expect(claim["board.tabs"]).toBeUndefined();
  expect(read(dir, MARKER)).toEqual({ role: "org", org: "acme", layout: 3 });
  expect(git(dir, "log", "-1", "--format=%s").trim()).toBe("org: move team channels and Linear keys into the team directory");
  expect(git(dir, "rev-list", "--count", "origin/main..HEAD").trim()).toBe("1");
  expect(git(dir, "status", "--porcelain").trim()).toBe("");
});

test("a clone already on layout 3 is refused and left alone", () => {
  const dir = org({ layout: 3 });
  const before = snapshot(dir);
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("already on the team directory layout");
  expect(snapshot(dir)).toBe(before);
});

test("a role: team marker is refused even at layout 2, and nothing changes", () => {
  const dir = org();
  writeFileSync(join(dir, MARKER), JSON.stringify({ role: "team", org: "acme", layout: 2 }));
  commitAndPush(dir);
  const before = snapshot(dir);
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("This is not a mattstack org repo");
  expect(result.stderr.toString()).toContain("does not say role: org");
  expect(snapshot(dir)).toBe(before);
});

test("a copy of the clone is refused, since the writes would land in the clone rt reads", () => {
  const dir = org();
  const copy = join(home, "copy", "acme");
  cpSync(dir, copy, { recursive: true });
  const before = snapshot(dir);
  const copyBefore = snapshot(copy);
  const result = run(copy, "me", "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("Run this on the org clone rt reads");
  expect(result.stderr.toString()).toContain("bun scripts/move-to-team-directory.ts ~/.mattstack/orgs/acme --admin me");
  expect(snapshot(dir)).toBe(before);
  expect(snapshot(copy)).toBe(copyBefore);
});

test("--admin naming someone the org does not list as an admin is refused", () => {
  const dir = org();
  const before = snapshot(dir);
  const result = run(dir, "stranger");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("stranger is not an admin of this org");
  expect(snapshot(dir)).toBe(before);
});

test("a team owner who is not an org admin is refused", () => {
  const dir = org();
  const before = snapshot(dir);
  const result = run(dir, "owner1", "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("owner1 is not an admin of this org");
  expect(snapshot(dir)).toBe(before);
});

test("a directory that already has a duplicate code owners channel is refused", () => {
  const directory = { teams: { a: { slack: { codeOwnersChannel: "pod-x" } }, b: { slack: { codeOwnersChannel: "#Pod-X" } } } };
  const dir = org({ settings: { "mattstack.directory": directory } });
  const before = snapshot(dir);
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("Two teams claim #pod-x");
  expect(snapshot(dir)).toBe(before);
});

test("a team store that is a symbolic link is refused before it is read", () => {
  const dir = org();
  const outside = join(home, "outside.jsonc");
  writeFileSync(outside, JSON.stringify({ "mattstack.integrations": { linear: { teamKey: "OUT" } } }));
  rmSync(join(dir, CLAIM_STORE));
  symlinkSync(outside, join(dir, CLAIM_STORE));
  commitAndPush(dir);
  const before = snapshot(dir);
  const result = run(dir, "me", "--write");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("symbolic link");
  expect(snapshot(dir)).toBe(before);
  expect(readFileSync(outside, "utf8")).toContain("OUT");
});
