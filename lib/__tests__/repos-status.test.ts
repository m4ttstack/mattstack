import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { reposStatus, statusBlocks } from "../../commands/repos.ts";
import * as ui from "../ui/out.ts";
import { renderPlain } from "../ui/out-plain.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

const origExit = process.exit;
let io: ReturnType<typeof captureOut>;

beforeEach(() => {
  io = captureOut();
  ui.__test__.setHuman(() => false);
  (process as any).exit = (code: number) => {
    throw new Error(`exit ${code}`);
  };
});

afterEach(() => {
  io.restore();
  (process as any).exit = origExit;
});

const worktree = {
  worktree: "/Users/sample/widgets", branch: "main", detached: false,
  staged: 0, unstaged: 3, untracked: 1, conflicted: 0, clean: false,
  ahead: 1, behind: 0, upstream: "origin/main",
  lastFetchedAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:01:00.000Z",
};
const row = { repo: "remote:forge.example.test%2Facme%2Fwidgets", worktrees: [worktree], error: null };

describe("rt repos status", () => {
  test("--json prints the daemon data verbatim in the plain envelope", async () => {
    await reposStatus(["--json"], {
      query: async () => ({ ok: true, data: { repos: [row], sweptAt: "2026-09-17T00:01:00.000Z" } }) as any,
    });
    expect(io.stdout()).toBe(`${JSON.stringify({ ok: true, repos: [row], sweptAt: "2026-09-17T00:01:00.000Z" })}\n`);
    expect(io.stderr()).toBe("");
  });

  test("--refresh forwards refresh: true with a generous timeout", async () => {
    let sent: any = null;
    let timeout: any = null;
    await reposStatus(["--json", "--refresh"], {
      query: async (_cmd, payload, timeoutMs) => {
        sent = payload;
        timeout = timeoutMs;
        return { ok: true, data: { repos: [], sweptAt: null } } as any;
      },
    });
    expect(sent).toEqual({ refresh: true });
    expect(timeout).toBe(120_000);
  });

  test("daemon down fails with the plain JSON error and exit 1", async () => {
    await expect(reposStatus(["--json"], { query: async () => null })).rejects.toThrow("exit 1");
    expect(io.stdout()).toBe(`${JSON.stringify({ ok: false, error: "daemon unavailable, the rt daemon must be running for repo status" })}\n`);
    expect(io.stderr()).toBe("");
  });

  test("daemon down, for a person: one failure with the command to start it, exit 1", async () => {
    await expect(reposStatus([], { query: async () => null })).rejects.toThrow("exit 1");
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("The rt daemon is not running\n  why: Repo status comes from the daemon.\n  next: rt daemon start\n");
  });

  test("a daemon error, for a person, carries the daemon's reason as the hint", async () => {
    await expect(reposStatus([], { query: async () => ({ ok: false, error: "sweep crashed" }) as any })).rejects.toThrow("exit 1");
    expect(io.stderr()).toBe("rt could not read your repos' status  sweep crashed\n");
  });

  test("each repo is a tree of its worktrees: branch, what changed, where it stands, where it lives", async () => {
    await reposStatus([], { query: async () => ({ ok: true, data: { repos: [row], sweptAt: null } }) as any });
    expect(io.stdout()).toBe("acme/widgets\n  - main  3 unstaged, 1 untracked  ahead 1  /Users/sample/widgets\n");
  });

  test("a clean worktree, a detached one and a repo the sweep could not read", () => {
    const text = renderPlain(
      statusBlocks([
        { repo: "remote:forge.example.test%2Facme%2Fwidgets", worktrees: [{ ...worktree, unstaged: 0, untracked: 0, clean: true, ahead: 0, branch: null as unknown as string, detached: true }], error: "git status timed out" },
      ]),
    );
    expect(text).toBe("acme/widgets\n  - (detached)  clean    /Users/sample/widgets\n[warning] rt could not check acme/widgets  git status timed out\n");
  });

  test("no rows yet says so and names the refresh", () => {
    expect(renderPlain(statusBlocks([]))).toBe("[not yet] No repo status yet  rt checks your repos shortly after it starts\n  next: rt repos status --refresh\n");
  });

  test("a branch name with a right-to-left override prints without it", () => {
    const hostile = `main${String.fromCodePoint(0x202e)}evil`;
    const text = renderPlain(statusBlocks([{ repo: "remote:forge.example.test%2Facme%2Fwidgets", worktrees: [{ ...worktree, branch: hostile, unstaged: 0, untracked: 0, clean: true, ahead: 0 }], error: null }]));
    expect(text).toContain("  - mainevil  clean");
    expect(text).not.toContain(String.fromCodePoint(0x202e));
  });
});
