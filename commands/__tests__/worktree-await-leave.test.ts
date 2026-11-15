import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { awaitLeaveCommand, leaveState, readLastActive, type AwaitLeaveDeps } from "../worktree-await-leave.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../../lib/worktree/registry.ts";
import { recordDepartures } from "../../lib/worktree/departures.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

const MAIN = "/repos/main";

function tree(over: Partial<TreeRecord> = {}): TreeRecord {
  return {
    name: "brisk-lantern",
    path: "/pool/brisk-lantern",
    kind: "ephemeral",
    state: "claimed",
    branch: "feature",
    createdAt: "2026-11-14T08:00:00.000Z",
    claimedAt: "2026-11-14T09:00:00.000Z",
    ...over,
  };
}

const none = { mainCheckout: MAIN, started: null, startTree: () => null, departed: () => null, lastActive: () => null };

// A resumed session: this process started at 10:00, the tree was claimed at 09:00.
const resumed = { ...none, started: "2026-11-14T10:00:00.000Z", startTree: () => "/pool/brisk-lantern" };

describe("leaveState", () => {
  test("no tree at the path reads none", () => {
    expect(leaveState({ tree: null, ...none })).toEqual({ state: "none" });
  });

  test("a tree that is not an rt ephemeral tree reads none", () => {
    for (const kind of ["main", "unmanaged", "golden"] as const) {
      expect(leaveState({ tree: tree({ kind, leaving: { why: "x", since: "2026-11-14T10:00:00.000Z" } }), ...none })).toEqual({ state: "none" });
    }
  });

  test("an unclaimed pool member is reclaimed, since a session inside it never owns it", () => {
    for (const state of ["on-deck", "creating"] as const) {
      expect(leaveState({ tree: tree({ state }), ...none })).toEqual({ state: "reclaimed", mainCheckout: MAIN });
    }
  });

  test("a resumed session that enters a newly claimed tree keeps waiting", () => {
    const input = { ...resumed, startTree: () => "/pool/other-tree", lastActive: () => "2026-11-14T08:00:00.000Z" };
    expect(leaveState({ tree: tree({ claimedAt: "2026-11-14T10:05:00.000Z" }), ...input })).toBeNull();
    expect(leaveState({ tree: tree(), ...input })).toBeNull();
  });

  test("a session that re-claims a recycled path in this run keeps waiting", () => {
    const departed = () => "2026-11-14T09:30:00.000Z";
    // Not its start tree.
    expect(leaveState({ tree: tree({ claimedAt: "2026-11-14T10:10:00.000Z" }), ...resumed, startTree: () => null, departed })).toBeNull();
    // Its start tree, but the claim began after this process started.
    expect(leaveState({ tree: tree({ claimedAt: "2026-11-14T10:10:00.000Z" }), ...resumed, departed })).toBeNull();
  });

  test("resumed into its start tree, which was re-claimed while it was away, is reclaimed", () => {
    expect(leaveState({ tree: tree(), ...resumed, lastActive: () => "2026-11-14T08:30:00.000Z" })).toEqual({ state: "reclaimed", mainCheckout: MAIN });
  });

  test("resumed into its own tree that nobody re-claimed keeps waiting", () => {
    expect(leaveState({ tree: tree(), ...resumed, lastActive: () => "2026-11-14T09:30:00.000Z" })).toBeNull();
  });

  test("no transcript, departed before the re-claim, start tree: reclaimed", () => {
    expect(leaveState({ tree: tree(), ...resumed, departed: () => "2026-11-14T08:30:00.000Z" })).toEqual({ state: "reclaimed", mainCheckout: MAIN });
  });

  test("a known last activity wins over the departure", () => {
    const input = { ...resumed, departed: () => "2026-11-14T08:30:00.000Z", lastActive: () => "2026-11-14T09:30:00.000Z" };
    expect(leaveState({ tree: tree(), ...input })).toBeNull();
  });

  test("without a start time or a start tree the ownership check never applies", () => {
    const old = { departed: () => "2026-11-14T08:30:00.000Z", lastActive: () => "2026-11-14T08:30:00.000Z" };
    expect(leaveState({ tree: tree(), ...resumed, ...old, started: null })).toBeNull();
    expect(leaveState({ tree: tree(), ...resumed, ...old, startTree: () => null })).toBeNull();
  });

  test("a departed session whose tree was not re-claimed since is leaving, not reclaimed", () => {
    const leaving = { why: "PR #1 merged", since: "2026-11-14T10:00:00.000Z" };
    expect(leaveState({ tree: tree({ leaving }), ...resumed, departed: () => "2026-11-14T09:30:00.000Z" })).toEqual({
      state: "leaving",
      why: "PR #1 merged",
      mainCheckout: MAIN,
    });
  });

  test("a leaving tree answers leaving with the reason and the main checkout", () => {
    const leaving = { why: "PR #1144 merged", since: "2026-11-14T10:00:00.000Z" };
    expect(leaveState({ tree: tree({ leaving }), ...none })).toEqual({ state: "leaving", why: "PR #1144 merged", mainCheckout: MAIN });
  });

  test("a claimed tree with no mark and no newer claim keeps waiting", () => {
    expect(leaveState({ tree: tree(), ...none })).toBeNull();
  });

  test("the transcript and the departure are read only once the ownership check applies", () => {
    let reads = 0;
    const counted = { departed: () => (reads++, null), lastActive: () => (reads++, null) };
    leaveState({ tree: null, ...resumed, ...counted });
    leaveState({ tree: tree({ state: "on-deck" }), ...resumed, ...counted });
    leaveState({ tree: tree(), ...resumed, ...counted, startTree: () => "/pool/other-tree" });
    leaveState({ tree: tree({ claimedAt: "2026-11-14T10:05:00.000Z" }), ...resumed, ...counted });
    expect(reads).toBe(0);
  });

  test("with nowhere to send the session, every answer but none gives way to none", () => {
    const leaving = { why: "x", since: "2026-11-14T10:00:00.000Z" };
    expect(leaveState({ tree: tree({ leaving }), ...none, mainCheckout: null })).toEqual({ state: "none" });
    expect(leaveState({ tree: tree({ state: "on-deck" }), ...none, mainCheckout: null })).toEqual({ state: "none" });
  });
});

