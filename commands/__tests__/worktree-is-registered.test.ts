import { describe, expect, test } from "bun:test";
import { isRegisteredWorktreePath, parseHookStdin, worktreePathState } from "../worktree-hook.ts";

describe("isRegisteredWorktreePath", () => {
  const registered = new Set(["/pool/t1", "/private/pool/t2"]);
  const deps = {
    treeByPath: (p: string) => (registered.has(p) ? { repoName: "r", tree: p } : null),
    realpath: (p: string) => {
      if (p === "/gone") throw new Error("ENOENT");
      return p === "/pool/t2" ? "/private/pool/t2" : p;
    },
  };
  test("a registry tree is admitted, by its own path or its realpath", () => {
    expect(isRegisteredWorktreePath("/pool/t1", deps)).toBe(true);
    expect(isRegisteredWorktreePath("/pool/t2", deps)).toBe(true);
  });
  test("an unregistered, missing, relative or non-string path is refused", () => {
    expect(isRegisteredWorktreePath("/pool/other", deps)).toBe(false);
    expect(isRegisteredWorktreePath("/pool/t1/sub", deps)).toBe(false);
    expect(isRegisteredWorktreePath("/gone", deps)).toBe(false);
    expect(isRegisteredWorktreePath("pool/t1", deps)).toBe(false);
    expect(isRegisteredWorktreePath(undefined, deps)).toBe(false);
  });
});

describe("worktreePathState", () => {
  const deps = {
    treeByPath: (p: string) => (p === "/pool/t1" ? { repoName: "r", tree: p } : null),
    realpath: (p: string) => {
      if (p === "/gone") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      if (p === "/locked") throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      return p;
    },
  };
  test("a path that does not exist reads missing, so the mod can refuse it without asking a person", () => {
    expect(worktreePathState("/gone", deps)).toBe("missing");
  });
  test("a registry tree reads registered, and anything else that exists or cannot be read reads unregistered", () => {
    expect(worktreePathState("/pool/t1", deps)).toBe("registered");
    expect(worktreePathState("/pool/other", deps)).toBe("unregistered");
    expect(worktreePathState("/locked", deps)).toBe("unregistered");
    expect(worktreePathState("pool/t1", deps)).toBe("unregistered");
  });
});

describe("parseHookStdin", () => {
  test("WorktreeCreate carries the cwd and name", () => {
    expect(parseHookStdin(JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: "/repo", name: "rt-326", session_id: "s1" })))
      .toEqual({ event: "create", cwd: "/repo", name: "rt-326" });
  });
});
