import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { FetchAuthSeams } from "../../worktree/fetch-auth.ts";
import { runSkillsOrigin, type SpawnCapture } from "../origin-git.ts";

let repo: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd });
}

const seams: FetchAuthSeams = { confirmedHost: () => null, tokenFor: async () => "tok", forget: () => {} };

type Spawned = { argv: string[]; cwd: string | undefined; env: Record<string, string> | undefined };

function spawner(answers: { code: number; stderr: string }[]): { spawn: SpawnCapture; spawned: Spawned[] } {
  const spawned: Spawned[] = [];
  return {
    spawned,
    spawn: async (argv, cwd, env) => {
      spawned.push({ argv, cwd, env });
      const a = answers.shift() ?? { code: 0, stderr: "" };
      return { code: a.code, stdout: "", stderr: a.stderr };
    },
  };
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "rt-origin-git-")));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("runSkillsOrigin", () => {
  test("the user's own attempt runs hooks and carries no token", async () => {
    const { spawn, spawned } = spawner([{ code: 0, stderr: "" }]);

    const res = await runSkillsOrigin(["fetch"], { cwd: repo }, { auth: seams, spawn });

    expect(res.code).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.argv).toEqual(["git", "fetch"]);
    expect(spawned[0]!.env?.RT_GIT_TOKEN).toBeUndefined();
  });

  test("the token retry turns hooks off, so no hook inherits the token", async () => {
    const { spawn, spawned } = spawner([{ code: 128, stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" }, { code: 0, stderr: "" }]);

    const res = await runSkillsOrigin(["push"], { cwd: repo, push: true }, { auth: seams, spawn });

    expect(res.code).toBe(0);
    expect(spawned).toHaveLength(2);
    const retry = spawned[1]!;
    expect(retry.env?.RT_GIT_TOKEN).toBe("tok");
    expect(retry.argv.slice(0, 3)).toEqual(["git", "-c", "core.hooksPath=/dev/null"]);
    expect(retry.argv.at(-1)).toBe("push");
    expect(retry.cwd).toBe(repo);
  });

  test("a failure that is not about auth is returned without a retry", async () => {
    const { spawn, spawned } = spawner([{ code: 1, stderr: "fatal: Not possible to fast-forward, aborting." }]);

    const res = await runSkillsOrigin(["pull", "--ff-only"], { cwd: repo }, { auth: seams, spawn });

    expect(res).toEqual({ code: 1, stdout: "", stderr: "fatal: Not possible to fast-forward, aborting." });
    expect(spawned).toHaveLength(1);
  });
});
