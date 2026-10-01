/**
 * The worktree CLI is the SENDER side of the identity re-key — it must
 * serialize identities into daemon payloads and reverse-resolve `--repo`
 * (name/path/identity) the same way, or the daemon's now identity-only
 * handlers silently stop matching anything this CLI sends.
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import {
  __test__ as worktreeTest,
  repoLabel,
  worktreeAdopt,
  worktreeAwaitReady,
  worktreeCreate,
  worktreeDispose,
  worktreeFreshen,
  worktreeList,
  worktreeProvision,
  worktreeReadyApprove,
  worktreeRestore,
  worktreeTriage,
} from "../worktree.ts";
import { getRepoIdentity } from "../../lib/repo.ts";
import { changeMarker, changeNoun, repoHost } from "../../lib/repo-label.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import { deriveRepoIdentity, serializeIdentity } from "../../lib/settings/identity.ts";
import type { DaemonResponse } from "../../lib/daemon-client.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { teamSettingsPath } from "../../lib/rt-paths.ts";

// mock.module mutates the live "../../lib/daemon-client.ts" namespace object
// IN PLACE, so `realDaemonClient.daemonQuery` itself becomes the mock the
// moment one is installed — restoring with `() => realDaemonClient` would
// restore the mock to itself. Capture the individual real bindings BEFORE
// any mock.module call in this file, and restore with THOSE.
const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;
const realLastQueryTimedOut = realDaemonClient.lastQueryTimedOut;
const realDaemonTest = realDaemonClient.__test__;

interface Captured {
  cmd: string;
  payload?: Record<string, unknown>;
}

function installFakeDaemon(response: DaemonResponse): Captured[] {
  const calls: Captured[] = [];
  mock.module("../../lib/daemon-client.ts", () => ({
    ...realDaemonClient,
    daemonQuery: async (cmd: string, payload?: Record<string, unknown>) => {
      calls.push({ cmd, payload });
      return response;
    },
    lastQueryTimedOut: () => false,
  }));
  return calls;
}

describe("worktree CLI identity plumbing", () => {
  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let reposRoot: string;
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-worktree-cli-home-")));
    reposRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-worktree-cli-repos-")));
    process.env.HOME = home;
    closeStateDb();
    process.chdir(home); // neutral cwd: no repo directory lives under here
    io = captureOut();
    ui.__test__.reset();
    ui.__test__.setHuman(() => false);
  });

  afterEach(() => {
    io.restore();
    realDaemonTest.resetDownWarning();
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: realDaemonQuery,
      lastQueryTimedOut: realLastQueryTimedOut,
    }));
    process.chdir(origCwd);
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
  });

  function makeGitRepo(name: string): string {
    const dir = realpathSync(mkdtempSync(join(reposRoot, `${name}-`)));
    execSync("git init -q -b main", { cwd: dir });
    return dir;
  }

  test("in-repo default sends the SERIALIZED IDENTITY to the daemon, not a bare basename", async () => {
    const repoPath = makeGitRepo("provision-repo");
    process.chdir(repoPath);
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));

    const calls = installFakeDaemon({
      ok: true,
      data: { tree: "t", path: "p", branch: "b", branchState: "new" },
    });

    await worktreeProvision(["--ticket", "RT-1", "--json"], {});

    const call = calls.find((c) => c.cmd === "worktree:provision");
    expect(call).toBeDefined();
    expect(call!.payload!.repoName).toMatch(/^(remote|path):/);
    expect(call!.payload!.repoName).toBe(identity);
    // Never the plain directory basename — that's the display name, not the key.
    expect(call!.payload!.repoName).not.toBe(basename(repoPath));
  });

  test("--repo <name> reverse-resolves to the identity for a repo registered under an identity key", async () => {
    const repoPath = makeGitRepo("named-repo");
    // Visiting the repo once (as any rt command would) is what populates the
    // identity-keyed index resolveRepoArg's name-lookup branch reads.
    process.chdir(repoPath);
    const identity = getRepoIdentity()!.identity;
    process.chdir(home); // leave the repo — --repo must do the resolving, not cwd

    const calls = installFakeDaemon({ ok: true, data: { trees: [] } });

    await worktreeList(["--repo", basename(repoPath), "--json"], {});

    const call = calls.find((c) => c.cmd === "worktree:list");
    expect(call?.payload?.repoName).toBe(identity);
  });

  test("--repo <path> derives the identity from the directory", async () => {
    const repoPath = makeGitRepo("path-repo");
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));

    const calls = installFakeDaemon({ ok: true, data: { trees: [] } });

    await worktreeList(["--repo", repoPath, "--json"], {});

    const call = calls.find((c) => c.cmd === "worktree:list");
    expect(call?.payload?.repoName).toBe(identity);
  });

  test("--repo <already-serialized-identity> passes through unchanged", async () => {
    const repoPath = makeGitRepo("identity-arg-repo");
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));

    const calls = installFakeDaemon({ ok: true, data: { trees: [] } });

    await worktreeList(["--repo", identity, "--json"], {});

    const call = calls.find((c) => c.cmd === "worktree:list");
    expect(call?.payload?.repoName).toBe(identity);
  });

  test("provision --wait sends wait:true; without the flag the payload carries no wait", async () => {
    const repoPath = makeGitRepo("provision-wait-repo");
    process.chdir(repoPath);
    const calls = installFakeDaemon({
      ok: true,
      data: { tree: "t", path: "p", branch: "b", branchState: "new" },
    });

    await worktreeProvision(["--branch", "rt-96-x", "--wait", "--json"], {});
    await worktreeProvision(["--branch", "rt-96-y", "--json"], {});

    const [withWait, withoutWait] = calls.filter((c) => c.cmd === "worktree:provision");
    expect(withWait!.payload!.wait).toBe(true);
    expect(withoutWait!.payload!.wait).toBeUndefined();
  });

  test("await-ready sends the serialized identity and tree name to worktree:await-ready", async () => {
    const repoPath = makeGitRepo("await-repo");
    process.chdir(repoPath);
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));
    const calls = installFakeDaemon({
      ok: true,
      data: { tree: "alpha", path: "p", ready: true, readyAt: "2026-09-01T00:00:00.000Z" },
    });

    await worktreeAwaitReady(["alpha", "--json"], {});

    const call = calls.find((c) => c.cmd === "worktree:await-ready");
    expect(call).toBeDefined();
    expect(call!.payload!.repoName).toBe(identity);
    expect(call!.payload!.tree).toBe("alpha");
  });

  test("await-ready reports unfinished readiness without printing an undefined step name", async () => {
    const repoPath = makeGitRepo("await-pending-repo");
    process.chdir(repoPath);
    // Not-ready with no failedStep is the still-pending case (the settle never
    // got the tree lock), not a failed step.
    installFakeDaemon({
      ok: true,
      data: { tree: "alpha", path: "p", ready: false, readyAt: null },
    });

    try {
      await worktreeAwaitReady(["alpha"], {});
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
    }

    expect(io.stdout()).toBe("[warning] Setup did not finish in alpha  you can use this worktree, but its dependencies may be out of date\n");
    expect(io.stderr()).toBe("");
  });

  test("await-ready picker carries the rt worktree await-ready in-card breadcrumb (dispatcher header stays suppressed)", async () => {
    const { installFakePick } = await import("../../lib/ui/pick-fake.ts");
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: async (cmd: string) => {
        if (cmd === "worktree:list") {
          return {
            ok: true,
            data: { trees: [{ name: "alpha", path: "/p/alpha", kind: "ephemeral", state: "claimed", branch: null, repoName: "r1" }] },
          };
        }
        return { ok: true, data: { tree: "alpha", path: "/p/alpha", ready: true, readyAt: "2026-09-01T00:00:00.000Z" } };
      },
      lastQueryTimedOut: () => false,
    }));

    const fake = installFakePick([{ kind: "result", result: { action: "select", value: "/p/alpha", query: "" } }]);
    try {
      await worktreeAwaitReady([], {});
    } finally {
      fake.restore();
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.request.breadcrumb).toEqual(["rt", "worktree", "await-ready"]);
  });

  test("an unresolvable --repo exits with a clear message instead of sending a bogus key to the daemon", async () => {
    const calls = installFakeDaemon({ ok: true, data: { trees: [] } });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeList(["--repo", "no-such-repo-anywhere", "--json"], {})).rejects.toThrow("process.exit sentinel");
      expect(calls.find((c) => c.cmd === "worktree:list")).toBeUndefined();
      expect(JSON.parse(io.stdout()).error).toContain("no-such-repo-anywhere");
      io.clear();
      await expect(worktreeList(["--repo", "no-such-repo-anywhere"], {})).rejects.toThrow("process.exit sentinel");
      expect(io.stderr()).toBe("rt does not know a repo called no-such-repo-anywhere\n  next: rt repos status\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("JSON output includes readyHeldRepos alongside trees", async () => {
    installFakeDaemon({ ok: true, data: { trees: [], readyHeldRepos: ["path:/foo"] } });
    await worktreeList(["--json"], {});
    expect(JSON.parse(io.stdout()).readyHeldRepos).toEqual(["path:/foo"]);
  });

  test("held-repo notice prints even when there are no worktrees", async () => {
    installFakeDaemon({ ok: true, data: { trees: [], readyHeldRepos: ["path:/foo"] } });
    await worktreeList([], {});

    const lines = io.lines();
    expect(lines[0]).toStartWith("[needs you] The team's setup steps are waiting for your approval  ");
    expect(lines.slice(1)).toEqual(["  next: rt worktree ready-approve <repo>", "[skipped] No worktrees"]);
  });

  test("a running-run refusal names the run and the command to stop it, on stderr", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        disposed: [],
        refused: [{ tree: "tree-a", reason: "running-run", detail: "running run run-1 at implement; rt runs abandon run-1" }],
        recoverable: [],
      },
    });
    try {
      await worktreeDispose(["tree-a"], {});
      expect(process.exitCode).toBe(1);
    } finally {
      // Bun's process.exitCode setter ignores undefined; only 0 clears it.
      process.exitCode = 0;
    }

    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("[refused] tree-a  a pipeline run is still working in it (run run-1, at implement)\n  next: rt runs abandon run-1\n");
  });

  test("a row with nothing after its branch ends at the branch", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        trees: [
          { name: "golden", path: "/nonexistent/golden", kind: "golden", state: "on-deck", branch: null, repoName: "github.com/acme/app", createdAt: "2026-09-21T00:00:00.000Z" },
        ],
      },
    });
    await worktreeList([], {});

    expect(io.stdout()).toBe("github.com/acme/app/golden  golden  (detached)\n");
  });

  test("list names why a disposable tree stayed and why a merged claim is held", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        trees: [
          { name: "beacon", path: "/nonexistent/beacon", kind: "ephemeral", state: "disposable", disposableReason: "dirty", branch: "team-step-cards", repoName: "github.com/acme/app", createdAt: "2026-09-21T00:00:00.000Z" },
          { name: "smaug", path: "/nonexistent/smaug", kind: "ephemeral", state: "claimed", heldReason: "pid 75703 (xctest) has its cwd inside", branch: "daemon-restart-truth", repoName: "github.com/acme/app", createdAt: "2026-09-21T00:00:00.000Z", mr: { iid: 361, state: "merged", title: "t" } },
          { name: "gollum", path: "/nonexistent/gollum", kind: "ephemeral", state: "claimed", heldReason: "left over from an evicted MR", branch: "recut", repoName: "github.com/acme/app", createdAt: "2026-09-21T00:00:00.000Z", mr: null },
        ],
      },
    });
    await worktreeList([], {});

    const rows = io.lines();
    expect(rows.find((l) => l.includes("/beacon "))).toContain("disposable (it has changes that are not committed)");
    expect(rows.find((l) => l.includes("/smaug "))).toContain("!361 merged");
    expect(rows.find((l) => l.includes("/smaug "))).toContain("held: pid 75703 (xctest) has its cwd inside");
    expect(rows.find((l) => l.includes("/gollum "))).not.toContain("held:");
    expect(rows.every((l) => l === l.trimEnd())).toBe(true);
  });

  test("freshen's picker offers the golden alongside on-deck members", async () => {
    const { installFakePick } = await import("../../lib/ui/pick-fake.ts");
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    installFakeDaemon({
      ok: true,
      data: {
        trees: [
          { name: "golden", path: "/g", kind: "golden", state: "on-deck", branch: null, repoName: "r1", createdAt: "2026-09-21T00:00:00.000Z" },
          { name: "lupin", path: "/l", kind: "ephemeral", state: "on-deck", branch: null, repoName: "r1", createdAt: "2026-09-21T00:00:00.000Z" },
          { name: "hedwig", path: "/h", kind: "ephemeral", state: "claimed", branch: null, repoName: "r1", createdAt: "2026-09-21T00:00:00.000Z" },
        ],
      },
    });
    const fake = installFakePick([{ kind: "result", result: { action: "cancel", value: null, query: "" } }]);
    try {
      await worktreeFreshen([], {});
    } finally {
      fake.restore();
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
    expect(fake.calls).toHaveLength(1);
    const values = fake.calls[0]!.request.rows.map((r) => r.value);
    expect(values).toContain("/g");
    expect(values).toContain("/l");
    expect(values).not.toContain("/h");
  });

  test("triage prints one line per row with its group and verdict, and --json passes the payload through", async () => {
    const row = {
      tree: "olive", path: "/x", branch: "b", mr: { iid: 47, state: "merged", title: "sync button", at: null }, ticket: null,
      push: { kind: "in-main" }, containment: "in-default", dirt: { kind: "junk", files: [".visual/a.png"] }, group: "safe",
      verdict: "Every commit is in main. Only generated files are left.", actions: ["dispose"], fingerprint: { headSha: "h", dirtHash: "d", mrState: "merged" },
    };
    const data = {
      rows: [
        { ...row, repo: `remote:${encodeURIComponent("github.com/acme/app")}` },
        { ...row, repo: `remote:${encodeURIComponent("gitlab.com/acme/kit")}`, tree: "rowan", mr: { ...row.mr, iid: 12 } },
      ],
      banners: [], counts: { needsDecision: 1, safe: 1, waiting: 0, kept: 0 },
    };
    installFakeDaemon({ ok: true, data });
    await worktreeTriage([], {});
    expect(io.lines()).toEqual([
      "1 worktree needs a decision",
      "app/olive  safe  #47 merged  Every commit is in main. Only generated files are left.",
      "kit/rowan  safe  !12 merged  Every commit is in main. Only generated files are left.",
    ]);

    io.clear();
    await worktreeTriage(["--json"], {});
    expect(JSON.parse(io.stdout()).counts.needsDecision).toBe(1);
  });
  test("provision says what was made, where its branch came from, and what is still running", async () => {
    const repoPath = makeGitRepo("provision-human");
    process.chdir(repoPath);
    installFakeDaemon({
      ok: true,
      data: { tree: "alpha", path: "/pool/alpha", branch: "feature/one", branchState: "new", wasOnDeck: true, readyPending: true, readySteps: ["install"] },
    });

    await worktreeProvision(["--branch", "feature/one"], {});

    expect(io.stdout()).toBe(
      "[ok] alpha  /pool/alpha\n" +
        "branch: feature/one\n" +
        "  a new branch, on a spare worktree rt had ready\n" +
        "[running] Still setting up in the background  install\n" +
        "  next: rt worktree await-ready alpha\n",
    );
    expect(io.stderr()).toBe("");
  });

  test("provision names held team steps and a failed step without coral", async () => {
    const repoPath = makeGitRepo("provision-held");
    process.chdir(repoPath);
    installFakeDaemon({
      ok: true,
      data: { tree: "alpha", path: "/pool/alpha", branch: "feature/one", branchState: "behind", readyHeld: true, readyFailed: true, failedStep: "install" },
    });

    await worktreeProvision(["--branch", "feature/one"], {});

    expect(io.lines().slice(2)).toEqual([
      "  a branch you already had, behind its remote",
      "[needs you] The team's setup steps are waiting for your approval",
      "  next: rt worktree ready-approve",
      "[warning] The install setup step failed  you can use this worktree, but its dependencies may be out of date",
    ]);
  });

  test("provision and restore never name an undefined setup step", async () => {
    const repoPath = makeGitRepo("provision-unnamed");
    process.chdir(repoPath);
    getRepoIdentity();
    const unfinished = "[warning] Setup did not finish  you can use this worktree, but its dependencies may be out of date";

    installFakeDaemon({ ok: true, data: { tree: "alpha", path: "/pool/alpha", branch: "feature/one", branchState: "new", readyFailed: true } });
    await worktreeProvision(["--branch", "feature/one"], {});
    expect(io.lines().at(-1)).toBe(unfinished);

    io.clear();
    installFakeDaemon({ ok: true, data: { restored: true, path: "/pool/alpha", tree: "alpha", readyFailed: true } });
    await worktreeRestore(["alpha"], {});
    expect(io.lines()).toEqual(["[ok] alpha restored  /pool/alpha", unfinished]);
  });

  test("create names the tree, and says when it was kept as a spare", async () => {
    const repoPath = makeGitRepo("create-human");
    process.chdir(repoPath);
    installFakeDaemon({ ok: true, data: { tree: "beta", path: "/pool/beta" } });

    await worktreeCreate(["--on-deck"], {});

    expect(io.stdout()).toBe("[ok] beta  /pool/beta, kept as a spare\n");
  });

  test("await-ready on a ready tree is one line on stdout", async () => {
    const repoPath = makeGitRepo("await-human");
    process.chdir(repoPath);
    installFakeDaemon({ ok: true, data: { tree: "alpha", path: "p", ready: true, readyAt: null } });

    await worktreeAwaitReady(["alpha"], {});

    expect(io.stdout()).toBe("[ok] alpha is ready  it had no setup steps\n");
  });

  test("restore keeps the word the worktree skill reads, and lists what can come back", async () => {
    const repoPath = makeGitRepo("restore-human");
    process.chdir(repoPath);
    getRepoIdentity();
    installFakeDaemon({ ok: true, data: { restored: true, path: "/pool/alpha", tree: "alpha" } });

    await worktreeRestore(["alpha"], {});
    expect(io.stdout()).toBe("[ok] alpha restored  /pool/alpha\n");

    io.clear();
    await worktreeRestore(["--list"], {});
    expect(io.stdout()).toEndWith("[skipped] Nothing to bring back\n");
  });

  test("--json with the daemon down leaves stdout empty and exits 1", async () => {
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: async () => null,
      lastQueryTimedOut: () => false,
    }));
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeList(["--json"], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("The rt daemon is not running\n  why: Worktrees are made and cleaned up by the daemon.\n  next: rt daemon start\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("the daemon being down is said once, not again by the daemon client", async () => {
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: async () => {
        // What the real client does after a failed restart.
        realDaemonTest.warnDaemonDown();
        return null;
      },
      lastQueryTimedOut: () => false,
    }));
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeList([], {})).rejects.toThrow("process.exit sentinel");
      expect(io.stderr()).toBe("The rt daemon is not running\n  why: Worktrees are made and cleaned up by the daemon.\n  next: rt daemon start\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a slow daemon is not called down", async () => {
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: async () => null,
      lastQueryTimedOut: () => true,
    }));
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeList([], {})).rejects.toThrow("process.exit sentinel");
      expect(io.stderr()).toBe("This is taking longer than rt waits for\n  why: The daemon may still be working on it.\n  next: rt worktree list\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a repo name that matches two repos says so, and names them", async () => {
    const first = makeGitRepo("twin");
    const second = makeGitRepo("twin");
    const { setKvValue } = await import("../../lib/state/index.ts");
    setKvValue("repo-index", `remote:${encodeURIComponent("git.example.com/one/twin")}`, first);
    setKvValue("repo-index", `remote:${encodeURIComponent("git.example.com/two/twin")}`, second);
    const calls = installFakeDaemon({ ok: true, data: { trees: [] } });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeList(["--repo", "twin"], {})).rejects.toThrow("process.exit sentinel");
      expect(calls.find((c) => c.cmd === "worktree:list")).toBeUndefined();
      const lines = io.errLines();
      expect(lines[0]).toBe("More than one repo is called twin");
      expect(lines[1]).toBe("  why: Use the full name of the one you mean.");
      expect(lines[2]).toStartWith("  It could be ");
      expect(lines[2]).toContain("git.example.com/one/twin");
      expect(lines[2]).toContain("git.example.com/two/twin");
      expect(lines[2]).not.toContain("remote:");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a lock another operation holds is a refusal on stderr, not a failure", async () => {
    installFakeDaemon({ ok: false, error: "busy" });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeFreshen(["alpha"], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("[refused] That worktree is busy right now  another rt operation is using it\n  next: Try again in a moment\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("ready-approve off a terminal says the steps need you, on stderr, exit 1", async () => {
    const repoPath = makeGitRepo("approve-human");
    execSync("git remote add origin git@git.example.com:sample-team/approve-human.git", { cwd: repoPath });
    process.chdir(repoPath);
    getRepoIdentity();
    const store = teamSettingsPath("sample-team");
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, JSON.stringify({ repos: { "git.example.com/sample-team/approve-human": { "rt.worktrees": { onDeck: 1, ready: [{ run: "make setup" }] } } } }));
    const wire = serializeIdentity(await deriveRepoIdentity(repoPath));
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeReadyApprove([wire], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      const lines = io.errLines();
      expect(lines[0]).toBe("[needs you] The team's setup steps for approve-human need your approval  approving needs a terminal, so rt can show you the steps first");
      expect(lines[1]).toStartWith("  next: rt worktree ready-approve ");
      expect(lines[2]).toStartWith(`  note: From a script: rt settings set rt.worktreeReadyApproval '"`);
      expect(lines).toHaveLength(3);
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a failed checkout is a failure, with git's words under it", async () => {
    installFakeDaemon({ ok: false, error: "checkout-failed:pathspec did not match" });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeFreshen(["alpha"], {})).rejects.toThrow("process.exit sentinel");
      expect(io.stderr()).toBe("The branch could not be checked out\n  pathspec did not match\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a missing tree name asks for it, with the command as the next step", async () => {
    installFakeDaemon({ ok: true, data: { trees: [] } });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeDispose([], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stderr()).toBe("Which worktree?\n  next: rt worktree dispose <tree>\n");
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a hostile branch name is printed without its hidden character", async () => {
    const hostile = "main" + String.fromCodePoint(0x202e) + "gnp.exe";
    installFakeDaemon({
      ok: true,
      data: { trees: [{ name: "alpha", path: "/nonexistent/alpha", kind: "ephemeral", state: "claimed", branch: hostile, repoName: "github.com/acme/app" }] },
    });

    await worktreeList([], {});

    expect(io.stdout()).not.toContain(String.fromCodePoint(0x202e));
    expect(io.stdout()).toContain("maingnp.exe");
  });

  test("list says when merged worktrees are not cleaned up, with the command that fixes it", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        trees: [],
        mergeCleanupOff: [{ repo: `remote:${encodeURIComponent("github.com/acme/app")}`, path: "/code/app", reason: "no-token", forge: "github" }],
      },
    });

    await worktreeList([], {});

    expect(io.lines()).toEqual([
      "[warning] Merged worktrees are not cleaned up in app  rt has no GitHub login",
      "  next: rt setup github connect --use-gh",
      "[skipped] No worktrees",
    ]);
  });

  test("triage names the same gap the way list does", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        rows: [],
        banners: [{ repo: `remote:${encodeURIComponent("gitlab.example.com/acme/kit")}`, path: "/code/kit", reason: "no-token", forge: "gitlab" }],
        counts: { needsDecision: 0 },
      },
    });

    await worktreeTriage([], {});

    expect(io.lines()).toEqual([
      "0 worktrees need a decision",
      "[warning] Merged worktrees are not cleaned up in kit  rt has no GitLab login",
      "  next: rt setup gitlab connect",
    ]);
    expect(io.stdout()).not.toContain("no-token");
  });

  test("a GitHub row marks its pull request with #, as triage does", async () => {
    installFakeDaemon({
      ok: true,
      data: {
        trees: [
          { name: "olive", path: "/nonexistent/olive", kind: "ephemeral", state: "claimed", branch: "sync-button", repoName: `remote:${encodeURIComponent("github.com/acme/app")}`, mr: { iid: 47, state: "merged", title: "t" } },
        ],
      },
    });

    await worktreeList([], {});

    expect(io.stdout()).toContain("#47 merged");
    expect(io.stdout()).not.toContain("!47");
  });

  test("dispose says how long a cleaned-up tree can be brought back, and when there was nothing to do", async () => {
    installFakeDaemon({
      ok: true,
      data: { disposed: ["tree-a"], refused: [], recoverable: [{ tree: "tree-a", path: "/trash/tree-a", until: "2026-10-08T00:00:00.000Z" }] },
    });
    await worktreeDispose(["tree-a"], {});
    expect(io.stdout()).toBe("[ok] tree-a cleaned up  you can bring it back until 2026-10-08\n");

    io.clear();
    installFakeDaemon({ ok: true, data: { disposed: [], refused: [] } });
    await worktreeDispose(["tree-a"], {});
    expect(io.stdout()).toBe("[skipped] Nothing to clean up\n");
  });

  test("freshen and adopt report each tree and a count", async () => {
    installFakeDaemon({ ok: true, data: { ran: ["lupin"] } });
    await worktreeFreshen(["lupin"], {});
    expect(io.stdout()).toBe("[ok] lupin freshened\n");

    io.clear();
    const repoPath = makeGitRepo("adopt-human");
    installFakeDaemon({ ok: true, data: { main: "main", claimed: ["alpha"], unmanaged: ["beta"], disposed: [], refused: [{ tree: "gamma", reason: "dirty" }, { tree: "delta", reason: "remove-failed" }] } });
    await worktreeAdopt(["--repo", repoPath], {});
    expect(io.lines()).toEqual([
      "[ok] alpha  now looked after by rt",
      "[skipped] beta  left alone",
      "[skipped] gamma was left as it is  it has changes that are not committed",
      "[warning] delta was left as it is  it could not be moved away, try again",
      "",
      "[ok] Adopted this repo's worktrees  1 claimed, 1 left alone, 0 cleaned up",
    ]);
    expect(io.stderr()).toBe("");
  });

  test("dispose: a guard that declines is refused on stderr, a tree that could not be moved is a failure", async () => {
    installFakeDaemon({
      ok: true,
      data: { disposed: [], refused: [{ tree: "tree-a", reason: "dirty" }, { tree: "tree-b", reason: "remove-failed" }], recoverable: [] },
    });
    try {
      await worktreeDispose(["tree-a"], {});
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
    }

    expect(io.stdout()).toBe("");
    expect(io.errLines()).toEqual([
      "[refused] tree-a  it has changes that are not committed",
      "[failed] tree-b  it could not be moved away, try again",
    ]);
  });

  test("a branch name git would read as an option is named in words, and --json keeps the daemon's value", async () => {
    const repoPath = makeGitRepo("unsafe-ref");
    process.chdir(repoPath);
    const error = "unsafe git ref (starts with '-' or empty): --upload-pack=x";
    installFakeDaemon({ ok: false, error });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeProvision(["--ticket", "T-1", "--json"], {})).rejects.toThrow("process.exit sentinel");
      expect(JSON.parse(io.stdout())).toEqual({ error });

      io.clear();
      await expect(worktreeProvision(["--ticket", "T-1"], {})).rejects.toThrow("process.exit sentinel");
      expect(io.stdout()).toBe("");
      expect(io.errLines()[0]).toBe("That is not a branch name rt can use");
      expect(io.stderr()).toContain("--upload-pack=x");
      expect(io.stderr()).not.toContain("unsafe git ref");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe("repoLabel", () => {
  test("decodes a remote identity to its trailing path segment", () => {
    expect(repoLabel("remote:gitlab.com%2Fg%2Frepo")).toBe("repo");
  });

  test("decodes a path identity to its basename", () => {
    expect(repoLabel(`path:${encodeURIComponent("/Users/matt/repo-tools")}`)).toBe("repo-tools");
  });

  test("the change marker and noun follow the identity's host, never a raw prefix", () => {
    const gh = `remote:${encodeURIComponent("github.com/m4ttstack/rt")}`;
    const gl = `remote:${encodeURIComponent("gitlab.com/m4ttstack/app-kit")}`;
    const local = `path:${encodeURIComponent("/Users/matt/scratch")}`;
    expect([repoHost(gh), changeMarker(gh), changeNoun(gh)]).toEqual(["github.com", "#", "PR"]);
    expect([repoHost(gl), changeMarker(gl), changeNoun(gl)]).toEqual(["gitlab.com", "!", "MR"]);
    expect([repoHost(local), changeMarker(local), changeNoun(local)]).toEqual([null, "!", "MR"]);
    expect(repoHost("github.com/m4ttstack/rt")).toBeNull();
  });

  test("a value that isn't a serialized identity passes through unchanged", () => {
    expect(repoLabel("not-an-identity")).toBe("not-an-identity");
  });
});

describe("copyForCode", () => {
  test("a known daemon code becomes a plain title, a why and a next", () => {
    expect(worktreeTest.copyForCode("not-found")).toEqual({
      title: "No cleaned-up worktree has that name",
      next: { text: "rt worktree restore --list", role: "command" },
    });
    expect(worktreeTest.copyForCode("tree-unknown")).toEqual({
      title: "rt has no worktree by that name",
      next: { text: "rt worktree list", role: "command" },
    });
  });

  test("rt declining by policy is a refusal with a hint, never a failure", () => {
    expect(worktreeTest.copyForCode("busy")).toEqual({
      refused: true,
      title: "That worktree is busy right now",
      hint: "another rt operation is using it",
      next: "Try again in a moment",
    });
    for (const code of ["busy", "branch-duplicated", "branch-attached:alpha", "branch-elsewhere", "path-exists"]) {
      expect(worktreeTest.copyForCode(code).refused).toBe(true);
    }
    for (const code of ["repo-unknown", "checkout-failed:x", "create-failed:install", "not-found", "no-manifest", "no-head-sha", "worktree-add-failed", "copy-failed", "register-failed", "claim-write-failed", "something-new"]) {
      expect(worktreeTest.copyForCode(code).refused).toBeUndefined();
    }
  });

  test("a code that carries a value puts the value in the sentence", () => {
    expect(worktreeTest.copyForCode("branch-attached:alpha").title).toBe("That branch is already checked out in the alpha worktree");
    expect(worktreeTest.copyForCode("create-failed:install").why).toBe("It stopped at the install step.");
    expect(worktreeTest.copyForCode("checkout-failed:pathspec did not match")).toEqual({ title: "The branch could not be checked out", details: "pathspec did not match" });
  });

  test("a failed create names its step from the first line and keeps the step's output under it", () => {
    const copy = worktreeTest.copyForCode("create-failed:install\nnpm ERR! x\nnote");
    expect(copy.why).toBe("It stopped at the install step.");
    expect(copy.details).toBe("npm ERR! x\nnote");
    expect(worktreeTest.copyForCode("create-failed:install").details).toBeUndefined();
  });

  test("a create that failed with no step named says setup did not finish", () => {
    expect(worktreeTest.copyForCode("create-failed:unknown").why).toBe("It stopped before finishing setup.");
    expect(worktreeTest.copyForCode("create-failed:unknown\nboom").details).toBe("boom");
  });

  test("an unsafe branch name is worded about the branch, never in the daemon's sentence", () => {
    const copy = worktreeTest.copyForCode("unsafe git ref (starts with '-' or empty): -x");
    expect(copy.title).toBe("That is not a branch name rt can use");
    expect(copy.why).toContain("-x");
    expect(JSON.stringify(copy)).not.toContain("unsafe git ref");
    expect(worktreeTest.copyForCode("unsafe git ref (starts with '-' or empty): ").why).toBe("The branch name is empty.");
  });

  test("an unknown code falls back to the daemon's own words", () => {
    expect(worktreeTest.copyForCode("something-new")).toEqual({ title: "something-new" });
  });
});

describe("restore --list", () => {
  let io: ReturnType<typeof captureOut>;
  beforeEach(() => {
    io = captureOut();
    ui.__test__.reset();
    ui.__test__.setHuman(() => false);
  });
  afterEach(() => io.restore());

  test("restore --list says who cleaned each worktree up, in words", () => {
    ui.print(
      worktreeTest.restorableEntriesBlock([
        { name: "alpha", path: "/t/alpha", branch: "feature/one", reason: "manual", disposedAt: "2026-09-30T10:00:00.000Z", keptUntil: "2026-10-07T10:00:00.000Z" },
        { name: "beta", path: "/t/beta", branch: null, reason: "auto", disposedAt: "2026-09-29T10:00:00.000Z", keptUntil: "2026-10-06T10:00:00.000Z" },
        { name: "gamma", path: "/t/gamma", branch: "fix/two", reason: "force", disposedAt: "2026-09-28T10:00:00.000Z", keptUntil: "2026-10-05T10:00:00.000Z" },
      ]),
    );
    expect(io.lines().map((l) => l.split(/ {2,}/))).toEqual([
      ["alpha", "feature/one", "cleaned up 2026-09-30 by you", "kept until 2026-10-07"],
      ["beta", "(detached)", "cleaned up 2026-09-29 by rt after its merge", "kept until 2026-10-06"],
      ["gamma", "fix/two", "cleaned up 2026-09-28 by you, with force", "kept until 2026-10-05"],
    ]);
  });
});

describe("disposeReason", () => {
  test("disposeReason covers every dispose code with words, never the code", () => {
    const codes = ["changed", "kind-main", "kind-golden", "kind-unmanaged", "dirty", "unpushed", "attended", "grace", "no-trash", "busy", "remove-failed", "unknown"];
    for (const code of codes) {
      const { words } = worktreeTest.disposeReason(code);
      expect(words).not.toContain(code);
      expect(words).not.toMatch(/[-_]/);
    }
    expect(worktreeTest.disposeReason("remove-failed").failed).toBe(true);
    expect(worktreeTest.disposeReason("unknown").failed).toBe(true);
    expect(worktreeTest.disposeReason("dirty").failed).toBeUndefined();
  });

  test("a running-run detail becomes the run, the stage and the command to stop it", () => {
    expect(worktreeTest.disposeReason("running-run", "running run r-7 at review; rt runs abandon r-7")).toEqual({
      words: "a pipeline run is still working in it (run r-7, at review)",
      next: { text: "rt runs abandon r-7", role: "command" },
    });
    expect(worktreeTest.disposeReason("running-run", "some other sentence").words).toBe("some other sentence");
  });

  test("an unreadable run database names the command to check by hand", () => {
    expect(worktreeTest.disposeReason("runs-unreadable", "could not verify ...")).toEqual({
      words: "rt could not check whether a pipeline run is using it",
      next: { text: "rt runs", role: "command" },
    });
  });
});

describe("the steps a person approves", () => {
  let io: ReturnType<typeof captureOut>;
  beforeEach(() => {
    io = captureOut();
    ui.__test__.reset();
    ui.__test__.setHuman(() => false);
  });
  afterEach(() => io.restore());

  test("the steps a person approves are shown one per line with escapes removed", () => {
    ui.print(
      worktreeTest.readyStepsBlock("app", "abc123", [
        { run: "pnpm install" },
        { run: "pnpm db:migrate \x1b[2Jecho hidden", when: "lockfile changed" },
      ]),
    );
    expect(io.stdout()).toBe("Setup steps the team wrote for app (hash abc123)\n  pnpm install\n  pnpm db:migrate echo hidden  (lockfile changed)\n");
  });
});