describe("readLastActive", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "await-leave-transcript-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function transcript(sessionId: string, lines: unknown[]): void {
    const project = join(dir, "projects", "-some-project");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, `${sessionId}.jsonl`), lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  }

  test("reads the newest entry timestamp strictly before started", () => {
    transcript("s1", [
      { type: "user", timestamp: "2026-11-14T09:00:00.000Z" },
      { type: "assistant", timestamp: "2026-11-14T09:10:00.000Z" },
      "not json",
      { type: "summary" },
      { type: "user", timestamp: "2026-11-14T10:00:00.000Z" },
      { type: "assistant", timestamp: "2026-11-14T10:05:00.000Z" },
    ]);
    expect(readLastActive("s1", "2026-11-14T10:00:00.000Z", [dir])).toBe("2026-11-14T09:10:00.000Z");
  });

  test("reads across a chunk boundary", () => {
    const filler = "x".repeat(200_000);
    transcript("s1", [
      { type: "user", timestamp: "2026-11-14T09:00:00.000Z", filler },
      { type: "user", timestamp: "2026-11-14T11:00:00.000Z", filler },
    ]);
    expect(readLastActive("s1", "2026-11-14T10:00:00.000Z", [dir])).toBe("2026-11-14T09:00:00.000Z");
  });

  test("a transcript whose first entry is at or after started is null without reading further", () => {
    transcript("s3", [
      { type: "summary" },
      { type: "user", timestamp: "2026-11-14T10:00:00.000Z" },
      { type: "user", timestamp: "2026-11-14T09:00:00.000Z" },
    ]);
    expect(readLastActive("s3", "2026-11-14T10:00:00.000Z", [dir])).toBeNull();
  });

  test("is null when the session has no transcript or nothing before started", () => {
    expect(readLastActive("missing", "2026-11-14T10:00:00.000Z", [dir])).toBeNull();
    transcript("s2", [{ type: "user", timestamp: "2026-11-14T10:30:00.000Z" }]);
    expect(readLastActive("s2", "2026-11-14T10:00:00.000Z", [dir])).toBeNull();
  });
});

