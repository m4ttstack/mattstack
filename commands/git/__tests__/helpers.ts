import { spyOn } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { CommandContext } from "../../../lib/command-tree.ts";

export class Exit extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

/** process.exit throws Exit until restore(), so a test can read the code a handler left with. */
export function trapExit(): { restore(): void } {
  const spy = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Exit(code ?? 0);
  }) as never);
  return { restore: () => spy.mockRestore() };
}

/** The code `fn` exited with, or null when it returned. Needs trapExit(). */
export async function exitCodeOf(fn: () => Promise<unknown>): Promise<number | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof Exit) return err.code;
    throw err;
  }
}

export function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
}

/** A repo on `main` with one commit ("first commit", a.txt holding "one"), and its own identity so commits work under the test HOME. */
export function makeRepo(root: string, name = "repo"): string {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: "pipe" });
  git(repo, "config", "user.email", "sam@example.test");
  git(repo, "config", "user.name", "Sam Sample");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-qm", "first commit");
  return repo;
}

export function ctxFor(repo: string): CommandContext {
  return { identity: { repoName: "sample-app", identity: "git.example.test/sample/sample-app", repoRoot: repo, dataDir: join(repo, ".rt-data"), remoteUrl: "", baseUrl: "" } };
}

/** Runs `fn` with the process inside `dir`: the inspect and mutate verbs read process.cwd(). */
export async function inDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const before = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(before);
  }
}
