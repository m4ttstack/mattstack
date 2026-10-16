import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, mkdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import pino from "pino";
import { createHerdStore, type HerdStore, herdSubject } from "../herd-store.ts";
import { createGatesStore, GATE_BY_PANE, type GatesStore } from "../gates-store.ts";
import { createGateHandlers } from "../handlers/gate.ts";
import { createEventsBus } from "../events-bus.ts";
import { createHerdHandlers, HERD_OPTION_LABEL_MAX, type HerdDeps } from "../handlers/herd.ts";
import { createBgClaimsStore, type BgClaimsStore } from "../bg-claims-store.ts";
import { bgSocketPath, type BgService } from "../bg-service.ts";
import { createBgHandlers } from "../handlers/bg.ts";
import { createEscapeInjector } from "../gate-escape.ts";
import type { herdrRequest } from "../../herdr/client.ts";
import { acceptTrustOnPane } from "../trust-accept.ts";
import { jobBudgets } from "../herd-budgets.ts";
import { readGithubMerge, type LaneDeps } from "../herd-lanes.ts";
import type { HerdLaneRow } from "../../../packages/rt-client/src/commands.ts";
import type { TreeRecord } from "../../worktree/registry.ts";
import { deleteChatSession, readChatSession, writeChatSession } from "../../chat-session.ts";

const log = pino({ level: "silent" });
let dirs: string[] = [];
beforeEach(() => { dirs = []; });
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const s of ["sess-w1", "sess-w2", "sess-shep", "sess-shep-2", "sess-shep-3"]) deleteChatSession(s);
});

export function harness(over: Partial<HerdDeps> = {}, trustTestBudgets: { registerBudgetMs?: number; settleMs?: number; stepMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rt-herd-h-"));
  dirs.push(dir);
  const store = createHerdStore({ dbPath: join(dir, "herds.db"), log });
  const gateStore = createGatesStore({ dbPath: join(dir, "gates.db"), log });
  const bus = createEventsBus({ dbPath: join(dir, "events.db"), log });
  const gate = createGateHandlers(gateStore, bus, () => {}, { log });
  const claims: BgClaimsStore = createBgClaimsStore({ dbPath: join(dir, "bg-claims.db"), log });
  let bgStopCalls = 0;
  const bg: BgService = {
    socketPath: () => "/tmp/hidden.sock",
    up: async () => false,
    ensure: async () => ({ socket: "/tmp/hidden.sock", started: true }),
    stop: async () => { bgStopCalls += 1; },
    reprobe: async () => ({ ok: true, drift: [] }),
    lastParity: () => null,
  };
  const chatCalls: Array<{ verb: string; payload: any }> = [];
  // One ordered log across both fakes, for the cases where what matters is
  // which call came first (chat identity before the trust wait).
  const order: string[] = [];
  const chat = {
    "chat:sign-in": async (p: any) => {
      chatCalls.push({ verb: "sign-in", payload: p });
      order.push("chat:sign-in");
      const handle = p.continue ?? p.baseHandle ?? "shepherd";
      const name = handle.replace(/\.[a-z0-9]+$/, "");
      return { ok: true as const, data: { handle, baseHandle: name, name, continued: p.continue !== undefined, reclaimed: false, sessionId: p.sessionId, room: p.room ?? null } };
    },
    "chat:sign-out": async (p: any) => { chatCalls.push({ verb: "sign-out", payload: p }); return { ok: true as const, data: { sessionId: p.sessionId } }; },
    "chat:join": async (p: any) => { chatCalls.push({ verb: "join", payload: p }); order.push("chat:join"); return { ok: true as const, data: { handle: p.handle, memberCount: 1, unread: 0 } }; },
    "chat:post": async (p: any) => { chatCalls.push({ verb: "post", payload: p }); return { ok: true as const, data: { id: chatCalls.length, recipients: p.mentions ?? [], others: 0 } }; },
    "chat:archive": async (p: any) => { chatCalls.push({ verb: "archive", payload: p }); return { ok: true as const, data: { room: p.room, archivedAt: 1 } }; },
    "chat:dm": async (p: any) => { chatCalls.push({ verb: "dm", payload: p }); return { ok: true as const, data: { room: "dm-room", id: chatCalls.length, recipients: [p.to], recipientNames: [p.to] } }; },
    // A minted herd id carries the wall clock, so the herd's own room is read
    // back off the store; the decoy row sits first so a handler that took the
    // first room instead of the herd's would read 9, not 3.
    "chat:rooms": async (p: any) => {
      chatCalls.push({ verb: "rooms", payload: p });
      const rooms = [
        { room: "herd-other-20260908-120000", unread: 9, memberCount: 2, lastActivity: 0 },
        ...store.list().map((hd) => ({ room: hd.room, unread: 3, memberCount: 2, lastActivity: 0 })),
      ];
      return { ok: true as const, data: { rooms } };
    },
  } as unknown as HerdDeps["chat"];
  const agentCalls: any[] = [];
  const herdrCalls: string[][] = [];
  // Socket-side herdr: `session.snapshot` for status, plus the trust-dialog
  // sequence. `trust` is the knob set: how many `agent.get` calls fail before
  // the agent registers, what `agent.wait` settles at, and what `pane.read`
  // hands back.
  const socketCalls: Array<{ method: string; params: any; sock: any }> = [];
  const screen = { text: "$ claude\nworking...\n" };
  // `clearOnAccept` models the real modal: the accept keys dismiss it, so the
  // verifying re-read finds it gone. A test sets it false to model a modal
  // that survives the keys (the stuck case).
  const trust = { registerFailures: 0, waitOk: true, waitStatus: "blocked", clearOnAccept: true };
  // Real herdr names the agent on every claude pane (pane:list filters on it),
  // so the fake does too: a row without it is a live shell with no claude
  // behind it, which is exactly the dead-worker case.
  const snapshotPanes: { rows: Array<Record<string, unknown>> } = { rows: [{ pane_id: "w9:p1", agent: "claude", agent_status: "working" }] };
  // Resolved before `agent`, so agent:start's own trust check (below) and
  // HerdDeps.herdr share the exact same fake: a test's `over.herdr` override
  // must reach both, the way one real herdr socket serves both real callers.
  const herdrFn = (over.herdr ?? (async (method: string, params: any, o: any) => {
    socketCalls.push({ method, params, sock: o?.sockPath ?? null });
    order.push(`herdr:${method}`);
    // Real herdr knows nothing of the bg: ref scheme -- a prefixed id is an
    // unknown target on every socket. Honest rejection here is what keeps
    // the parse-at-the-seam contract tested.
    const target = params?.target ?? params?.pane_id;
    if (typeof target === "string" && target.startsWith("bg:")) return { ok: false, code: "not_found", message: `unknown pane ${target}` };
    if (method === "session.snapshot") return { ok: true, result: { snapshot: { panes: snapshotPanes.rows } } };
    if (method === "agent.get") {
      if (trust.registerFailures > 0) { trust.registerFailures -= 1; return { ok: false, code: "not_found", message: "no agent" }; }
      return { ok: true, result: { agent: { agent_status: "working" } } };
    }
    if (method === "agent.wait") {
      return trust.waitOk ? { ok: true, result: { agent: { agent_status: trust.waitStatus } } } : { ok: false, code: "timeout", message: "still working" };
    }
    if (method === "pane.read") return { ok: true, result: { read: screen } };
    if (method === "pane.send_keys") {
      // Models the real modal rather than "any key clears it": an arrow
      // moves the cursor, and Enter accepts only whatever the cursor is on.
      // Only the first key of a batch registers, which is the live herdr
      // behavior the driver exists to work around (RT-156).
      const key = (params?.keys ?? [])[0];
      if ((key === "up" || key === "down") && screen.text === ELEVATED_TRUST) screen.text = ELEVATED_TRUST_ON_YES;
      else if (key === "enter" && trust.clearOnAccept && screen.text !== ELEVATED_TRUST) screen.text = "$ claude\n> \n";
      return { ok: true, result: {} };
    }
    return { ok: false, code: "invalid_request", message: method };
  })) as unknown as HerdDeps["herdr"];
  // Contract parity with the real agent:start (handlers/agent.ts): a spawn
  // that lands on the bg socket reports paneId as a bg: REF, never the bare
  // id -- that is what the pane column stores. The bare-id fake hid the
  // double-prefix family for a full release. RT-156 unified the trust check
  // into agent:start itself, so the fake drives it here too, against the
  // same fake herdr the socket-side assertions above already read from --
  // repointing THIS call is what keeps the trust tests exercising the real
  // path instead of a fallback herd.ts no longer has.
  const agent = {
    "agent:start": async (p: any) => {
      agentCalls.push(p);
      const barePane = "w9:p1";
      const paneId = p.herdrSocket === "/tmp/hidden.sock" ? `bg:${barePane}` : barePane;
      const trustOutcome = p.provider === "claude"
        ? await acceptTrustOnPane({
          herdr: herdrFn,
          sock: p.herdrSocket ? { sockPath: p.herdrSocket } : {},
          pane: barePane, log, context: {},
          waitBudgetMs: p.trustWaitMs ?? 3_000,
          registerBudgetMs: trustTestBudgets.registerBudgetMs ?? 2_000,
          settleMs: trustTestBudgets.settleMs ?? 5,
          stepMs: trustTestBudgets.stepMs ?? 1,
        })
        : undefined;
      return { ok: true as const, data: { id: "ag-1", sessionId: "sess-w1", paneId, tabId: "w9:t1", workspaceId: "w9", repo: p.repo, cwd: p.cwd, surface: "herdr", provider: p.provider ?? "claude", ...(trustOutcome !== undefined && { trust: trustOutcome }) } };
    },
  } as unknown as HerdDeps["agent"];
  const worktreeCalls: any[] = [];
  const worktree = {
    "worktree:provision": async (p: any) => { worktreeCalls.push({ verb: "provision", p }); return { ok: true, data: { tree: p.branch, path: `/w/${p.branch}`, branch: p.branch, wasOnDeck: false, readyAt: null, branchState: "new" } }; },
    "worktree:dispose": async (p: any) => { worktreeCalls.push({ verb: "dispose", p }); return { ok: true, data: { disposed: [p.tree], refused: [], recoverable: [] } }; },
  };
  const deps: HerdDeps = {
    store, gateStore, gate, chat, agent, worktree,
    runWorktree: () => null,
    findRunningRunByWorktree: () => ({ kind: "none" }),
    presenceIdentityForSession: () => null,
    mintWorkerId: (job: string) => `${job}.w001`,
    identityNames: (ids: Iterable<string>) => new Map([...ids].map((id) => [id, id.replace(/\.[a-z0-9]+$/, "")])),
    resolveHandle: (x: string) => x,
    herdr: herdrFn,
    herdrRunnerFor: (socket: string | null) => {
      const allHerds = store.list();
      return async (args: string[]) => {
        herdrCalls.push(args);
        // Same honesty as the socket fake: the herdr CLI takes bare pane
        // ids; a bg:-prefixed argument is an unknown pane, exit 1.
        if (args[0] === "pane" && typeof args[2] === "string" && args[2].startsWith("bg:")) return { stdout: `unknown pane ${args[2]}`, exitCode: 1 };
        if (args[0] === "workspace" && args[1] === "list") {
          const workspaces = allHerds.map((h) => ({ workspace_id: h.id, label: h.workspace }));
          return { stdout: JSON.stringify({ result: { workspaces } }), exitCode: 0 };
        }
        return { stdout: "{}", exitCode: 0 };
      };
    },
    lifecycle: { connected: () => true, watch: () => {}, sweepClaims: async () => {} },
    probeInbox: async () => "reachable",
    bg, claims,
    jobsRoot: join(dir, "herds"),
    log,
    ...over,
  };
  const h = createHerdHandlers(deps);
  return { h, deps, store, gateStore, gate, chatCalls, agentCalls, worktreeCalls, herdrCalls, socketCalls, order, screen, trust, snapshotPanes, dir, claims, bg, bgStopCalls: () => bgStopCalls };
}

const START = { name: "demo", repo: "gh:m4ttstack/rt", session: "sess-shep" };

/** The plain first-run dialog: the cursor starts on "Yes, proceed". */
const PLAIN_TRUST = [
  "│ Do you trust the files in this folder?  │",
  "│ ❯ 1. Yes, proceed                       │",
  "│   2. No, exit                           │",
].join("\n");

/** The elevated variant after one step up: the cursor sits on "Yes". */
const ELEVATED_TRUST_ON_YES = [
  "│ Do you trust the files in this folder?                     │",
  "│ This folder pre-approves 12 tool permissions in            │",
  "│ .claude/settings.local.json. Only proceed if you trust it.  │",
  "│ ❯ 1. Yes, proceed                                          │",
  "│   2. No, exit                                              │",
].join("\n");

/** The elevated variant: the cursor defaults to "No, exit". */
const ELEVATED_TRUST = [
  "│ Do you trust the files in this folder?                     │",
  "│ This folder pre-approves 12 tool permissions in            │",
  "│ .claude/settings.local.json. Only proceed if you trust it.  │",
  "│   1. Yes, proceed                                          │",
  "│ ❯ 2. No, exit                                              │",
].join("\n");

describe("herd:start", () => {
  test("mints the id, records the room and workspace, signs in, joins, subscribes", async () => {
    const { h, store, gateStore, chatCalls } = harness();
    const res = await h["herd:start"](START);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.data.herd).toMatch(/^demo-\d{8}-\d{6}$/);
    expect(res.data.room).toBe(`herd-${res.data.herd}`);
    expect(res.data.workspace).toBe(`herd: ${res.data.herd}`);
    expect(res.data.hidden).toBe(false);
    const row = store.get(res.data.herd)!;
    expect(row).toMatchObject({ shepherdSession: "sess-shep", shepherdHandle: "shepherd", herdrSocket: null, status: "active" });
    expect(chatCalls.map((c) => c.verb)).toEqual(["sign-in", "join"]);
    expect(chatCalls[0]!.payload).toMatchObject({ sessionId: "sess-shep", baseHandle: "shepherd", noRoom: true });
    expect(chatCalls[1]!.payload).toMatchObject({ room: res.data.room, handle: "shepherd" });
    const subs = gateStore.subscriptions({ live: true });
    expect(subs).toHaveLength(2);
    const prefixSub = subs.find((s) => s.scope === "prefix")!;
    const ownerSub = subs.find((s) => s.scope === "owner")!;
    expect(prefixSub).toMatchObject({ subjectPrefix: `herd:${res.data.herd}/`, session: "sess-shep" });
    expect(ownerSub).toMatchObject({ subjectPrefix: "", ownerRef: `herd:${res.data.herd}`, session: "sess-shep" });
    expect(res.data.subscription).toBe(prefixSub.id);
  });

  test("herd start subscribes the shepherd to its own gates by owner", async () => {
    const { h, gateStore } = harness();
    const res = await h["herd:start"](START);
    if (!res.ok) throw new Error(res.error);
    const subs = gateStore.subscriptions({ live: true });
    expect(subs.some((s) => s.scope === "owner" && s.ownerRef?.startsWith("herd:"))).toBe(true);
  });

  test("rejects an invalid name and a missing session", async () => {
    const { h } = harness();
    expect((await h["herd:start"]({ ...START, name: "Bad Name" })).ok).toBe(false);
    expect((await h["herd:start"]({ ...START, session: "" })).ok).toBe(false);
  });

  test("a session that already holds a handle is not re-signed-in; the herd uses that handle", async () => {
    const { h, store, chatCalls } = harness({ presenceIdentityForSession: (s) => (s === "sess-shep" ? { handle: "kai", baseHandle: "kai", name: "kai" } : null) });
    const res = await h["herd:start"](START);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.handle).toBe("kai");
    expect(store.get(res.data.herd)!.shepherdHandle).toBe("kai");
    expect(chatCalls.map((c) => c.verb)).toEqual(["join"]);
    expect(chatCalls[0]!.payload).toMatchObject({ room: res.data.room, handle: "kai" });
  });

  test("two starts with the same name in the same second get distinct ids", async () => {
    const { h } = harness();
    const a = await h["herd:start"](START);
    const b = await h["herd:start"](START);
    if (!a.ok || !b.ok) throw new Error("start failed");
    expect(a.data.herd).not.toBe(b.data.herd);
    expect(b.data.herd).toMatch(/^demo-\d{8}-\d{6}(-2)?$/);
  });

  test("--hidden ensures the hidden server, records its socket, and asks lifecycle to watch it", async () => {
    const watched: string[] = [];
    const { h, store } = harness({ lifecycle: { connected: () => true, watch: (s) => { watched.push(s); }, sweepClaims: async () => {} } });
    const res = await h["herd:start"]({ ...START, hidden: true });
    if (!res.ok) throw new Error(res.error);
    expect(store.get(res.data.herd)).toMatchObject({ hidden: true, herdrSocket: "/tmp/hidden.sock" });
    expect(watched).toEqual(["/tmp/hidden.sock"]);
  });

  test("--hidden claims herd:<id> on the bg server", async () => {
    const { h, claims } = harness();
    const res = await h["herd:start"]({ ...START, hidden: true });
    if (!res.ok) throw new Error(res.error);
    expect(claims.list()).toEqual([{ owner: `herd:${res.data.herd}`, pane: null, createdAt: expect.any(Number) }]);
  });

  // The claim is only registered once store.create() succeeds; a failure on
  // any step before it (chat:join here) must leave no orphaned claim behind
  // for a herd row that will never exist to release it.
  test("a hidden start whose chat:join fails leaves zero claims", async () => {
    const chat = {
      "chat:sign-in": async (p: any) => ({ ok: true as const, data: { handle: p.baseHandle ?? "shepherd", baseHandle: p.baseHandle ?? "shepherd", sessionId: p.sessionId, room: p.room ?? null } }),
      "chat:join": async () => ({ ok: false as const, error: "join failed" }),
    } as unknown as HerdDeps["chat"];
    const { h, store, claims } = harness({ chat });
    const res = await h["herd:start"]({ ...START, hidden: true });
    expect(res.ok).toBe(false);
    expect(store.list()).toEqual([]);
    expect(claims.list()).toEqual([]);
  });

  test("callerPane is recorded as shepherdPane; omitting it leaves the column null", async () => {
    const { h, store } = harness();
    const withPane = await h["herd:start"]({ ...START, callerPane: "wX:p1" });
    if (!withPane.ok) throw new Error(withPane.error);
    expect(store.get(withPane.data.herd)!.shepherdPane).toBe("wX:p1");

    const withoutPane = await h["herd:start"]({ ...START, name: "demo2" });
    if (!withoutPane.ok) throw new Error(withoutPane.error);
    expect(store.get(withoutPane.data.herd)!.shepherdPane).toBeNull();
  });
});

