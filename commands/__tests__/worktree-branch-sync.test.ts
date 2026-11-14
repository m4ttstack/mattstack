import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BranchSyncResult, GitToolDeps } from "../../lib/mcp/git-tools.ts";
import type { StackGuardRunners } from "../../lib/stack-guard.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { createOriginAuth, helperEnv } from "../git/origin-auth.ts";
import type { FetchDeps, PushDeps } from "../git/shared.ts";
import { ctxFor, exitCodeOf, git, makeRepo, NO_USER, tokenSeams, trapExit } from "../git/__tests__/helpers.ts";
import { syncBranch, syncCommand } from "../sync.ts";
import { branchSyncCommand, type BranchSyncDeps } from "../worktree-branch-sync.ts";

const AUTH = "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled";
const result = (over: Partial<BranchSyncResult>): BranchSyncResult =>
  ({ kind: "synced", branch: "feat", oldHead: "a", newHead: "b", pushed: true, refusal: null, ...over });

let io: CapturedOut;
beforeEach(() => {
  io = captureOut();
  out.__test__.reset();
});
afterEach(() => io.restore());

function deps(answer: BranchSyncResult): { d: BranchSyncDeps; calls: { syncs: number; auths: number } } {
  const calls = { syncs: 0, auths: 0 };
  return { calls, d: { sync: async () => { calls.syncs++; return answer; }, auth: async () => { calls.auths++; return null; } } };
}

// rt sync retries a fetch or push that fails on auth through `rt git credential` itself, so this verb retries only branch_sync's own preflight fetch.
describe("branchSyncCommand", () => {
  test.each([
    ["a fetch that failed on auth", result({ kind: "error", oldHead: "a", newHead: "a", pushed: false, refusal: `Could not fetch from origin: the forge refused rt's token as well ${AUTH}` })],
    ["a push that failed on auth", result({ kind: "push-refused", pushed: false, refusal: `Could not push feat: the forge refused rt's token as well ${AUTH}` })],
    ["a synced branch", result({})],
    ["a preflight fetch that failed on something other than auth", result({ kind: "error", oldHead: "a", newHead: "a", pushed: false, refusal: "git fetch origin failed: fatal: unable to access: Could not resolve host" })],
  ])("%s is reported as rt sync left it, from one run", async (_label, answer) => {
    const { d, calls } = deps(answer);
    await branchSyncCommand([], undefined, d);
    expect(calls.syncs).toBe(1);
    expect(JSON.parse(io.stdout())).toEqual(answer);
  });
});

describe("branchSyncCommand when the preflight fetch fails on auth", () => {
  const preflightAuth = result({ kind: "error", oldHead: "a", newHead: "a", pushed: false, refusal: `git fetch origin failed: ${AUTH}` });
  let repo: string;
  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "rt-branch-sync-pre-")));
    execFileSync("git", ["init", "-q", repo], { stdio: "pipe" });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  test("runs branch_sync once more with git and rt sync carrying rt's helper, and no token", async () => {
    const seen: Pick<GitToolDeps, "git" | "sync">[] = [];
    const synced = result({});
    const d: BranchSyncDeps = {
      sync: async (_cwd, ds) => (seen.push(ds), seen.length === 1 ? preflightAuth : synced),
      auth: async () => ({ env: helperEnv("gitlab.com", {}, "!rt-helper") as Record<string, string>, remote: "https://gitlab.com/acme/x.git", host: "gitlab.com" }),
    };
    await branchSyncCommand([], undefined, d);
    expect(seen.length).toBe(2);
    const helpers = await seen[1]!.git(["config", "--get-all", "credential.https://gitlab.com.helper"], repo);
    expect(helpers.stdout).toBe("\n!rt-helper\n");
    expect((await seen[0]!.git(["config", "--get-all", "credential.https://gitlab.com.helper"], repo)).stdout).toBe("");
    expect(JSON.parse(io.stdout())).toEqual(synced);
  });

  test("with no token for origin, the failure is reported from one run", async () => {
    const { d, calls } = deps(preflightAuth);
    await branchSyncCommand([], undefined, d);
    expect(calls).toEqual({ syncs: 1, auths: 1 });
    expect(JSON.parse(io.stdout())).toEqual(preflightAuth);
  });
});

describe("rt sync --json, which branch_sync runs, retries its own fetch and push", () => {
  let root: string;
  const savedLog = process.env.RT_SYNC_LOG_PATH;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rt-branch-sync-")));
    process.env.RT_SYNC_LOG_PATH = join(root, "sync.log");
  });
  afterEach(() => {
    if (savedLog === undefined) delete process.env.RT_SYNC_LOG_PATH;
    else process.env.RT_SYNC_LOG_PATH = savedLog;
    rmSync(root, { recursive: true, force: true });
  });

  /** A clone on `feature` one commit behind its local origin/main; the https URL is never contacted, every remote call is faked. */
  function staleClone(): string {
    const seed = makeRepo(root, "seed");
    const origin = join(root, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-q", "origin", "main");
    const clone = join(root, "clone");
    execFileSync("git", ["clone", "-q", origin, clone], { stdio: "pipe" });
    for (const [k, v] of [["user.email", "sam@example.test"], ["user.name", "Sam Sample"], ["commit.gpgsign", "false"]] as const) git(clone, "config", k, v);
    git(clone, "checkout", "-qb", "feature");
    writeFileSync(join(clone, "f.txt"), "feature\n");
    git(clone, "add", "f.txt");
    git(clone, "commit", "-qm", "feature file");
    git(clone, "push", "-q", "-u", "origin", "feature");
    writeFileSync(join(seed, "m.txt"), "main\n");
    git(seed, "add", "m.txt");
    git(seed, "commit", "-qm", "main file");
    git(seed, "push", "-q", "origin", "main");
    git(clone, "fetch", "-q", "origin");
    git(clone, "remote", "set-url", "origin", "https://gitlab.com/acme/x.git");
    return clone;
  }

  test("an https clone with no helper of its own syncs through rt's helper, with no token in any env", async () => {
    const clone = staleClone();
    const auth = createOriginAuth(tokenSeams);
    const fetches = [{ ok: false as const, output: NO_USER }];
    const envs: NodeJS.ProcessEnv[] = [];
    const fetchDeps: FetchDeps = { run: async (_c, env) => (envs.push(env), fetches.shift() ?? { ok: true }), findAgent: async () => undefined, env: process.env, auth, helper: "!rt-helper", switchViable: async () => false };
    const pushDeps: PushDeps = { run: async (_c, _a, env) => (envs.push(env), { ok: true }), findAgent: async () => undefined, auth, helper: "!rt-helper", switchViable: async () => false };
    const clear: StackGuardRunners = { gitqStacks: async () => null, forgeOpenMrs: async () => ({ ok: true, mrs: [] }) };
    const exit = trapExit();
    try {
      const code = await exitCodeOf(() => syncCommand(["--json", "--no-agent"], ctxFor(clone), {
        syncBranch: (cwd, opts) => syncBranch(cwd, { ...opts, originAuth: auth, fetchDeps, pushDeps, stackRunners: clear }),
      }));
      expect(code).toBeNull();
    } finally {
      exit.restore();
    }
    expect(envs).toHaveLength(3);
    expect(Object.values(envs[1]!)).toContain("!rt-helper");
    expect(Object.values(envs[2]!)).toContain("!rt-helper");
    expect(JSON.stringify(envs)).not.toContain("LEAKCHECK");
    expect(git(clone, "rev-parse", "feature~1")).toBe(git(clone, "rev-parse", "origin/main"));
  }, 20_000);
});
