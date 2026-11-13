import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { __testSeams, ontoCommand, rebaseOnto } from "../rebase.ts";
import * as out from "../../../lib/ui/out.ts";
import { renderPlain } from "../../../lib/ui/out-plain.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import type { ForgeTokenLookup } from "../../../lib/team/forge-token.ts";
import { createOriginAuth, tokenNoteBlocks, type OriginAuth, type OriginAuthSeams } from "../origin-auth.ts";
import type { FetchDeps } from "../shared.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "./helpers.ts";


let tmpRoot: string;
let savedSyncLogPath: string | undefined;

beforeEach(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-rebase-")));
  // rebaseOnto logs every git command via syncLog; redirect it to a temp
  // file so these tests never append to the real ~/.mattstack/rt/sync.log.
  savedSyncLogPath = process.env.RT_SYNC_LOG_PATH;
  process.env.RT_SYNC_LOG_PATH = join(tmpRoot, "sync.log");
});

afterEach(() => {
  if (savedSyncLogPath === undefined) delete process.env.RT_SYNC_LOG_PATH;
  else process.env.RT_SYNC_LOG_PATH = savedSyncLogPath;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* */ }
});

function sh(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: "pipe" });
}

/**
 * Repo where `feature` and `master` both edit line 1 of app.txt,
 * guaranteeing an unresolvable conflict with no auto-resolve rules.
 */
function makeConflictRepo(): string {
  const repo = join(tmpRoot, "repo");
  execSync(`git init -q -b master "${repo}"`);
  const git = (c: string) => sh(`git -c user.email=t@t -c user.name=t ${c}`, repo);
  writeFileSync(join(repo, "app.txt"), "base\n");
  git("add .");
  git('commit -qm "base"');
  git("checkout -qb feature");
  writeFileSync(join(repo, "app.txt"), "feature change\n");
  git('commit -qam "feature edit"');
  git("checkout -q master");
  writeFileSync(join(repo, "app.txt"), "master change\n");
  git('commit -qam "master edit"');
  git("checkout -q feature");
  return repo;
}

function rebaseDirExists(repo: string): boolean {
  return (
    existsSync(join(repo, ".git", "rebase-merge")) ||
    existsSync(join(repo, ".git", "rebase-apply"))
  );
}

describe("rebaseOnto onConflict", () => {
  test("pause leaves the rebase in progress and reports it", async () => {
    const repo = makeConflictRepo();
    const result = await rebaseOnto({
      cwd: repo,
      target: "master",
      skipFetch: true,
      quiet: true,
      onConflict: "pause",
    });
    expect(result.status).toBe("conflict");
    expect(result.rebaseInProgress).toBe(true);
    expect(result.unresolvedFiles).toEqual(["app.txt"]);
    expect(result.backupBranch).toStartWith("rt-backup/rebase/feature/");
    expect(rebaseDirExists(repo)).toBe(true);
  });

  test("default aborts as before", async () => {
    const repo = makeConflictRepo();
    const result = await rebaseOnto({
      cwd: repo,
      target: "master",
      skipFetch: true,
      quiet: true,
    });
    expect(result.status).toBe("conflict");
    expect(result.rebaseInProgress).toBeFalsy();
    expect(rebaseDirExists(repo)).toBe(false);
  });
});

describe("rebaseOnto auto-resolve", () => {
  test("a conflicted file name holding shell syntax reaches git as one argument, and nothing runs", async () => {
    const hostile = "feat$(touch${IFS}pwned)";
    const repo = join(tmpRoot, "repo");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "pipe" });
    execFileSync("git", ["init", "-q", "-b", "master", repo], { stdio: "pipe" });
    writeFileSync(join(repo, hostile), "base\n");
    git("add", "--", hostile);
    git("commit", "-qm", "base");
    git("checkout", "-qb", "feature");
    writeFileSync(join(repo, hostile), "feature change\n");
    git("commit", "-qam", "feature edit");
    git("checkout", "-q", "master");
    writeFileSync(join(repo, hostile), "master change\n");
    git("commit", "-qam", "master edit");
    git("checkout", "-q", "feature");

    const result = await rebaseOnto({
      cwd: repo,
      target: "master",
      skipFetch: true,
      quiet: true,
      autoResolve: [{ glob: "feat*", strategy: "theirs" }],
    });

    expect(existsSync(join(repo, "pwned"))).toBe(false);
    expect(existsSync(join(process.cwd(), "pwned"))).toBe(false);
    expect(result.status).toBe("ok");
    expect(result.resolvedFiles).toEqual([hostile]);
    expect(rebaseDirExists(repo)).toBe(false);
  });
});

