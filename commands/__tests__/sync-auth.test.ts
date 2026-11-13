import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { StackGuardRunners } from "../../lib/stack-guard.ts";
import type { ForgeTokenLookup } from "../../lib/team/forge-token.ts";
import * as out from "../../lib/ui/out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { createOriginAuth, tokenNoteBlocks, type OriginAuth, type OriginAuthSeams } from "../git/origin-auth.ts";
import type { FetchDeps, PushDeps } from "../git/shared.ts";
import { syncAllNote, syncBranch, type SyncSummary } from "../sync.ts";
import { git, makeRepo } from "../git/__tests__/helpers.ts";

const TOKEN = "glpat-LEAKCHECK000000000";
const NO_USER = "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled";
const PUSH_URL = "https://gitlab.com/acme/x.git";

const clear: StackGuardRunners = {
  gitqStacks: async () => null,
  forgeOpenMrs: async () => ({ ok: true, mrs: [] }),
};

const tokenSeams: OriginAuthSeams = { confirmedHost: () => null, lookup: async (): Promise<ForgeTokenLookup> => ({ kind: "token", token: TOKEN }) };
const noTokenSeams: OriginAuthSeams = { confirmedHost: () => null, lookup: async (): Promise<ForgeTokenLookup> => ({ kind: "absent" }) };

type Result = { ok: true } | { ok: false; output: string };

let root: string;
let io: CapturedOut;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["RT_SYNC_LOG_PATH", "GIT_TERMINAL_PROMPT", "GIT_ASKPASS", "RT_SYNC_AUTH_MARK"] as const;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-auth-")));
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.RT_SYNC_LOG_PATH = join(root, "sync.log");
  delete process.env.GIT_TERMINAL_PROMPT;
  delete process.env.GIT_ASKPASS;
  delete process.env.RT_SYNC_AUTH_MARK;
  io = captureOut();
  out.__test__.reset();
  out.__test__.setHuman(() => false);
});

afterEach(() => {
  io.restore();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(root, { recursive: true, force: true });
});

/**
 * A clone on `feature` whose local origin/main is one commit ahead of it, so
 * a sync rebases and pushes without its own fetch moving anything. origin is
 * a local bare repo; the https push URL is never contacted, because every
 * fetch and push runs through a fake.
 */
function staleClone(name = "clone", pushUrl: string | null = PUSH_URL): string {
  const seed = makeRepo(root, `${name}-seed`);
  const origin = join(root, `${name}-origin.git`);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  const clone = join(root, name);
  execFileSync("git", ["clone", "-q", origin, clone], { stdio: "pipe" });
  git(clone, "config", "user.email", "sam@example.test");
  git(clone, "config", "user.name", "Sam Sample");
  git(clone, "config", "commit.gpgsign", "false");
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
  if (pushUrl) git(clone, "config", "remote.origin.pushurl", pushUrl);
  return clone;
}

function fakeRemotes(auth: OriginAuth, pushResults: Result[] = [{ ok: true }], fetchResults: Result[] = [{ ok: true }]) {
  const promptAtFetch: (string | undefined)[] = [];
  const pushEnvs: NodeJS.ProcessEnv[] = [];
  const fetchDeps: FetchDeps = {
    run: async () => (promptAtFetch.push(process.env.GIT_TERMINAL_PROMPT), fetchResults.shift() ?? { ok: true }),
    findAgent: async () => undefined,
    env: process.env,
    auth,
    helper: "!helper",
    switchViable: async () => false,
  };
  const pushDeps: PushDeps = {
    run: async (_cwd, _args, env) => (pushEnvs.push(env), pushResults.shift() ?? { ok: true }),
    findAgent: async () => undefined,
    auth,
    helper: "!helper",
    switchViable: async () => false,
  };
  return { fetchDeps, pushDeps, promptAtFetch, pushEnvs };
}

