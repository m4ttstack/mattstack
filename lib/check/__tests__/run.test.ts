import { describe, expect, test } from "bun:test";
import type { GitRunner } from "../../mcp/git-tools.ts";
import type { RunResult } from "../../subprocess.ts";
import { readConfig, runCheck, treeState, type RunDeps } from "../run.ts";

type Script = Record<string, { code?: number; stdout?: string }>;

function fakeGit(script: Script = {}, calls: string[] = []): GitRunner {
  const base: Script = {
    "rev-parse --verify HEAD": { stdout: "abc123\n" },
    "symbolic-ref refs/remotes/origin/HEAD": { stdout: "refs/remotes/origin/main\n" },
    "merge-base HEAD origin/main": { stdout: "base456\n" },
    "status --porcelain": { stdout: "" },
  };
  const all = { ...base, ...script };
  return async (args) => {
    const key = args.join(" ");
    calls.push(key);
    const hit = all[key] ?? { code: 1 };
    return { code: hit.code ?? 0, stdout: hit.stdout ?? "", stderr: "" };
  };
}

type ExecCall = { argv: string[]; opts: Parameters<RunDeps["exec"]>[1] };

function harness(result: Partial<RunResult> = {}, git: GitRunner = fakeGit(), setting: RunDeps["setting"] = () => ({ command: "bun x" })) {
  const execCalls: ExecCall[] = [];
  let clock = 1000;
  const deps: RunDeps = {
    git,
    setting,
    now: () => (clock += 500),
    exec: async (argv, opts) => {
      execCalls.push({ argv, opts });
      return { stdout: "", stderr: "", exitCode: 0, ...result };
    },
  };
  return { deps, execCalls };
}

describe("readConfig", () => {
  test("a missing or empty command is null", () => {
    expect(readConfig("/tmp", { setting: () => ({}) })).toBeNull();
    expect(readConfig("/tmp", { setting: () => ({ command: "" }) })).toBeNull();
  });
});

