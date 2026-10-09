import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallerContext, NativeSessionRef, Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { worktreeToolDefs } from "../../mcp/worktree-tools.ts";
import type { ToolContext } from "../../mcp/shared.ts";
import { openStateDb } from "../../state/db.ts";
import { setKvValue } from "../../state/kv-blob.ts";
import { claudeHookCaller } from "../claude/worktrees.ts";
import { codexWorktreeLifecycle } from "../codex/worktrees.ts";
import { createSessionStore } from "../session-store.ts";
import {
  applyWorktreeEvent, claimWorktree, currentWorktree, provisionWorktree, resumeWorktreeAccess, worktreeLifecycle,
  type ManagedTree, type WorktreeDeps,
} from "../worktrees.ts";

let dir = "";
let db: Database;
let origHome: string | undefined;
let trees: ManagedTree[] = [];
let disposeCount = 0;
let disposeResult: () => Outcome<void> = () => ({ ok: true, data: undefined });

beforeEach(() => {
  origHome = process.env.HOME;
  dir = mkdtempSync(join(tmpdir(), "agent-worktrees-"));
  process.env.HOME = join(dir, "home");
  db = openStateDb(join(dir, "state.db"));
  trees = [
    { repoName: "remote:example%2Fr", name: "fred", path: "/pool/r/fred", kind: "ephemeral", state: "claimed", claimedAt: "2026-10-09T01:00:00.000Z" },
    { repoName: "remote:example%2Fr", name: "wilma", path: "/pool/r/wilma", kind: "ephemeral", state: "claimed", claimedAt: "2026-10-09T01:05:00.000Z" },
    { repoName: "remote:example%2Fr", name: "barney", path: "/pool/r/barney", kind: "ephemeral", state: "on-deck" },
  ];
  disposeCount = 0;
  disposeResult = () => ({ ok: true, data: undefined });
});

