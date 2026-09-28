import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitStaged, amendStaged } from "../commit-ops.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}

/** Fresh repo with one commit containing tracked.txt */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-commit-ops-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@test");
  git(dir, "config", "user.name", "test");
  writeFileSync(join(dir, "tracked.txt"), "base\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  return dir;
}

/** Fresh unborn repo with no commits */
function makeUnbornRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-commit-ops-unborn-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@test");
  git(dir, "config", "user.name", "test");
  return dir;
}

describe("commitStaged", () => {
  test("commits the message verbatim: no shell expansion, quotes and newlines survive", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    git(dir, "add", "tracked.txt");

    const message = 'fix: $(touch INJECTED) `touch INJ2` "quoted" \'single\'\n\nbody line';
    const summary = commitStaged(dir, message);

    expect(existsSync(join(dir, "INJECTED"))).toBe(false);
    expect(existsSync(join(dir, "INJ2"))).toBe(false);
    expect(git(dir, "log", "--format=%B", "-1").trim()).toBe(message);
    expect(summary).toContain("fix:");
    rmSync(dir, { recursive: true, force: true });
  });

  test("throws with git's stderr when there is nothing to commit", () => {
    const dir = makeRepo();
    expect(() => commitStaged(dir, "empty")).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  test("multi-line message with blank line commits verbatim", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    git(dir, "add", "tracked.txt");

    const message = "fix: multi-line\n\nbody paragraph";
    commitStaged(dir, message);

    expect(git(dir, "log", "-1", "--format=%B").trim()).toBe(message);
    rmSync(dir, { recursive: true, force: true });
  });

  test("coAuthors option produces trailers separated by blank line", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    git(dir, "add", "tracked.txt");

    const message = "feat: new feature";
    const coAuthors = ["Alice Smith <alice@example.com>", "Bob Jones <bob@example.com>"];
    commitStaged(dir, message, { coAuthors });

    const fullLog = git(dir, "log", "-1", "--format=%B");
    expect(fullLog).toContain("feat: new feature");
    expect(fullLog).toContain("Co-Authored-By: Alice Smith <alice@example.com>");
    expect(fullLog).toContain("Co-Authored-By: Bob Jones <bob@example.com>");
    expect(fullLog).toMatch(/feat: new feature\n\nCo-Authored-By:/);
    rmSync(dir, { recursive: true, force: true });
  });

  test("amend option replaces previous commit without changing log count", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed1\n");
    git(dir, "add", "tracked.txt");
    commitStaged(dir, "first commit");

    writeFileSync(join(dir, "tracked.txt"), "changed2\n");
    git(dir, "add", "tracked.txt");
    commitStaged(dir, "amended commit", { amend: true });

    const logCount = git(dir, "log", "--oneline").trim().split("\n").length;
    expect(logCount).toBe(2);
    expect(git(dir, "log", "-1", "--format=%B").trim()).toBe("amended commit");
    rmSync(dir, { recursive: true, force: true });
  });

  test("allowEmpty option commits with clean index", () => {
    const dir = makeRepo();

    const message = "chore: empty commit";
    commitStaged(dir, message, { allowEmpty: true });

    expect(git(dir, "log", "-1", "--format=%B").trim()).toBe("chore: empty commit");
    rmSync(dir, { recursive: true, force: true });
  });

  test("noVerify option commits despite pre-commit hook that exits 1", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    git(dir, "add", "tracked.txt");

    const hooksDir = join(dir, ".git", "hooks");
    const preCommitHook = join(hooksDir, "pre-commit");
    writeFileSync(preCommitHook, "#!/bin/sh\nexit 1\n");
    chmodSync(preCommitHook, 0o755);

    const message = "feat: with no-verify";

    // Assert that commit without noVerify throws
    expect(() => commitStaged(dir, message)).toThrow();

    // Assert that commit with noVerify succeeds
    const summary = commitStaged(dir, message, { noVerify: true });
    expect(summary).toContain("feat: with no-verify");
    expect(git(dir, "log", "-1", "--format=%B").trim()).toBe("feat: with no-verify");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("amendStaged", () => {
  test("amend without a message keeps the original message", () => {
    const cwd = makeUnbornRepo();
    writeFileSync(join(cwd, "a.txt"), "one\n");
    git(cwd, "add", ".");
    commitStaged(cwd, "original message");
    writeFileSync(join(cwd, "a.txt"), "two\n");
    git(cwd, "add", ".");
    amendStaged(cwd);
    const msg = git(cwd, "log", "-1", "--format=%s").trim();
    expect(msg).toBe("original message");
    const count = git(cwd, "rev-list", "--count", "HEAD").trim();
    expect(count).toBe("1");
    rmSync(cwd, { recursive: true, force: true });
  });

  test("amend with a message replaces it", () => {
    const cwd = makeUnbornRepo();
    writeFileSync(join(cwd, "a.txt"), "one\n");
    git(cwd, "add", ".");
    commitStaged(cwd, "original message");
    amendStaged(cwd, { message: "rewritten" });
    const msg = git(cwd, "log", "-1", "--format=%s").trim();
    expect(msg).toBe("rewritten");
    rmSync(cwd, { recursive: true, force: true });
  });
});