describe("runCheck", () => {
  test("an unconfigured repo is configured: false and runs nothing", async () => {
    const { deps, execCalls } = harness({}, fakeGit(), () => ({}));
    expect(await runCheck("/tree", {}, deps)).toEqual({ configured: false });
    expect(execCalls).toHaveLength(0);
  });

  test("runs the command from the tree root with the base, head, tree and full env", async () => {
    const { deps, execCalls } = harness();
    await runCheck("/tree", {}, deps);
    expect(execCalls[0]!.argv).toEqual(["/bin/sh", "-c", "bun x"]);
    expect(execCalls[0]!.opts?.cwd).toBe("/tree");
    expect(execCalls[0]!.opts?.env?.RT_CHECK_BASE).toBe("base456");
    expect(execCalls[0]!.opts?.env?.RT_CHECK_HEAD).toBe("abc123");
    expect(execCalls[0]!.opts?.env?.RT_CHECK_TREE).toBe("/tree");
    expect(execCalls[0]!.opts?.env?.RT_CHECK_FULL).toBeUndefined();
    await runCheck("/tree", { full: true }, deps);
    expect(execCalls[1]!.opts?.env?.RT_CHECK_FULL).toBe("1");
  });

  test("hands the caller's abort signal to the command's child", async () => {
    const { deps, execCalls } = harness();
    const ctrl = new AbortController();
    await runCheck("/tree", { signal: ctrl.signal }, deps);
    expect(execCalls[0]!.opts?.signal).toBe(ctrl.signal);
  });

  test("exit 0 with a summary line is green", async () => {
    const { deps } = harness({ stdout: 'noise\n{"mode":"selected","selected":95,"passed":95,"failed":0}\n' });
    const r = await runCheck("/tree", {}, deps);
    expect(r).toMatchObject({ configured: true, verdict: "green", sha: "abc123", base: "base456", dirty: false, command: "bun x", fromCache: false });
    if (r.configured) expect(r.summary.selected).toBe(95);
  });

  test("a skip summary with exit 0 is green", async () => {
    const { deps } = harness({ stdout: '{"mode":"skip"}\n' });
    const r = await runCheck("/tree", {}, deps);
    expect(r.configured && r.verdict).toBe("green");
  });

  test("exit 1 is red and carries the last 20 lines", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const { deps } = harness({ exitCode: 1, stdout: lines.join("\n") });
    const r = await runCheck("/tree", {}, deps);
    expect(r.configured && r.verdict).toBe("red");
    if (r.configured) {
      expect(r.outputTail.split("\n")).toHaveLength(20);
      expect(r.outputTail.endsWith("line 30")).toBe(true);
      expect(r.outputTail.startsWith("line 11")).toBe(true);
    }
  });

  test("a timeout is an error with its reason", async () => {
    const { deps, execCalls } = harness({ exitCode: -1, timedOut: true });
    const r = await runCheck("/tree", {}, deps);
    expect(r.configured && r.verdict).toBe("error");
    if (r.configured) expect(r).toMatchObject({ reason: "timed out after 600s", timedOutAfter: 600 });
    expect(execCalls[0]!.opts?.timeoutMs).toBe(600_000);
  });

  test("a command that cannot start is an error", async () => {
    for (const exitCode of [127, -1]) {
      const { deps } = harness({ exitCode, stdout: "" });
      const r = await runCheck("/tree", {}, deps);
      expect(r.configured && r.verdict).toBe("error");
      if (r.configured) expect(r.reason).toStartWith("command could not start");
    }
  });

  test("raw stderr stays in the local reason", async () => {
    const { deps } = harness({ exitCode: 127, stderr: "sh: nope: not found\n" });
    const r = await runCheck("/tree", {}, deps);
    expect(r).toMatchObject({ verdict: "error", reason: "command could not start: sh: nope: not found" });
    expect(r).not.toHaveProperty("timedOutAfter");
  });

  test("a dirty tree gates but is not posted", async () => {
    const { deps } = harness({}, fakeGit({ "status --porcelain": { stdout: " M lib/x.ts\n" } }));
    const r = await runCheck("/tree", {}, deps);
    expect(r).toMatchObject({ configured: true, dirty: true, verdict: "green" });
  });

  test("--base overrides the merge base", async () => {
    const calls: string[] = [];
    const { deps, execCalls } = harness({}, fakeGit({}, calls));
    await runCheck("/tree", { base: "origin/feat" }, deps);
    expect(execCalls[0]!.opts?.env?.RT_CHECK_BASE).toBe("origin/feat");
    expect(calls.some((c) => c.startsWith("merge-base"))).toBe(false);
  });

  test("a failed merge base is an error and runs nothing", async () => {
    const { deps, execCalls } = harness({}, fakeGit({ "merge-base HEAD origin/main": { code: 1 } }));
    const r = await runCheck("/tree", {}, deps);
    expect(execCalls).toHaveLength(0);
    expect(r).toMatchObject({
      configured: true,
      verdict: "error",
      reason: "could not find the merge base with origin/main",
      sha: "abc123",
      base: "",
      dirty: false,
      command: "bun x",
      fromCache: false,
      summary: { mode: "exit", selected: null, passed: null, failed: null, failures: [] },
    });
  });

  test("the default branch falls back to main", async () => {
    const { deps, execCalls } = harness({}, fakeGit({ "symbolic-ref refs/remotes/origin/HEAD": { code: 1 } }));
    await runCheck("/tree", {}, deps);
    expect(execCalls[0]!.opts?.env?.RT_CHECK_BASE).toBe("base456");
  });
});

describe("treeState", () => {
  test("reads the head sha and dirtiness", async () => {
    expect(await treeState("/tree", { git: fakeGit() })).toEqual({ sha: "abc123", dirty: false });
  });
});