describe("herd:resume / status / close", () => {
  async function started(over: Partial<HerdDeps> = {}) {
    const hx = harness(over);
    const res = await hx.h["herd:start"](START);
    if (!res.ok) throw new Error(res.error);
    return { ...hx, herd: res.data.herd, room: res.data.room };
  }

  test("start and resume write the shepherd's chat session file", async () => {
    const { h, herd } = await started();
    expect(readChatSession("sess-shep")).toMatchObject({ handle: "shepherd", baseHandle: "shepherd" });
    const res = await h["herd:resume"]({ herd, session: "sess-shep-2" });
    if (!res.ok) throw new Error(res.error);
    expect(readChatSession("sess-shep-2")).toMatchObject({ handle: "shepherd", baseHandle: "shepherd" });
  });

  test("resume re-subscribes with the new session and returns gates, unread, status", async () => {
    const { h, store, gateStore, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    gateStore.open({ subject: `herd:${herd}/job-a`, kind: "question", questions: [{ id: "q", label: "?", multi: false, options: ["a", "b"] }] });
    const res = await h["herd:resume"]({ herd, session: "sess-shep-2" });
    if (!res.ok) throw new Error(res.error);
    expect(store.get(herd)!.shepherdSession).toBe("sess-shep-2");
    const subs = gateStore.subscriptions({ live: true, session: "sess-shep-2" });
    expect(subs).toHaveLength(2);
    expect(subs.map((s) => s.scope).sort()).toEqual(["owner", "prefix"]);
    expect(res.data.gates).toHaveLength(1);
    expect(res.data.unread).toBe(3);
    expect(res.data.status.jobs[0]).toMatchObject({ name: "job-a", openGate: res.data.gates[0]!.id, paneStatus: "working" });
  });

  test("resume with callerPane stores shepherdPane; a resume without it clears a stale one", async () => {
    const { h, store, herd } = await started();
    const withPane = await h["herd:resume"]({ herd, session: "sess-shep-2", callerPane: "wX:p1" });
    if (!withPane.ok) throw new Error(withPane.error);
    expect(store.get(herd)!.shepherdPane).toBe("wX:p1");

    const withoutPane = await h["herd:resume"]({ herd, session: "sess-shep-3" });
    if (!withoutPane.ok) throw new Error(withoutPane.error);
    expect(store.get(herd)!.shepherdPane).toBeNull();
  });

  test("a live pane with no claude behind it reads sessionDead, not working", async () => {
    const { h, store, snapshotPanes, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    // The shell survives a SIGKILLed claude, so the pane is still listed.
    snapshotPanes.rows = [{ pane_id: "w9:p1" }];
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]).toMatchObject({ name: "job-a", sessionDead: true, paneStatus: null });
  });

  test("a job whose pane still runs claude is not dead", async () => {
    const { h, store, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]!.sessionDead).toBe(false);
  });

  test("a finished job whose claude is gone is not flagged dead", async () => {
    const { h, store, snapshotPanes, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "done", pane: "w9:p1" });
    snapshotPanes.rows = [{ pane_id: "w9:p1" }];
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]!.sessionDead).toBe(false);
  });

  test("a spawning job whose claude has not started yet is not flagged dead", async () => {
    const { h, store, snapshotPanes, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "spawning", pane: "w9:p1" });
    snapshotPanes.rows = [{ pane_id: "w9:p1" }];
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]!.sessionDead).toBe(false);
  });

  test("a pane herdr no longer lists at all is unknown, never dead", async () => {
    const { h, store, snapshotPanes, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    snapshotPanes.rows = [];
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]!.sessionDead).toBeNull();
  });

  test("status carries the watchdog's ladder per job, and leaves the field off where the watchdog holds none", async () => {
    const asked: Array<[string, string]> = [];
    const watchdog: NonNullable<HerdDeps["watchdog"]> = {
      annotations: (hd, job) => { asked.push([hd, job]); return job === "job-a" ? { strikes: 2, lastPokeAt: 1_234 } : null; },
    };
    const { h, store, herd } = await started({ watchdog });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    store.upsertJob({ herd, name: "job-b", worktree: "/w/job-b", handle: "job-b", status: "active", pane: "w9:p2" });
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs.find((j) => j.name === "job-a")!.watchdog).toEqual({ strikes: 2, lastPokeAt: 1_234 });
    expect(res.data.jobs.find((j) => j.name === "job-b")!.watchdog).toBeUndefined();
    expect("watchdog" in res.data.jobs.find((j) => j.name === "job-b")!).toBe(false);
    expect(asked).toEqual([[herd, "job-a"], [herd, "job-b"]]);
  });

  test("status without a watchdog wired leaves the field off every job", async () => {
    const { h, store, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]!.watchdog).toBeUndefined();
    expect("watchdog" in res.data.jobs[0]!).toBe(false);
  });

  test("resume drops only the prior shepherd's subscriptions for this herd; an unrelated session's herd-prefix subscription survives", async () => {
    const { h, gateStore, herd } = await started();
    const before = gateStore.subscriptions({ live: true });
    expect(before).toHaveLength(2);
    // A co-observer on this herd's prefix (e.g. a manual `rt gate subscribe`
    // or a board relay) must not be caught by the resume re-point.
    const observer = gateStore.subscribe({ subjectPrefix: `herd:${herd}/`, session: "observer" });
    const res = await h["herd:resume"]({ herd, session: "sess-shep-2" });
    if (!res.ok) throw new Error(res.error);
    const after = gateStore.subscriptions({ live: true });
    const shepSubs = after.filter((s) => s.session === "sess-shep-2");
    expect(shepSubs).toHaveLength(2);
    for (const b of before) expect(after.some((a) => a.id === b.id)).toBe(false);
    expect(after.some((a) => a.id === observer.id)).toBe(true);
  });

  // Regression: replacement must create both new rows before dropping the
  // prior session's, and roll back cleanly if the second (owner) row fails --
  // never leave the prior session's fan-out gone with nothing to replace it.
  test("resume rolls back a failed owner-subscribe on replacement, leaving the prior session's rows untouched and no new prefix row", async () => {
    const { h, gateStore, gate, herd } = await started();
    const before = gateStore.subscriptions({ live: true });
    expect(before).toHaveLength(2);
    expect(before.every((s) => s.session === "sess-shep")).toBe(true);

    const realSubscribe = gate["gate:subscribe"];
    (gate as any)["gate:subscribe"] = async (p: any) => {
      if (p.scope === "owner") return { ok: false as const, error: "owner subscribe failed" };
      return realSubscribe(p);
    };

    const res = await h["herd:resume"]({ herd, session: "sess-shep-2" });
    expect(res.ok).toBe(false);

    const after = gateStore.subscriptions({ live: true });
    expect(after).toHaveLength(2);
    for (const b of before) expect(after.some((a) => a.id === b.id)).toBe(true);
    expect(after.some((a) => a.session === "sess-shep-2")).toBe(false);
  });

  test("start never drops another session's subscription (no prior shepherd to re-point from)", async () => {
    const { h, gateStore } = harness();
    const observer = gateStore.subscribe({ subjectPrefix: "herd:demo-", session: "observer" });
    const res = await h["herd:start"](START);
    if (!res.ok) throw new Error(res.error);
    expect(gateStore.subscriptions({ live: true }).some((s) => s.id === observer.id)).toBe(true);
  });

  test("resume on an unknown herd fails", async () => {
    const { h } = harness();
    expect((await h["herd:resume"]({ herd: "nope", session: "s" })).ok).toBe(false);
  });

  test("resume signs the prior shepherd session out, then continues the stored shepherd id", async () => {
    const { h, store, chatCalls, herd, room } = await started();
    store.setShepherd(herd, { session: "sess-shep", handle: "shepherd.k3f9" });
    chatCalls.length = 0;
    const res = await h["herd:resume"]({ herd, session: "sess-shep-2" });
    if (!res.ok) throw new Error(res.error);
    const identity = chatCalls.filter((c) => c.verb !== "rooms");
    expect(identity.map((c) => c.verb)).toEqual(["sign-out", "sign-in", "join"]);
    expect(identity[0]!.payload).toEqual({ sessionId: "sess-shep" });
    expect(identity[1]!.payload).toMatchObject({ sessionId: "sess-shep-2", continue: "shepherd.k3f9", noRoom: true });
    expect(identity[1]!.payload.baseHandle).toBeUndefined();
    expect(identity[2]!.payload).toMatchObject({ room, handle: "shepherd.k3f9" });
    expect(res.data.handle).toBe("shepherd.k3f9");
    expect(store.get(herd)!.shepherdHandle).toBe("shepherd.k3f9");
    expect(readChatSession("sess-shep-2")).toMatchObject({ handle: "shepherd.k3f9", name: "shepherd" });
  });

  test("resume never continues a stored legacy id that now resolves to another identity; it signs in fresh under the id's base name", async () => {
    const { h, store, chatCalls, herd } = await started({ resolveHandle: (x) => (x === "shepherd" ? "shepherd.zz99" : x) });
    chatCalls.length = 0;
    const res = await h["herd:resume"]({ herd, session: "sess-shep-2" });
    if (!res.ok) throw new Error(res.error);
    const signIn = chatCalls.find((c) => c.verb === "sign-in")!.payload;
    expect(signIn).toMatchObject({ sessionId: "sess-shep-2", baseHandle: "shepherd", noRoom: true });
    expect(signIn.continue).toBeUndefined();
    expect(res.data.handle).not.toBe("shepherd.zz99");
    expect(store.get(herd)!.shepherdHandle).toBe(res.data.handle);
  });

  test("resume strips a legacy id's numeric suffix for the fresh sign-in's base name", async () => {
    const { h, store, chatCalls, herd } = await started({ resolveHandle: (x) => (x === "shepherd-2" ? "shepherd.zz99" : x) });
    store.setShepherd(herd, { session: "sess-shep", handle: "shepherd-2" });
    chatCalls.length = 0;
    const res = await h["herd:resume"]({ herd, session: "sess-shep-2" });
    if (!res.ok) throw new Error(res.error);
    const signIn = chatCalls.find((c) => c.verb === "sign-in")!.payload;
    expect(signIn).toMatchObject({ baseHandle: "shepherd" });
    expect(signIn.continue).toBeUndefined();
  });

  test("resume continues the shepherd id even when the new session already holds its own", async () => {
    const { h, store, chatCalls, herd } = await started({ presenceIdentityForSession: (s) => (s === "sess-shep-2" ? { handle: "kai.k3f9", baseHandle: "kai", name: "kai" } : null) });
    chatCalls.length = 0;
    const res = await h["herd:resume"]({ herd, session: "sess-shep-2" });
    if (!res.ok) throw new Error(res.error);
    expect(chatCalls.find((c) => c.verb === "sign-in")!.payload).toMatchObject({ sessionId: "sess-shep-2", continue: "shepherd" });
    expect(res.data.handle).toBe("shepherd");
    expect(store.get(herd)!.shepherdHandle).toBe("shepherd");
  });

  test("resume from the shepherd's own session signs nothing out", async () => {
    const { h, chatCalls, herd } = await started();
    chatCalls.length = 0;
    const res = await h["herd:resume"]({ herd, session: "sess-shep" });
    if (!res.ok) throw new Error(res.error);
    expect(chatCalls.filter((c) => c.verb === "sign-out")).toEqual([]);
    expect(chatCalls.find((c) => c.verb === "sign-in")!.payload).toMatchObject({ sessionId: "sess-shep", continue: "shepherd" });
  });

  test("status and list carry the shepherd's and each job's display name next to the ids", async () => {
    const { h, store, herd } = await started();
    store.setShepherd(herd, { session: "sess-shep", handle: "shepherd.k3f9" });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a.w001", status: "active", pane: "w9:p1" });
    const status = await h["herd:status"]({ herd });
    if (!status.ok) throw new Error(status.error);
    expect(status.data.herd).toMatchObject({ shepherdHandle: "shepherd.k3f9", shepherdName: "shepherd" });
    expect(status.data.jobs[0]).toMatchObject({ handle: "job-a.w001", handleName: "job-a" });
    const list = await h["herd:list"]({});
    if (!list.ok) throw new Error(list.error);
    expect(list.data.herds.find((r) => r.id === herd)).toMatchObject({ shepherdHandle: "shepherd.k3f9", shepherdName: "shepherd" });
  });

  test("status reports lifecycleConnected, hiddenUp null for a visible herd, and the shepherd's subscription row", async () => {
    const { h, gateStore, herd } = await started();
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toMatchObject({ lifecycleConnected: true, hiddenUp: null, unread: 3 });
    const sub = gateStore.subscriptions({ live: true })[0]!;
    expect(res.data.subscription).toEqual({ id: sub.id, dead: false, lastDelivery: null });
  });

  // A malformed-but-ok session.snapshot reply (missing snapshot, or panes
  // not an array) must degrade to an empty pane map, never throw through
  // herd:status.
  test("status treats a malformed session.snapshot reply as no panes instead of throwing", async () => {
    const { h, store, herd } = await started({
      herdr: (async (method: string) => (method === "session.snapshot" ? { ok: true, result: {} } : { ok: false, code: "invalid_request", message: method })) as unknown as HerdDeps["herdr"],
    });
    store.upsertJob({ herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "w9:p1" });
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]).toMatchObject({ name: "job-a", paneStatus: null });
  });

  test("status reports push reachability from the probe", async () => {
    const { h, herd } = await started({ probeInbox: async () => "unreachable" });
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.push).toEqual({ state: "unreachable", lastDelivery: null });
  });

  test("status push.lastDelivery mirrors the shepherd's own subscription delivery", async () => {
    const { h, gateStore, herd } = await started({ probeInbox: async () => "reachable" });
    const sub = gateStore.subscriptions({ live: true }).find((s) => s.scope === "prefix")!;
    gateStore.markSubscriptionDelivery(sub.id, "delivered");
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.push.state).toBe("reachable");
    expect(res.data.push.lastDelivery).toMatchObject({ outcome: "delivered" });
  });

  // Run-gate pushes land on the owner-scoped row, never the prefix row
  // (fanOut's first-match dedupe stops at whichever row matches first), so
  // push.lastDelivery must also look there or steady pipeline pushes read
  // as "never delivered" despite gate_pushed having actually landed.
  test("status push.lastDelivery reflects a delivery recorded on the owner-scoped row, not just the prefix row", async () => {
    const { h, gateStore, herd } = await started({ probeInbox: async () => "reachable" });
    const prefixSub = gateStore.subscriptions({ live: true }).find((s) => s.scope === "prefix")!;
    const ownerSub = gateStore.subscriptions({ live: true }).find((s) => s.scope === "owner")!;
    expect(prefixSub.lastDelivery).toBeNull();
    gateStore.markSubscriptionDelivery(ownerSub.id, "delivered");
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.push.lastDelivery).toMatchObject({ outcome: "delivered" });
  });

  test("resume counts run gates owned by the herd's jobs alongside its own gates", async () => {
    const hx = harness({ runWorktree: (id) => (id === "run-1" ? "/w/job-a" : id === "run-2" ? "/elsewhere" : null) });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const herd = s.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active" });
    const Q = [{ id: "q", label: "?", multi: false, options: ["a"] }];
    hx.gateStore.open({ subject: `herd:${herd}/job-a`, kind: "question", questions: Q });
    hx.gateStore.open({ subject: "run:run-1", kind: "clarify", questions: Q });
    hx.gateStore.open({ subject: "run:run-2", kind: "clarify", questions: Q });
    const res = await hx.h["herd:resume"]({ herd, session: "sess-shep-2" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.gates.length).toBe(2);
  });

  test("status reports a dead subscription rather than hiding it as missing", async () => {
    const { h, gateStore, herd } = await started();
    const sub = gateStore.subscriptions({ live: true })[0]!;
    gateStore.markSubscriptionDead(sub.id);
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.subscription).toMatchObject({ id: sub.id, dead: true });
  });

  test("status surfaces an answered gate whose nudge never landed", async () => {
    const { h, store, gateStore, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "w9:p1" });
    const g = gateStore.open({ subject: `herd:${herd}/job-a`, kind: "question", questions: [{ id: "q", label: "?", multi: false, options: ["a"] }], nudge: { session: "sess-w1" } }).row.id;
    store.setJobStatus(herd, "job-a", "at-gate", { lastGate: g });
    gateStore.answer(g, { q: "a" }, "shepherd");
    gateStore.markDelivery(g, "dead-pane");
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]).toMatchObject({ openGate: null, lastGateStatus: "answered", lastGateDelivery: "dead-pane" });
  });

  test("status reports lastGateConsumed false for an answered, nudged gate no one has read yet", async () => {
    const { h, store, gateStore, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "w9:p1" });
    const g = gateStore.open({ subject: `herd:${herd}/job-a`, kind: "question", questions: [{ id: "q", label: "?", multi: false, options: ["a"] }], nudge: { session: "sess-w1" } }).row.id;
    store.setJobStatus(herd, "job-a", "at-gate", { lastGate: g });
    gateStore.answer(g, { q: "a" }, "shepherd");
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]).toMatchObject({ lastGateConsumed: false });
  });

  test("status reports lastGateConsumed true once the nudged gate is marked consumed", async () => {
    const { h, store, gateStore, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "w9:p1" });
    const g = gateStore.open({ subject: `herd:${herd}/job-a`, kind: "question", questions: [{ id: "q", label: "?", multi: false, options: ["a"] }], nudge: { session: "sess-w1" } }).row.id;
    store.setJobStatus(herd, "job-a", "at-gate", { lastGate: g });
    gateStore.answer(g, { q: "a" }, "shepherd");
    gateStore.markConsumed(g);
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]).toMatchObject({ lastGateConsumed: true });
  });

  test("status reports lastGateConsumed true for a released (losing pane) answer, which now stamps consumedAt too", async () => {
    const { h, store, gateStore, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "w9:p1" });
    const g = gateStore.open({ subject: `herd:${herd}/job-a`, kind: "question", questions: [{ id: "q", label: "?", multi: false, options: ["a"] }], pane: "w9:p1", nudge: { session: "sess-w1" } }).row.id;
    store.setJobStatus(herd, "job-a", "at-gate", { lastGate: g });
    gateStore.answer(g, { q: "a" }, "shepherd");
    gateStore.answer(g, { q: "a" }, GATE_BY_PANE); // the losing pane reconciles: released AND consumed
    expect(gateStore.get(g)!.released).toBe(true);
    expect(gateStore.get(g)!.consumedAt).not.toBeNull();
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]).toMatchObject({ lastGateConsumed: true });
  });

  test("status reports lastGateConsumed null for a job with no gate", async () => {
    const { h, store, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "w9:p1" });
    const res = await h["herd:status"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.jobs[0]).toMatchObject({ lastGateConsumed: null });
  });

  test("close closes the pane on the herd's socket and marks the job closed", async () => {
    const { h, store, herd, herdrCalls } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    const res = await h["herd:close"]({ herd, job: "job-a" });
    expect(res.ok).toBe(true);
    expect(herdrCalls).toContainEqual(["pane", "close", "w9:p1"]);
    expect(store.getJob(herd, "job-a")!.status).toBe("closed");
  });

  test("close marks the job closed even when the herdr runner throws", async () => {
    const { h, store, herd } = await started({ herdrRunnerFor: () => async () => { throw new Error("herdr not found"); } });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    const res = await h["herd:close"]({ herd, job: "job-a" });
    expect(res.ok).toBe(true);
    expect(store.getJob(herd, "job-a")!.status).toBe("closed");
  });

  test("close on a job with no pane still marks it closed", async () => {
    const { h, store, herd, herdrCalls } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "crashed" });
    const res = await h["herd:close"]({ herd, job: "job-a" });
    expect(res.ok).toBe(true);
    expect(herdrCalls).toEqual([]);
    expect(store.getJob(herd, "job-a")!.status).toBe("closed");
  });

  test("close on a job whose worktree still has a running run warns instead of blocking", async () => {
    const { h, store, herd } = await started({
      findRunningRunByWorktree: (worktree) =>
        worktree === "/w/job-a" ? { kind: "match", run: { id: "run-1", currentStage: "implement" } } : { kind: "none" },
    });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active" });
    const res = await h["herd:close"]({ herd, job: "job-a" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.data.warning).toBe("job worktree has running run run-1 at implement; finish it or run: rt runs abandon run-1");
    expect(store.getJob(herd, "job-a")!.status).toBe("closed");
  });

  test("close on a job with no running run carries no warning", async () => {
    const { h, store, herd } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active" });
    const res = await h["herd:close"]({ herd, job: "job-a" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.data.warning).toBeUndefined();
  });

  // Regression: an unreadable run DB must not read as "nothing running" --
  // herd:close warns rather than silently closing the job clean.
  test("close on a job whose run scan could not finish warns instead of reading it as clean", async () => {
    const { h, store, herd } = await started({
      findRunningRunByWorktree: () => ({ kind: "incomplete" }),
    });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active" });
    const res = await h["herd:close"]({ herd, job: "job-a" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.data.warning).toBe("could not verify runs; check manually");
    expect(store.getJob(herd, "job-a")!.status).toBe("closed");
  });
});

describe("herd:list", () => {
  test("lists active herds with their job counts; --all includes wrapped ones", async () => {
    const hx = harness();
    const a = await hx.h["herd:start"](START);
    const b = await hx.h["herd:start"]({ ...START, name: "other" });
    if (!a.ok || !b.ok) throw new Error("start failed");
    hx.store.upsertJob({ herd: a.data.herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active" });
    hx.store.setHerdStatus(b.data.herd, "wrapped");
    const active = await hx.h["herd:list"]({});
    if (!active.ok) throw new Error(active.error);
    expect(active.data.herds.map((h) => h.id)).toEqual([a.data.herd]);
    expect(active.data.herds[0]).toMatchObject({ room: a.data.room, status: "active", jobs: 1 });
    const all = await hx.h["herd:list"]({ all: true });
    if (!all.ok) throw new Error(all.error);
    expect(all.data.herds.map((h) => h.id).sort()).toEqual([a.data.herd, b.data.herd].sort());
  });
});

describe("worker verbs", () => {
  const Q = [{ id: "q1", label: "Which?", multi: false, options: ["a", "b"] }];
  async function withJob() {
    const hx = harness();
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    hx.store.upsertJob({ herd: s.data.herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1", agentSession: "sess-w1" });
    return { ...hx, herd: s.data.herd, room: s.data.room };
  }

  async function withHiddenJob() {
    const hx = harness();
    const s = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!s.ok) throw new Error(s.error);
    hx.store.upsertJob({ herd: s.data.herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "bg:wh:p1", agentSession: "sess-w1" });
    return { ...hx, herd: s.data.herd, room: s.data.room };
  }

  test("ask opens a question gate with subject, refs, nudge, meta; job goes at-gate", async () => {
    const { h, store, gateStore, herd } = await withJob();
    const res = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", pane: "w9:p1", questions: Q, context: "why" });
    if (!res.ok) throw new Error(res.error);
    const g = gateStore.get(res.data.gate)!;
    expect(g).toMatchObject({ subject: `herd:${herd}/job-a`, kind: "question", agent: "job-a", pane: "w9:p1", nudge: { session: "sess-w1" }, meta: { herd, job: "job-a" }, context: "why" });
    expect(store.getJob(herd, "job-a")).toMatchObject({ status: "at-gate", lastGate: res.data.gate });
  });

  test("ask on a hidden herd stores the pane as a bg: ref, and the escape injector resolves that ref to the bg socket", async () => {
    const { h, gateStore, herd } = await withHiddenJob();
    const res = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!res.ok) throw new Error(res.error);
    const g = gateStore.get(res.data.gate)!;
    expect(g.pane).toBe("bg:wh:p1");

    const seenSock: Array<string | undefined> = [];
    const fakeHerdrRecording = (async (method: string, params: unknown, o?: { sockPath?: string }) => {
      seenSock.push(o?.sockPath);
      return { ok: true, result: {} };
    }) as typeof herdrRequest;
    const escapeInjector = createEscapeInjector({
      herdr: fakeHerdrRecording,
      snapshot: async () => [{ paneRef: g.pane!, sockPath: bgSocketPath(), workspaceId: "wh", agentStatus: "blocked" }],
    });
    const injected = await escapeInjector({ paneId: g.pane! });
    expect(injected).toEqual({ ok: true, paneRef: g.pane! });
    expect(seenSock).toEqual([bgSocketPath()]);
  });

  test("ask on a visible herd stores the pane bare (unchanged)", async () => {
    const { h, gateStore, herd } = await withJob();
    const res = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!res.ok) throw new Error(res.error);
    expect(gateStore.get(res.data.gate)!.pane).toBe("w9:p1");
  });

  test("ask over the form option cap opens with a wait origin, still nudging the worker", async () => {
    const { h, gateStore, herd } = await withJob();
    const overCap = [{ id: "q1", label: "Which?", multi: false, options: ["a", "b", "c", "d", "e"] }];
    const res = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", pane: "w9:p1", questions: overCap });
    if (!res.ok) throw new Error(res.error);
    const g = gateStore.get(res.data.gate)!;
    expect(g.origin).toMatchObject({ paneId: "w9:p1", presentation: "wait" });
    expect(g.nudge).toEqual({ session: "sess-w1" });
  });

  test("ask at or under the form option cap keeps a form origin and the nudge", async () => {
    const { h, gateStore, herd } = await withJob();
    const res = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", pane: "w9:p1", questions: Q });
    if (!res.ok) throw new Error(res.error);
    const g = gateStore.get(res.data.gate)!;
    expect(g.origin).toMatchObject({ paneId: "w9:p1", presentation: "form" });
    expect(g.nudge).toEqual({ session: "sess-w1" });
  });

  test("ask refuses an option label over the cap, names the limit, and opens no gate", async () => {
    const { h, gateStore, herd } = await withJob();
    const wordy = [{ id: "q1", label: "Which?", multi: false, options: ["x".repeat(200), "b"] }];
    const res = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", pane: "w9:p1", questions: wordy });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain(`${HERD_OPTION_LABEL_MAX}`);
    expect(res.error).toContain("description");
    expect(gateStore.list({ open: true }).gates).toEqual([]);
  });

  test("the label cap stays off every other gate: gate:open keeps a long option label", async () => {
    const { gate } = await withJob();
    const long = "l".repeat(HERD_OPTION_LABEL_MAX * 3);
    const res = await gate["gate:open"]({ subject: "run:rt/review-1", kind: "question", questions: [{ id: "q1", label: "Post these findings?", multi: false, options: [long, "b"] }] });
    if (!res.ok) throw new Error(res.error);
  });

  test("ask accepts a short label with a long value and description, and ignores the (Recommended) suffix", async () => {
    const { h, herd } = await withJob();
    const shaped = [{ id: "q1", label: "Which?", multi: false, options: [
      { value: "v".repeat(300), label: "Short pick" + "!".repeat(HERD_OPTION_LABEL_MAX - 10), description: "d".repeat(400) },
      { value: "b", label: "x".repeat(HERD_OPTION_LABEL_MAX) + " (Recommended)" },
    ] }];
    const res = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", pane: "w9:p1", questions: shaped });
    if (!res.ok) throw new Error(res.error);
  });

  test("ask refuses an unknown job and invalid questions", async () => {
    const { h, herd } = await withJob();
    expect((await h["herd:ask"]({ herd, job: "nope", session: "s", questions: Q })).ok).toBe(false);
    expect((await h["herd:ask"]({ herd, job: "job-a", session: "s", questions: [] })).ok).toBe(false);
  });

  test("ask refuses an options-less question cleanly (no throw), and opens no gate", async () => {
    const { h, gateStore, herd } = await withJob();
    const malformed = [{ id: "q1", label: "Which?", multi: false }] as unknown as typeof Q;
    const res = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", pane: "w9:p1", questions: malformed });
    expect(res).toEqual({ ok: false, error: "invalid questions" });
    expect(gateStore.list({ open: true }).gates).toEqual([]);
  });

  test("ask refuses non-array questions cleanly (no throw), and opens no gate", async () => {
    const { h, gateStore, herd } = await withJob();
    const nonArray = { id: "q1", label: "Which?", multi: false, options: ["a"] } as unknown as typeof Q;
    const res = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", pane: "w9:p1", questions: nonArray });
    expect(res).toEqual({ ok: false, error: "invalid questions" });
    expect(gateStore.list({ open: true }).gates).toEqual([]);
  });

  test("ask refuses an orphan job (herd_jobs row whose parent herd was deleted)", async () => {
    const { h, store } = await withJob();
    // No FK from herd_jobs to herds: seed a job row under a herd id that was
    // never (or no longer) created, matching the deleted-parent case.
    store.upsertJob({ herd: "orphan-herd", name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1", agentSession: "sess-w1" });
    const res = await h["herd:ask"]({ herd: "orphan-herd", job: "job-a", session: "sess-w1", questions: Q });
    expect(res.ok).toBe(false);
  });

  test("milestone posts quietly to the room then opens a milestone gate with the fixed options", async () => {
    const { h, store, gateStore, chatCalls, herd, room } = await withJob();
    const res = await h["herd:milestone"]({ herd, job: "job-a", session: "sess-w1", pane: "w9:p1", artifact: "/w/job-a/spec.md", summary: "spec ready" });
    if (!res.ok) throw new Error(res.error);
    const post = chatCalls.find((c) => c.verb === "post")!;
    expect(post.payload).toMatchObject({ room, handle: "job-a", quiet: true });
    expect(post.payload.body).toContain("/w/job-a/spec.md");
    const g = gateStore.get(res.data.gate)!;
    expect(g.kind).toBe("milestone");
    expect(g.questions).toEqual([{ id: "decision", label: "spec ready", multi: false, options: [
      { value: "Approve", label: "Approve" },
      { value: "Revise", label: "Revise" },
      { value: "Spawn a reviewer", label: "Spawn a reviewer" },
    ] }]);
    expect(g.meta).toMatchObject({ herd, job: "job-a", artifact: "/w/job-a/spec.md" });
    expect(store.getJob(herd, "job-a")!.status).toBe("at-milestone");
  });

  test("milestone opens with a form origin (fixed 3-option questions fit the cap)", async () => {
    const { h, gateStore, herd } = await withJob();
    const res = await h["herd:milestone"]({ herd, job: "job-a", session: "sess-w1", pane: "w9:p1", artifact: "/w/job-a/spec.md" });
    if (!res.ok) throw new Error(res.error);
    const g = gateStore.get(res.data.gate)!;
    expect(g.origin).toMatchObject({ paneId: "w9:p1", presentation: "form" });
    expect(g.nudge).toEqual({ session: "sess-w1" });
  });

  test("milestone on a hidden herd stores the pane as a bg: ref", async () => {
    const { h, gateStore, herd } = await withHiddenJob();
    const res = await h["herd:milestone"]({ herd, job: "job-a", session: "sess-w1", artifact: "/w/job-a/spec.md" });
    if (!res.ok) throw new Error(res.error);
    expect(gateStore.get(res.data.gate)!.pane).toBe("bg:wh:p1");
  });

  test("answer returns the recorded answer with notes, or null while open", async () => {
    const { h, gateStore, herd } = await withJob();
    const asked = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!asked.ok) throw new Error(asked.error);
    const open = await h["herd:answer"]({ gate: asked.data.gate });
    if (!open.ok) throw new Error(open.error);
    expect(open.data).toMatchObject({ status: "open", answer: null });
    gateStore.answer(asked.data.gate, { q1: { value: "b", note: "and also x" } } as never, "shepherd");
    const done = await h["herd:answer"]({ gate: asked.data.gate });
    if (!done.ok) throw new Error(done.error);
    expect(done.data.status).toBe("answered");
    expect(done.data.answer!.by).toBe("shepherd");
    expect((await h["herd:answer"]({ gate: "gt-nope" })).ok).toBe(false);
  });

  test("herd:answer with the nudged session consumes", async () => {
    const { h, gateStore, herd } = await withJob();
    const asked = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!asked.ok) throw new Error(asked.error);
    gateStore.answer(asked.data.gate, { q1: { value: "b" } } as never, "shepherd");
    const res = await h["herd:answer"]({ gate: asked.data.gate, sessionId: "sess-w1" });
    expect(res.ok).toBe(true);
    expect(gateStore.get(asked.data.gate)!.consumedAt).not.toBeNull();
  });

  test("herd:answer without a session, or with a foreign session, does not consume", async () => {
    const { h, gateStore, herd } = await withJob();
    const asked = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!asked.ok) throw new Error(asked.error);
    gateStore.answer(asked.data.gate, { q1: { value: "b" } } as never, "shepherd");
    await h["herd:answer"]({ gate: asked.data.gate });
    await h["herd:answer"]({ gate: asked.data.gate, sessionId: "someone-else" });
    expect(gateStore.get(asked.data.gate)!.consumedAt).toBeNull();
  });

  test("herd:answer on a nudge-less gate does not consume when read with no session", async () => {
    const { h, gateStore, herd } = await withJob();
    const g = gateStore.open({ subject: `herd:${herd}/job-a`, kind: "question", questions: Q }).row.id;
    gateStore.answer(g, { q1: { value: "b" } } as never, "shepherd");
    await h["herd:answer"]({ gate: g });
    expect(gateStore.get(g)!.consumedAt).toBeNull();
  });

  test("herd:answer with the nudged session reading an OPEN gate does not consume", async () => {
    const { h, gateStore, herd } = await withJob();
    const asked = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!asked.ok) throw new Error(asked.error);
    const res = await h["herd:answer"]({ gate: asked.data.gate, sessionId: "sess-w1" });
    expect(res.ok).toBe(true);
    expect((res as { ok: true; data: { status: string } }).data.status).toBe("open");
    expect(gateStore.get(asked.data.gate)!.consumedAt).toBeNull();
  });

  test("report posts to the room mentioning the shepherd and marks the job done", async () => {
    const { h, store, chatCalls, herd, room } = await withJob();
    const res = await h["herd:report"]({ herd, job: "job-a", body: "done: A1 A2" });
    if (!res.ok) throw new Error(res.error);
    const post = chatCalls.find((c) => c.verb === "post")!;
    expect(post.payload).toMatchObject({ room, handle: "job-a", body: "done: A1 A2", mentions: ["shepherd"] });
    expect(post.payload.quiet).toBeUndefined();
    expect(store.getJob(herd, "job-a")).toMatchObject({ status: "done", lastReport: res.data.message });
  });

  test("report on a disposable job closes its pane and marks it closed", async () => {
    const { h, store, herdrCalls, herd } = await withJob();
    store.upsertJob({ herd, name: "review-job-a", worktree: "/w/job-a", handle: "review-job-a", status: "active", pane: "w9:p7", disposable: true });
    const res = await h["herd:report"]({ herd, job: "review-job-a", body: "verdict: approve" });
    expect(res.ok).toBe(true);
    expect(herdrCalls).toContainEqual(["pane", "close", "w9:p7"]);
    expect(store.getJob(herd, "review-job-a")!.status).toBe("closed");
  });

  test("follow-up flips a done job back to active and keeps its report", async () => {
    const { h, store, herd } = await withJob();
    const reported = await h["herd:report"]({ herd, job: "job-a", body: "done: A1" });
    if (!reported.ok) throw new Error(reported.error);
    const res = await h["herd:follow-up"]({ herd, job: "job-a" });
    expect(res).toEqual({ ok: true, data: { job: "job-a", status: "active" } });
    expect(store.getJob(herd, "job-a")).toMatchObject({ status: "active", lastReport: reported.data.message });
  });

  test("a follow-up round ends at the next report: done again with the new report", async () => {
    const { h, store, herd } = await withJob();
    await h["herd:report"]({ herd, job: "job-a", body: "done: A1" });
    await h["herd:follow-up"]({ herd, job: "job-a" });
    const second = await h["herd:report"]({ herd, job: "job-a", body: "done: follow-up fixes" });
    if (!second.ok) throw new Error(second.error);
    expect(store.getJob(herd, "job-a")).toMatchObject({ status: "done", lastReport: second.data.message });
  });

  test("follow-up refuses a job that is not done, an unknown job and a paneless job", async () => {
    const { h, store, herd } = await withJob();
    const live = await h["herd:follow-up"]({ herd, job: "job-a" });
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.error).toContain("not done");
    const unknown = await h["herd:follow-up"]({ herd, job: "nope" });
    expect(unknown.ok).toBe(false);
    store.upsertJob({ herd, name: "job-p", worktree: "/w/p", handle: "job-p", status: "done", pane: null });
    const paneless = await h["herd:follow-up"]({ herd, job: "job-p" });
    expect(paneless.ok).toBe(false);
    if (!paneless.ok) expect(paneless.error).toContain("no pane");
    expect(store.getJob(herd, "job-p")!.status).toBe("done");
  });

  test("follow-up refuses a done job whose herd is wrapped and leaves both as they were", async () => {
    const { h, store, herd } = await withJob();
    await h["herd:report"]({ herd, job: "job-a", body: "done: A1" });
    expect((await h["herd:wrap-up"]({ herd })).ok).toBe(true);
    expect(store.getJob(herd, "job-a")!.pane).not.toBeNull();
    const res = await h["herd:follow-up"]({ herd, job: "job-a" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(`herd "${herd}" is wrapped`);
    expect(store.getJob(herd, "job-a")!.status).toBe("done");
    expect(store.get(herd)!.status).toBe("wrapped");
  });
});

describe("herd:spawn", () => {
  async function started() {
    const hx = harness();
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    return { ...hx, herd: s.data.herd, room: s.data.room };
  }

  test("RT-356: the prompt names the herd's current shepherd and its id, and job.md keeps both slots for the next launch", async () => {
    let shepherdName = "shepherd";
    const hx = harness({
      presenceIdentityForSession: (s) => (s === "sess-shep" ? { handle: "shepherd.k3f9", baseHandle: "shepherd", name: "shepherd" } : null),
      identityNames: (ids: Iterable<string>) => new Map([...ids].map((id) => [id, shepherdName])),
    });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const brief = "# job\nDM <shepherd handle> (id <shepherd id>) when done.";
    const first = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief, dir: "/t" });
    if (!first.ok) throw new Error(first.error);
    expect(hx.agentCalls[0].prompt).toContain("DM shepherd (id shepherd.k3f9) when done.");
    expect(hx.agentCalls[0].prompt).not.toMatch(/<shepherd (?:handle|id)>/);
    const stored = readFileSync(join(hx.dir, "herds", s.data.herd, "job-a", "job.md"), "utf8");
    expect(stored).toContain("<shepherd handle>");
    expect(stored).toContain("<shepherd id>");
    shepherdName = "ann";
    const again = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", dir: "/t" });
    if (!again.ok) throw new Error(again.error);
    expect(hx.agentCalls[1].prompt).toContain("DM ann (id shepherd.k3f9) when done.");
  });

  test("RT-356: a respawn after a resume under a new shepherd identity names the new id and its name", async () => {
    const names = new Map([["shepherd-2", "kai"], ["shepherd", "ann"]]);
    // A legacy id that now resolves to another identity is the resume path that
    // signs the shepherd in under a new id.
    const hx = harness({
      presenceIdentityForSession: (s) => (s === "sess-shep" ? { handle: "shepherd-2", baseHandle: "shepherd", name: "kai" } : null),
      identityNames: (ids: Iterable<string>) => new Map([...ids].map((id) => [id, names.get(id) ?? id])),
      resolveHandle: (x: string) => (x === "shepherd-2" ? "shepherd.zz99" : x),
    });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const brief = "# job\nDM <shepherd handle> (id <shepherd id>) when done.";
    const first = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief, dir: "/t" });
    if (!first.ok) throw new Error(first.error);
    expect(hx.agentCalls[0].prompt).toContain("DM kai (id shepherd-2) when done.");
    const resumed = await hx.h["herd:resume"]({ herd: s.data.herd, session: "sess-shep-2" });
    if (!resumed.ok) throw new Error(resumed.error);
    expect(resumed.data.handle).toBe("shepherd");
    const again = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", dir: "/t" });
    if (!again.ok) throw new Error(again.error);
    expect(hx.agentCalls[1].prompt).toContain("DM ann (id shepherd) when done.");
    expect(hx.agentCalls[1].prompt).not.toContain("shepherd-2");
  });

  test("RT-356: the shepherd's name is resolved before the job row goes to spawning", async () => {
    const statusAtLookup: Array<string | null> = [];
    let herdId = "";
    const hx: ReturnType<typeof harness> = harness({
      identityNames: (ids: Iterable<string>) => {
        if (herdId) statusAtLookup.push(hx.store.getJob(herdId, "job-a")?.status ?? null);
        return new Map([...ids].map((id) => [id, id]));
      },
    });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    herdId = s.data.herd;
    const res = await hx.h["herd:spawn"]({ herd: herdId, job: "job-a", brief: "# job\nDM <shepherd id>.", dir: "/t" });
    if (!res.ok) throw new Error(res.error);
    expect(statusAtLookup).toEqual([null]);
  });

  test("RT-356: a brief with no slot is launched unchanged", async () => {
    const { h, agentCalls, herd } = await started();
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "# job\nplain", dir: "/t" });
    if (!res.ok) throw new Error(res.error);
    expect(agentCalls[0].prompt).toBe("# job\nplain");
  });

  test("provisions, starts the agent in the herd workspace with env and handle, signs the pane in, records the job", async () => {
    const { h, store, agentCalls, worktreeCalls, chatCalls, herd, room, dir } = await started();
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "# job\ndo the thing", model: "opus", account: "2" });
    if (!res.ok) throw new Error(res.error);
    expect(worktreeCalls[0]).toMatchObject({ verb: "provision", p: { repoName: "gh:m4ttstack/rt", branch: "job-a", disposal: "job" } });
    expect(agentCalls[0]).toMatchObject({
      repo: "gh:m4ttstack/rt", cwd: "/w/job-a", surface: "herdr", model: "opus", account: "2",
      workspace: `herd: ${herd}`, tab: "job-a", label: "job-a", caller: `herd:${herd}`, handle: "job-a.w001",
      subject: herdSubject(herd, "job-a"),
      env: { HERD_ID: herd, HERD_JOB: "job-a", HERD_ROOM: room },
    });
    expect(agentCalls[0].prompt).toContain("do the thing");
    expect(agentCalls[0].herdrSocket).toBeUndefined();
    const signIn = chatCalls.filter((c) => c.verb === "sign-in")[1]!;
    expect(signIn.payload).toMatchObject({ sessionId: "sess-w1", continue: "job-a.w001", pane: "w9:p1", noRoom: true });
    expect(signIn.payload.baseHandle).toBeUndefined();
    expect(chatCalls.filter((c) => c.verb === "join")[1]!.payload).toMatchObject({ room, handle: "job-a.w001", pane: "w9:p1" });
    expect(store.getJob(herd, "job-a")).toMatchObject({ worktree: "/w/job-a", branch: "job-a", tree: "job-a", pane: "w9:p1", agentSession: "sess-w1", agentId: "ag-1", handle: "job-a.w001", status: "spawning", disposable: false });
    expect(res.data).toMatchObject({ pane: "w9:p1", worktree: "/w/job-a", tree: "job-a", sessionId: "sess-w1", wasOnDeck: false });
    expect(readFileSync(join(dir, "herds", herd, "job-a", "job.md"), "utf8")).toContain("do the thing");
    const jobMd = join(dir, "herds", herd, "job-a", "job.md");
    expect(statSync(jobMd).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "herds", herd, "job-a")).mode & 0o777).toBe(0o700);
  });

  test("a spawned worker gets a chat session file, so the chat_* MCP tools resolve its handle", async () => {
    const { h, herd } = await started();
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b" });
    if (!res.ok) throw new Error(res.error);
    expect(readChatSession("sess-w1")).toMatchObject({ sessionId: "sess-w1", handle: "job-a.w001", baseHandle: "job-a", name: "job-a" });
  });

  test("an existing file naming the same handle is kept, room and all", async () => {
    writeChatSession({ sessionId: "sess-w1", handle: "job-a.w001", baseHandle: "job-a", name: "job-a", signedInAt: 1, room: "r" });
    const { h, herd } = await started();
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b" });
    if (!res.ok) throw new Error(res.error);
    expect(readChatSession("sess-w1")).toMatchObject({ handle: "job-a.w001", room: "r", signedInAt: 1 });
  });

  test("a stale file naming another handle is rewritten to the signed-in handle, keeping its room", async () => {
    writeChatSession({ sessionId: "sess-w1", handle: "old-2", baseHandle: "old", signedInAt: 1, room: "r" });
    const { h, herd } = await started();
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b" });
    if (!res.ok) throw new Error(res.error);
    expect(readChatSession("sess-w1")).toMatchObject({ handle: "job-a.w001", baseHandle: "job-a", name: "job-a", room: "r" });
  });

  test("--dir skips provisioning; a respawn closes the old pane first and reuses the stored job.md", async () => {
    const { h, store, agentCalls, worktreeCalls, herdrCalls, herd } = await started();
    const first = await h["herd:spawn"]({ herd, job: "job-a", brief: "the brief", dir: "/existing/tree" });
    if (!first.ok) throw new Error(first.error);
    expect(worktreeCalls).toEqual([]);
    expect(first.data.wasOnDeck).toBeNull();
    expect(store.getJob(herd, "job-a")!.tree).toBeNull();
    expect(herdrCalls).toEqual([]);
    const again = await h["herd:spawn"]({ herd, job: "job-a", dir: "/existing/tree" });
    if (!again.ok) throw new Error(again.error);
    expect(herdrCalls).toContainEqual(["pane", "close", "w9:p1"]);
    expect(agentCalls[1].prompt).toContain("the brief");
    expect(agentCalls[1].cwd).toBe("/existing/tree");
  });

  // A pre-existing job.md may have been written 0644 in a 0755 dir by an
  // older rt; a brief-less respawn reads it back and must tighten both
  // modes rather than leaving the loose ones in place.
  test("a brief-less respawn tightens a legacy job.md's modes without changing its content", async () => {
    const { h, dir, herd } = await started();
    const first = await h["herd:spawn"]({ herd, job: "job-a", brief: "the brief", dir: "/existing/tree" });
    if (!first.ok) throw new Error(first.error);
    const jobDirPath = join(dir, "herds", herd, "job-a");
    const jobMd = join(jobDirPath, "job.md");
    chmodSync(jobDirPath, 0o755);
    chmodSync(jobMd, 0o644);
    const again = await h["herd:spawn"]({ herd, job: "job-a", dir: "/existing/tree" });
    if (!again.ok) throw new Error(again.error);
    expect(statSync(jobDirPath).mode & 0o777).toBe(0o700);
    expect(statSync(jobMd).mode & 0o777).toBe(0o600);
    expect(readFileSync(jobMd, "utf8")).toBe("the brief");
  });

  test("--disposable is recorded on the job row", async () => {
    const { h, store, herd } = await started();
    const res = await h["herd:spawn"]({ herd, job: "review-job-a", brief: "review it", dir: "/w/job-a", disposable: true });
    expect(res.ok).toBe(true);
    expect(store.getJob(herd, "review-job-a")!.disposable).toBe(true);
  });

  test("a respawn without --disposable keeps the prior disposable flag", async () => {
    const { h, store, herd } = await started();
    expect((await h["herd:spawn"]({ herd, job: "review-job-a", brief: "review it", dir: "/w/job-a", disposable: true })).ok).toBe(true);
    expect((await h["herd:spawn"]({ herd, job: "review-job-a", dir: "/w/job-a" })).ok).toBe(true);
    expect(store.getJob(herd, "review-job-a")!.disposable).toBe(true);
  });

  test("the trust accept waits out herdr's registration lag, then accepts with enter", async () => {
    const { h, socketCalls, order, screen, trust, herd } = await started();
    screen.text = PLAIN_TRUST;
    trust.registerFailures = 2;
    // The shepherd's own sign-in is already in the log, so only the calls this
    // spawn adds can say anything about the worker's ordering.
    const mark = order.length;
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(socketCalls.filter((c) => c.method === "agent.get")).toHaveLength(3);
    expect(socketCalls.find((c) => c.method === "agent.wait")!.params).toMatchObject({ target: "w9:p1", until: ["idle", "blocked", "done"], timeout_ms: 15_000 });
    expect(socketCalls.find((c) => c.method === "pane.send_keys")!.params).toEqual({ pane_id: "w9:p1", keys: ["enter"] });
    expect((res as any).data.trust).toBe("accepted");
    // RT-156 unified the trust check into agent:start itself, so it runs
    // (and blocks) before agent:start returns -- chat sign-in, which only
    // starts once herd:spawn has the record back, comes after the wait, not
    // before it. Reversed from when herd.ts ran a second, later trust check
    // of its own; that fallback is gone.
    const spawned = order.slice(mark);
    const signedIn = spawned.indexOf("chat:sign-in");
    const firstGet = spawned.indexOf("herdr:agent.get");
    expect(signedIn).toBeGreaterThanOrEqual(0);
    expect(firstGet).toBeGreaterThanOrEqual(0);
    expect(firstGet).toBeLessThan(signedIn);
  });

  test("an idle agent whose brief merely says trust is sent nothing", async () => {
    const { h, socketCalls, screen, trust, herd } = await started();
    screen.text = "reading the brief: trust the fixture owner\n";
    trust.waitStatus = "idle";
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(socketCalls.some((c) => c.method === "pane.send_keys")).toBe(false);
    expect((res as any).data.trust).toBe("none");
  });

  // The live miss (RT-156): board-37's spawn returned in 5s, far inside the
  // register budget, because herdr had an agent and settled it non-blocked.
  // The modal was up the whole time and nothing ever read the screen.
  test("a modal still up while herdr calls the agent idle is accepted, not passed over", async () => {
    const { h, socketCalls, screen, trust, herd } = await started();
    screen.text = PLAIN_TRUST;
    trust.waitStatus = "idle";
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(socketCalls.find((c) => c.method === "pane.send_keys")!.params).toEqual({ pane_id: "w9:p1", keys: ["enter"] });
    expect((res as any).data.trust).toBe("accepted");
  });

  test("a pane still working when the trust budget expires is read once and left alone when no modal is up", async () => {
    const { h, socketCalls, screen, trust, herd } = await started();
    screen.text = "$ claude\nworking...\n";
    trust.waitOk = false;
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(socketCalls.some((c) => c.method === "pane.send_keys")).toBe(false);
    expect((res as any).data.trust).toBe("none");
  });

  test("a modal up on a pane whose wait timed out is still accepted", async () => {
    const { h, screen, trust, herd } = await started();
    screen.text = PLAIN_TRUST;
    trust.waitOk = false;
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: "/t" });
    expect((res as any).data.trust).toBe("accepted");
  });

  test("a pane sitting on the modal before claude ever registers is still accepted", async () => {
    // The pre-claude dialog is exactly why herdr never sees an agent, so
    // giving up on the register poll used to skip the check that was needed.
    const hx = harness({}, { registerBudgetMs: 400 });
    hx.screen.text = PLAIN_TRUST;
    hx.trust.registerFailures = Number.MAX_SAFE_INTEGER;
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const res = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(hx.socketCalls.find((c) => c.method === "pane.send_keys")!.params).toEqual({ pane_id: "w9:p1", keys: ["enter"] });
    expect((res as any).data.trust).toBe("accepted");
  });

  test("an unregistered pane showing no modal is reported unchecked, not accepted", async () => {
    const hx = harness({}, { registerBudgetMs: 400 });
    hx.screen.text = "$ claude\nbash: claude: command not found\n";
    hx.trust.registerFailures = Number.MAX_SAFE_INTEGER;
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const res = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(hx.socketCalls.some((c) => c.method === "pane.send_keys")).toBe(false);
    expect((res as any).data.trust).toBe("unchecked");
  });

  test("the elevated modal is walked up to Yes instead of entered on No", async () => {
    const { h, socketCalls, screen, herd } = await started();
    screen.text = ELEVATED_TRUST;
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(socketCalls.filter((c) => c.method === "pane.send_keys").map((c) => c.params.keys)).toEqual([["up"], ["enter"]]);
    expect((res as any).data.trust).toBe("accepted");
  });

  test("a modal whose cursor cannot be read is left alone and the job reads stuck-at-modal", async () => {
    const { h, socketCalls, screen, store, herd } = await started();
    screen.text = "Do you trust the files in this folder?\n  1. Yes, proceed\n  2. No, exit\n";
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(socketCalls.some((c) => c.method === "pane.send_keys")).toBe(false);
    expect((res as any).data.trust).toBe("stuck");
    expect(store.getJob(herd, "job-a")!.status).toBe("stuck-at-modal");
  });

  test("a modal that survives the accept keys is retried once, then reported stuck", async () => {
    const { h, socketCalls, screen, trust, store, herd } = await started();
    screen.text = ELEVATED_TRUST;
    trust.clearOnAccept = false;
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    // One step up, then an enter per attempt: every call carries a single key.
    expect(socketCalls.filter((c) => c.method === "pane.send_keys").map((c) => c.params.keys)).toEqual([["up"], ["enter"], ["enter"]]);
    expect((res as any).data.trust).toBe("stuck");
    expect(store.getJob(herd, "job-a")!.status).toBe("stuck-at-modal");
  });

  test("a pane showing ordinary output is left alone", async () => {
    const { h, socketCalls, herd } = await started();
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(socketCalls.some((c) => c.method === "pane.read")).toBe(true);
    expect(socketCalls.some((c) => c.method === "pane.send_keys")).toBe(false);
  });

  test("a hidden herd runs the trust check on its own socket", async () => {
    const hx = harness();
    hx.screen.text = PLAIN_TRUST;
    const s = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!s.ok) throw new Error(s.error);
    expect((await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" })).ok).toBe(true);
    expect(hx.socketCalls.find((c) => c.method === "pane.send_keys")!.sock).toBe("/tmp/hidden.sock");
  });

  test("a spawn still succeeds when the herdr socket throws on the trust check", async () => {
    const hx = harness({
      herdr: (async (method: string) => {
        if (method === "session.snapshot") return { ok: true, result: { snapshot: { panes: [] } } };
        throw new Error("socket gone");
      }) as unknown as HerdDeps["herdr"],
    });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const res = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(hx.store.getJob(s.data.herd, "job-a")!.pane).toBe("w9:p1");
  });

  // Herd workers depend on claude-only machinery (the reserved chat handle
  // chat:sign-in binds presence to, and the gate-fork --settings hook), so the
  // payload must pin the provider rather than inherit the agent.provider
  // default -- a global `agent.provider = codex` would otherwise degrade every
  // herd silently.
  test("herd:spawn pins provider claude on the agent:start payload", async () => {
    const hx = harness();
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const res = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(hx.agentCalls[0].provider).toBe("claude");
  });

  test("a hidden herd passes its socket to agent:start", async () => {
    const hx = harness();
    const s = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!s.ok) throw new Error(s.error);
    const res = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" });
    expect(res.ok).toBe(true);
    expect(hx.agentCalls[0].herdrSocket).toBe("/tmp/hidden.sock");
  });

  test("a hidden herd's spawn result and status jobs print the pane as a bg: ref; a visible herd's stays bare", async () => {
    const hx = harness();
    const s = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!s.ok) throw new Error(s.error);
    const spawned = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" });
    if (!spawned.ok) throw new Error(spawned.error);
    expect(spawned.data.pane).toBe("bg:w9:p1");
    const status = await hx.h["herd:status"]({ herd: s.data.herd });
    if (!status.ok) throw new Error(status.error);
    expect(status.data.jobs[0]!.pane).toBe("bg:w9:p1");

    const vis = await hx.h["herd:start"]({ ...START, name: "vis" });
    if (!vis.ok) throw new Error(vis.error);
    const visSpawned = await hx.h["herd:spawn"]({ herd: vis.data.herd, job: "job-a", brief: "b", dir: "/t" });
    if (!visSpawned.ok) throw new Error(visSpawned.error);
    expect(visSpawned.data.pane).toBe("w9:p1");
  });

  test("a sign-in that hands back a renamed handle is what the join, the row, and the response carry", async () => {
    const calls: Array<{ verb: string; payload: any }> = [];
    const chat = {
      "chat:sign-in": async (p: any) => { calls.push({ verb: "sign-in", payload: p }); return { ok: true as const, data: { handle: "job-a-2", baseHandle: "job-a", name: "job-a-2", continued: false, reclaimed: false, sessionId: p.sessionId, room: null } }; },
      "chat:join": async (p: any) => { calls.push({ verb: "join", payload: p }); return { ok: true as const, data: { handle: p.handle, memberCount: 1, unread: 0 } }; },
    } as unknown as HerdDeps["chat"];
    const hx = harness({ chat, presenceIdentityForSession: () => ({ handle: "shepherd", baseHandle: "shepherd", name: "shepherd" }) });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const res = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" });
    if (!res.ok) throw new Error(res.error);
    expect(calls.filter((c) => c.verb === "join")[1]!.payload).toMatchObject({ room: s.data.room, handle: "job-a-2" });
    expect(hx.store.getJob(s.data.herd, "job-a")).toMatchObject({ handle: "job-a-2", pane: "w9:p1", agentSession: "sess-w1", agentId: "ag-1" });
    expect(res.data.handle).toBe("job-a-2");
  });

  test("a respawn whose agent:start fails leaves no pane on the row, since the old one is already closed, and keeps the old session", async () => {
    let starts = 0;
    const agent = {
      "agent:start": async (p: any) => {
        starts += 1;
        if (starts > 1) return { ok: false as const, error: "boom" };
        return { ok: true as const, data: { id: "ag-1", sessionId: "sess-w1", paneId: "w9:p1", tabId: "w9:t1", workspaceId: "w9", repo: p.repo, cwd: p.cwd, surface: "herdr", provider: "claude" } };
      },
    } as unknown as HerdDeps["agent"];
    const hx = harness({ agent });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const first = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" });
    if (!first.ok) throw new Error(first.error);
    expect(hx.store.getJob(s.data.herd, "job-a")!.pane).toBe("w9:p1");
    expect((await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", dir: "/t" })).ok).toBe(false);
    expect(hx.herdrCalls).toContainEqual(["pane", "close", "w9:p1"]);
    expect(hx.store.getJob(s.data.herd, "job-a")).toMatchObject({ pane: null, agentSession: "sess-w1", agentId: "ag-1", status: "spawning" });
  });

  test("refuses a bad job name, a new job with no brief, and an unknown herd", async () => {
    const { h, herd } = await started();
    expect((await h["herd:spawn"]({ herd, job: "Bad", brief: "b" })).ok).toBe(false);
    expect((await h["herd:spawn"]({ herd, job: "job-b" })).ok).toBe(false);
    expect((await h["herd:spawn"]({ herd: "nope", job: "job-a", brief: "b" })).ok).toBe(false);
  });

  test("every spawn of a job mints a fresh worker id, so a respawn never inherits the last worker's DMs", async () => {
    let n = 0;
    const hx = harness({ mintWorkerId: (job) => `${job}.w00${++n}` });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const first = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", brief: "b", dir: "/t" });
    if (!first.ok) throw new Error(first.error);
    const second = await hx.h["herd:spawn"]({ herd: s.data.herd, job: "job-a", dir: "/t" });
    if (!second.ok) throw new Error(second.error);
    expect(hx.agentCalls.map((c) => c.handle)).toEqual(["job-a.w001", "job-a.w002"]);
    expect(hx.store.getJob(s.data.herd, "job-a")!.handle).toBe("job-a.w002");
  });
});