afterEach(() => {
  db.close();
  process.env.HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

function deps(over: Partial<WorktreeDeps> = {}): WorktreeDeps {
  return {
    db,
    findTree: (path) => trees.find((t) => t.path === path) ?? null,
    findTreeByName: (repoName, name) => trees.find((t) => t.repoName === repoName && t.name === name) ?? null,
    dispose: async (tree) => {
      disposeCount += 1;
      await Bun.sleep(1);
      const r = disposeResult();
      if (r.ok) trees = trees.filter((t) => t.path !== tree.path);
      return r;
    },
    provision: async () => {
      const t = trees.find((x) => x.state === "on-deck");
      if (!t) return { ok: false, error: { code: "refused", message: "pool empty" } };
      t.state = "claimed";
      t.claimedAt = "2026-10-09T02:00:00.000Z";
      return { ok: true, data: { tree: t.name, path: t.path } };
    },
    ...over,
  };
}

const claude = (value: string): NativeSessionRef => ({ harness: "claude", profile: "default", kind: "id", value });
const codex = (value: string): NativeSessionRef => ({ harness: "codex", profile: "default", kind: "id", value });

function bind(identity: string, native: NativeSessionRef, attemptId?: string): SessionBinding {
  const store = createSessionStore(db);
  const r = store.bind(store.reserve({ identity, ...(attemptId && { attemptId }) }), native, { mode: "herdr", pane: `w1:${identity}` });
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

const ctx = (binding: SessionBinding): CallerContext => ({ binding });

function claimed(context: CallerContext, path: string, readRoots: string[] = []) {
  const r = claimWorktree(context, path, { readRoots }, deps());
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

describe("applyWorktreeEvent", () => {
  test("foreign worktree event refuses", async () => {
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    const other = ctx(bind("ola.cd34", codex("thread-9"), "att-2"));
    claimed(other, "/pool/r/wilma");

    const foreign = await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps());
    expect(foreign.ok).toBe(false);
    for (const kind of ["enter", "relocate"] as const) {
      expect((await applyWorktreeEvent(mine, { kind, path: "/pool/r/fred" }, deps())).ok).toBe(false);
    }

    for (const kind of ["enter", "relocate", "leave"] as const) {
      const claimedByAnother = await applyWorktreeEvent(mine, { kind, path: "/pool/r/wilma" }, deps());
      expect(claimedByAnother.ok).toBe(false);
      if (!claimedByAnother.ok) expect(claimedByAnother.error.code).toBe("refused");
    }
    expect(disposeCount).toBe(0);
    expect(trees.map((t) => t.name)).toEqual(["fred", "wilma", "barney"]);
  });

  test("duplicate leave does not dispose twice", async () => {
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    claimed(mine, "/pool/r/fred");

    const first = await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps());
    const second = await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps());
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(disposeCount).toBe(1);
  });

  test("two leaves racing dispose once", async () => {
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    claimed(mine, "/pool/r/fred");
    const both = await Promise.all([
      applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps()),
      applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps()),
    ]);
    expect(both.every((r) => r.ok)).toBe(true);
    expect(disposeCount).toBe(1);
  });

  test("a failed dispose keeps the tree and lets a later leave try again", async () => {
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    claimed(mine, "/pool/r/fred");
    disposeResult = () => ({ ok: false, error: { code: "refused", message: "the tree has uncommitted changes" } });
    const kept = await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps());
    expect(kept.ok).toBe(false);
    disposeResult = () => ({ ok: true, data: undefined });
    expect((await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps())).ok).toBe(true);
    expect((await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps())).ok).toBe(true);
    expect(disposeCount).toBe(2);
  });

  test("a leave marker left by a process that died stops blocking after twice the dispose timeout", async () => {
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    const holder = claimed(mine, "/pool/r/fred");
    setKvValue("agent-worktrees", holder.path, { ...holder, leavingAt: 5_000_000 }, db);
    const at = (now: number) => deps({ now: () => now });
    expect((await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, at(5_000_000 + 239_000))).ok).toBe(true);
    expect(disposeCount).toBe(0);
    expect((await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, at(5_000_000 + 241_000))).ok).toBe(true);
    expect(disposeCount).toBe(1);
  });

  test("a held tree marked disposable can still be left by its holder", async () => {
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    claimed(mine, "/pool/r/fred");
    trees[0]!.state = "disposable";
    expect((await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps())).ok).toBe(true);
    expect(disposeCount).toBe(1);
  });

  test("another attempt on the same binding is foreign", async () => {
    const store = createSessionStore(db);
    const first = bind("remy.ab12", claude("sess-1"), "att-1");
    claimed(ctx(first), "/pool/r/fred");
    const detached = store.detach(first.key, first.attachment.generation);
    if (!detached.ok) throw new Error(detached.error.message);
    const replacement = bind("remy.ab12", claude("sess-2"), "att-2");

    const r = await applyWorktreeEvent(ctx(replacement), { kind: "leave", path: "/pool/r/fred" }, deps());
    expect(r.ok).toBe(false);
    expect(disposeCount).toBe(0);
  });

  test("a re-claimed tree at the same path is no longer the old owner's", async () => {
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    claimed(mine, "/pool/r/fred");
    trees[0]!.claimedAt = "2026-10-09T03:00:00.000Z";
    const r = await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps());
    expect(r.ok).toBe(false);
    expect(disposeCount).toBe(0);
    const other = ctx(bind("ola.cd34", codex("thread-9"), "att-2"));
    expect(claimWorktree(other, "/pool/r/fred", {}, deps()).ok).toBe(true);
  });

  test("an on-deck member or a path rt does not manage cannot be claimed or entered", async () => {
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    expect(claimWorktree(mine, "/pool/r/barney", {}, deps()).ok).toBe(false);
    expect(claimWorktree(mine, "/elsewhere", {}, deps()).ok).toBe(false);
    expect((await applyWorktreeEvent(mine, { kind: "enter", path: "/elsewhere" }, deps())).ok).toBe(false);
  });

  test("leaving a path the pool does not hold disposes nothing", async () => {
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    expect((await applyWorktreeEvent(mine, { kind: "leave", path: "/repo/.claude/worktrees/spike" }, deps())).ok).toBe(true);
    claimed(mine, "/pool/r/fred");
    trees = trees.filter((t) => t.name !== "fred");
    expect((await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps())).ok).toBe(true);
    expect(currentWorktree(mine, deps())).toBeNull();
    expect(disposeCount).toBe(0);
  });

  test("claiming a tree another session holds refuses", () => {
    claimed(ctx(bind("ola.cd34", codex("thread-9"), "att-2")), "/pool/r/wilma");
    const r = claimWorktree(ctx(bind("remy.ab12", claude("sess-1"), "att-1")), "/pool/r/wilma", {}, deps());
    expect(r.ok).toBe(false);
  });

  test("enter and relocate move the caller's current worktree", async () => {
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    claimed(mine, "/pool/r/fred");
    claimed(mine, "/pool/r/wilma");
    expect(currentWorktree(mine, deps())?.path).toBe("/pool/r/wilma");
    expect((await applyWorktreeEvent(mine, { kind: "relocate", path: "/pool/r/fred" }, deps())).ok).toBe(true);
    expect(currentWorktree(mine, deps())?.path).toBe("/pool/r/fred");
    expect((await applyWorktreeEvent(mine, { kind: "enter", path: "/pool/r/wilma" }, deps())).ok).toBe(true);
    expect(currentWorktree(mine, deps())?.path).toBe("/pool/r/wilma");
    expect((await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/wilma" }, deps())).ok).toBe(true);
    expect(currentWorktree(mine, deps())).toBeNull();
  });
});

