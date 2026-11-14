import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { GitResult } from "../git-async.ts";
import { originFetchAuth, poolCredentialHelper, runGitOrigin, type FetchAuthSeams } from "../fetch-auth.ts";

let root: string;
let repo: string;
let helperLog: string;
let rtHelper: string;
const origEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, HOME: process.env.HOME };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function seams(token: string | null, confirmedHost: string | null = null): FetchAuthSeams & { asked: string[]; forgotten: string[] } {
  const asked: string[] = [];
  const forgotten: string[] = [];
  return {
    asked,
    forgotten,
    confirmedHost: () => confirmedHost,
    helper: `!${rtHelper}`,
    tokenFor: async (remote) => {
      asked.push(remote);
      return token;
    },
    forget: (remote) => {
      forgotten.push(remote);
    },
  };
}

const readLog = (): string => {
  try {
    return readFileSync(helperLog, "utf8");
  } catch {
    return "";
  }
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-fetch-auth-")));
  process.env.HOME = root;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  // A logging helper stands in for Apple git's system osxkeychain: it must never see rt's token.
  helperLog = join(root, "helper.log");
  const logger = join(root, "logger.sh");
  writeFileSync(logger, `#!/bin/sh\necho "$1 $(cat | tr '\\n' ' ')" >> '${helperLog}'\n`);
  chmodSync(logger, 0o755);
  const globalConfig = join(root, "global.gitconfig");
  writeFileSync(globalConfig, `[credential]\n\thelper = ${logger}\n`);
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  // Stands in for `rt git credential`: it reads the token from rt's store at call time, never from git's env.
  rtHelper = join(root, "rt-helper.sh");
  writeFileSync(rtHelper, `#!/bin/sh\ntest "$1" = get || exit 0\ncat >/dev/null\necho username=x-access-token\necho password=tok_rt\n`);
  chmodSync(rtHelper, 0o755);
  repo = join(root, "repo");
  git(root, "init", "-q", "-b", "main", repo);
});

