import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { describe, expect, test } from "bun:test";
import {
  attributeCwds,
  nestedExcludes,
  planWorktreeKill,
  processLabel,
  safeRealpath,
  selectKillTargets,
  type KillCandidate,
  type KillPlanInput,
} from "../worktree-process-kill.ts";

function row(pid: number, ppid: number, command: string, fullCommand: string): KillCandidate {
  return { pid, ppid, command, fullCommand };
}

test("worktree-process-kill.ts imports no sync exec", () => {
  const src = readFileSync(resolve(import.meta.dir, "..", "worktree-process-kill.ts"), "utf8");
  expect(src).not.toMatch(/from\s+["']child_process["']/);
  expect(src).not.toMatch(/\bexecSync\b/);
});

describe("selectKillTargets", () => {
  test("kills package-script chains and orphaned compilers", () => {
    const rows = [
      row(100, 1, "doppler", "/opt/homebrew/bin/doppler run -- pnpm start:lite:watch"),
      row(101, 100, "node", "/Users/x/.volta/bin/node wrap.js src/app/server-lite"),
      row(102, 1, "tsgo", "/Users/x/node_modules/.bin/tsgo --watch"),
    ];

    const targets = selectKillTargets(rows);

    expect(targets.map(t => t.pid).sort()).toEqual([100, 101, 102]);
  });

  test("keeps AI agent sessions and all their descendants", () => {
    const rows = [
      row(10, 1, "claude", "claude"),
      row(11, 10, "bash", "bash -c 'bun test'"),
      row(12, 11, "bun", "/Users/x/.bun/bin/bun test lib"),
      row(20, 1, "node", "node server.js"),
    ];

    const targets = selectKillTargets(rows);

    // claude, its shell, and the bun the shell spawned all survive;
    // the unrelated dev server does not.
    expect(targets.map(t => t.pid)).toEqual([20]);
  });

  test("recognizes AI agents launched via an interpreter", () => {
    const rows = [
      row(30, 1, "node", "/usr/local/bin/node /Users/x/.local/bin/codex"),
      row(31, 30, "rg", "rg --files"),
    ];

    const targets = selectKillTargets(rows);

    expect(targets).toEqual([]);
  });

  test("keeps shells and .app bundle processes", () => {
    const rows = [
      row(40, 1, "zsh", "/bin/zsh -il"),
      row(41, 1, "Cursor", "/Applications/Cursor.app/Contents/MacOS/Cursor"),
      row(42, 1, "node", "node dev-server.js"),
    ];

    const targets = selectKillTargets(rows);

    expect(targets.map(t => t.pid)).toEqual([42]);
  });

  test("keeps protected pids and their descendants", () => {
    const rows = [
      row(50, 1, "bun", "bun run cli.ts parking-lot park"),
      row(51, 50, "lsof", "lsof -d cwd -Fpn"),
      row(60, 1, "node", "node watcher.js"),
    ];

    const targets = selectKillTargets(rows, { protectedPids: [50] });

    expect(targets.map(t => t.pid)).toEqual([60]);
  });

  test("custom aiAgentNames extend the default protection list", () => {
    const rows = [
      row(70, 1, "my-agent", "/usr/local/bin/my-agent --serve"),
    ];

    expect(selectKillTargets(rows).map(t => t.pid)).toEqual([70]);
    expect(selectKillTargets(rows, { aiAgentNames: ["my-agent"] })).toEqual([]);
  });

  test("multiplexers, remote shells, and editors are spared", () => {
    const rows = [
      row(10, 1, "tmux", "tmux"),
      row(11, 1, "ssh", "ssh host"),
      row(12, 1, "nvim", "nvim file.ts"),
      row(13, 1, "node", "node server.js"),
    ];

    const targets = selectKillTargets(rows);

    expect(targets.map(t => t.pid)).toEqual([13]);
  });

  test("caller pid and its descendants are spared", () => {
    const rows = [
      row(100, 1, "rt", "rt worktree dispose"),
      row(101, 100, "node", "node x"),
      row(200, 1, "node", "node dev"),
    ];

    const targets = selectKillTargets(rows, { protectedPids: [100] });

    expect(targets.map(t => t.pid)).toEqual([200]);
  });
});

describe("attributeCwds", () => {
  test("keeps only cwds inside the target", () => {
    const cwdMap = new Map([
      [1, "/repo"],
      [2, "/repo/sub"],
      [3, "/repo-sibling"],
      [4, "/elsewhere"],
    ]);

    const attributed = attributeCwds("/repo", [], cwdMap);

    expect([...attributed.keys()].sort()).toEqual([1, 2]);
  });

  test("drops cwds owned by a more-specific nested exclude", () => {
    const cwdMap = new Map([
      [1, "/repo"],
      [2, "/repo/.worktrees/other"],
      [3, "/repo/.worktrees/other/src"],
      [4, "/repo/main-work"],
    ]);

    const attributed = attributeCwds("/repo", ["/repo/.worktrees/other"], cwdMap);

    expect([...attributed.keys()].sort()).toEqual([1, 4]);
  });

  test("SYMLINKED-PREFIX: target given via a symlink whose realpath differs still excludes a nested tree", () => {
    const scratch = mkdtempSync(join(tmpdir(), "rt-kill-test-"));
    const realRootRaw = join(scratch, "real-root");
    const nestedRaw = join(realRootRaw, ".worktrees", "other");
    const symlinkedHome = join(scratch, "symlinked-home");

    mkdirSync(nestedRaw, { recursive: true });
    symlinkSync(realRootRaw, symlinkedHome);

    // `scratch` itself may sit under an ambient OS symlink (macOS /var ->
    // /private/var), so resolve the raw creation paths once to get the true
    // canonical form the test compares against.
    const realRoot = safeRealpath(realRootRaw);
    const nested = safeRealpath(nestedRaw);

    // Caller passes the worktree path through the extra symlink hop;
    // safeRealpath must still land both target and exclude on the same
    // canonical prefix as the directly-resolved paths above.
    const target = safeRealpath(symlinkedHome);
    const excludes = [safeRealpath(join(symlinkedHome, ".worktrees", "other"))];
    expect(target).toBe(realRoot);
    expect(excludes[0]).toBe(nested);

    const cwdMap = new Map([
      [1, join(realRoot, "main-work")],
      [2, join(nested, "src")], // lives under the realpath'd nested tree
    ]);

    const attributed = attributeCwds(target, excludes, cwdMap);

    expect([...attributed.keys()]).toEqual([1]);
  });

  test("safeRealpath falls back to the literal path when the target doesn't exist", () => {
    const missing = "/no/such/path/rt-kill-test";
    expect(safeRealpath(missing)).toBe(missing);
  });
});

describe("nestedExcludes", () => {
  test("drops an exclude equal to the target itself", () => {
    expect(nestedExcludes("/repo", ["/repo"])).toEqual([]);
  });

  test("keeps excludes strictly nested under the target", () => {
    expect(nestedExcludes("/repo", ["/repo/sub"])).toEqual(["/repo/sub"]);
  });

  test("a target-equal exclude does not zero out attributeCwds' kill set", () => {
    const cwdMap = new Map([
      [1, "/repo"],
      [2, "/repo/sub"],
    ]);

    const excludes = nestedExcludes("/repo", ["/repo"]);
    const attributed = attributeCwds("/repo", excludes, cwdMap);

    expect([...attributed.keys()].sort()).toEqual([1, 2]);
  });
});

describe("planWorktreeKill", () => {
  const A = "/w/haldir";
  const B = "/w/shelob";

  function plan(
    table: KillCandidate[],
    cwdEntries: [number, string][],
    opts: Partial<KillPlanInput> = {},
  ) {
    return planWorktreeKill({
      target: A,
      excludes: [],
      table,
      cwds: new Map(cwdEntries),
      protectedPids: [],
      stopSessionsInside: false,
      ...opts,
    });
  }
  const pids = (r: { targets: KillCandidate[] }) => r.targets.map(t => t.pid);

  test("incident replay: a moved session's shell and children in A are spared, workload is not", () => {
    const table = [
      row(1, 0, "launchd", "/sbin/launchd"),
      row(500, 1, "herdr", "/Users/x/.local/bin/herdr server"),
      row(600, 500, "-zsh", "-zsh"),
      row(601, 600, "claude", "/Users/x/.local/bin/claude --model opus"),
      row(602, 601, ".bun", "/Users/x/.bun/bin/bun run mcp"),
      row(603, 601, ".loc", "/Users/x/.local/bin/herdr mcp"),
      row(700, 1, "node", "node vite"),
    ];
    const cwds: [number, string][] = [[600, A], [601, B], [602, A], [603, `${A}/sub`], [700, A]];
    for (const stopSessionsInside of [true, false]) {
      const result = plan(table, cwds, { stopSessionsInside });
      expect(pids(result)).toEqual([700]);
      expect(result.stoppedSessions).toEqual([]);
    }
  });

  test("a login shell with no agent is spared", () => {
    expect(pids(plan([row(600, 1, "-zsh", "-zsh")], [[600, A]]))).toEqual([]);
  });

  test("protected pid 1 does not spare unrelated workload", () => {
    const result = plan([row(700, 1, "node", "node vite")], [[700, A]], { protectedPids: [1, 999] });
    expect(pids(result)).toEqual([700]);
  });

  test("an agent inside A is stopped only with stopSessionsInside", () => {
    const table = [
      row(600, 1, "-zsh", "-zsh"),
      row(601, 600, "claude", "claude"),
      row(602, 601, "bun", "bun run mcp"),
    ];
    const cwds: [number, string][] = [[600, A], [601, A], [602, A]];

    const stopping = plan(table, cwds, { stopSessionsInside: true });
    expect(pids(stopping)).toEqual([601]);
    expect(stopping.stoppedSessions).toEqual([{ pid: 601, label: "claude", cwd: A }]);

    const sparing = plan(table, cwds, { stopSessionsInside: false });
    expect(pids(sparing)).toEqual([]);
    expect(sparing.stoppedSessions).toEqual([]);
  });

  test("an agent above a protected caller pid is spared with its family", () => {
    const table = [
      row(601, 1, "claude", "claude"),
      row(650, 601, "zsh", "zsh -c rt"),
      row(651, 650, "rt", "rt worktree dispose"),
    ];
    const result = plan(table, [[601, A], [650, A], [651, A]], {
      protectedPids: [651],
      stopSessionsInside: true,
    });
    expect(pids(result)).toEqual([]);
    expect(result.stoppedSessions).toEqual([]);
  });

  test("spare wins: an agent in A under a moved session is not stopped", () => {
    const table = [
      row(601, 1, "claude", "claude"),
      row(610, 601, "codex", "codex"),
      row(611, 610, "node", "node x"),
    ];
    const result = plan(table, [[601, B], [610, A], [611, A]], { stopSessionsInside: true });
    expect(pids(result)).toEqual([]);
    expect(result.stoppedSessions).toEqual([]);
  });

  test("an agent with unknown cwd counts as outside", () => {
    const table = [row(601, 1, "claude", "claude"), row(602, 601, "node", "node vite")];
    const result = plan(table, [[602, A]], { stopSessionsInside: true });
    expect(pids(result)).toEqual([]);
  });

  test("a ppid cycle or a missing parent does not loop", () => {
    const table = [
      row(800, 801, "node", "node a"),
      row(801, 800, "node", "node b"),
      row(802, 4242, "node", "node c"),
    ];
    const result = plan(table, [[800, A], [801, A], [802, A]]);
    expect(pids(result)).toEqual([800, 801, 802]);
  });

  test("nested excluded tree owns its processes", () => {
    const result = plan([row(700, 1, "node", "node vite")], [[700, `${A}/nested`]], {
      excludes: [`${A}/nested`],
    });
    expect(pids(result)).toEqual([]);
  });

  test("an .app bundle helper in A is spared", () => {
    const helper = row(
      720,
      1,
      "Code Helper",
      "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper --type=utility",
    );
    expect(pids(plan([helper], [[720, A]]))).toEqual([]);
  });

  test("spared binaries in A are spared", () => {
    const table = [row(730, 1, "vim", "vim README.md"), row(731, 1, "tmux", "tmux new")];
    expect(pids(plan(table, [[730, A], [731, A]]))).toEqual([]);
  });

  test("a protected caller's own descendants are spared with no agent above", () => {
    const table = [
      row(640, 1, "zsh", "zsh"),
      row(641, 640, "rt", "rt worktree dispose"),
      row(642, 641, "node", "node helper"),
    ];
    const result = plan(table, [[640, A], [641, A], [642, A]], { protectedPids: [641] });
    expect(pids(result)).toEqual([]);
  });
});

describe("processLabel", () => {
  test("labels use argv0, not the truncated comm", () => {
    expect(processLabel(row(1, 0, ".loc", "/Users/x/.local/bin/claude --x"))).toBe("claude");
    expect(processLabel(row(1, 0, "-zsh", "-zsh"))).toBe("zsh");
  });
});