describe("resumed sessions", () => {
  test("a resumed session resolves its current worktree and required read roots", () => {
    const store = createSessionStore(db);
    const before = bind("remy.ab12", claude("sess-1"), "att-1");
    claimed(ctx(before), "/pool/r/fred", ["/home/remy/.mattstack/briefs"]);
    const detached = store.detach(before.key, before.attachment.generation);
    if (!detached.ok) throw new Error(detached.error.message);
    const resumed = bind("remy.ab12", claude("sess-1"), "att-1");
    expect(resumed.key).toBe(before.key);

    expect(currentWorktree(ctx(resumed), deps())?.path).toBe("/pool/r/fred");
    expect(resumeWorktreeAccess(resumed, "/checkout/r", deps())).toEqual({
      worktree: "/pool/r/fred", readRoots: ["/home/remy/.mattstack/briefs", "/pool/r/fred"],
    });
    expect(resumeWorktreeAccess(resumed, "/pool/r/fred", deps())).toEqual({
      worktree: "/pool/r/fred", readRoots: ["/home/remy/.mattstack/briefs"],
    });
  });

  test("a session with no worktree resumes with no extra roots", () => {
    expect(resumeWorktreeAccess(bind("remy.ab12", claude("sess-1"), "att-1"), "/checkout/r", deps())).toEqual({ readRoots: [] });
  });
});

describe("lifecycle by harness", () => {
  test("Claude reports native hooks; Codex uses rt's explicit operations", () => {
    expect(worktreeLifecycle("claude")).toBe("native");
    expect(worktreeLifecycle("codex")).toBe("explicit");
    expect(codexWorktreeLifecycle).toBe("explicit");
  });

  test("a Codex worker provisions and disposes through rt's explicit operations, once", async () => {
    const worker = ctx(bind("ola.cd34", codex("thread-9"), "att-2"));
    const provisioned = await provisionWorktree(worker, { repoName: "remote:example%2Fr", ticket: "RT-1" }, deps());
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) return;
    expect(provisioned.data.path).toBe("/pool/r/barney");
    expect(currentWorktree(worker, deps())?.path).toBe("/pool/r/barney");

    const intruder = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    expect((await applyWorktreeEvent(intruder, { kind: "leave", path: "/pool/r/barney" }, deps())).ok).toBe(false);

    expect((await applyWorktreeEvent(worker, { kind: "leave", path: "/pool/r/barney" }, deps())).ok).toBe(true);
    expect((await applyWorktreeEvent(worker, { kind: "leave", path: "/pool/r/barney" }, deps())).ok).toBe(true);
    expect(disposeCount).toBe(1);
  });
});