afterEach(() => {
  for (const [k, v] of Object.entries(origEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

function credential(auth: { env: Record<string, string> }, sub: "fill" | "approve", input: string): string {
  return spawnSync("git", ["credential", sub], {
    cwd: repo,
    env: { ...process.env, ...auth.env },
    input,
    encoding: "utf8",
  }).stdout;
}

describe("originFetchAuth", () => {
  test("an https origin on a forge rt holds a token for gets rt's helper, and only rt's helper answers", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const s = seams("tok_rt");
    const auth = await originFetchAuth(repo, s);
    expect(s.asked).toEqual(["https://github.com/acme/app.git"]);
    expect(credential(auth!, "fill", "protocol=https\nhost=github.com\n\n")).toContain("password=tok_rt");
    expect(readLog()).toBe("");
  });

  test("the token reaches git only through the helper: no env value carries it", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const auth = await originFetchAuth(repo, seams("tok_rt"));
    expect(Object.values(auth!.env).filter((v) => v.includes("tok_rt"))).toEqual([]);
    expect(Object.keys(auth!.env).filter((k) => k.startsWith("RT_GIT_"))).toEqual([]);
  });

  test("rt's helper is the only one for the origin host, after any GIT_CONFIG pairs already in the env", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const saved = { count: process.env.GIT_CONFIG_COUNT, k: process.env.GIT_CONFIG_KEY_0, v: process.env.GIT_CONFIG_VALUE_0 };
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "core.quotepath";
    process.env.GIT_CONFIG_VALUE_0 = "false";
    try {
      const auth = await originFetchAuth(repo, seams("tok_rt"));
      expect(auth!.env).toMatchObject({
        GIT_CONFIG_COUNT: "3",
        GIT_CONFIG_KEY_0: "core.quotepath",
        GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
        GIT_CONFIG_VALUE_1: "",
        GIT_CONFIG_KEY_2: "credential.https://github.com.helper",
        GIT_CONFIG_VALUE_2: `!${rtHelper}`,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
      });
    } finally {
      for (const [k, v] of [["GIT_CONFIG_COUNT", saved.count], ["GIT_CONFIG_KEY_0", saved.k], ["GIT_CONFIG_VALUE_0", saved.v]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test("a helper named in GIT_CONFIG_PARAMETERS would come after rt's, so nothing is offered", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const saved = process.env.GIT_CONFIG_PARAMETERS;
    process.env.GIT_CONFIG_PARAMETERS = "'credential.helper'='store'";
    try {
      expect(await originFetchAuth(repo, seams("tok_rt"))).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.GIT_CONFIG_PARAMETERS;
      else process.env.GIT_CONFIG_PARAMETERS = saved;
    }
  });

  test("the default helper runs rt's CLI entry, never the daemon's, as `git credential`", () => {
    const helper = poolCredentialHelper();
    expect(helper.startsWith("!")).toBe(true);
    expect(helper.endsWith(" git credential")).toBe(true);
    expect(helper).toContain("cli.ts");
    expect(helper).not.toContain("daemon.ts");
  });

  test("git's store after a successful auth never reaches the user's helpers", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const auth = await originFetchAuth(repo, seams("tok_rt"));
    credential(auth!, "approve", "protocol=https\nhost=github.com\nusername=x-access-token\npassword=tok_rt\n\n");
    expect(readLog()).not.toContain("tok_rt");
  });

  test("another host (a submodule, a redirect) never gets the token", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const auth = await originFetchAuth(repo, seams("tok_rt"));
    expect(credential(auth!, "fill", "protocol=https\nhost=gitlab.com\n\n")).not.toContain("tok_rt");
  });

  test.each([
    ["scp-style ssh", "git@github.com:acme/app.git"],
    ["ssh url", "ssh://git@github.com/acme/app.git"],
    ["cleartext http", "http://github.com/acme/app.git"],
  ])("a %s origin is left to the user's own transport, and no token is read", async (_label, url) => {
    git(repo, "remote", "add", "origin", url);
    const s = seams("tok_rt");
    expect(await originFetchAuth(repo, s)).toBeNull();
    expect(s.asked).toEqual([]);
  });

  test("a local path origin gets nothing", async () => {
    git(repo, "remote", "add", "origin", join(root, "elsewhere"));
    expect(await originFetchAuth(repo, seams("tok_rt"))).toBeNull();
  });

  test("the token is withheld from a host the user never confirmed", async () => {
    git(repo, "remote", "add", "origin", "https://gitlab.evil.example/acme/app.git");
    const s = seams("tok_rt");
    expect(await originFetchAuth(repo, s)).toBeNull();
    expect(s.asked).toEqual([]);
  });

  test("the user-confirmed self-hosted forge gets the token", async () => {
    git(repo, "remote", "add", "origin", "https://gitlab.corp.example/acme/app.git");
    expect(await originFetchAuth(repo, seams("tok_rt", "gitlab.corp.example"))).not.toBeNull();
  });

  test("a push is judged by the push URL: an https pushurl on an unconfirmed host gets nothing", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    git(repo, "config", "remote.origin.pushurl", "https://gitlab.evil.example/acme/app.git");
    const s = seams("tok_rt");
    expect(await originFetchAuth(repo, s, { push: true })).toBeNull();
    expect(s.asked).toEqual([]);
    expect(await originFetchAuth(repo, s)).not.toBeNull();
  });

  test("no token held: plain fetch", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    expect(await originFetchAuth(repo, seams(null))).toBeNull();
  });

  test("no origin at all: plain fetch", async () => {
    expect(await originFetchAuth(repo, seams("tok_rt"))).toBeNull();
  });

  test("under bun test the default lookups are off, so no suite reads the real settings, sops or keychain", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    expect(process.env.RT_POOL_FORGE_TOKEN).toBe("off");
    expect(await originFetchAuth(repo)).toBeNull();
  });
});