describe("herd:spawn {tree} and herd:respawn", () => {
  const Q = [{ id: "q1", label: "Which?", multi: false, options: ["a", "b"] }];
  const REPO = START.repo;

  function claimedTree(name: string, over: Partial<TreeRecord> = {}): TreeRecord {
    const path = mkdtempSync(join(tmpdir(), `rt-herd-tree-${name}-`));
    dirs.push(path);
    return { name, path, kind: "ephemeral", state: "claimed", branch: `br-${name}`, createdAt: "2026-10-16T00:00:00Z", ...over };
  }

  function fakeRegistry(trees: TreeRecord[]): NonNullable<HerdDeps["registry"]> {
    return {
      load: (repo) => (repo === REPO ? trees : []),
      byPath: (path) => {
        const t = trees.find((x) => x.path === path);
        return t ? { repoName: REPO, tree: t.name } : null;
      },
    };
  }

  async function started(trees: TreeRecord[], over: Partial<HerdDeps> = {}) {
    const hx = harness({ registry: fakeRegistry(trees), ...over });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    return { ...hx, herd: s.data.herd };
  }

  test("spawn with tree launches in the registered path without provisioning", async () => {
    const t1 = claimedTree("t1");
    const { h, store, worktreeCalls, agentCalls, herd } = await started([t1]);
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" });
    if (!res.ok) throw new Error(res.error);
    expect(worktreeCalls).toEqual([]);
    expect(agentCalls[0].cwd).toBe(t1.path);
    expect(res.data).toMatchObject({ worktree: t1.path, branch: "br-t1", tree: "t1", wasOnDeck: null });
    expect(store.getJob(herd, "job-a")).toMatchObject({ worktree: t1.path, branch: "br-t1", tree: "t1" });
  });

  test("spawn with tree refuses an unmanaged tree", async () => {
    const { h, agentCalls, worktreeCalls, herd } = await started([claimedTree("t1", { kind: "unmanaged", state: undefined })]);
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('tree "t1" is unmanaged');
    expect(agentCalls).toEqual([]);
    expect(worktreeCalls).toEqual([]);
  });

  test("spawn persists model, effort and account on the job row", async () => {
    const { h, store, herd } = await started([]);
    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: "/t", model: "opus", effort: "high", account: "2" });
    if (!res.ok) throw new Error(res.error);
    expect(store.getJob(herd, "job-a")).toMatchObject({ model: "opus", effort: "high", account: "2" });
    const bare = await h["herd:spawn"]({ herd, job: "job-b", brief: "b", dir: "/t" });
    if (!bare.ok) throw new Error(bare.error);
    expect(store.getJob(herd, "job-b")).toMatchObject({ model: null, effort: null, account: null });
  });

  test("guest spawn keeps tree null so wrap-up cannot dispose the host tree", async () => {
    const t1 = claimedTree("t1");
    const { h, store, worktreeCalls, herd } = await started([t1]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" })).ok).toBe(true);
    const guest = await h["herd:spawn"]({ herd, job: "review-a", brief: "review", tree: "t1" });
    if (!guest.ok) throw new Error(guest.error);
    expect(guest.data).toMatchObject({ worktree: t1.path, tree: null });
    expect(store.getJob(herd, "review-a")!.tree).toBeNull();
    const wrap = await h["herd:wrap-up"]({ herd, dispose: ["review-a"] });
    if (!wrap.ok) throw new Error(wrap.error);
    expect(wrap.data.refused).toEqual([{ tree: "review-a", reason: "no rt-provisioned tree for this job" }]);
    expect(worktreeCalls.filter((c) => c.verb === "dispose")).toEqual([]);
  });

  test("guest spawn ticks the host's reviewerRounds under its latest milestone artifact", async () => {
    const t1 = claimedTree("t1");
    const { h, store, herd } = await started([t1]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" })).ok).toBe(true);
    expect((await h["herd:milestone"]({ herd, job: "job-a", session: "sess-w1", artifact: "/a/spec.md" })).ok).toBe(true);
    const guest = await h["herd:spawn"]({ herd, job: "review-a", brief: "review", tree: "t1" });
    if (!guest.ok) throw new Error(guest.error);
    expect(guest.data.reviewerRound).toEqual({ host: "job-a", key: "/a/spec.md", budget: { used: 1, cap: 2, spent: false } });
    expect(jobBudgets(store.budgetRows(herd, "job-a")).reviewerRounds["/a/spec.md"]).toEqual({ used: 1, cap: 2, spent: false });
    expect(jobBudgets(store.budgetRows(herd, "review-a")).reviewerRounds).toEqual({});
  });

  test("a host spawn returns no reviewerRound", async () => {
    const t1 = claimedTree("t1");
    const { h, herd } = await started([t1]);
    const host = await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" });
    if (!host.ok) throw new Error(host.error);
    expect(host.data.reviewerRound).toBeUndefined();
  });

  test("a job launched with --dir in a tree's path hosts a guest spawned into that tree", async () => {
    const t1 = claimedTree("t1");
    const { h, store, herd } = await started([t1]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: t1.path })).ok).toBe(true);
    const guest = await h["herd:spawn"]({ herd, job: "review-a", brief: "review", tree: "t1" });
    if (!guest.ok) throw new Error(guest.error);
    expect(guest.data.tree).toBeNull();
    expect(guest.data.reviewerRound).toEqual({ host: "job-a", key: "", budget: { used: 1, cap: 2, spent: false } });
    expect(store.getJob(herd, "review-a")!.tree).toBeNull();
  });

  test("spawning an existing job settles its old session's gates after launch", async () => {
    const t1 = claimedTree("t1");
    const { h, gate, gateStore, herd } = await started([t1]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" })).ok).toBe(true);
    const answered = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!answered.ok) throw new Error(answered.error);
    expect((await gate["gate:answer"]({ id: answered.data.gate, answers: { q1: "a" }, by: "console" })).ok).toBe(true);
    const open = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!open.ok) throw new Error(open.error);

    const res = await h["herd:spawn"]({ herd, job: "job-a", brief: "round two", tree: "t1" });
    if (!res.ok) throw new Error(res.error);
    expect(gateStore.get(open.data.gate)).toMatchObject({ status: "closed", closedReason: "abandoned" });
    expect(gateStore.get(answered.data.gate)!.consumedAt).not.toBeNull();
  });

  test("a failed relaunch leaves the old session's gates pending for spawn and respawn alike", async () => {
    for (const verb of ["herd:spawn", "herd:respawn"] as const) {
      let starts = 0;
      const agent = {
        "agent:start": async (p: any) => {
          starts += 1;
          if (starts > 1) return { ok: false as const, error: "boom" };
          return { ok: true as const, data: { id: "ag-1", sessionId: "sess-w1", paneId: "w9:p1", tabId: "w9:t1", workspaceId: "w9", repo: p.repo, cwd: p.cwd, surface: "herdr", provider: "claude" } };
        },
      } as unknown as HerdDeps["agent"];
      const t1 = claimedTree("t1");
      const { h, gate, gateStore, herd } = await started([t1], { agent });
      expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" })).ok).toBe(true);
      const answered = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
      if (!answered.ok) throw new Error(answered.error);
      expect((await gate["gate:answer"]({ id: answered.data.gate, answers: { q1: "a" }, by: "console" })).ok).toBe(true);
      const open = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
      if (!open.ok) throw new Error(open.error);

      const res = verb === "herd:spawn" ? await h["herd:spawn"]({ herd, job: "job-a", tree: "t1" }) : await h["herd:respawn"]({ herd, job: "job-a" });
      expect(res.ok).toBe(false);
      expect(gateStore.get(open.data.gate)!.status).toBe("open");
      expect(gateStore.get(answered.data.gate)!.consumedAt).toBeNull();
    }
  });

  test("a relaunch after a failed one settles the session the failure kept on the row", async () => {
    let starts = 0;
    const agent = {
      "agent:start": async (p: any) => {
        starts += 1;
        if (starts === 2) return { ok: false as const, error: "boom" };
        return { ok: true as const, data: { id: `ag-${starts}`, sessionId: `sess-w${starts}`, paneId: `w9:p${starts}`, tabId: "w9:t1", workspaceId: "w9", repo: p.repo, cwd: p.cwd, surface: "herdr", provider: "claude" } };
      },
    } as unknown as HerdDeps["agent"];
    const t1 = claimedTree("t1");
    const { h, gate, gateStore, store, herd } = await started([t1], { agent });
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" })).ok).toBe(true);
    const answered = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!answered.ok) throw new Error(answered.error);
    expect((await gate["gate:answer"]({ id: answered.data.gate, answers: { q1: "a" }, by: "console" })).ok).toBe(true);
    const open = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!open.ok) throw new Error(open.error);

    expect((await h["herd:respawn"]({ herd, job: "job-a" })).ok).toBe(false);
    expect(store.getJob(herd, "job-a")).toMatchObject({ agentSession: "sess-w1", agentId: "ag-1" });
    expect(gateStore.get(open.data.gate)!.status).toBe("open");
    expect(gateStore.get(answered.data.gate)!.consumedAt).toBeNull();

    const res = await h["herd:respawn"]({ herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.settled).toEqual({ closed: [open.data.gate], consumed: [answered.data.gate] });
    expect(gateStore.get(open.data.gate)).toMatchObject({ status: "closed", closedReason: "abandoned" });
    expect(gateStore.get(answered.data.gate)!.consumedAt).not.toBeNull();
    expect(store.getJob(herd, "job-a")).toMatchObject({ agentSession: "sess-w3", agentId: "ag-3" });
  });

  test("respawn reuses the worktree and inherits model, effort and account", async () => {
    const t1 = claimedTree("t1");
    const { h, worktreeCalls, agentCalls, herd } = await started([t1]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1", model: "opus", effort: "high", account: "2" })).ok).toBe(true);
    const res = await h["herd:respawn"]({ herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(worktreeCalls).toEqual([]);
    expect(agentCalls[1]).toMatchObject({ cwd: t1.path, model: "opus", effort: "high", account: "2" });
    expect(res.data).toMatchObject({ worktree: t1.path, branch: "br-t1", tree: "t1", launch: { model: "opus", effort: "high", account: "2" } });
  });

  test("respawn overrides one setting and keeps the others", async () => {
    const t1 = claimedTree("t1");
    const { h, store, agentCalls, herd } = await started([t1]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1", model: "opus", effort: "high", account: "2" })).ok).toBe(true);
    const res = await h["herd:respawn"]({ herd, job: "job-a", model: "sonnet" });
    if (!res.ok) throw new Error(res.error);
    expect(agentCalls[1]).toMatchObject({ model: "sonnet", effort: "high", account: "2" });
    expect(res.data.launch).toEqual({ model: "sonnet", effort: "high", account: "2" });
    expect(store.getJob(herd, "job-a")).toMatchObject({ model: "sonnet", effort: "high", account: "2" });
  });

  test("respawn refuses a job whose worktree is gone", async () => {
    const t1 = claimedTree("t1");
    const { h, worktreeCalls, agentCalls, herd } = await started([t1]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" })).ok).toBe(true);
    rmSync(t1.path, { recursive: true, force: true });
    const res = await h["herd:respawn"]({ herd, job: "job-a" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(t1.path);
    expect(worktreeCalls).toEqual([]);
    expect(agentCalls).toHaveLength(1);
  });

  test("respawn refuses an unknown job", async () => {
    const { h, herd } = await started([]);
    const res = await h["herd:respawn"]({ herd, job: "ghost" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(`unknown job "ghost" in herd "${herd}"`);
  });

  test("respawn refuses a job whose worktree is not a registered tree", async () => {
    const dirJob = mkdtempSync(join(tmpdir(), "rt-herd-dir-"));
    dirs.push(dirJob);
    const { h, agentCalls, herd } = await started([]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", dir: dirJob })).ok).toBe(true);
    const res = await h["herd:respawn"]({ herd, job: "job-a" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(`job "job-a" worktree ${dirJob} is not a registered tree; respawn it from the CLI with --dir`);
    expect(agentCalls).toHaveLength(1);
  });

  test("respawn refuses a job whose tree is no longer claimed", async () => {
    const t1 = claimedTree("t1");
    const { h, agentCalls, herd } = await started([t1]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" })).ok).toBe(true);
    t1.state = "disposable";
    const res = await h["herd:respawn"]({ herd, job: "job-a" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(`job "job-a" worktree ${t1.path}: tree "t1" is ephemeral and disposable; only a claimed ephemeral tree can host a worker`);
    expect(agentCalls).toHaveLength(1);
  });

  test("respawn settles the old session's run gates in the job's worktree, past the first page of a listing", async () => {
    const t1 = claimedTree("t1");
    const runTrees: Record<string, string> = { "r-other": "/w/elsewhere", "r-job": t1.path };
    const { h: base, deps, gate, gateStore, herd } = await started([t1], { runWorktree: (run) => runTrees[run] ?? null });
    const listCalls: Array<number | undefined> = [];
    const paged = {
      ...gate,
      "gate:list": async (p: any) => { listCalls.push(p?.cursor); return gate["gate:list"]({ ...p, limit: 2 }); },
    } as unknown as HerdDeps["gate"];
    const h = createHerdHandlers({ ...deps, gate: paged });
    expect((await base["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" })).ok).toBe(true);

    const openRun = async (run: string, kind: string, session: string) => {
      const r = await gate["gate:open"]({ subject: `run:${run}`, kind, questions: Q, nudge: { session } });
      if (!r.ok) throw new Error(r.error);
      return r.data.id;
    };
    const decoys = [];
    for (const kind of ["k1", "k2", "k3", "k4"]) {
      const id = await openRun("r-other", kind, "sess-w1");
      expect((await gate["gate:answer"]({ id, answers: { q1: "a" }, by: "console" })).ok).toBe(true);
      decoys.push(id);
    }
    const openGate = await openRun("r-job", "k-open", "sess-w1");
    const answered = await openRun("r-job", "k-answered", "sess-w1");
    expect((await gate["gate:answer"]({ id: answered, answers: { q1: "a" }, by: "console" })).ok).toBe(true);
    const otherSession = await openRun("r-job", "k-other", "sess-other");

    const res = await h["herd:respawn"]({ herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.settled).toEqual({ closed: [openGate], consumed: [answered] });
    expect(gateStore.get(openGate)).toMatchObject({ status: "closed", closedReason: "abandoned" });
    expect(gateStore.get(answered)!.consumedAt).not.toBeNull();
    expect(gateStore.get(otherSession)!.status).toBe("open");
    for (const id of decoys) expect(gateStore.get(id)!.consumedAt).toBeNull();
    expect(listCalls.filter((c) => c !== undefined).length).toBeGreaterThan(1);
  });

  test("respawn ticks respawns and reports spent at 2 but still launches the third", async () => {
    const t1 = claimedTree("t1");
    const { h, agentCalls, herd } = await started([t1]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" })).ok).toBe(true);
    const budgets = [];
    for (let i = 0; i < 3; i++) {
      const res = await h["herd:respawn"]({ herd, job: "job-a" });
      if (!res.ok) throw new Error(res.error);
      budgets.push(res.data.budget);
    }
    expect(budgets).toEqual([{ used: 1, cap: 2, spent: false }, { used: 2, cap: 2, spent: true }, { used: 3, cap: 2, spent: true }]);
    expect(agentCalls).toHaveLength(4);
  });

  test("respawn closes the old session's open gates and settles its answered unconsumed gates", async () => {
    const t1 = claimedTree("t1");
    const { h, gate, gateStore, herd } = await started([t1]);
    expect((await h["herd:spawn"]({ herd, job: "job-a", brief: "b", tree: "t1" })).ok).toBe(true);
    const answered = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!answered.ok) throw new Error(answered.error);
    expect((await gate["gate:answer"]({ id: answered.data.gate, answers: { q1: "a" }, by: "console" })).ok).toBe(true);
    const open = await h["herd:ask"]({ herd, job: "job-a", session: "sess-w1", questions: Q });
    if (!open.ok) throw new Error(open.error);
    const otherSession = await h["herd:milestone"]({ herd, job: "job-a", session: "sess-other", artifact: "/a/spec.md" });
    if (!otherSession.ok) throw new Error(otherSession.error);

    const res = await h["herd:respawn"]({ herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.settled).toEqual({ closed: [open.data.gate], consumed: [answered.data.gate] });
    expect(gateStore.get(open.data.gate)).toMatchObject({ status: "closed", closedReason: "abandoned" });
    expect(gateStore.get(answered.data.gate)!.consumedAt).not.toBeNull();
    expect(gateStore.get(otherSession.data.gate)!.status).toBe("open");
  });
});

describe("herd:gates", () => {
  test("lists herd-prefixed gates plus run gates whose worktree matches a job", async () => {
    const hx = harness({ runWorktree: (id) => (id === "run-1" ? "/w/job-a" : id === "run-2" ? "/elsewhere" : null) });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const herd = s.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active" });
    const Q = [{ id: "q", label: "?", multi: false, options: ["a"] }];
    const g1 = hx.gateStore.open({ subject: `herd:${herd}/job-a`, kind: "question", questions: Q }).row.id;
    const g2 = hx.gateStore.open({ subject: "run:run-1", kind: "clarify", questions: Q }).row.id;
    hx.gateStore.open({ subject: "run:run-2", kind: "clarify", questions: Q });
    hx.gateStore.open({ subject: "run:run-3", kind: "clarify", questions: Q });
    const res = await hx.h["herd:gates"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.gates.map((g) => g.id).sort()).toEqual([g1, g2].sort());
  });

  test("lists herd and run gates that sit past the first page of a listing", async () => {
    const hx = harness({ runWorktree: (id) => (id === "run-job" ? "/w/job-a" : "/elsewhere") });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const herd = s.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active" });
    const Q = [{ id: "q", label: "?", multi: false, options: ["a"] }];
    const own = hx.gateStore.open({ subject: `herd:${herd}/job-a`, kind: "question", questions: Q }).row.id;
    for (const kind of ["k1", "k2", "k3", "k4"]) hx.gateStore.open({ subject: "run:run-other", kind, questions: Q });
    const run = hx.gateStore.open({ subject: "run:run-job", kind: "clarify", questions: Q }).row.id;
    const listCalls: Array<number | undefined> = [];
    const paged = {
      ...hx.deps.gate,
      "gate:list": async (p: any) => { listCalls.push(p?.cursor); return hx.deps.gate["gate:list"]({ ...p, limit: 2 }); },
    } as unknown as HerdDeps["gate"];
    const h = createHerdHandlers({ ...hx.deps, gate: paged });
    const res = await h["herd:gates"]({ herd });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.gates.map((g) => g.id).sort()).toEqual([own, run].sort());
    expect(listCalls.filter((c) => c !== undefined).length).toBeGreaterThan(1);
  });

  test("includeParked adds this herd's parked gates, never another herd's, and the default stays open-only", async () => {
    const hx = harness({ runWorktree: (id) => (id === "run-1" ? "/w/job-a" : null) });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const herd = s.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active" });
    const Q = [{ id: "q", label: "?", multi: false, options: ["a"] }];
    const own = hx.gateStore.open({ subject: `herd:${herd}/job-a`, kind: "question", questions: Q }).row.id;
    const run = hx.gateStore.open({ subject: "run:run-1", kind: "clarify", questions: Q }).row.id;
    const other = hx.gateStore.open({ subject: "herd:hd-other/job-a", kind: "question", questions: Q }).row.id;
    for (const id of [own, run, other]) hx.gateStore.park(id);
    const open = await hx.h["herd:gates"]({ herd });
    if (!open.ok) throw new Error(open.error);
    expect(open.data.gates).toEqual([]);
    const live = await hx.h["herd:gates"]({ herd, includeParked: true });
    if (!live.ok) throw new Error(live.error);
    expect(live.data.gates.map((g) => g.id).sort()).toEqual([own, run].sort());
  });
});

describe("herd:diagnose", () => {
  const LIMIT_SCREEN = ["⏺ Working.", "  ⎿  You've hit your session limit · resets 5pm", "─".repeat(40), "> ", "─".repeat(40), "  ? for shortcuts"].join("\n");

  async function started(over: Partial<HerdDeps> = {}) {
    const reads: Array<{ pane: string; socket: string | null }> = [];
    const hx = harness({
      paneScreen: async (pane, socket) => { reads.push({ pane, socket }); return LIMIT_SCREEN; },
      ...over,
    });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    return { ...hx, herd: s.data.herd, reads };
  }

  test("diagnose returns verdict, gates and budgets but never screen text", async () => {
    const watchdog: NonNullable<HerdDeps["watchdog"]> = { annotations: (_h, job) => (job === "job-a" ? { strikes: 1, lastPokeAt: 99 } : null) };
    const { h, store, gateStore, snapshotPanes, herd, reads } = await started({ watchdog, runWorktree: (id) => (id === "run-1" ? "/w/job-a" : "/elsewhere") });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    store.upsertJob({ herd, name: "job-b", worktree: "/w/job-b", handle: "job-b", status: "active", pane: "w9:p2" });
    store.tickBudget(herd, "job-a", "respawns");
    snapshotPanes.rows = [{ pane_id: "w9:p1", agent: "claude", agent_status: "idle" }];
    const Q = [{ id: "q", label: "?", multi: false, options: ["a"] }];
    const answered = gateStore.open({ subject: herdSubject(herd, "job-a"), kind: "question", questions: Q, nudge: { session: "sess-w1" } }).row.id;
    gateStore.answer(answered, { q: "a" }, "shepherd");
    store.setJobStatus(herd, "job-a", "active", { lastGate: answered });
    gateStore.open({ subject: herdSubject(herd, "job-b"), kind: "question", questions: Q });
    gateStore.open({ subject: "run:run-2", kind: "clarify", questions: Q });

    const res = await h["herd:diagnose"]({ herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toMatchObject({
      job: "job-a", status: "active", pane: "w9:p1", paneState: "idle", verdict: "rate-limited", openGates: [],
      lastGate: { id: answered, status: "answered", consumed: false },
      watchdog: { strikes: 1, lastPokeAt: 99 },
    });
    expect(res.data.budgets.respawns).toEqual({ used: 1, cap: 2, spent: false });
    expect(reads).toEqual([{ pane: "w9:p1", socket: null }]);
    expect(JSON.stringify(res.data)).not.toContain("hit your");
  });

  test("diagnose lists the job's own open gates and its run gates, with presentation and owner", async () => {
    const { h, store, gateStore, herd, reads } = await started({ runWorktree: (id) => (id === "run-1" ? "/w/job-a" : "/elsewhere") });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "at-gate", pane: "w9:p1" });
    const Q = [{ id: "q", label: "?", multi: false, options: ["a"] }];
    const own = gateStore.open({ subject: herdSubject(herd, "job-a"), kind: "question", questions: Q }).row.id;
    const run = gateStore.open({ subject: "run:run-1", kind: "clarify", questions: Q }).row.id;
    gateStore.open({ subject: "run:run-2", kind: "clarify", questions: Q });
    const res = await h["herd:diagnose"]({ herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.verdict).toBe("at-gate");
    expect(res.data.openGates).toEqual([
      { id: own, kind: "question", presentation: "wait", owner: "human" },
      { id: run, kind: "clarify", presentation: "wait", owner: "human" },
    ]);
    expect(res.data.watchdog).toBeNull();
    expect(reads).toEqual([]);
  });

  test("diagnose does not read the screen of a working pane", async () => {
    const { h, store, herd, reads } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    const res = await h["herd:diagnose"]({ herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toMatchObject({ paneState: "working", verdict: "working" });
    expect(reads).toEqual([]);
  });

  test("diagnose reads a hidden herd's screen on its own socket with the bare pane id", async () => {
    const reads: Array<{ pane: string; socket: string | null }> = [];
    const { h, store, snapshotPanes, socketCalls } = harness({ paneScreen: async (pane, socket) => { reads.push({ pane, socket }); return LIMIT_SCREEN; } });
    const s = await h["herd:start"]({ ...START, hidden: true });
    if (!s.ok) throw new Error(s.error);
    const herd = s.data.herd;
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "bg:w9:p1" });
    snapshotPanes.rows = [{ pane_id: "w9:p1", agent: "claude", agent_status: "done" }];
    const res = await h["herd:diagnose"]({ herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.verdict).toBe("rate-limited");
    expect(reads).toEqual([{ pane: "w9:p1", socket: "/tmp/hidden.sock" }]);
    expect(socketCalls.filter((c) => c.method === "session.snapshot").at(-1)!.sock).toBe("/tmp/hidden.sock");
  });

  test("diagnose's default screen read asks herdr for the visible screen", async () => {
    const hx = harness();
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    hx.store.upsertJob({ herd: s.data.herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    hx.snapshotPanes.rows = [{ pane_id: "w9:p1", agent: "claude", agent_status: "idle" }];
    hx.screen.text = ["Login expired · Please run /login", "─".repeat(40), "> ", "─".repeat(40)].join("\n");
    const res = await hx.h["herd:diagnose"]({ herd: s.data.herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.verdict).toBe("login-expired");
    expect(hx.socketCalls.find((c) => c.method === "pane.read")!.params).toEqual({ pane_id: "w9:p1", source: "visible" });
  });

  test("diagnose refuses to guess when herdr is unreachable", async () => {
    const { h, store, herd, reads } = await started({
      herdr: (async () => ({ ok: false, code: "unavailable", message: "no socket" })) as unknown as HerdDeps["herdr"],
    });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    const res = await h["herd:diagnose"]({ herd, job: "job-a" });
    expect(res).toEqual({ ok: false, error: "herdr is unreachable on the default socket; the pane's state is unknown" });
    expect(reads).toEqual([]);
  });

  test("diagnose treats a malformed snapshot reply as unreachable, not gone", async () => {
    const { h, store, herd } = await started({
      herdr: (async () => ({ ok: true, result: {} })) as unknown as HerdDeps["herdr"],
    });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    const res = await h["herd:diagnose"]({ herd, job: "job-a" });
    expect(res.ok).toBe(false);
  });

  test("diagnose reads a throwing screen read as no screen", async () => {
    const { h, store, snapshotPanes, herd } = await started({ paneScreen: async () => { throw new Error("boom"); } });
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w9:p1" });
    snapshotPanes.rows = [{ pane_id: "w9:p1", agent: "claude", agent_status: "idle" }];
    const res = await h["herd:diagnose"]({ herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toMatchObject({ paneState: "idle", verdict: "idle" });
  });

  test("diagnose reports no-pane for a job without a pane", async () => {
    const { h, store, herd, reads } = await started();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "spawning" });
    const res = await h["herd:diagnose"]({ herd, job: "job-a" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toMatchObject({ pane: null, paneState: null, verdict: "no-pane", lastGate: null });
    expect(reads).toEqual([]);
  });

  test("diagnose refuses an unknown job", async () => {
    const { h, herd } = await started();
    const res = await h["herd:diagnose"]({ herd, job: "ghost" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe(`unknown job "ghost" in herd "${herd}"`);
  });
});

describe("herd:nudge", () => {
  const Q = [{ id: "q", label: "?", multi: false, options: ["a"] }];

  async function nudgeable(over: Partial<HerdDeps> = {}) {
    const injects: Array<{ paneId: string; text: string; sockPath?: string }> = [];
    const delivery: { result: Awaited<ReturnType<NonNullable<HerdDeps["inject"]>>> } = { result: { ok: true, data: { paneId: "w9:p1", delivered: "accepted" } } };
    const hx = harness({
      inject: async (o) => { injects.push({ paneId: o.paneId, text: o.text, ...(o.sockPath && { sockPath: o.sockPath }) }); return delivery.result; },
      runWorktree: (id) => (id === "run-1" ? "/w/job-a" : "/elsewhere"),
      ...over,
    });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const herd = s.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a.w001", status: "active", pane: "w9:p1", agentSession: "sess-w1" });
    hx.snapshotPanes.rows = [{ pane_id: "w9:p1", agent: "claude", agent_status: "idle" }];
    const gate = hx.gateStore.open({ subject: herdSubject(herd, "job-a"), kind: "question", questions: Q, nudge: { session: "sess-w1" } }).row.id;
    hx.gateStore.answer(gate, { q: "a" }, "shepherd");
    return { ...hx, herd, gate, injects, delivery };
  }

  const paneLine = (gate: string) => `shepherd: gate ${gate} is answered; call herd_answer {gate: "${gate}"} and act on it.`;

  test("first nudge DMs the job handle from the shepherd and ticks", async () => {
    const { h, herd, gate, chatCalls, injects, store } = await nudgeable();
    const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toEqual({ gate, rung: "dm", delivered: true, needsHuman: false, budget: { used: 1, cap: 2, spent: false } });
    expect(chatCalls.filter((c) => c.verb === "dm").map((c) => c.payload)).toEqual([{ from: "shepherd", to: "job-a.w001", body: `call herd_answer for ${gate}` }]);
    expect(injects).toEqual([]);
    expect(store.budgetRows(herd, "job-a")).toEqual([{ counter: "nudges", key: gate, used: 1 }]);
  });

  test("second nudge types into an idle pane with no form gate", async () => {
    const { h, herd, gate, injects, chatCalls } = await nudgeable();
    await h["herd:nudge"]({ herd, job: "job-a", gate });
    const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toEqual({ gate, rung: "pane", delivered: true, needsHuman: false, budget: { used: 2, cap: 2, spent: true } });
    expect(injects).toEqual([{ paneId: "w9:p1", text: paneLine(gate) }]);
    expect(chatCalls.filter((c) => c.verb === "dm")).toHaveLength(1);
  });

  test("a hidden herd's pane nudge goes to the bare pane on its own socket", async () => {
    const injects: Array<{ paneId: string; sockPath?: string }> = [];
    const hx = harness({ inject: async (o) => { injects.push({ paneId: o.paneId, sockPath: o.sockPath }); return { ok: true, data: { paneId: o.paneId, delivered: "accepted" } }; } });
    const s = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!s.ok) throw new Error(s.error);
    const herd = s.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "bg:w9:p1", agentSession: "sess-w1" });
    hx.snapshotPanes.rows = [{ pane_id: "w9:p1", agent: "claude", agent_status: "idle" }];
    const gate = hx.gateStore.open({ subject: herdSubject(herd, "job-a"), kind: "question", questions: Q, nudge: { session: "sess-w1" } }).row.id;
    hx.gateStore.answer(gate, { q: "a" }, "shepherd");
    hx.store.tickBudget(herd, "job-a", "nudges", gate);
    const res = await hx.h["herd:nudge"]({ herd, job: "job-a", gate });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.delivered).toBe(true);
    expect(injects).toEqual([{ paneId: "w9:p1", sockPath: "/tmp/hidden.sock" }]);
  });

  for (const failing of ["herd:", "run:"]) {
    test(`a pane nudge refuses when the ${failing} gate listing fails, rather than read no form open`, async () => {
      const { deps, herd, gate, injects, store } = await nudgeable();
      store.tickBudget(herd, "job-a", "nudges", gate);
      const broken = {
        ...deps.gate,
        "gate:list": async (p: any) => (p?.subjectPrefix?.startsWith(failing) ? { ok: false, error: "db locked" } : deps.gate["gate:list"](p)),
      } as unknown as HerdDeps["gate"];
      const h = createHerdHandlers({ ...deps, gate: broken });
      const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
      expect(res).toEqual({ ok: false, error: "could not list the job's open gates (db locked); whether a form is open is unknown" });
      expect(injects).toEqual([]);
      expect(store.budgetRows(herd, "job-a")).toEqual([{ counter: "nudges", key: gate, used: 1 }]);
    });
  }

  test("second nudge with a form-presentation gate open returns form-open and does not tick", async () => {
    const { h, herd, gate, gateStore, injects, store } = await nudgeable();
    store.tickBudget(herd, "job-a", "nudges", gate);
    gateStore.open({ subject: "run:run-1", kind: "clarify", questions: Q, origin: { paneId: "w9:p1", presentation: "form" } });
    const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toEqual({ gate, rung: "pane", delivered: false, needsHuman: true, why: "form-open", budget: { used: 1, cap: 2, spent: false } });
    expect(injects).toEqual([]);
    expect(store.budgetRows(herd, "job-a")).toEqual([{ counter: "nudges", key: gate, used: 1 }]);
  });

  test("an open wait-presentation gate does not block the pane nudge", async () => {
    const { h, herd, gate, gateStore, injects, store } = await nudgeable();
    store.tickBudget(herd, "job-a", "nudges", gate);
    gateStore.open({ subject: herdSubject(herd, "job-a"), kind: "question", questions: Q });
    const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.delivered).toBe(true);
    expect(injects).toHaveLength(1);
  });

  test("second nudge on a working pane returns pane-busy and does not tick", async () => {
    const { h, herd, gate, injects, store, snapshotPanes } = await nudgeable();
    store.tickBudget(herd, "job-a", "nudges", gate);
    snapshotPanes.rows = [{ pane_id: "w9:p1", agent: "claude", agent_status: "working" }];
    const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toMatchObject({ rung: "pane", delivered: false, needsHuman: true, why: "pane-busy", budget: { used: 1 } });
    expect(injects).toEqual([]);
  });

  test("a pane rung reports pane-gone, not-claude and a modal without typing", async () => {
    const { h, herd, gate, injects, store, snapshotPanes } = await nudgeable();
    store.tickBudget(herd, "job-a", "nudges", gate);
    snapshotPanes.rows = [];
    expect((await h["herd:nudge"]({ herd, job: "job-a", gate }) as any).data.why).toBe("pane-gone");
    snapshotPanes.rows = [{ pane_id: "w9:p1", agent_status: "idle" }];
    expect((await h["herd:nudge"]({ herd, job: "job-a", gate }) as any).data.why).toBe("not-claude");
    snapshotPanes.rows = [{ pane_id: "w9:p1", agent: "claude", agent_status: "blocked" }];
    expect((await h["herd:nudge"]({ herd, job: "job-a", gate }) as any).data.why).toBe("form-open");
    expect(injects).toEqual([]);
    expect(store.budgetRows(herd, "job-a")).toEqual([{ counter: "nudges", key: gate, used: 1 }]);
  });

  test("a job with no pane reports pane-gone on the pane rung", async () => {
    const { h, herd, gate, store, injects } = await nudgeable();
    store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a.w001", status: "active", pane: null, agentSession: "sess-w1" });
    store.tickBudget(herd, "job-a", "nudges", gate);
    const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toMatchObject({ delivered: false, needsHuman: true, why: "pane-gone" });
    expect(injects).toEqual([]);
  });

  test("an unreachable herdr refuses the pane rung and ticks nothing", async () => {
    const { h, herd, gate, store, injects } = await nudgeable({
      herdr: (async () => ({ ok: false, code: "unavailable", message: "no socket" })) as unknown as HerdDeps["herdr"],
    });
    store.tickBudget(herd, "job-a", "nudges", gate);
    const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
    expect(res).toEqual({ ok: false, error: "herdr is unreachable on the default socket; the pane's state is unknown" });
    expect(injects).toEqual([]);
    expect(store.budgetRows(herd, "job-a")).toEqual([{ counter: "nudges", key: gate, used: 1 }]);
  });

  test("injector refusal returns refused, needsHuman, no tick", async () => {
    const { h, herd, gate, store, delivery } = await nudgeable();
    store.tickBudget(herd, "job-a", "nudges", gate);
    for (const result of [
      { ok: true as const, data: { paneId: "w9:p1", delivered: "refused" as const, reason: "draft in composer" } },
      { ok: true as const, data: { paneId: "w9:p1", delivered: "queued" as const } },
      { ok: false as const, error: "herdr went away" },
    ]) {
      delivery.result = result;
      const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
      if (!res.ok) throw new Error(res.error);
      expect(res.data).toMatchObject({ rung: "pane", delivered: false, needsHuman: true, why: "refused", budget: { used: 1 } });
    }
    expect(store.budgetRows(herd, "job-a")).toEqual([{ counter: "nudges", key: gate, used: 1 }]);
  });

  test("third nudge still acts and reports spent", async () => {
    const { h, herd, gate, injects } = await nudgeable();
    await h["herd:nudge"]({ herd, job: "job-a", gate });
    await h["herd:nudge"]({ herd, job: "job-a", gate });
    const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toEqual({ gate, rung: "pane", delivered: true, needsHuman: false, budget: { used: 3, cap: 2, spent: true } });
    expect(injects).toHaveLength(2);
  });

  test("a DM failure returns its error and ticks nothing", async () => {
    const { h, herd, gate, store, deps } = await nudgeable();
    deps.chat["chat:dm"] = async () => ({ ok: false, error: "chat: dm failed (retry budget exhausted)" });
    const res = await h["herd:nudge"]({ herd, job: "job-a", gate });
    expect(res).toEqual({ ok: false, error: "chat: dm failed (retry budget exhausted)" });
    expect(store.budgetRows(herd, "job-a")).toEqual([]);
  });

  test("refuses a gate that is not this job's, an unanswered gate, a consumed gate, and a gate from a replaced session", async () => {
    const { h, herd, gate, gateStore, store, chatCalls, injects } = await nudgeable();
    store.upsertJob({ herd, name: "job-b", worktree: "/w/job-b", handle: "job-b", status: "active", pane: "w9:p2", agentSession: "sess-w2" });
    const other = gateStore.open({ subject: herdSubject(herd, "job-b"), kind: "question", questions: Q, nudge: { session: "sess-w1" } }).row.id;
    gateStore.answer(other, { q: "a" }, "shepherd");
    const elsewhere = gateStore.open({ subject: "run:run-2", kind: "clarify", questions: Q, nudge: { session: "sess-w1" } }).row.id;
    gateStore.answer(elsewhere, { q: "a" }, "shepherd");
    const unanswered = gateStore.open({ subject: "run:run-1", kind: "clarify", questions: Q, nudge: { session: "sess-w1" } }).row.id;
    const consumed = gateStore.open({ subject: herdSubject(herd, "job-a"), kind: "question", questions: Q, nudge: { session: "sess-w1" } }).row.id;
    gateStore.answer(consumed, { q: "a" }, "shepherd");
    gateStore.markConsumed(consumed);
    const stale = gateStore.open({ subject: herdSubject(herd, "job-a"), kind: "question", questions: Q, nudge: { session: "sess-old" } }).row.id;
    gateStore.answer(stale, { q: "a" }, "shepherd");

    const refusal = async (g: string) => {
      const res = await h["herd:nudge"]({ herd, job: "job-a", gate: g });
      if (res.ok) throw new Error(`nudged ${g}`);
      return res.error;
    };
    expect(await refusal(other)).toContain("not job \"job-a\"'s");
    expect(await refusal(elsewhere)).toContain("not job \"job-a\"'s");
    expect(await refusal("gate-missing")).toBe("gate not found: gate-missing");
    expect(await refusal(unanswered)).toContain("is open, not answered");
    expect(await refusal(consumed)).toContain("already consumed");
    expect(await refusal(stale)).toContain("stale");
    expect(store.budgetRows(herd, "job-a")).toEqual([]);
    expect(chatCalls.filter((c) => c.verb === "dm")).toEqual([]);
    expect(injects).toEqual([]);
    expect((await h["herd:nudge"]({ herd, job: "job-a", gate })).ok).toBe(true);
  });

  test("a run gate in the job's worktree can be nudged", async () => {
    const { h, herd, gateStore } = await nudgeable();
    const run = gateStore.open({ subject: "run:run-1", kind: "clarify", questions: Q, nudge: { session: "sess-w1" } }).row.id;
    gateStore.answer(run, { q: "a" }, "shepherd");
    const res = await h["herd:nudge"]({ herd, job: "job-a", gate: run });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toMatchObject({ gate: run, rung: "dm", delivered: true });
  });
});

describe("hidden verbs", () => {
  test("attend resolves the hidden pane's terminal and opens an attached tab in the caller's workspace", async () => {
    const hx = harness({
      herdrRunnerFor: (socket) => async (args) => {
        hx.herdrCalls.push([socket ?? "default", ...args]);
        if (args[0] === "pane" && args[1] === "get") return { stdout: JSON.stringify({ result: { pane: { terminal_id: "term-7" } } }), exitCode: 0 };
        if (args[0] === "tab" && args[1] === "create") return { stdout: JSON.stringify({ result: { root_pane: { pane_id: "wv:p9", tab_id: "wv:t9", workspace_id: "wv" } } }), exitCode: 0 };
        return { stdout: "{}", exitCode: 0 };
      },
    });
    const s = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!s.ok) throw new Error(s.error);
    hx.store.upsertJob({ herd: s.data.herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "bg:wh:p1" });
    const res = await hx.h["herd:attend"]({ herd: s.data.herd, job: "job-a", callerWorkspace: "wv" });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toEqual({ tab: "wv:t9", pane: "bg:wh:p1" });
    expect(hx.herdrCalls).toContainEqual(["/tmp/hidden.sock", "pane", "get", "wh:p1"]);
    expect(hx.herdrCalls).toContainEqual(["default", "tab", "create", "--workspace", "wv", "--label", "attend: job-a", "--focus"]);
    const run = hx.herdrCalls.find((c) => c[1] === "pane" && c[2] === "run")!;
    expect(run[3]).toBe("wv:p9");
    expect(run[4]).toContain("terminal attach term-7 --takeover");
    expect(run[4]).toContain("HERDR_SESSION=bg");
  });

  test("attend on a visible herd is a no-op with a message", async () => {
    const hx = harness();
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    hx.store.upsertJob({ herd: s.data.herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "w9:p1" });
    const res = await hx.h["herd:attend"]({ herd: s.data.herd, job: "job-a", callerWorkspace: "wv" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatch(/not hidden/);
  });

  // termId rides unquoted into the `terminal attach` shell line, so a
  // non-string (or shell-unsafe) terminal_id must fall through to the
  // existing "no terminal id" error rather than being trusted.
  test("attend rejects a non-string terminal_id", async () => {
    const hx = harness({
      herdrRunnerFor: (socket) => async (args) => {
        hx.herdrCalls.push([socket ?? "default", ...args]);
        if (args[0] === "pane" && args[1] === "get") return { stdout: JSON.stringify({ result: { pane: { terminal_id: 7 } } }), exitCode: 0 };
        return { stdout: "{}", exitCode: 0 };
      },
    });
    const s = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!s.ok) throw new Error(s.error);
    hx.store.upsertJob({ herd: s.data.herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "bg:wh:p1" });
    const res = await hx.h["herd:attend"]({ herd: s.data.herd, job: "job-a", callerWorkspace: "wv" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatch(/no terminal id/);
    expect(hx.herdrCalls.some((c) => c[1] === "tab" && c[2] === "create")).toBe(false);
  });

  test("attend fails cleanly when tab create exits zero with output that is not JSON", async () => {
    const hx = harness({
      herdrRunnerFor: (socket) => async (args) => {
        hx.herdrCalls.push([socket ?? "default", ...args]);
        if (args[0] === "pane" && args[1] === "get") return { stdout: JSON.stringify({ result: { pane: { terminal_id: "term-7" } } }), exitCode: 0 };
        if (args[0] === "tab" && args[1] === "create") return { stdout: "nope", exitCode: 0 };
        return { stdout: "{}", exitCode: 0 };
      },
    });
    const s = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!s.ok) throw new Error(s.error);
    hx.store.upsertJob({ herd: s.data.herd, name: "job-a", worktree: "/w", handle: "job-a", status: "active", pane: "bg:wh:p1" });
    const res = await hx.h["herd:attend"]({ herd: s.data.herd, job: "job-a", callerWorkspace: "wv" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatch(/invalid JSON/);
    expect(hx.herdrCalls.some((c) => c[1] === "pane" && c[2] === "run")).toBe(false);
  });

  test("stop-hidden returns the failure when the herdr stop fails", async () => {
    const hx = harness({
      bg: {
        socketPath: () => "/tmp/hidden.sock", up: async () => true, ensure: async () => ({ socket: "/tmp/hidden.sock", started: false }),
        stop: async () => { throw new Error("herdr session stop failed: no such session"); },
        reprobe: async () => ({ ok: true, drift: [] }), lastParity: () => null,
      },
    });
    const res = await hx.h["herd:stop-hidden"]({});
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toMatch(/no such session/);
  });

  test("stop-hidden refuses while the hidden herd's claim is held, then stops once wrap-up releases it", async () => {
    const hx = harness();
    const s = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!s.ok) throw new Error(s.error);
    const refused = await hx.h["herd:stop-hidden"]({});
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.error).toContain(`herd:${s.data.herd}`);
    expect((await hx.h["herd:wrap-up"]({ herd: s.data.herd, closePanes: true })).ok).toBe(true);
    const res = await hx.h["herd:stop-hidden"]({});
    expect(res.ok).toBe(true);
    expect(hx.bgStopCalls()).toBe(1);
  });

  test("stop-hidden refuses on a foreign claim, naming it", async () => {
    const hx = harness();
    hx.claims.claim("runner:999");
    const res = await hx.h["herd:stop-hidden"]({});
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toContain("runner:999");
    expect(hx.bgStopCalls()).toBe(0);
  });
});

describe("herd:wrap-up", () => {
  async function withTwoJobs() {
    const hx = harness();
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const herd = s.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", branch: "job-a", tree: "slot-a", handle: "job-a", status: "done", pane: "w9:p1" });
    hx.store.upsertJob({ herd, name: "job-b", worktree: "/w/job-b", branch: "job-b", tree: "slot-b", handle: "job-b", status: "done", pane: "w9:p2" });
    mkdirSync(join(hx.dir, "herds", herd, "job-a"), { recursive: true });
    return { ...hx, herd, room: s.data.room };
  }

  // Matt's ruling (RT-118 item 5): the herd:<id> claim releases only once the
  // panes actually close -- --close-panes, after the closes succeed -- never
  // on a bare wrap-up. Anything short of that leaves the claim for the
  // lifecycle's pane-close path or the boot sweep to release later.
  test("wrap-up --close-panes releases a hidden herd's bg claim; a visible herd holds none to release", async () => {
    const hx = harness();
    const hidden = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!hidden.ok) throw new Error(hidden.error);
    expect(hx.claims.list().map((c) => c.owner)).toContain(`herd:${hidden.data.herd}`);
    expect((await hx.h["herd:wrap-up"]({ herd: hidden.data.herd, closePanes: true })).ok).toBe(true);
    expect(hx.claims.list().map((c) => c.owner)).not.toContain(`herd:${hidden.data.herd}`);

    const visible = await hx.h["herd:start"]({ ...START, name: "vis" });
    if (!visible.ok) throw new Error(visible.error);
    expect((await hx.h["herd:wrap-up"]({ herd: visible.data.herd, closePanes: true })).ok).toBe(true);
    expect(hx.claims.list()).toEqual([]);
  });

  // Review fix (item 5, IMPORTANT): closePane is best-effort and
  // setJobStatus marks every attempted job "closed" regardless, so the
  // release must be gated on real success, not on the flag alone.
  test("wrap-up --close-panes releases the claim once every attempted pane close succeeds", async () => {
    const hx = harness();
    const hidden = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!hidden.ok) throw new Error(hidden.error);
    const herd = hidden.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "done", pane: "bg:w9:p1" });
    const res = await hx.h["herd:wrap-up"]({ herd, closePanes: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.closed).toEqual(["job-a"]);
    // The stored value is a bg: ref; the herdr CLI only knows the bare id.
    expect(hx.herdrCalls).toContainEqual(["pane", "close", "w9:p1"]);
    expect(hx.claims.list().map((c) => c.owner)).not.toContain(`herd:${herd}`);
  });

  test("wrap-up --close-panes keeps the claim when every attempted pane close fails", async () => {
    const hx = harness({ herdrRunnerFor: () => async (args: string[]) => (args[0] === "pane" && args[1] === "close" ? { stdout: "", exitCode: 1 } : { stdout: "{}", exitCode: 0 }) });
    const hidden = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!hidden.ok) throw new Error(hidden.error);
    const herd = hidden.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "done", pane: "bg:w9:p1" });
    const res = await hx.h["herd:wrap-up"]({ herd, closePanes: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.closed).toEqual([]);
    expect(hx.store.getJob(herd, "job-a")!.status).toBe("done");
    expect(hx.claims.list().map((c) => c.owner)).toContain(`herd:${herd}`);
  });

  // CodeRabbit (PR #222): a failed close must not stamp the job "closed" --
  // that forced status made a *second* wrap-up call see the job as already
  // handled (skipped, not attempted), so `failed` came back empty and the
  // claim was released while the pane was still alive. Status now reflects
  // reality: only a close that actually succeeds moves the job to "closed",
  // so a retry re-attempts it for real.
  test("a failed close keeps the claim and the job pane-bearing; a retry that succeeds then releases it", async () => {
    let closeCalls = 0;
    const hx = harness({
      herdrRunnerFor: () => async (args: string[]) => {
        if (args[0] === "pane" && args[1] === "close") {
          closeCalls += 1;
          return closeCalls === 1 ? { stdout: "", exitCode: 1 } : { stdout: "", exitCode: 0 };
        }
        return { stdout: "{}", exitCode: 0 };
      },
    });
    const hidden = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!hidden.ok) throw new Error(hidden.error);
    const herd = hidden.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "done", pane: "bg:w9:p1" });

    const first = await hx.h["herd:wrap-up"]({ herd, closePanes: true });
    if (!first.ok) throw new Error(first.error);
    expect(first.data.closed).toEqual([]);
    expect(hx.store.getJob(herd, "job-a")!.status).not.toBe("closed");
    expect(hx.store.getJob(herd, "job-a")!.pane).toBe("bg:w9:p1");
    expect(hx.claims.list().map((c) => c.owner)).toContain(`herd:${herd}`);

    const second = await hx.h["herd:wrap-up"]({ herd, closePanes: true });
    if (!second.ok) throw new Error(second.error);
    expect(second.data.closed).toEqual(["job-a"]);
    expect(hx.store.getJob(herd, "job-a")!.status).toBe("closed");
    expect(hx.claims.list().map((c) => c.owner)).not.toContain(`herd:${herd}`);
  });

  test("wrap-up without --close-panes leaves a hidden herd's bg claim; bg:stop then refuses, naming it", async () => {
    const hx = harness();
    const hidden = await hx.h["herd:start"]({ ...START, hidden: true });
    if (!hidden.ok) throw new Error(hidden.error);
    expect(hx.claims.list().map((c) => c.owner)).toContain(`herd:${hidden.data.herd}`);

    expect((await hx.h["herd:wrap-up"]({ herd: hidden.data.herd })).ok).toBe(true);
    expect(hx.claims.list().map((c) => c.owner)).toContain(`herd:${hidden.data.herd}`);

    const bgHandlers = createBgHandlers({
      service: hx.bg,
      claims: hx.claims,
      lifecycle: { watch: () => {}, sweepClaims: async () => {} },
    });
    const stopRes = await bgHandlers["bg:stop"]({});
    expect(stopRes.ok).toBe(false);
    if (stopRes.ok) throw new Error("unreachable");
    expect(stopRes.error).toContain(`herd:${hidden.data.herd}`);
  });

  test("runs exactly the flagged actions: panes, workspace, dispose by registry tree name, job dirs, archive", async () => {
    const { h, store, herdrCalls, worktreeCalls, chatCalls, herd, room, dir } = await withTwoJobs();
    const res = await h["herd:wrap-up"]({ herd, closePanes: true, dispose: ["job-a"], deleteJobDirs: true, archiveRoom: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toEqual({ closed: ["job-a", "job-b"], workspaceClosed: true, disposed: ["slot-a"], refused: [], deletedJobDirs: true, archived: true });
    expect(herdrCalls).toContainEqual(["pane", "close", "w9:p1"]);
    expect(herdrCalls).toContainEqual(["pane", "close", "w9:p2"]);
    expect(herdrCalls.some((c) => c[0] === "workspace" && c[1] === "close")).toBe(true);
    expect(worktreeCalls).toContainEqual({ verb: "dispose", p: { repoName: "gh:m4ttstack/rt", tree: "slot-a" } });
    expect(existsSync(join(dir, "herds", herd))).toBe(false);
    expect(chatCalls.at(-1)).toMatchObject({ verb: "archive", payload: { room, handle: "shepherd", archived: true } });
    expect(store.get(herd)!.status).toBe("wrapped");
    expect(store.jobs(herd).every((j) => j.status === "closed")).toBe(true);
  });

  test("with no flags it only marks the herd wrapped and reports a dispose refusal verbatim", async () => {
    const hx = await withTwoJobs();
    hx.worktreeCalls.length = 0;
    const refusing = harness({
      worktree: {
        "worktree:provision": async () => ({ ok: true, data: {} }),
        "worktree:dispose": async (p: any) => ({ ok: true, data: { disposed: [], refused: [{ tree: p.tree, reason: "unmerged work" }], recoverable: [] } }),
      },
    });
    const s = await refusing.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    refusing.store.upsertJob({ herd: s.data.herd, name: "job-a", worktree: "/w/job-a", branch: "job-a", tree: "slot-a", handle: "job-a", status: "done" });
    const res = await refusing.h["herd:wrap-up"]({ herd: s.data.herd, dispose: ["job-a"] });
    if (!res.ok) throw new Error(res.error);
    expect(res.data).toMatchObject({ closed: [], workspaceClosed: false, disposed: [], refused: [{ tree: "slot-a", reason: "unmerged work" }], deletedJobDirs: false, archived: false });
    expect(refusing.herdrCalls).toEqual([]);
  });

  test("a --dir job has no registry tree and is refused with a reason, not disposed", async () => {
    const { h, store, worktreeCalls, herd } = await withTwoJobs();
    store.upsertJob({ herd, name: "job-c", worktree: "/elsewhere", handle: "job-c", status: "done" });
    const res = await h["herd:wrap-up"]({ herd, dispose: ["job-c"] });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.refused).toEqual([{ tree: "job-c", reason: "no rt-provisioned tree for this job" }]);
    expect(worktreeCalls.filter((c) => c.verb === "dispose")).toEqual([]);
  });

  // Two crashed, pane-less jobs: closePane never runs for either, so the CLI's
  // pane count must read zero, not two, even though both rows still flip to
  // "closed".
  test("pane-less jobs are marked closed but never counted as closed panes", async () => {
    const hx = harness();
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const herd = s.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "done", pane: null });
    hx.store.upsertJob({ herd, name: "job-b", worktree: "/w/job-b", handle: "job-b", status: "done", pane: null });
    const res = await hx.h["herd:wrap-up"]({ herd, closePanes: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.closed).toEqual([]);
    expect(hx.store.jobs(herd).every((j) => j.status === "closed")).toBe(true);
    expect(hx.herdrCalls.some((c) => c[0] === "pane" && c[1] === "close")).toBe(false);
  });

  // A pane close that fails (closePane returns false) must not be counted
  // either: `closed` names only panes that actually closed. Nor may it flip
  // the job's status to "closed" -- a wrap-up retry re-derives `attempted`
  // from `job.status !== "closed"`, so a forced status here would make the
  // pane invisible to the next attempt.
  test("a job whose pane close fails keeps its status and is not counted", async () => {
    const hx = harness({ herdrRunnerFor: () => async (args) => (args[0] === "pane" && args[1] === "close" ? { stdout: "", exitCode: 1 } : { stdout: "{}", exitCode: 0 }) });
    const s = await hx.h["herd:start"](START);
    if (!s.ok) throw new Error(s.error);
    const herd = s.data.herd;
    hx.store.upsertJob({ herd, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "done", pane: "w9:p1" });
    const res = await hx.h["herd:wrap-up"]({ herd, closePanes: true });
    if (!res.ok) throw new Error(res.error);
    expect(res.data.closed).toEqual([]);
    expect(hx.store.getJob(herd, "job-a")!.status).toBe("done");
  });
});

describe("herd:lanes", () => {
  type Merge = HerdLaneRow["merge"];
  const OPEN: Merge = { forge: "github", state: "open", url: "https://github.com/o/r/pull/3", number: 3, mergedAt: null };

  function lanesHarness(diffs: Record<string, string>, merges: Record<string, Merge | Error> = {}, heads: Record<string, string | null> = {}) {
    const mergeCalls: Array<{ worktree: string; branch: string }> = [];
    const lanes: LaneDeps = {
      git: async (cwd, args) => {
        const name = cwd.split("/").pop()!;
        if (args[0] === "diff") return { stdout: diffs[name] ?? "", exitCode: 0 };
        if (args[0] === "rev-parse") {
          const head = name in heads ? heads[name] : name;
          return head === null ? { stdout: "", exitCode: 128 } : { stdout: `${head}\n`, exitCode: 0 };
        }
        if (args[0] === "rev-list") return { stdout: "1\n", exitCode: 0 };
        if (args[0] === "config") return { stdout: "git@github.com:o/r.git\n", exitCode: 0 };
        return { stdout: "", exitCode: 1 };
      },
      defaultRef: async () => "origin/main",
      merge: async (worktree, branch) => {
        mergeCalls.push({ worktree, branch });
        const m = merges[worktree.split("/").pop()!];
        if (m instanceof Error) throw m;
        return m ?? { forge: "github", state: "none", url: null, number: null, mergedAt: null };
      },
    };
    const hx = harness({ lanes });
    const herd = "lanes-1";
    hx.store.create({ id: herd, repo: "remote:github.com%2Fo%2Fr", room: "herd-lanes-1", workspace: "herd: lanes-1", shepherdSession: "sess-shep", shepherdHandle: "shepherd", herdrSocket: null, hidden: false });
    const job = (name: string, o: { tree?: string | null; worktree?: string; branch?: string | null; make?: boolean } = {}) => {
      const worktree = o.worktree ?? join(hx.dir, "wt", name);
      if (o.make !== false) mkdirSync(worktree, { recursive: true });
      hx.store.upsertJob({ herd, name, worktree, branch: o.branch === undefined ? name : o.branch, tree: o.tree === undefined ? `t-${name}` : o.tree, handle: `${name}.w001`, status: "active" });
      return worktree;
    };
    const lanesOf = async (payload: { herd: string; job?: string }) => {
      const res = await hx.h["herd:lanes"](payload);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    };
    return { ...hx, herd, job, lanesOf, mergeCalls };
  }

  test("lanes returns per-job drift, collisions and merge", async () => {
    const hx = lanesHarness({ a: "1\t0\tlib/x.ts\n2\t1\tlib/a.ts\n", b: "3\t3\tlib/x.ts\n" }, { a: OPEN });
    hx.job("a"); hx.job("b");
    const data = await hx.lanesOf({ herd: hx.herd });
    const a = data.lanes.find((l) => l.job === "a")!;
    expect(data.lanes.map((l) => l.job).sort()).toEqual(["a", "b"]);
    expect(a).toMatchObject({ branch: "a", base: "origin/main", commits: 1, merge: OPEN });
    expect(a.drift).toMatchObject({ filesChanged: 2, insertions: 3, deletions: 1 });
    expect(a.collidesWith).toEqual([{ job: "b", files: ["lib/x.ts"] }]);
    expect(data.collisions).toEqual([{ path: "lib/x.ts", jobs: ["a", "b"] }]);
    expect(data.skipped).toEqual([]);
  });

  test("guest jobs get no lane row", async () => {
    const hx = lanesHarness({ a: "1\t0\tlib/x.ts\n" });
    const wt = hx.job("a");
    hx.job("review-a", { tree: null, worktree: wt });
    const data = await hx.lanesOf({ herd: hx.herd });
    expect(data.lanes.map((l) => l.job)).toEqual(["a"]);
    expect(data.collisions).toEqual([]);
    expect(hx.mergeCalls).toHaveLength(1);
  });

  test("closed jobs get no lane row", async () => {
    const hx = lanesHarness({});
    hx.job("a"); hx.job("b");
    hx.store.setJobStatus(hx.herd, "b", "closed");
    expect((await hx.lanesOf({ herd: hx.herd })).lanes.map((l) => l.job)).toEqual(["a"]);
  });

  test("a row with no branch reads the merge state of the worktree's checked-out branch", async () => {
    const hx = lanesHarness({}, { a: OPEN }, { a: "feature-x" });
    const wt = hx.job("a", { branch: null, tree: null });
    const [lane] = (await hx.lanesOf({ herd: hx.herd })).lanes;
    expect(lane).toMatchObject({ branch: "feature-x", merge: OPEN });
    expect(hx.mergeCalls).toEqual([{ worktree: wt, branch: "feature-x" }]);
  });

  test("a worker that moved to a follow-up branch is read on its current branch, not the spawn-time one", async () => {
    const hx = lanesHarness({}, {}, { a: "a-follow-up" });
    const wt = hx.job("a");
    const [lane] = (await hx.lanesOf({ herd: hx.herd })).lanes;
    expect(lane!.branch).toBe("a-follow-up");
    expect(hx.mergeCalls).toEqual([{ worktree: wt, branch: "a-follow-up" }]);
  });

  test("a detached HEAD reads unknown without a forge call and does not tick unmergedReports", async () => {
    const hx = lanesHarness({}, {}, { a: "HEAD" });
    hx.job("a", { branch: null, tree: null });
    hx.store.setJobStatus(hx.herd, "a", "done", { lastReport: 7 });
    const [lane] = (await hx.lanesOf({ herd: hx.herd })).lanes;
    expect(lane!.branch).toBeNull();
    expect(lane!.merge).toEqual({ forge: "github", state: "unknown", url: null, number: null, mergedAt: null, error: "no branch checked out" });
    expect(hx.mergeCalls).toEqual([]);
    expect(hx.store.budgetRows(hx.herd, "a")).toEqual([]);
  });

  test("a branch read that fails reads unknown, never none", async () => {
    const hx = lanesHarness({}, {}, { a: null });
    hx.job("a");
    const [lane] = (await hx.lanesOf({ herd: hx.herd })).lanes;
    expect(lane!.merge).toMatchObject({ state: "unknown", error: "git could not read the worktree's checked-out branch" });
    expect(hx.mergeCalls).toEqual([]);
  });

  test("forge error reads unknown and does not tick unmergedReports", async () => {
    const hx = lanesHarness({}, { a: new Error("GitHub said 502") });
    hx.job("a");
    hx.store.setJobStatus(hx.herd, "a", "done", { lastReport: 7 });
    const [lane] = (await hx.lanesOf({ herd: hx.herd })).lanes;
    expect(lane!.merge).toMatchObject({ state: "unknown", url: null, number: null, mergedAt: null });
    expect(lane!.merge.error).toContain("GitHub said 502");
    expect(lane!.unmergedReports.used).toBe(0);
    expect(hx.store.budgetRows(hx.herd, "a")).toEqual([]);
  });

  for (const status of [401, 503]) {
    test(`a GitHub ${status} reads unknown and does not tick unmergedReports`, async () => {
      const hx = lanesHarness({});
      hx.job("a");
      hx.store.setJobStatus(hx.herd, "a", "done", { lastReport: 7 });
      const failed = await readGithubMerge(async () => new Response("{}", { status }), "o/r", "a");
      const lanes = { ...hx.deps.lanes!, merge: async () => failed };
      const h = createHerdHandlers({ ...hx.deps, lanes });
      const res = await h["herd:lanes"]({ herd: hx.herd });
      if (!res.ok) throw new Error(res.error);
      expect(res.data.lanes[0]!.merge.state).toBe("unknown");
      expect(hx.store.budgetRows(hx.herd, "a")).toEqual([]);
    });
  }

  test("a forge error never carries a credentialed URL", async () => {
    const hx = lanesHarness({}, { a: new Error("fetch https://oauth2:glpat-SECRET@gitlab.example.com/x failed") });
    hx.job("a");
    const [lane] = (await hx.lanesOf({ herd: hx.herd })).lanes;
    expect(lane!.merge.error).not.toContain("glpat-SECRET");
  });

  test("a done job's report read open ticks unmergedReports once per report id", async () => {
    const hx = lanesHarness({}, { a: OPEN });
    hx.job("a");
    hx.store.setJobStatus(hx.herd, "a", "done", { lastReport: 7 });
    await hx.lanesOf({ herd: hx.herd });
    const again = (await hx.lanesOf({ herd: hx.herd })).lanes[0]!;
    expect(again.unmergedReports).toEqual({ used: 1, cap: 2, spent: false });
    hx.store.setJobStatus(hx.herd, "a", "done", { lastReport: 9 });
    expect((await hx.lanesOf({ herd: hx.herd })).lanes[0]!.unmergedReports).toEqual({ used: 2, cap: 2, spent: true });
  });

  test("an active job's open lane does not tick", async () => {
    const hx = lanesHarness({}, { a: OPEN });
    hx.job("a");
    expect((await hx.lanesOf({ herd: hx.herd })).lanes[0]!.unmergedReports.used).toBe(0);
  });

  test("merged never ticks", async () => {
    const hx = lanesHarness({}, { a: { ...OPEN, state: "merged", mergedAt: "2026-10-16T00:00:00Z" } });
    hx.job("a");
    hx.store.setJobStatus(hx.herd, "a", "done", { lastReport: 7 });
    const [lane] = (await hx.lanesOf({ herd: hx.herd })).lanes;
    expect(lane!.unmergedReports.used).toBe(0);
    expect(hx.store.budgetRows(hx.herd, "a")).toEqual([]);
  });

  test("a job whose worktree is gone is listed in skipped", async () => {
    const hx = lanesHarness({});
    hx.job("a");
    hx.job("gone", { worktree: join(hx.dir, "nowhere"), make: false });
    const data = await hx.lanesOf({ herd: hx.herd });
    expect(data.lanes.map((l) => l.job)).toEqual(["a"]);
    expect(data.skipped).toEqual([{ job: "gone", reason: expect.stringContaining("no longer exists") }]);
  });

  test("job filter narrows lanes but collisions span every job", async () => {
    const hx = lanesHarness({ a: "1\t0\tlib/x.ts\n", b: "1\t0\tlib/x.ts\n" }, { a: OPEN });
    hx.job("a"); hx.job("b");
    const data = await hx.lanesOf({ herd: hx.herd, job: "a" });
    expect(data.lanes.map((l) => l.job)).toEqual(["a"]);
    expect(data.lanes[0]!.collidesWith).toEqual([{ job: "b", files: ["lib/x.ts"] }]);
    expect(data.collisions).toEqual([{ path: "lib/x.ts", jobs: ["a", "b"] }]);
    expect(hx.mergeCalls.map((c) => c.branch)).toEqual(["a"]);
  });

  test("an unknown herd or job is refused", async () => {
    const hx = lanesHarness({});
    hx.job("a");
    expect((await hx.h["herd:lanes"]({ herd: "nope" })).ok).toBe(false);
    expect((await hx.h["herd:lanes"]({ herd: hx.herd, job: "nope" })).ok).toBe(false);
  });
});
