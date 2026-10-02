import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { rebaseOnto, type RebaseResult } from "../../commands/git/rebase.ts";
import type { HerdrRunner } from "../agent-herdr.ts";
import * as out from "../ui/out.ts";
import { renderPlain } from "../ui/out-plain.ts";
import { captureOut, type CapturedOut } from "../ui/__tests__/capture-out.ts";
import {
  buildConflictBundle,
  renderAgentTask,
  manualReport,
  resolveEscalationMode,
  runEscalationFlow,
  verifyRebaseCompleted,
  writeTaskFile,
} from "../rebase-escalation.ts";

let tmpRoot: string;
let savedSyncLogPath: string | undefined;

beforeEach(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-escalation-")));
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

async function pausedConflict(repo: string): Promise<RebaseResult> {
  return rebaseOnto({
    cwd: repo,
    target: "master",
    skipFetch: true,
    quiet: true,
    onConflict: "pause",
  });
}

describe("buildConflictBundle", () => {
  test("reads branch commits from the branch ref, not detached HEAD", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);
    const bundle = buildConflictBundle(result, repo);

    expect(bundle.kind).toBe("rebase-conflict");
    expect(bundle.state).toBe("mid-rebase");
    expect(bundle.branch).toBe("feature");
    expect(bundle.target).toBe("master");
    expect(bundle.unresolvedFiles).toEqual(["app.txt"]);
    // Mid-rebase HEAD is detached on the target side; the branch ref must
    // still yield the branch's own commit, and only that commit.
    expect(bundle.branchCommits).toHaveLength(1);
    expect(bundle.branchCommits[0]).toContain("feature edit");
    expect(bundle.targetCommits).toHaveLength(1);
    expect(bundle.targetCommits[0]).toContain("master edit");
    expect(bundle.backupBranch).toStartWith("rt-backup/rebase/feature/");
  });
});

describe("renderAgentTask", () => {
  test("contains the worktree, files, both intents, and the safety rules", async () => {
    const repo = makeConflictRepo();
    const bundle = buildConflictBundle(await pausedConflict(repo), repo);
    const task = renderAgentTask(bundle, repo);

    expect(task).toContain(repo);
    expect(task).toContain("app.txt");
    expect(task).toContain("feature edit");
    expect(task).toContain("master edit");
    expect(task).toContain("git rebase --continue");
    expect(task).toContain("Do NOT push");
    expect(task).toContain(bundle.backupBranch!);
  });
});

describe("manualReport", () => {
  test("says the rebase is paused and names both ways out, leaving the files to the paused line above it", async () => {
    const repo = makeConflictRepo();
    const bundle = buildConflictBundle(await pausedConflict(repo), repo);
    const lines = renderPlain(manualReport(bundle)).split("\n");
    expect(lines[0]).toBe("[needs you] The rebase of feature onto master is paused  1 file to resolve");
    expect(lines[1]).toBe("  next: Fix the files, then run git add <files> and git rebase --continue");
    expect(lines[2]).toBe("  note: To give up instead, run git rebase --abort");
    expect(lines[3]).toBe(`        Your branch as it was: ${bundle.backupBranch}`);
    expect(lines[4]).toBe("        rt did not push. When the rebase is done, run git push --force-with-lease origin feature");
    expect(lines).not.toContain("app.txt");
  });

  test("with no backup the note leaves that line out", () => {
    const text = renderPlain(manualReport({ kind: "rebase-conflict", state: "mid-rebase", branch: "feature", target: "origin/main", commitsBehind: 2, unresolvedFiles: ["a.ts", "b.ts"], autoResolvedFiles: [], backupBranch: null, branchCommits: [], targetCommits: [], hint: "" }));
    expect(text).toStartWith("[needs you] The rebase of feature onto origin/main is paused  2 files to resolve\n  next: ");
    expect(text).not.toContain("Your branch as it was");
  });
});

