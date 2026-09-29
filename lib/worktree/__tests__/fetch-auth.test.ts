import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { originFetchAuth, runGitOrigin, type FetchAuthSeams } from "../fetch-auth.ts";

let root: string;
let repo: string;
const origEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, HOME: process.env.HOME };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function seams(token: string | null, confirmedHost: string | null = null): FetchAuthSeams & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    confirmedHost: () => confirmedHost,
    tokenFor: async (remote) => {
      asked.push(remote);
      return token;
    },
  };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-fetch-auth-")));
  process.env.HOME = root;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
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

describe("originFetchAuth", () => {
  test("an https origin on a forge rt holds a token for gets that token through git's credential protocol", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const s = seams("tok_rt");
    const auth = await originFetchAuth(repo, s);
    expect(s.asked).toEqual(["https://github.com/acme/app.git"]);
    expect(auth).not.toBeNull();
    expect(auth!.args.join(" ")).not.toContain("tok_rt");

    const fill = spawnSync("git", [...auth!.args, "credential", "fill"], {
      cwd: repo,
      env: { ...process.env, ...auth!.env, GIT_TERMINAL_PROMPT: "0" },
      input: "protocol=https\nhost=github.com\n\n",
      encoding: "utf8",
    });
    expect(fill.stdout).toContain("password=tok_rt");
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

  test("no token held: plain fetch", async () => {
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    expect(await originFetchAuth(repo, seams(null))).toBeNull();
  });

  test("no origin at all: plain fetch", async () => {
    expect(await originFetchAuth(repo, seams("tok_rt"))).toBeNull();
  });
});

describe("runGitOrigin", () => {
  test("fetches from a file remote exactly as runGit would", async () => {
    const upstream = join(root, "upstream");
    git(root, "init", "-q", "-b", "main", upstream);
    writeFileSync(join(upstream, "a.txt"), "a");
    git(upstream, "add", ".");
    git(upstream, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
    git(repo, "remote", "add", "origin", `file://${upstream}`);

    const r = await runGitOrigin(repo, ["fetch", "origin", "main"], { auth: seams("tok_rt") });
    expect(r.exitCode).toBe(0);
    expect(git(repo, "rev-parse", "origin/main")).toBe(git(upstream, "rev-parse", "HEAD"));
  });

  test("an https origin the user rewrote with insteadOf is judged by where git really goes", async () => {
    const upstream = join(root, "upstream");
    git(root, "init", "-q", "-b", "main", upstream);
    writeFileSync(join(upstream, "a.txt"), "a");
    git(upstream, "add", ".");
    git(upstream, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    git(repo, "config", `url.file://${upstream}.insteadOf`, "https://github.com/acme/app.git");

    const s = seams("tok_rt");
    const r = await runGitOrigin(repo, ["fetch", "origin", "main"], { auth: s });
    expect(r.exitCode).toBe(0);
    expect(s.asked).toEqual([]);
  });
});