const TOKEN = "glpat-LEAKCHECK000000000";
const NO_USER = "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled";
const tokenSeams: OriginAuthSeams = { confirmedHost: () => null, lookup: async (): Promise<ForgeTokenLookup> => ({ kind: "token", token: TOKEN }) };

function fakeFetch(auth: OriginAuth, results: ({ ok: true } | { ok: false; output: string })[]): FetchDeps {
  return {
    run: async () => results.shift() ?? { ok: true },
    findAgent: async () => undefined,
    env: process.env,
    auth,
    helper: "!helper",
    switchViable: async () => false,
  };
}

function originRepo(): string {
  const repo = makeRepo(tmpRoot);
  const origin = join(tmpRoot, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "checkout", "-qb", "feature");
  writeFileSync(join(repo, "f.txt"), "feature\n");
  git(repo, "add", "f.txt");
  git(repo, "commit", "-qm", "feature file");
  git(repo, "fetch", "-q", "origin");
  return repo;
}

describe("rebase and the forge token", () => {
  let io: CapturedOut;
  let exit: { restore(): void };
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["GIT_TERMINAL_PROMPT", "GIT_ASKPASS"] as const;

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    io = captureOut({ console: true });
    out.__test__.reset();
    out.__test__.setHuman(() => false);
    exit = trapExit();
  });
  afterEach(() => {
    exit.restore();
    io.restore();
    delete __testSeams.originAuth;
    delete __testSeams.fetchDeps;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("rebaseOnto reports usedRtToken when its fetch needed rt's helper", async () => {
    const repo = originRepo();
    git(repo, "remote", "set-url", "origin", "https://gitlab.com/acme/x.git");
    const auth = createOriginAuth(tokenSeams);
    const result = await rebaseOnto({ cwd: repo, target: "main", quiet: true, fetchDeps: fakeFetch(auth, [{ ok: false, output: NO_USER }, { ok: true }]), originAuth: auth });
    expect(result.status).not.toBe("error");
    expect(result.usedRtToken).toBe(true);
    expect(result.tokenForge).toBe("gitlab");
    expect(JSON.stringify(result)).not.toContain("LEAKCHECK");
  }, 20_000);

  test("rebaseOnto with skipFetch never reports usedRtToken", async () => {
    const repo = originRepo();
    const result = await rebaseOnto({ cwd: repo, target: "main", quiet: true, skipFetch: true });
    expect(result.usedRtToken).toBeUndefined();
    expect(result.tokenForge).toBeUndefined();
  }, 20_000);

  test("ontoCommand prints the token note after a finished rebase, not under --json, not after a failure", async () => {
    const auth = createOriginAuth(tokenSeams);
    const repo = originRepo();
    git(repo, "remote", "set-url", "origin", "https://gitlab.com/acme/x.git");
    __testSeams.originAuth = createOriginAuth(null);
    __testSeams.fetchDeps = fakeFetch(auth, [{ ok: false, output: NO_USER }, { ok: true }]);
    expect(await exitCodeOf(() => ontoCommand(["main"], ctxFor(repo)))).toBeNull();
    expect(io.stderr() + io.stdout()).toContain(renderPlain(tokenNoteBlocks("gitlab")).split("\n")[0]!);
    expect(io.stderr() + io.stdout()).not.toContain("LEAKCHECK");

    io.restore();
    io = captureOut({ console: true });
    __testSeams.fetchDeps = fakeFetch(auth, [{ ok: false, output: NO_USER }, { ok: true }]);
    expect(await exitCodeOf(() => ontoCommand(["main", "--json"], ctxFor(repo)))).toBeNull();
    expect(io.stderr() + io.stdout()).not.toContain("GitLab token");

    io.restore();
    io = captureOut({ console: true });
    __testSeams.fetchDeps = fakeFetch(auth, [{ ok: false, output: "fatal: unable to access: Could not resolve host" }]);
    expect(await exitCodeOf(() => ontoCommand(["main"], ctxFor(repo)))).toBe(1);
    expect(io.stderr() + io.stdout()).not.toContain("GitLab token");
  }, 20_000);

  test("the command calls guardPrompts before the fetch and undoes it before exiting", async () => {
    const repo = originRepo();
    const order: string[] = [];
    const auth: OriginAuth = {
      ...createOriginAuth(null),
      guardPrompts: async (_cwd, o) => {
        order.push(`guard push=${o?.push}`);
        return () => order.push("undo");
      },
    };
    const deps = fakeFetch(auth, []);
    deps.run = async () => (order.push("fetch"), { ok: true });
    __testSeams.originAuth = auth;
    __testSeams.fetchDeps = deps;
    await exitCodeOf(() => ontoCommand(["main"], ctxFor(repo)));
    expect(order).toEqual(["guard push=false", "fetch", "undo"]);
  }, 20_000);
});