describe("syncBranch prompt guard", () => {
  test("syncBranch decides the guard from the push URL and restores it after", async () => {
    const clone = staleClone();
    const auth = createOriginAuth(tokenSeams);
    const { fetchDeps, pushDeps, promptAtFetch } = fakeRemotes(auth);
    const before = process.env.GIT_TERMINAL_PROMPT;
    const s = await syncBranch(clone, { quiet: true, stackRunners: clear, originAuth: auth, fetchDeps, pushDeps });
    expect(s.error).toBeUndefined();
    expect(promptAtFetch).toEqual(["0"]);
    expect(process.env.GIT_TERMINAL_PROMPT).toBe(before);
    expect("GIT_ASKPASS" in process.env).toBe(false);
  });

  test("syncBranch calls guardPrompts before its first remote call", async () => {
    const clone = staleClone();
    const log = join(root, "upload-pack.log");
    const script = join(root, "upload-pack.sh");
    writeFileSync(script, `#!/bin/sh\nprintf '%s\\n' "\${RT_SYNC_AUTH_MARK:-unset}" >> '${log}'\nexec git upload-pack "$@"\n`, { mode: 0o755 });
    git(clone, "config", "remote.origin.uploadpack", script);
    const order: string[] = [];
    const auth: OriginAuth = {
      ...createOriginAuth(null),
      guardPrompts: async () => {
        order.push("guard");
        process.env.RT_SYNC_AUTH_MARK = "guarded";
        return () => {
          delete process.env.RT_SYNC_AUTH_MARK;
          order.push("undo");
        };
      },
    };
    const { fetchDeps, pushDeps } = fakeRemotes(auth);
    await syncBranch(clone, { quiet: true, stackRunners: clear, originAuth: auth, fetchDeps, pushDeps });
    expect(order).toEqual(["guard", "undo"]);
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, "utf8").split("\n")[0]).toBe("guarded");
  });

  test("syncBranch leaves prompts alone when rt cannot authenticate origin", async () => {
    const clone = staleClone();
    const auth = createOriginAuth(noTokenSeams);
    const { fetchDeps, pushDeps, promptAtFetch } = fakeRemotes(auth);
    await syncBranch(clone, { quiet: true, stackRunners: clear, originAuth: auth, fetchDeps, pushDeps });
    expect(promptAtFetch).toEqual([undefined]);
  });

  test("the guard from one syncBranch does not leak into the next", async () => {
    const first = staleClone("first");
    const second = staleClone("second");
    const withToken = createOriginAuth(tokenSeams);
    const withoutToken = createOriginAuth(noTokenSeams);
    const a = fakeRemotes(withToken);
    const b = fakeRemotes(withoutToken);
    await syncBranch(first, { quiet: true, stackRunners: clear, originAuth: withToken, fetchDeps: a.fetchDeps, pushDeps: a.pushDeps });
    await syncBranch(second, { quiet: true, stackRunners: clear, originAuth: withoutToken, fetchDeps: b.fetchDeps, pushDeps: b.pushDeps });
    expect(a.promptAtFetch).toEqual(["0"]);
    expect(b.promptAtFetch).toEqual([undefined]);
  });
});

describe("syncBranch token use", () => {
  test("a sync that needed rt's token reports usedRtToken and its forge", async () => {
    const clone = staleClone();
    const auth = createOriginAuth(tokenSeams);
    const { fetchDeps, pushDeps, pushEnvs } = fakeRemotes(auth, [{ ok: false, output: NO_USER }, { ok: true }]);
    const s = await syncBranch(clone, { quiet: true, stackRunners: clear, originAuth: auth, fetchDeps, pushDeps });
    expect(s.error).toBeUndefined();
    expect(s.pushed).toBe(true);
    expect(s.usedRtToken).toBe(true);
    expect(s.tokenForge).toBe("gitlab");
    expect(pushEnvs[1]!.GIT_CONFIG_VALUE_1).toBe("!helper");
    expect(JSON.stringify(pushEnvs)).not.toContain("LEAKCHECK");
  });

  test("a sync that did not need it reports neither", async () => {
    const clone = staleClone();
    const auth = createOriginAuth(tokenSeams);
    const { fetchDeps, pushDeps } = fakeRemotes(auth);
    const s = await syncBranch(clone, { quiet: true, stackRunners: clear, originAuth: auth, fetchDeps, pushDeps });
    expect(s.pushed).toBe(true);
    expect(s.usedRtToken).toBeUndefined();
    expect(s.tokenForge).toBeUndefined();
  });

  test("a refused push carries no token and reports a failure", async () => {
    const clone = staleClone();
    const auth = createOriginAuth(tokenSeams);
    const refused = `remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://oauth2:${TOKEN}@gitlab.com/acme/x.git/'`;
    const { fetchDeps, pushDeps } = fakeRemotes(auth, [{ ok: false, output: NO_USER }, { ok: false, output: refused }]);
    const s = await syncBranch(clone, { quiet: true, stackRunners: clear, originAuth: auth, fetchDeps, pushDeps });
    expect(s.error).toBe("Could not push feature: the forge refused rt's token as well");
    expect(s.pushed).toBe(false);
    expect(JSON.stringify(s)).not.toContain("LEAKCHECK");
  });
});

describe("the token note", () => {
  const summary = (branch: string, over: Partial<SyncSummary> = {}): SyncSummary => ({ branch, worktree: `/tmp/${branch}`, resetResult: null, rebaseResult: null, pushed: true, ...over });

  test("tokenNoteBlocks names the forge, says this run and points at rt git auth", () => {
    const text = renderPlain(tokenNoteBlocks("gitlab"));
    expect(text).toContain("GitLab");
    expect(text).toContain("this run");
    expect(text).toContain("rt git auth");
    expect(text).not.toContain("this sync");
  });

  test("tokenNoteBlocks under sync all names the worktrees", () => {
    const text = renderPlain(tokenNoteBlocks("github", ["feature/a", "feature/b"]));
    expect(text).toContain("GitHub");
    expect(text).toContain("feature/a");
    expect(text).toContain("feature/b");
  });

  test("syncAllNote lists only the worktrees that used the token and is empty when none did", () => {
    const text = renderPlain(
      syncAllNote([summary("feature/a", { usedRtToken: true, tokenForge: "gitlab" }), summary("feature/b"), summary("feature/c", { usedRtToken: true, tokenForge: "gitlab" })]),
    );
    expect(text).toContain("feature/a");
    expect(text).toContain("feature/c");
    expect(text).not.toContain("feature/b");
    expect(text.split("rt git auth").length - 1).toBe(1);
    expect(syncAllNote([summary("feature/a"), summary("feature/b")])).toEqual([]);
  });
});