describe("Claude hook caller", () => {
  test("switch off, no session, or an unbound session keeps the hook's own path", () => {
    bind("remy.ab12", claude("sess-1"), "att-1");
    expect(claudeHookCaller("sess-1", {}, { db, enabled: () => false }).kind).toBe("legacy");
    expect(claudeHookCaller(undefined, {}, { db, enabled: () => true }).kind).toBe("legacy");
    expect(claudeHookCaller("sess-unbound", {}, { db, enabled: () => true }).kind).toBe("legacy");
  });

  test("a bound session resolves from the hook's own session id", () => {
    const b = bind("remy.ab12", claude("sess-1"), "att-1");
    const caller = claudeHookCaller("sess-1", {}, { db, enabled: () => true });
    expect(caller.kind).toBe("bound");
    if (caller.kind === "bound") expect(caller.context.binding.key).toBe(b.key);
  });

  test("a session id rt cannot attribute is refused rather than acting as either binding", () => {
    bind("remy.ab12", claude("sess-1"), "att-1");
    bind("ola.cd34", { ...claude("sess-1"), profile: "work" }, "att-2");
    expect(claudeHookCaller("sess-1", {}, { db, enabled: () => true }).kind).toBe("refused");
  });
});

describe("worktree tools under a bound caller", () => {
  const ID = "remote:example%2Fr";
  const as = (c: CallerContext): ToolContext => ({ caller: async () => ({ ok: true, data: c }) });

  function tools(calls: string[]) {
    const command = (async (name: string, payload: { tree?: string }) => {
      calls.push(name);
      if (name === "worktree:provision") return { ok: true, data: { tree: "barney", path: "/pool/r/barney" } };
      if (name === "worktree:dispose") return { ok: true, data: { disposed: [payload.tree], refused: [], recoverable: [] } };
      return { ok: true, data: {} };
    }) as never;
    return worktreeToolDefs({
      command,
      caller: async (c) => (c ? c.caller() : null),
      repo: async () => ({ identity: ID }),
      worktrees: () => deps(),
    });
  }
  const tool = (defs: ReturnType<typeof tools>, n: string) => defs.find((t) => t.name === n)!;

  test("worktree_provision records the tree for the calling session", async () => {
    const calls: string[] = [];
    const worker = ctx(bind("ola.cd34", codex("thread-9"), "att-2"));
    trees[2]!.state = "claimed";
    trees[2]!.claimedAt = "2026-10-09T02:00:00.000Z";
    const r = await tool(tools(calls), "worktree_provision").handler({ repoName: ID, ticket: "RT-1" }, {}, undefined, as(worker));
    expect(r.ok).toBe(true);
    expect(currentWorktree(worker, deps())?.path).toBe("/pool/r/barney");
  });

  test("worktree_dispose refuses a tree another session holds", async () => {
    const calls: string[] = [];
    claimed(ctx(bind("ola.cd34", codex("thread-9"), "att-2")), "/pool/r/wilma");
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    const r = await tool(tools(calls), "worktree_dispose").handler({ repoName: ID, tree: "wilma" }, {}, undefined, as(mine));
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test("worktree_dispose of the caller's own tree settles its record, so a later leave does not dispose again", async () => {
    const calls: string[] = [];
    const mine = ctx(bind("remy.ab12", claude("sess-1"), "att-1"));
    claimed(mine, "/pool/r/fred");
    const r = await tool(tools(calls), "worktree_dispose").handler({ repoName: ID, tree: "fred" }, {}, undefined, as(mine));
    expect(r.ok).toBe(true);
    expect((await applyWorktreeEvent(mine, { kind: "leave", path: "/pool/r/fred" }, deps())).ok).toBe(true);
    expect(disposeCount).toBe(0);
    expect(calls).toEqual(["worktree:dispose"]);
  });
});