describe("runGitOrigin", () => {
  function upstreamWithCommit(): string {
    const upstream = join(root, "upstream");
    git(root, "init", "-q", "-b", "main", upstream);
    writeFileSync(join(upstream, "a.txt"), "a");
    git(upstream, "add", ".");
    git(upstream, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
    return upstream;
  }

  test("fetches from a file remote exactly as runGit would, reading no token", async () => {
    const upstream = upstreamWithCommit();
    git(repo, "remote", "add", "origin", `file://${upstream}`);
    const s = seams("tok_rt");
    const r = await runGitOrigin(repo, ["fetch", "origin", "main"], { auth: s });
    expect(r.exitCode).toBe(0);
    expect(git(repo, "rev-parse", "origin/main")).toBe(git(upstream, "rev-parse", "HEAD"));
    expect(s.asked).toEqual([]);
  });

  test("an https origin that fetches fine on the user's own setup never reads rt's token", async () => {
    const upstream = upstreamWithCommit();
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    git(repo, "config", `url.file://${upstream}.insteadOf`, "https://github.com/acme/app.git");
    const s = seams("tok_rt");
    expect((await runGitOrigin(repo, ["fetch", "origin", "main"], { auth: s })).exitCode).toBe(0);
    expect(s.asked).toEqual([]);
  });

  const AUTH_FAIL: GitResult = { stdout: "", stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n", exitCode: 128 };
  const OK: GitResult = { stdout: "", stderr: "", exitCode: 0 };

  function scripted(results: GitResult[]) {
    const calls: { args: string[]; env?: Record<string, string> }[] = [];
    const run = async (_cwd: string, args: string[], opts: { env?: Record<string, string> } = {}) => {
      calls.push({ args, env: opts.env });
      return results.shift()!;
    };
    return { calls, run };
  }

  test("only an auth failure retries, through rt's helper, with no token in argv or env", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const s = seams("tok_rt");
    const { calls, run } = scripted([AUTH_FAIL, OK]);
    const r = await runGitOrigin(repo, ["fetch", "origin", "main"], { auth: s, run });
    expect(r.exitCode).toBe(0);
    expect(calls[0]!.args).toEqual(["fetch", "origin", "main"]);
    expect(calls[0]!.env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(calls[1]!.args).toEqual(["fetch", "origin", "main"]);
    const env = calls[1]!.env!;
    const count = Number(env.GIT_CONFIG_COUNT);
    expect([env[`GIT_CONFIG_KEY_${count - 1}`], env[`GIT_CONFIG_VALUE_${count - 1}`]]).toEqual(["credential.https://github.com.helper", `!${rtHelper}`]);
    expect(Object.values(env).filter((v) => v.includes("tok_rt"))).toEqual([]);
  });

  test("the retry fetches for real through rt's helper", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const { calls, run } = scripted([AUTH_FAIL, OK]);
    await runGitOrigin(repo, ["fetch", "origin", "main"], { auth: seams("tok_rt"), run });
    expect(credential({ env: calls[1]!.env! }, "fill", "protocol=https\nhost=github.com\n\n")).toContain("password=tok_rt");
    expect(readLog()).toBe("");
  });

  test("a non-auth failure (network, missing ref) is returned as is, reading no token", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const s = seams("tok_rt");
    const { calls, run } = scripted([{ stdout: "", stderr: "fatal: couldn't find remote ref nope\n", exitCode: 128 }]);
    const r = await runGitOrigin(repo, ["fetch", "origin", "nope"], { auth: s, run });
    expect(r.exitCode).toBe(128);
    expect(calls).toHaveLength(1);
    expect(s.asked).toEqual([]);
  });

  test("a token the forge rejects is forgotten, so the next attempt rereads the store", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const s = seams("tok_stale");
    const { run } = scripted([AUTH_FAIL, { ...AUTH_FAIL, stderr: "remote: HTTP Basic: Access denied\nfatal: Authentication failed\n" }]);
    const r = await runGitOrigin(repo, ["fetch", "origin", "main"], { auth: s, run });
    expect(r.exitCode).toBe(128);
    expect(s.forgotten).toEqual(["https://github.com/acme/app.git"]);
  });
});