describe("writeTaskFile", () => {
  test("writes under <dataDir>/agent-tasks and returns the path", () => {
    const dataDir = join(tmpRoot, "data");
    const path = writeTaskFile(dataDir, "task body");
    expect(path).toStartWith(join(dataDir, "agent-tasks"));
    expect(path).toEndWith(".md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("task body");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dataDir, "agent-tasks")).mode & 0o777).toBe(0o700);
  });
});

describe("verifyRebaseCompleted", () => {
  test("still-in-progress while the rebase is paused", async () => {
    const repo = makeConflictRepo();
    await pausedConflict(repo);
    expect(verifyRebaseCompleted(repo, "feature", "master")).toBe("still-in-progress");
  });

  test("completed after conflicts are resolved and the rebase continues", async () => {
    const repo = makeConflictRepo();
    await pausedConflict(repo);
    writeFileSync(join(repo, "app.txt"), "merged change\n");
    sh("git add app.txt", repo);
    sh("GIT_EDITOR=true git -c user.email=t@t -c user.name=t rebase --continue", repo);
    expect(verifyRebaseCompleted(repo, "feature", "master")).toBe("completed");
  });

  test("agent-aborted when the rebase was aborted (clean tree, target not ancestor)", async () => {
    const repo = makeConflictRepo();
    await pausedConflict(repo);
    sh("git rebase --abort", repo);
    expect(verifyRebaseCompleted(repo, "feature", "master")).toBe("agent-aborted");
  });

  test("dirty when the tree has uncommitted changes after the rebase", async () => {
    const repo = makeConflictRepo();
    await pausedConflict(repo);
    sh("git rebase --abort", repo);
    writeFileSync(join(repo, "junk.txt"), "leftover\n");
    sh("git add junk.txt", repo);
    expect(verifyRebaseCompleted(repo, "feature", "master")).toBe("dirty");
  });

  // Spawns a full conflicted rebase (many git processes) — bun's default 5s
  // per-test timeout is over the line when the whole suite runs concurrently.
  test("wrong-branch when the agent switched branches", async () => {
    const repo = makeConflictRepo();
    await pausedConflict(repo);
    sh("git rebase --abort", repo);
    sh("git checkout -q master", repo);
    expect(verifyRebaseCompleted(repo, "feature", "master")).toBe("wrong-branch");
  }, 20_000);
});

describe("resolveEscalationMode", () => {
  test("--json wins regardless of TTY", () => {
    expect(resolveEscalationMode(["--json"], true)).toBe("json");
    expect(resolveEscalationMode(["--json"], false)).toBe("json");
  });

  test("non-TTY without --json is off (historic behavior preserved)", () => {
    expect(resolveEscalationMode([], false)).toBe("off");
  });

  test("--no-agent forces off even on a TTY", () => {
    expect(resolveEscalationMode(["--no-agent"], true)).toBe("off");
  });

  test("interactive on a TTY by default", () => {
    expect(resolveEscalationMode([], true)).toBe("interactive");
    expect(resolveEscalationMode(["--agent"], true)).toBe("interactive");
  });
});

function scriptedHerdr(
  overrides: Record<string, { stdout: string; exitCode?: number }> = {},
): { calls: string[][]; runner: HerdrRunner } {
  const calls: string[][] = [];
  const responses: Record<string, { stdout: string; exitCode?: number }> = {
    "workspace list": { stdout: JSON.stringify({ result: { workspaces: [] } }) },
    "workspace create": {
      stdout: JSON.stringify({ result: { root_pane: { pane_id: "p1", tab_id: "t1", workspace_id: "w1" } } }),
    },
    ...overrides,
  };
  const runner: HerdrRunner = async (args) => {
    calls.push(args);
    const r = responses[args.slice(0, 2).join(" ")] ?? { stdout: "" };
    return { stdout: r.stdout, exitCode: r.exitCode ?? 0 };
  };
  return { calls, runner };
}

describe("runEscalationFlow (agent path)", () => {
  let io: CapturedOut;
  beforeEach(() => {
    io = captureOut({ console: true });
    out.__test__.reset();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
  });

  // Regression coverage for the herdr-agent.ts migration: the old driver
  // emitted the removed `wait agent-status` verb, so every agent-path
  // assertion below pins the current `agent wait --until` verb instead.
  test("agent resolves the conflict: launches via herdr, waits, verifies from git state", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);
    writeFileSync(join(repo, "app.txt"), "merged change\n");
    sh("git add app.txt", repo);
    sh("GIT_EDITOR=true git -c user.email=t@t -c user.name=t rebase --continue", repo);

    const { calls, runner } = scriptedHerdr();
    const code = await runEscalationFlow({
      cwd: repo,
      dataDir: join(tmpRoot, "data"),
      repoName: "myrepo",
      result,
      mode: "interactive",
      autoYes: true,
      push: false,
      herdrRunner: runner,
    });

    expect(code).toBe(0);
    expect(calls.some((c) => c[0] === "wait" && c[1] === "agent-status")).toBe(false);
    expect(calls.some((c) => c[0] === "agent" && c[1] === "wait")).toBe(true);
    expect(calls).toContainEqual(["agent", "wait", "p1", "--until", "idle", "--until", "done", "--timeout", "600000"]);
    expect(io.lines()).toEqual(["[running] An agent is resolving the conflicts  pane p1; Ctrl+C leaves it working", "[ok] The agent resolved the conflicts  feature is rebased"]);
    expect(io.stderr()).toBe("");
  }, 20_000);

  test("agent wait times out: reports and reads the pane, never the removed verb", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);

    const { calls, runner } = scriptedHerdr({
      "agent wait": { stdout: "", exitCode: 1 },
      "pane read": { stdout: "last pane output" },
    });
    const code = await runEscalationFlow({
      cwd: repo,
      dataDir: join(tmpRoot, "data"),
      repoName: "myrepo",
      result,
      mode: "interactive",
      autoYes: true,
      push: false,
      herdrRunner: runner,
    });

    expect(code).toBe(1);
    expect(calls.some((c) => c[0] === "wait" && c[1] === "agent-status")).toBe(false);
    expect(calls).toContainEqual(["pane", "read", "p1", "--source", "recent"]);
    expect(io.errLines()[0]).toBe("The agent did not finish in 10 minutes");
    expect(io.errLines()[1]).toBe("  why: Nothing was pushed.");
    expect(io.errLines()[2]).toBe("  Pane p1 is still open.");
    expect(io.stderr()).toEndWith("the end of the pane:\n  last pane output\n");
  }, 20_000);

  test("an existing rebase tab is focused, not waited on: no wait against an empty pane id", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);

    const { calls, runner } = scriptedHerdr({
      "workspace list": { stdout: JSON.stringify({ result: { workspaces: [{ workspace_id: "w1", label: "myrepo" }] } }) },
      "tab list": { stdout: JSON.stringify({ result: { tabs: [{ tab_id: "t9", label: "rebase feature" }] } }) },
    });
    const code = await runEscalationFlow({
      cwd: repo,
      dataDir: join(tmpRoot, "data"),
      repoName: "myrepo",
      result,
      mode: "interactive",
      autoYes: true,
      push: false,
      herdrRunner: runner,
    });

    expect(code).toBe(1);
    expect(calls.some((c) => c[0] === "tab" && c[1] === "focus")).toBe(true);
    expect(calls.some((c) => c[0] === "agent" && c[1] === "wait")).toBe(false);
    expect(calls).not.toContainEqual(["agent", "wait", "", "--until", "idle", "--until", "done", "--timeout", "600000"]);
    expect(io.stdout()).toBe("[warning] An agent is already working on feature  nothing new was started\n");
  }, 20_000);

  test("only the end of a long pane is shown", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);
    const pane = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n") + "\n\x1b[2Jlast\n";
    const { runner } = scriptedHerdr({ "agent wait": { stdout: "", exitCode: 1 }, "pane read": { stdout: pane } });
    await runEscalationFlow({ cwd: repo, dataDir: join(tmpRoot, "data"), repoName: "sample-app", result, mode: "interactive", autoYes: true, push: false, herdrRunner: runner });
    const shown = io.errLines().slice(io.errLines().indexOf("the end of the pane:") + 1);
    expect(shown).toHaveLength(40);
    expect(shown[0]).toBe("  line 462");
    expect(shown.at(-1)).toBe("  last");
    expect(io.stderr()).not.toContain("\x1b");
  }, 20_000);

  test("a pane read that throws leaves the failure title first and the exit code alone", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);
    const { runner: scripted } = scriptedHerdr({ "agent wait": { stdout: "", exitCode: 1 } });
    const runner: HerdrRunner = async (args) => {
      if (args[0] === "pane" && args[1] === "read") throw new Error("herdr socket closed");
      return scripted(args);
    };
    const code = await runEscalationFlow({ cwd: repo, dataDir: join(tmpRoot, "data"), repoName: "sample-app", result, mode: "interactive", autoYes: true, push: false, herdrRunner: runner });
    expect(code).toBe(1);
    expect(io.errLines()[0]).toBe("The agent did not finish in 10 minutes");
    expect(io.stdout() + io.stderr()).not.toContain("Could not hand this to an agent");
  }, 20_000);

  test("a herdr that fails after the choice ends with the manual report, never an abort", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);
    const runner: HerdrRunner = async (args) => {
      if (args[0] === "workspace" && args[1] === "list") return { stdout: JSON.stringify({ result: { workspaces: [] } }), exitCode: 0 };
      throw new Error("herdr socket closed");
    };
    const code = await runEscalationFlow({ cwd: repo, dataDir: join(tmpRoot, "data"), repoName: "sample-app", result, mode: "interactive", autoYes: true, push: false, herdrRunner: runner });
    expect(code).toBe(1);
    expect(io.lines()[0]).toBe("[warning] Could not hand this to an agent  herdr socket closed");
    expect(io.lines()[1]).toBe("[needs you] The rebase of feature onto master is paused  1 file to resolve");
    expect(verifyRebaseCompleted(repo, "feature", "master")).toBe("still-in-progress");
  }, 20_000);
});

describe("runEscalationFlow (--json)", () => {
  test("stdout is the conflict bundle, two-space indented, and the code is 3", async () => {
    const repo = makeConflictRepo();
    const result = await pausedConflict(repo);
    const io = captureOut({ console: true });
    out.__test__.reset();
    out.__test__.setHuman(() => false);
    try {
      const code = await runEscalationFlow({ cwd: repo, dataDir: join(tmpRoot, "data"), repoName: "sample-app", result, mode: "json", autoYes: false, push: true });
      expect(code).toBe(3);
      expect(io.stdout()).toBe(JSON.stringify(buildConflictBundle(result, repo), null, 2) + "\n");
      expect(io.stderr()).toBe("");
    } finally {
      io.restore();
    }
  }, 20_000);
});
