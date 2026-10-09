import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import pino from "pino";
import type { ModBlock, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import { createModLinks, TESTED_CLAUDE_CODE, type ModLinks } from "../../agent-integrations/claude/mod-links.ts";
import { createRelocationInSession } from "../../agent-integrations/claude/relocation.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { claimWorktree, currentWorktree, type ManagedTree, type WorktreeDeps } from "../../agent-integrations/worktrees.ts";
import { openStateDb } from "../../state/db.ts";
import { createWatchdogActuators } from "../herd-watchdog-adapters.ts";
import { createPaneHandlers } from "../handlers/pane.ts";
import { createRelocationHandlers } from "../handlers/relocation.ts";
import type { RelocationWatcher } from "../relocation-announce.ts";

const SID = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-2222-3333-4444-555555555555";
const PANE = "w1:p1";
const CWD = "/repo";

type Reply = { ok: boolean; data?: any; error?: string; failure?: { code: string; message: string } };
const call = (fn: (payload: never) => Promise<unknown>, payload: unknown) => fn(payload as never) as Promise<Reply>;

const TREES: Record<string, ManagedTree> = {
  "/pool/r/fred": { repoName: "remote:example%2Fr", name: "fred", path: "/pool/r/fred", kind: "ephemeral", state: "claimed", claimedAt: "2026-10-09T01:00:00.000Z" },
  "/pool/r/wilma": { repoName: "remote:example%2Fr", name: "wilma", path: "/pool/r/wilma", kind: "ephemeral", state: "claimed", claimedAt: "2026-10-09T01:05:00.000Z" },
};

function bind(db: Database, session: string, pane = PANE): SessionBinding {
  const store = createSessionStore(db);
  const bound = store.bind(store.reserve({ identity: `id-${session}` }), { harness: "claude", profile: "default", kind: "id", value: session }, { mode: "herdr", pane });
  if (!bound.ok) throw new Error(bound.error.message);
  return bound.data;
}

function setup(opts: { blocks?: ModBlock[]; bound?: boolean; autoAccept?: boolean; now?: () => number } = {}) {
  const db = openStateDb(":memory:");
  const links: ModLinks = createModLinks({ now: opts.now ?? (() => 5_000), integrationsEnabled: () => true, store: createSessionStore(db) });
  const binding = opts.bound === false ? null : bind(db, SID);
  const registered = links.register({
    sessionId: SID, cwd: CWD, root: CWD, pane: PANE, claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.2.4",
    blocks: opts.blocks ?? ["policy", "relocation"],
  });
  if (!registered.ok) throw new Error(registered.error.message);
  const worktrees: WorktreeDeps = { db, findTree: (p) => TREES[p] ?? null };
  const inSession = createRelocationInSession({ db: () => db, links: () => links, now: opts.now ?? (() => 5_000) });
  const handlers = createRelocationHandlers({ links, db, autoAccept: () => opts.autoAccept ?? true, worktrees, inSession });
  const armed: Commands["pane:announce-relocation"]["payload"][] = [];
  const watcher: RelocationWatcher = {
    announce: async (a) => {
      armed.push(a);
      return { scheduled: true, pane: PANE };
    },
  };
  const pane = createPaneHandlers({ db, repoIndex: () => ({}), relocation: watcher, relocationInSession: inSession });
  return { db, links, binding, handlers, inSession, pane, armed, worktrees, linkId: registered.data.linkId };
}

const announce = (extra: Partial<Commands["pane:announce-relocation"]["payload"]> = {}) =>
  ({ sessionId: SID, tool: "EnterWorktree" as const, cwd: CWD, path: "/pool/r/fred", ...extra });

describe("relocation answered inside the Claude session", () => {
  test("a registered path enters with no prompt and no key press", async () => {
    const { handlers, pane, armed, linkId, binding, worktrees } = setup();
    claimWorktree({ binding: binding! }, "/pool/r/fred", {}, worktrees);
    claimWorktree({ binding: binding! }, "/pool/r/wilma", {}, worktrees);

    // The mod's permit hears the path is rt's, so the prompt never paints.
    expect(await call(handlers["worktree:registered"], { linkId, sessionId: SID, path: "/pool/r/fred", cwd: CWD }))
      .toEqual({ ok: true, data: { registered: true } });
    expect(await call(handlers["worktree:registered"], { linkId, sessionId: SID, path: "../pool/r/fred", cwd: "/repo" }))
      .toEqual({ ok: true, data: { registered: true } });

    // The PreToolUse announce arms nothing, so no seam presses a key.
    expect(await call(pane["pane:announce-relocation"], announce())).toEqual({ ok: true, data: { scheduled: false, pane: null, reason: "mod" } });
    expect(armed).toHaveLength(0);

    // The move is recorded only once EnterWorktree has run.
    expect(currentWorktree({ binding: binding! }, worktrees)?.path).toBe("/pool/r/wilma");
    expect(await call(handlers["worktree:entered"], { linkId, sessionId: SID, path: "/pool/r/fred" }))
      .toEqual({ ok: true, data: { recorded: true } });
    expect(currentWorktree({ binding: binding! }, worktrees)?.path).toBe("/pool/r/fred");
  });

  test("an unregistered path keeps the prompt", async () => {
    const { handlers, linkId, db, worktrees } = setup();
    expect(await call(handlers["worktree:registered"], { linkId, sessionId: SID, path: "/elsewhere/wt", cwd: CWD }))
      .toEqual({ ok: true, data: { registered: false } });

    // Another session's tree is refused, so the prompt stays with the person.
    claimWorktree({ binding: bind(db, OTHER, "w1:p9") }, "/pool/r/wilma", {}, worktrees);
    const foreign = await call(handlers["worktree:registered"], { linkId, sessionId: SID, path: "/pool/r/wilma", cwd: CWD });
    expect(foreign.failure?.code).toBe("refused");
    expect(await call(handlers["worktree:entered"], { linkId, sessionId: SID, path: "/pool/r/wilma" }))
      .toEqual({ ok: true, data: { recorded: false, reason: expect.stringContaining("not held by this session") } });

    // Auto-accept off, an unbound session, a link without the block, or another session's link: refused.
    const off = setup({ autoAccept: false });
    expect((await call(off.handlers["worktree:registered"], { linkId: off.linkId, sessionId: SID, path: "/pool/r/fred", cwd: CWD })).failure?.code).toBe("refused");
    const unbound = setup({ bound: false });
    expect((await call(unbound.handlers["worktree:registered"], { linkId: unbound.linkId, sessionId: SID, path: "/pool/r/fred", cwd: CWD })).failure?.code).toBe("refused");
    const noBlock = setup({ blocks: ["policy"] });
    expect((await call(noBlock.handlers["worktree:registered"], { linkId: noBlock.linkId, sessionId: SID, path: "/pool/r/fred", cwd: CWD })).failure?.code).toBe("refused");
    expect((await call(handlers["worktree:registered"], { linkId, sessionId: OTHER, path: "/pool/r/fred", cwd: CWD })).failure?.code).toBe("refused");
    expect((await call(handlers["worktree:registered"], { linkId: "ml-missing", sessionId: SID, path: "/pool/r/fred", cwd: CWD })).failure?.code).toBe("unknown-link");
  });

  test("worktree verbs validate their payloads", async () => {
    const { handlers, linkId } = setup();
    for (const bad of [undefined, {}, { linkId, sessionId: SID }, { linkId, sessionId: SID, path: "" , cwd: CWD }, { linkId, sessionId: SID, path: "x", cwd: "relative" }]) {
      expect((await call(handlers["worktree:registered"], bad)).failure?.code).toBe("invalid");
    }
    for (const bad of [undefined, { linkId, sessionId: SID }, { linkId, sessionId: SID, path: "relative" }]) {
      expect((await call(handlers["worktree:entered"], bad)).failure?.code).toBe("invalid");
    }
  });

  test("the seams stand down only for sessions with the block live", async () => {
    let now = 5_000;
    const live = setup({ now: () => now });
    expect(live.inSession.answers({ sessionId: SID })).toBe(true);
    expect(live.inSession.answers({ paneRef: PANE })).toBe(true);
    expect(live.inSession.answers({ paneRef: "w1:p2" })).toBe(false);

    // A name-mode create announce keeps today's handling for its window.
    expect(await call(live.pane["pane:announce-relocation"], announce({ origin: "create" }))).toEqual({ ok: true, data: { scheduled: true, pane: PANE } });
    expect(live.armed).toHaveLength(1);
    expect(live.inSession.answers({ sessionId: SID })).toBe(false);
    expect(live.inSession.answers({ paneRef: PANE })).toBe(false);
    now += 9_000;
    expect(live.inSession.answers({ paneRef: PANE })).toBe(true);

    // Without the block, or unbound, every seam keeps working as today.
    for (const other of [setup({ blocks: ["policy"] }), setup({ bound: false })]) {
      expect(other.inSession.answers({ sessionId: SID })).toBe(false);
      expect(other.inSession.answers({ paneRef: PANE })).toBe(false);
      expect(await call(other.pane["pane:announce-relocation"], announce())).toEqual({ ok: true, data: { scheduled: true, pane: PANE } });
      expect(other.armed).toHaveLength(1);
    }

  });

  test("the watchdog and reconciler stand down only once the mod has asked about the session", async () => {
    let now = 5_000;
    const live = setup({ now: () => now });
    const herdr: string[] = [];
    const act = createWatchdogActuators({
      herdStore: { setJobStatus: () => {} }, db: live.db, socketFor: () => "/tmp/h.sock", log: pino({ level: "silent" }),
      herdr: (async (_sock: unknown, method: string) => {
        herdr.push(method);
        throw new Error("no herdr in this test");
      }) as never,
      relocationInMod: (pane) => live.inSession.answered({ paneRef: pane }),
    });

    // Block live but no worktree:registered answer recorded (lost or slow): the watchdog drives as today.
    expect(live.inSession.answered({ paneRef: PANE })).toBe(false);
    await act.acceptRelocationModal("h1", "j1", PANE);
    expect(herdr.length).toBeGreaterThan(0);

    // A recorded answer, whatever it said, keeps the seams down for its window.
    for (const path of ["/pool/r/fred", "/elsewhere/wt"]) {
      now += 21_000;
      live.links.heartbeat(live.linkId);
      expect(live.inSession.answered({ paneRef: PANE })).toBe(false);
      await call(live.handlers["worktree:registered"], { linkId: live.linkId, sessionId: SID, path, cwd: CWD });
      expect(live.inSession.answered({ paneRef: PANE })).toBe(true);
      expect(live.inSession.answered({ sessionId: SID })).toBe(true);
      herdr.length = 0;
      expect(await act.acceptRelocationModal("h1", "j1", PANE)).toBe(false);
      expect(herdr).toHaveLength(0);
    }
    now += 21_000;
    live.links.heartbeat(live.linkId);
    claimWorktree({ binding: bind(live.db, OTHER, "w1:p9") }, "/pool/r/wilma", {}, live.worktrees);
    expect((await call(live.handlers["worktree:registered"], { linkId: live.linkId, sessionId: SID, path: "/pool/r/wilma", cwd: CWD })).failure?.code).toBe("refused");
    expect(live.inSession.answered({ paneRef: PANE })).toBe(true);
    now += 21_000;
    expect(live.inSession.answered({ paneRef: PANE })).toBe(false);

    // A refusal before the question (auto-accept off) records nothing.
    const off = setup({ autoAccept: false });
    await call(off.handlers["worktree:registered"], { linkId: off.linkId, sessionId: SID, path: "/pool/r/fred", cwd: CWD });
    expect(off.inSession.answered({ sessionId: SID })).toBe(false);
  });

  test("a create announce is noted even with no watcher to arm", async () => {
    const db = openStateDb(":memory:");
    const links = createModLinks({ now: () => 5_000, integrationsEnabled: () => true, store: createSessionStore(db) });
    bind(db, SID);
    links.register({ sessionId: SID, cwd: CWD, root: CWD, pane: PANE, claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.2.4", blocks: ["relocation"] });
    const inSession = createRelocationInSession({ db: () => db, links: () => links, now: () => 5_000 });
    const pane = createPaneHandlers({ db, repoIndex: () => ({}), relocationInSession: inSession });
    expect(inSession.answers({ sessionId: SID })).toBe(true);
    expect(await call(pane["pane:announce-relocation"], announce({ origin: "create" }))).toEqual({ ok: true, data: { scheduled: false, pane: null, reason: "disabled" } });
    expect(inSession.answers({ sessionId: SID })).toBe(false);
  });
});
