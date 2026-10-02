import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { syncAllCommand } from "../sync.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "../git/__tests__/helpers.ts";

// mock.module mutates the live namespace in place: keep the real bindings
// from before any mock to restore with.
const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;
const realIsDaemonRunning = realDaemonClient.isDaemonRunning;
const realStackGuard = await import("../../lib/stack-guard.ts");
const realCreateStackGuardRunners = realStackGuard.createStackGuardRunners;

let repos: Record<string, { path: string; worktrees: { path: string; branch: string }[] }> = {};

let io: CapturedOut;
let exit: { restore(): void };
let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-all-")));
  io = captureOut({ console: true });
  out.__test__.reset();
  out.__test__.setHuman(() => false);
  exit = trapExit();
  mock.module("../../lib/daemon-client.ts", () => ({
    ...realDaemonClient,
    isDaemonRunning: async () => true,
    daemonQuery: async () => ({ ok: true, data: { repos, watched: [] } }),
  }));
  mock.module("../../lib/stack-guard.ts", () => ({
    ...realStackGuard,
    createStackGuardRunners: () => ({
      gitqStacks: async () => null,
      forgeOpenMrs: async () => ({ ok: false, error: "forge: not logged in" }),
    }),
  }));
});
afterEach(() => {
  repos = {};
  mock.module("../../lib/stack-guard.ts", () => ({ ...realStackGuard, createStackGuardRunners: realCreateStackGuardRunners }));
  mock.module("../../lib/daemon-client.ts", () => ({
    ...realDaemonClient,
    isDaemonRunning: realIsDaemonRunning,
    daemonQuery: realDaemonQuery,
  }));
  exit.restore();
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

describe("rt sync all for a repo the daemon does not know", () => {
  test("next names a register command that runs as printed, with this repo's path", async () => {
    const repo = makeRepo(root, "sample app");
    git(repo, "remote", "add", "origin", join(root, "origin.git"));
    expect(await exitCodeOf(() => syncAllCommand([], ctxFor(repo)))).toBe(1);
    expect(io.stderr()).toBe(
      "The rt daemon does not know git.example.test/sample/sample-app yet\n" + `  next: rt repos register '${repo}'\n`,
    );
  });
});

describe("rt sync all when a branch's fetch fails", () => {
  test("the branch draws one failure, and no step line says it failed first", async () => {
    const repo = makeRepo(root);
    const origin = join(root, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
    git(repo, "remote", "add", "origin", origin);
    git(repo, "push", "-q", "origin", "main");
    git(repo, "checkout", "-qb", "feature");
    git(repo, "remote", "set-url", "origin", join(root, "gone.git"));
    repos = { "git.example.test/sample/sample-app": { path: repo, worktrees: [{ path: repo, branch: "feature" }] } };
    expect(await exitCodeOf(() => syncAllCommand([], ctxFor(repo)))).toBeNull();
    expect(io.stdout()).not.toContain("[failed] Could not fetch");
    expect(io.stderr()).toStartWith("Could not fetch from origin\n  Command failed: git fetch origin\n");
    expect(io.stderr().split("Could not fetch").length - 1).toBe(1);
  });
});