describe("awaitLeaveCommand", () => {
  const REPO = "await-leave-test-repo";
  let root: string;
  let treePath: string;
  let cap: CapturedOut;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "await-leave-")));
    treePath = join(root, "pool", "brisk-lantern");
    mkdirSync(join(treePath, "src", "deep"), { recursive: true });
    cap = captureOut();
  });
  afterEach(() => {
    cap.restore();
    saveRegistry(REPO, []);
    rmSync(root, { recursive: true, force: true });
  });

  function seed(over: Partial<TreeRecord> = {}): void {
    saveRegistry(REPO, [
      { name: "main", path: join(root, "main"), kind: "main", branch: "main", createdAt: "2026-11-14T07:00:00.000Z" },
      tree({ path: treePath, ...over }),
    ]);
  }

  const deps: Partial<AwaitLeaveDeps> = { lastActive: () => null };

  async function run(args: string[]): Promise<string[]> {
    await awaitLeaveCommand(args, undefined, deps);
    return cap.lines();
  }

  test("prints exactly one JSON line for a leaving tree", async () => {
    seed({ leaving: { why: "PR #1144 merged", since: "2026-11-14T10:00:00.000Z" } });
    const lines = await run([treePath, "--session", "s1"]);
    expect(lines).toEqual([JSON.stringify({ state: "leaving", why: "PR #1144 merged", mainCheckout: join(root, "main") })]);
    expect(cap.stderr()).toBe("");
  });

  test("a session in a subdirectory of the tree is answered for the tree", async () => {
    seed({ leaving: { why: "PR #1144 merged", since: "2026-11-14T10:00:00.000Z" } });
    const lines = await run([join(treePath, "src", "deep"), "--session", "s1"]);
    expect(lines).toEqual([JSON.stringify({ state: "leaving", why: "PR #1144 merged", mainCheckout: join(root, "main") })]);
  });

  test("a path outside every tree reads none", async () => {
    seed();
    expect(await run([root, "--session", "s1"])).toEqual(['{"state":"none"}']);
  });

  test("a session resumed into its start tree, departed before the current claim, reads reclaimed", async () => {
    seed({ claimedAt: "2026-11-14T09:00:00.000Z" });
    recordDepartures(treePath, ["s1"], "2026-11-14T08:30:00.000Z");
    const args = [treePath, "--session", "s1", "--started", "2026-11-14T10:00:00.000Z", "--start-cwd", treePath];
    expect(await run(args)).toEqual([JSON.stringify({ state: "reclaimed", mainCheckout: join(root, "main") })]);
  });

  test("a tree with no main record falls back to the git answer, and none when git has none", async () => {
    saveRegistry(REPO, [tree({ path: treePath, leaving: { why: "x", since: "2026-11-14T10:00:00.000Z" } })]);
    expect(await run([treePath, "--session", "s1"])).toEqual(['{"state":"none"}']);
  });

  test("a session resumed into its start tree that was re-claimed while it was away reads reclaimed", async () => {
    seed();
    const seen: Array<[string, string]> = [];
    await awaitLeaveCommand([treePath, "--session", "s1", "--started", "2026-11-14T10:00:00.000Z", "--start-cwd", join(treePath, "src")], undefined, {
      lastActive: (session, started) => {
        seen.push([session, started]);
        return "2026-11-14T08:00:00.000Z";
      },
    });
    expect(seen).toEqual([["s1", "2026-11-14T10:00:00.000Z"]]);
    expect(cap.lines()).toEqual([JSON.stringify({ state: "reclaimed", mainCheckout: join(root, "main") })]);
  });

  test("the transcript is read at most once per call", async () => {
    seed();
    let reads = 0;
    let polls = 0;
    await awaitLeaveCommand([treePath, "--session", "s1", "--started", "2026-11-14T10:00:00.000Z", "--start-cwd", treePath, "--timeout", "30"], undefined, {
      lastActive: () => {
        reads++;
        return "2026-11-14T09:30:00.000Z";
      },
      sleep: async () => {
        if (++polls < 3) return;
        saveRegistry(REPO, loadRegistry(REPO).map((t) => (t.kind === "ephemeral" ? { ...t, leaving: { why: "late", since: "2026-11-14T10:00:00.000Z" } } : t)));
      },
    });
    expect(polls).toBe(3);
    expect(reads).toBe(1);
    expect(cap.lines()).toEqual([JSON.stringify({ state: "leaving", why: "late", mainCheckout: join(root, "main") })]);
  });

  test("lastActive is never read for a session outside any tree or outside its start tree", async () => {
    seed();
    let reads = 0;
    const spy: Partial<AwaitLeaveDeps> = {
      lastActive: () => {
        reads++;
        return "2026-11-14T08:00:00.000Z";
      },
    };
    const started = ["--started", "2026-11-14T10:00:00.000Z"];
    await awaitLeaveCommand([root, "--session", "s1", ...started, "--start-cwd", root, "--timeout", "0"], undefined, spy);
    await awaitLeaveCommand([treePath, "--session", "s1", ...started, "--start-cwd", root, "--timeout", "0"], undefined, spy);
    await awaitLeaveCommand([treePath, "--session", "s1", ...started, "--timeout", "0"], undefined, spy);
    expect(reads).toBe(0);
    expect(cap.lines()).toEqual(['{"state":"none"}', '{"state":"timeout"}', '{"state":"timeout"}']);
  });

  test("a session that entered a tree claimed after it started keeps waiting despite an older departure", async () => {
    seed({ claimedAt: "2026-11-14T10:30:00.000Z" });
    recordDepartures(treePath, ["s1"], "2026-11-14T08:30:00.000Z");
    const args = [treePath, "--session", "s1", "--started", "2026-11-14T10:00:00.000Z", "--start-cwd", treePath, "--timeout", "0"];
    expect(await run(args)).toEqual(['{"state":"timeout"}']);
  });

  test("prints timeout when nothing happens inside --timeout", async () => {
    seed();
    const started = Date.now();
    expect(await run([treePath, "--session", "s1", "--timeout", "1"])).toEqual(['{"state":"timeout"}']);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("keeps polling and answers when the mark appears", async () => {
    seed();
    let polls = 0;
    await awaitLeaveCommand([treePath, "--session", "s1", "--timeout", "30"], undefined, {
      ...deps,
      sleep: async () => {
        polls++;
        const trees = loadRegistry(REPO);
        saveRegistry(REPO, trees.map((t) => (t.kind === "ephemeral" ? { ...t, leaving: { why: "late", since: "2026-11-14T10:00:00.000Z" } } : t)));
      },
    });
    expect(polls).toBe(1);
    expect(cap.lines()).toEqual([JSON.stringify({ state: "leaving", why: "late", mainCheckout: join(root, "main") })]);
  });

  test("a missing path or session is a usage failure with nothing on stdout", async () => {
    for (const args of [[], [treePath], ["--session", "s1"], [treePath, "--session", "s1", "--timeout", "soon"], [treePath, "--session", "s1", "--started", "yesterday"], [treePath, "--session", "s1", "--start-cwd"]]) {
      cap.clear();
      let code: number | undefined;
      const realExit = process.exit;
      process.exit = ((c?: number) => {
        code = c;
        throw new Error("exit");
      }) as typeof process.exit;
      try {
        await awaitLeaveCommand(args, undefined, deps);
      } catch {
        /* the stubbed exit */
      } finally {
        process.exit = realExit;
      }
      expect(code).toBe(2);
      expect(cap.stdout()).toBe("");
      expect(cap.stderr()).toContain("rt worktree await-leave");
    }
  });
});
