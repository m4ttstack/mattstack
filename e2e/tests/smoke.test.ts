import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestHome, rt } from "../harness.ts";

describe("smoke", () => {
  let home: string;
  let cleanup: () => void;

  beforeAll(() => {
    ({ path: home, cleanup } = createTestHome());
  });

  afterAll(() => cleanup());

  test("rt --version prints version string", async () => {
    const result = await rt(["--version"], { home });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^rt /);
  });

  const listedVerbs = (stdout: string) =>
    stdout.split("\n").map((line) => line.match(/^  ([a-z-]+)  /)?.[1]).filter(Boolean);

  test("rt --help lists the verbs typed by hand and leaves program verbs out", async () => {
    const result = await rt(["--help"], { home });
    expect(result.exitCode).toBe(0);

    // Help is a first-class product on stdout (dispatch-level --help).
    const verbs = listedVerbs(result.stdout);
    const expectedCommands = [
      "git", "sync", "run", "glitter",
      "port", "worktree",
      "cd", "nav", "hooks",
    ];
    for (const cmd of expectedCommands) {
      expect(verbs).toContain(cmd);
    }
    for (const cmd of ["daemon", "state", "skills", "herd", "uninstall", "chat", "settings"]) {
      expect(verbs).not.toContain(cmd);
    }
  });

  test("rt --all --help lists program verbs too", async () => {
    const result = await rt(["--all", "--help"], { home });
    expect(result.exitCode).toBe(0);
    const verbs = listedVerbs(result.stdout);
    for (const cmd of ["git", "daemon", "state", "skills", "herd"]) {
      expect(verbs).toContain(cmd);
    }
  });

  test("rt git in non-TTY lists subcommands", async () => {
    const result = await rt(["git"], { home });
    expect(result.exitCode).toBe(0);

    const output = result.stderr;
    const expectedSubs = [
      "rebase", "reset", "commit",
      "backup", "restore", "pull", "push", "upstream",
    ];
    for (const sub of expectedSubs) {
      expect(output).toContain(sub);
    }
  });

  test("rt nonexistent exits non-zero with error", async () => {
    const result = await rt(["nonexistent"], { home });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown command");
  });
});
