# Peer Asks Start in Seconds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A peer ask (review, re-review, replies) starts the recipient's agent about 5s after the click, and status changes reach the asker within seconds, on by default for every member.

**Architecture:** The relay gains a non-consuming long-poll (`GET /inbox/wait`). The rt daemon holds that wait per machine and broadcasts `peer-inbox` when mail lands. A new `rt.cron` trigger runs `board triage --peer` on that event (pull, materialize, ack, nudge pass, drain), and the board server ticks on the same event. A new `board.peerAsks` setting (default on) gates the automatic start. Review-state reports echo the ask their run answers.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `bun:test`, pino (daemon logger), rt settings resolver (`@mattstack/rt-client`).

**Spec:** `docs/superpowers/specs/2026-10-01-board-peer-ask-latency-design.md`

## Global Constraints

- Never use em dashes or en dashes in code, comments, docs or commit messages; use "..." or rephrase.
- Clean-code comments only: a comment states a constraint the code cannot show (a parity anchor, an ordering trap, an invariant). No narration, no review or task references, no decision history.
- Code under `lib/` never calls `console.*`; daemon modules log through the pino child logger they are given (`lib/__tests__/no-raw-output.test.ts` enforces this).
- Root tests run from the repo root (`bun test lib/...`); board and relay tests run from `apps/board` (`cd apps/board && bun test <path>`), because bun reads `bunfig.toml` only from the cwd.
- A child process spawned from a test passes `env: { ...childEnv(), ... }` (`lib/subprocess.ts`), never the bare startup environment.
- After touching `packages/rt-client/src`, run `cd packages/rt-client && bun run build` before running board tests.
- Commit after each task: short imperative subject, then a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The board's 60s peer tick stays. Push only makes things faster.
- Wire values, exact: event `peer-inbox`; trigger name `board-peer`; debounce `300`; wait cap `25` seconds; waiter cap `4` per board; waker backoff 1s doubling to a 60s cap; unconfigured recheck 5 minutes; request abort at wait plus 10s; claim wait up to 2 minutes polling every 1s.
- Setting `board.peerAsks`: object, scopes user and team, merge deep, default `{ enabled: true }`.

## Review Focus

1. A Mac that sleeps mid-wait leaves a half-open connection: the waker must give up on it at its abort timeout and reconnect, not hang until restart. Pinned in Task 2 ("a half-open connection is cut by the request timeout").
2. A rotated or revoked board token answers 401: the waker must re-read the token rather than retrying a stale cached one forever. Pinned in Task 2 ("a 401 re-reads the token").
3. Two asks published in the same millisecond: the second must still wake the waker, not wait for the 60s tick. Pinned in Task 1 (relay stamps are strictly increasing).
4. The relay restarting under a held wait (connection reset): the waker backs off, reconnects, and the cursor catches up on anything queued meanwhile. Pinned in Task 2 ("backs off on failures and resets after a good reply") and Task 1 ("returns at once when an unacked envelope is newer than since").
5. A peer pass that starts while a full triage pass holds the run claim: it must wait for the claim and then run, so the ask is not stranded until the next MR change. Pinned in Task 6 ("waits for a held claim and takes it once released").

## File Structure

| File | Responsibility |
|---|---|
| `apps/board/switchboard/waiters.ts` (new) | In-memory parked waits per board, wake, cap, cleanup |
| `apps/board/switchboard/store.ts` | `newestAfter(username, since)` |
| `apps/board/switchboard/server.ts` | `/inbox/wait` route, strictly increasing stamps, wake on publish, `idleTimeout`, `PORT=0` |
| `lib/daemon/peer-waker.ts` (new) | The daemon's relay wait loop and `peer-inbox` broadcast |
| `lib/daemon/handlers/secrets.ts` | `readSwitchboardToken()` |
| `lib/daemon.ts` | Start and stop the waker |
| `packages/rt-client/src/settings/*` | `board.peerAsks` registry row, schema, example, lock |
| `lib/setup/cron-install.ts` | `peerTrigger`, `findCronTrigger` |
| `lib/setup/steps/skills.ts` | `cron.triage` installs `board-peer` by `board.peerAsks` |
| `lib/setup/migrations/board-peer-trigger.ts` (new) | Adds `board-peer` on machines that already have `board-triage` |
| `apps/board/src/triage/config.ts` | `loadPeerAsksConfig` |
| `apps/board/src/triage/peer-pass.ts` (new) | `claimCronWaiting`, `triageShouldRun` |
| `apps/board/src/triage/memory-store.ts` | Export `CRON_CLAIM_STALE_MS` |
| `apps/board/src/peer/materialize-deps.ts` (new) | The board's real `MaterializeDeps`, shared by server and triage |
| `apps/board/bin/triage.ts` | `--peer` mode; nudge gating on `board.peerAsks` |
| `apps/board/src/triage/nudge.ts` | `disabled` copy |
| `apps/board/src/peer/runtime.ts` | `PEER_INBOX_EVENT`, `tickOnPeerInbox` |
| `apps/board/src/server.ts` | Tick on `peer-inbox`; awaits-click reads `board.peerAsks`; echo `nudgeId` |
| `apps/board/src/peer/nudges.ts` | `NudgeState.materializedAt` |
| `apps/board/src/peer/inbox.ts` | Stamp `materializedAt`; pass review-state `nudgeId` to finish |
| `apps/board/src/review-state.ts` | `runStartedAt` stamped at each run start |
| `apps/board/src/peer/ask-echo.ts` (new) | `askIdForRun` |
| `apps/board/docs/agent-actions.md`, `apps/board/docs/peer-boards.md` | Docs |

---

### Task 1: Relay long-poll (`GET /inbox/wait`)

**Files:**
- Create: `apps/board/switchboard/waiters.ts`
- Modify: `apps/board/switchboard/store.ts` (add `newestAfter` after `inbox`)
- Modify: `apps/board/switchboard/server.ts` (`makeFetchHandler` signature, `/envelopes` route, new `/inbox/wait` route, `import.meta.main` block)
- Test: `apps/board/switchboard/__tests__/inbox-wait.test.ts` (new)

**Interfaces:**
- Produces: `GET /inbox/wait?since=<ms>&timeout=<s>` answering `200 { woke: boolean, cursor: number }`, `401` without a board token, `400` on a non-numeric or negative query, `405` on another method.
- Produces: `class InboxWaiters { wait(username: string, timeoutMs: number, signal: AbortSignal): Promise<number | null>; wake(usernames: string[], cursor: number): void; boards(): string[]; count(username: string): number }`, `MAX_WAITERS_PER_BOARD = 4`, `MAX_WAIT_SECONDS = 25`.
- Produces: `makeFetchHandler(store, adminToken, now, teamInvites, waiters = new InboxWaiters())`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/board/switchboard/__tests__/inbox-wait.test.ts
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { makeFetchHandler } from '../server.ts';
import { SwitchboardStore } from '../store.ts';
import { TeamInviteStore } from '../team-invites.ts';
import { InboxWaiters, MAX_WAITERS_PER_BOARD } from '../waiters.ts';

const ADMIN = 'admin-secret';

function setup() {
  const clock = { t: 1000 };
  const db = new Database(':memory:');
  const store = new SwitchboardStore(db);
  const waiters = new InboxWaiters();
  const handler = makeFetchHandler(
    store,
    ADMIN,
    () => clock.t,
    new TeamInviteStore(db),
    waiters
  );
  const call = (
    path: string,
    opts: { token?: string; body?: unknown; signal?: AbortSignal } = {}
  ) =>
    handler(
      new Request(`http://x${path}`, {
        method: opts.body !== undefined ? 'POST' : 'GET',
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          'content-type': 'application/json',
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      })
    );
  const ada = store.registerBoard('ada').token;
  const grace = store.registerBoard('grace').token;
  return { store, waiters, call, ada, grace, clock };
}

const draft = (id: string, to: string) => ({
  id,
  to,
  type: 're-review-request',
  sentAt: 1,
  payload: {},
});

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await Bun.sleep(1);
  if (!cond()) throw new Error('condition never held');
}

describe('GET /inbox/wait', () => {
  test('needs a board token', async () => {
    const { call } = setup();
    expect((await call('/inbox/wait?since=0&timeout=0')).status).toBe(401);
  });

  test('rejects a query that is not a pair of numbers', async () => {
    const { call, ada } = setup();
    expect(
      (await call('/inbox/wait?since=soon&timeout=1', { token: ada })).status
    ).toBe(400);
    expect(
      (await call('/inbox/wait?since=0&timeout=-1', { token: ada })).status
    ).toBe(400);
  });

  test('returns at once when an unacked envelope is newer than since', async () => {
    const { call, ada, grace } = setup();
    await call('/envelopes', { token: grace, body: draft('e1', 'ada') });
    const res = await call('/inbox/wait?since=0&timeout=25', { token: ada });
    expect(await res.json()).toEqual({ woke: true, cursor: 1000 });
  });

  test('a parked wait wakes on a publish to that board', async () => {
    const { call, ada, grace, clock, waiters } = setup();
    const pending = call('/inbox/wait?since=0&timeout=25', { token: ada });
    await until(() => waiters.count('ada') === 1);
    clock.t = 2000;
    await call('/envelopes', { token: grace, body: draft('e1', 'ada') });
    expect(await (await pending).json()).toEqual({ woke: true, cursor: 2000 });
    expect(waiters.count('ada')).toBe(0);
  });

  test('mail for another board does not wake this one', async () => {
    const { call, ada, waiters } = setup();
    const pending = call('/inbox/wait?since=0&timeout=0.05', { token: ada });
    await until(() => waiters.count('ada') === 1);
    await call('/envelopes', { token: ada, body: draft('e1', 'grace') });
    expect(await (await pending).json()).toEqual({ woke: false, cursor: 0 });
  });

  test('a broadcast wakes every other waiting board', async () => {
    const { call, ada, grace, waiters, store } = setup();
    const linus = store.registerBoard('linus').token;
    const a = call('/inbox/wait?since=0&timeout=25', { token: ada });
    const l = call('/inbox/wait?since=0&timeout=25', { token: linus });
    await until(
      () => waiters.count('ada') === 1 && waiters.count('linus') === 1
    );
    await call('/envelopes', { token: grace, body: draft('e1', '*') });
    expect(((await (await a).json()) as { woke: boolean }).woke).toBe(true);
    expect(((await (await l).json()) as { woke: boolean }).woke).toBe(true);
  });

  test('times out with the cursor unchanged', async () => {
    const { call, ada } = setup();
    const res = await call('/inbox/wait?since=500&timeout=0.05', {
      token: ada,
    });
    expect(await res.json()).toEqual({ woke: false, cursor: 500 });
  });

  test('never consumes: the envelope is still in /inbox after a wake', async () => {
    const { call, ada, grace } = setup();
    await call('/envelopes', { token: grace, body: draft('e1', 'ada') });
    await call('/inbox/wait?since=0&timeout=0', { token: ada });
    const inbox = (await (await call('/inbox', { token: ada })).json()) as {
      envelopes: Array<{ id: string }>;
    };
    expect(inbox.envelopes.map(e => e.id)).toEqual(['e1']);
  });

  test('an acked envelope no longer wakes a wait', async () => {
    const { call, ada, grace } = setup();
    await call('/envelopes', { token: grace, body: draft('e1', 'ada') });
    await call('/inbox/ack', { token: ada, body: { ids: ['e1'] } });
    const res = await call('/inbox/wait?since=0&timeout=0.05', { token: ada });
    expect(await res.json()).toEqual({ woke: false, cursor: 0 });
  });

  test('two publishes in the same millisecond get distinct cursors, so the second still wakes', async () => {
    const { call, ada, grace } = setup();
    await call('/envelopes', { token: grace, body: draft('e1', 'ada') });
    const first = (await (
      await call('/inbox/wait?since=0&timeout=0', { token: ada })
    ).json()) as { cursor: number };
    await call('/envelopes', { token: grace, body: draft('e2', 'ada') });
    const second = await (
      await call(`/inbox/wait?since=${first.cursor}&timeout=0.05`, {
        token: ada,
      })
    ).json();
    expect(second).toEqual({ woke: true, cursor: first.cursor + 1 });
  });

  test('a disconnect drops the waiter', async () => {
    const { call, ada, waiters } = setup();
    const ctl = new AbortController();
    const pending = call('/inbox/wait?since=0&timeout=25', {
      token: ada,
      signal: ctl.signal,
    });
    await until(() => waiters.count('ada') === 1);
    ctl.abort();
    await pending.catch(() => undefined);
    expect(waiters.count('ada')).toBe(0);
  });
});

describe('InboxWaiters', () => {
  test('caps waiters per board, resolving the oldest as not woken', async () => {
    const w = new InboxWaiters();
    const never = new AbortController().signal;
    const first = w.wait('ada', 60_000, never);
    const rest = Array.from({ length: MAX_WAITERS_PER_BOARD }, () =>
      w.wait('ada', 60_000, never)
    );
    expect(await first).toBeNull();
    expect(w.count('ada')).toBe(MAX_WAITERS_PER_BOARD);
    w.wake(['ada'], 5);
    expect(await Promise.all(rest)).toEqual(
      Array(MAX_WAITERS_PER_BOARD).fill(5)
    );
    expect(w.count('ada')).toBe(0);
  });

  test('an already-aborted signal resolves at once without parking', async () => {
    const w = new InboxWaiters();
    const ctl = new AbortController();
    ctl.abort();
    expect(await w.wait('ada', 60_000, ctl.signal)).toBeNull();
    expect(w.count('ada')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/board && bun test switchboard/__tests__/inbox-wait.test.ts`
Expected: FAIL, `Cannot find module '../waiters.ts'`.

- [ ] **Step 3: Write `waiters.ts`**

```ts
// apps/board/switchboard/waiters.ts
export const MAX_WAITERS_PER_BOARD = 4;
export const MAX_WAIT_SECONDS = 25;

interface Waiter {
  settle(cursor: number | null): void;
}

/** Parked `/inbox/wait` requests, per board, in this one relay process. A
    second relay replica would never see the other's waiters. */
export class InboxWaiters {
  private byBoard = new Map<string, Waiter[]>();

  wait(
    username: string,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<number | null> {
    if (signal.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
      let settled = false;
      const waiter: Waiter = {
        settle: cursor => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          this.remove(username, waiter);
          resolve(cursor);
        },
      };
      const onAbort = () => waiter.settle(null);
      const timer = setTimeout(() => waiter.settle(null), timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      const list = this.byBoard.get(username) ?? [];
      list.push(waiter);
      this.byBoard.set(username, list);
      while (list.length > MAX_WAITERS_PER_BOARD) list[0]!.settle(null);
    });
  }

  wake(usernames: string[], cursor: number): void {
    for (const u of usernames)
      for (const w of [...(this.byBoard.get(u) ?? [])]) w.settle(cursor);
  }

  boards(): string[] {
    return [...this.byBoard.keys()];
  }

  count(username: string): number {
    return this.byBoard.get(username)?.length ?? 0;
  }

  private remove(username: string, waiter: Waiter): void {
    const list = this.byBoard.get(username);
    if (!list) return;
    const i = list.indexOf(waiter);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.byBoard.delete(username);
  }
}
```

- [ ] **Step 4: Add `newestAfter` to the store** (in `SwitchboardStore`, after `inbox`)

```ts
  /** Newest unacked `received_at` for this board strictly after `since`, or
      null when nothing newer is waiting. */
  newestAfter(username: string, since: number): number | null {
    const row = this.db
      .query<{ newest: number | null }, [string, number]>(
        `SELECT MAX(received_at) AS newest FROM envelopes WHERE recipient = ? AND received_at > ?`
      )
      .get(username, since);
    return row?.newest ?? null;
  }
```

- [ ] **Step 5: Wire the relay handler** (`apps/board/switchboard/server.ts`)

Add the import and extend the signature:

```ts
import { InboxWaiters, MAX_WAIT_SECONDS } from './waiters.ts';

export function makeFetchHandler(
  store: SwitchboardStore,
  adminToken: string,
  now: () => number,
  teamInvites: TeamInviteStore,
  waiters: InboxWaiters = new InboxWaiters()
) {
  const teamInviteRoutes = makeTeamInviteHandler(teamInvites, now);
  // Strictly increasing so a waker's cursor (`received_at > since`) can never
  // skip a second envelope stamped in the same millisecond.
  let lastStamp = 0;
  const stamp = () => (lastStamp = Math.max(now(), lastStamp + 1));
  return async (req: Request): Promise<Response> => {
```

Replace the publish call in the `/envelopes` route:

```ts
      const at = stamp();
      const result = store.publish(username, draft, at);
      if (!result.ok) return json(422, { error: result.error });
      waiters.wake(
        draft.to === '*'
          ? waiters.boards().filter(u => u !== username)
          : [draft.to],
        at
      );
      return json(201, { ok: true, delivered: result.delivered });
```

Add the wait route right after the `/inbox` route:

```ts
    if (pathname === '/inbox/wait') {
      if (req.method !== 'GET')
        return new Response('method not allowed', { status: 405 });
      const params = new URL(req.url).searchParams;
      const since = Number(params.get('since') ?? '0');
      const timeout = Number(params.get('timeout') ?? String(MAX_WAIT_SECONDS));
      if (
        !Number.isFinite(since) ||
        !Number.isFinite(timeout) ||
        timeout < 0
      )
        return new Response('expected numeric since and timeout', {
          status: 400,
        });
      const pending = store.newestAfter(username, since);
      if (pending !== null) return json(200, { woke: true, cursor: pending });
      const woke = await waiters.wait(
        username,
        Math.min(timeout, MAX_WAIT_SECONDS) * 1000,
        req.signal
      );
      return json(
        200,
        woke === null
          ? { woke: false, cursor: since }
          : { woke: true, cursor: woke }
      );
    }
```

In the `import.meta.main` block, accept `PORT=0`, raise the idle timeout above the wait cap, and log the bound port:

```ts
  const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 7940;
  // Bun closes a request idle for idleTimeout seconds (default 10), which
  // would cut every /inbox/wait held up to MAX_WAIT_SECONDS.
  const server = Bun.serve({
    port,
    idleTimeout: MAX_WAIT_SECONDS + 15,
    fetch: makeFetchHandler(store, adminToken, Date.now, teamInvites),
  });
  console.log(`switchboard listening on :${server.port} (db: ${dbPath})`);
```

(Remove the old `const port = Number(process.env.PORT) || 7940;`, the old `Bun.serve({...})` and the old `console.log` line.)

- [ ] **Step 6: Run the new and existing relay tests**

Run: `cd apps/board && bun test switchboard/__tests__/`
Expected: PASS, all files.

- [ ] **Step 7: Commit**

```bash
git add apps/board/switchboard
git commit -m "switchboard: add GET /inbox/wait long-poll that wakes on publish"
```

---

### Task 2: Daemon peer waker module

**Files:**
- Create: `lib/daemon/peer-waker.ts`
- Modify: `lib/daemon/handlers/secrets.ts` (add `readSwitchboardToken` after `loadBoardSecrets`)
- Test: `lib/daemon/__tests__/peer-waker.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's `GET /inbox/wait` contract.
- Produces: `PEER_INBOX_EVENT = "peer-inbox"`; `startPeerWaker(deps: PeerWakerDeps): { stop(): void; done: Promise<void> }`; `nextBackoffMs(failures: number): number`; `acceptedRelayUrl(raw: string | null | undefined): string | null`; `readSwitchboardToken(readSecretFn?): Promise<string | null>`.
- `PeerWakerDeps`: `{ log: Pick<Logger, "debug" | "info" | "warn">; emit(type: string, data: unknown): void; readUrl(): string | null | undefined; readToken(): Promise<string | null>; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; waitSeconds?: number; requestTimeoutMs?: number; unconfiguredRecheckMs?: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/daemon/__tests__/peer-waker.test.ts
import { describe, expect, test } from "bun:test";
import { acceptedRelayUrl, nextBackoffMs, PEER_INBOX_EVENT, startPeerWaker, type PeerWakerDeps } from "../peer-waker.ts";

type Reply = { status: number; body?: unknown } | "network" | "hang";

function harness(replies: Reply[], over: Partial<PeerWakerDeps> = {}) {
  const emitted: Array<{ type: string; data: unknown }> = [];
  const urls: string[] = [];
  const auths: string[] = [];
  const sleeps: number[] = [];
  const warns: unknown[] = [];
  let next = 0;
  let handle: ReturnType<typeof startPeerWaker> | undefined;
  const stop = () => handle?.stop();
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    auths.push(String((init?.headers as Record<string, string> | undefined)?.authorization));
    const r = replies[next++];
    if (r === undefined) {
      stop();
      throw new Error("stopped");
    }
    if (r === "network") throw new TypeError("fetch failed");
    if (r === "hang") {
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }),
      );
    }
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  handle = startPeerWaker({
    log: { debug() {}, info() {}, warn: (ctx: unknown) => void warns.push(ctx) } as unknown as PeerWakerDeps["log"],
    emit: (type, data) => void emitted.push({ type, data }),
    readUrl: () => "https://relay.example",
    readToken: async () => "tok",
    fetch: fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length > 50) stop();
    },
    ...over,
  });
  return { done: handle.done, emitted, urls, auths, sleeps, warns };
}

const ok = (woke: boolean, cursor: number) => ({ status: 200, body: { woke, cursor } });

describe("peer waker", () => {
  test("broadcasts peer-inbox on a wake and carries the cursor forward", async () => {
    const h = harness([ok(true, 1500), ok(false, 1500)]);
    await h.done;
    expect(h.emitted).toEqual([{ type: PEER_INBOX_EVENT, data: { cursor: 1500 } }]);
    expect(h.urls[0]).toBe("https://relay.example/inbox/wait?since=0&timeout=25");
    expect(h.urls[1]).toBe("https://relay.example/inbox/wait?since=1500&timeout=25");
  });

  test("a timed-out wait loops straight back without sleeping", async () => {
    const h = harness([ok(false, 0), ok(false, 0)]);
    await h.done;
    expect(h.sleeps).toEqual([]);
    expect(h.emitted).toEqual([]);
  });

  test("backs off on failures and resets after a good reply", async () => {
    const h = harness(["network", "network", { status: 503 }, ok(false, 0), "network"]);
    await h.done;
    expect(h.sleeps).toEqual([1000, 2000, 4000, 1000]);
    expect(h.warns).toHaveLength(3);
  });

  test("a half-open connection is cut by the request timeout", async () => {
    const h = harness(["hang", ok(true, 7)], { requestTimeoutMs: 20 });
    await h.done;
    expect(h.emitted).toEqual([{ type: PEER_INBOX_EVENT, data: { cursor: 7 } }]);
    expect(h.sleeps).toEqual([1000]);
  });

  test("a 401 re-reads the token", async () => {
    let reads = 0;
    const h = harness([{ status: 401 }, ok(true, 5)], { readToken: async () => `tok${++reads}` });
    await h.done;
    expect(reads).toBe(2);
    expect(h.auths.slice(0, 2)).toEqual(["Bearer tok1", "Bearer tok2"]);
    expect(h.emitted).toHaveLength(1);
  });

  test("the token is read once while it keeps working", async () => {
    let reads = 0;
    const h = harness([ok(false, 0), ok(false, 0), ok(false, 0)], { readToken: async () => (reads++, "tok") });
    await h.done;
    expect(reads).toBe(1);
  });

  test("stays idle while unpeered and starts once a token appears", async () => {
    let reads = 0;
    const h = harness([ok(true, 9)], {
      readToken: async () => (++reads === 1 ? null : "tok"),
      unconfiguredRecheckMs: 300_000,
    });
    await h.done;
    expect(h.sleeps[0]).toBe(300_000);
    expect(h.emitted).toEqual([{ type: PEER_INBOX_EVENT, data: { cursor: 9 } }]);
  });

  test("never fetches a plain-http relay that is not this machine", async () => {
    const h = harness([], { readUrl: () => "http://relay.example" });
    await h.done;
    expect(h.urls).toEqual([]);
  });

  test("a readUrl that throws counts as unpeered", async () => {
    const h = harness([], {
      readUrl: () => {
        throw new Error("store unreadable");
      },
    });
    await h.done;
    expect(h.urls).toEqual([]);
  });

  test("stop ends the loop", async () => {
    const h = startPeerWaker({
      log: { debug() {}, info() {}, warn() {} } as unknown as PeerWakerDeps["log"],
      emit: () => {},
      readUrl: () => null,
      readToken: async () => null,
    });
    h.stop();
    await h.done;
  });
});

describe("helpers", () => {
  test("nextBackoffMs doubles from 1s and caps at 60s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(nextBackoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });

  test("acceptedRelayUrl takes https anywhere and http only on this machine", () => {
    expect(acceptedRelayUrl("https://relay.example/")).toBe("https://relay.example");
    expect(acceptedRelayUrl("http://127.0.0.1:7940")).toBe("http://127.0.0.1:7940");
    expect(acceptedRelayUrl("http://localhost:7940")).toBe("http://localhost:7940");
    expect(acceptedRelayUrl("http://relay.example")).toBeNull();
    expect(acceptedRelayUrl("not a url")).toBeNull();
    expect(acceptedRelayUrl(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/peer-waker.test.ts`
Expected: FAIL, `Cannot find module '../peer-waker.ts'`.

- [ ] **Step 3: Write `lib/daemon/peer-waker.ts`**

```ts
/**
 * Holds the board's relay wait for this machine and broadcasts
 * `peer-inbox` when mail lands for the board. Mechanism only: it never
 * fetches, acks or parses an envelope; the board server and the
 * `board-peer` cron trigger do that on the broadcast.
 */
import type { Logger } from "pino";

/** Matches PEER_INBOX_EVENT in apps/board/src/peer/runtime.ts and the board-peer trigger's event. */
export const PEER_INBOX_EVENT = "peer-inbox";

const WAIT_SECONDS = 25;
const ABORT_SLACK_MS = 10_000;
const UNCONFIGURED_RECHECK_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;

export interface PeerWakerDeps {
  log: Pick<Logger, "debug" | "info" | "warn">;
  emit(type: string, data: unknown): void;
  readUrl(): string | null | undefined;
  readToken(): Promise<string | null>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  waitSeconds?: number;
  requestTimeoutMs?: number;
  unconfiguredRecheckMs?: number;
}

export interface PeerWakerHandle {
  stop(): void;
  done: Promise<void>;
}

export function nextBackoffMs(failures: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** failures);
}

/** The board token rides every call, so only https, or http to this machine. */
export function acceptedRelayUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  return raw.replace(/\/+$/, "");
}

type WaitOutcome = { kind: "ok"; woke: boolean; cursor: number } | { kind: "fail"; reason: string };

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

async function waitOnce(
  fetchFn: typeof fetch,
  base: string,
  token: string,
  since: number,
  waitSeconds: number,
  timeoutMs: number,
  stop: AbortSignal,
): Promise<WaitOutcome> {
  const signal = AbortSignal.any([stop, AbortSignal.timeout(timeoutMs)]);
  try {
    const res = await fetchFn(`${base}/inbox/wait?since=${since}&timeout=${waitSeconds}`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
    if (!res.ok) return { kind: "fail", reason: `http ${res.status}` };
    const body = (await res.json()) as { woke?: unknown; cursor?: unknown };
    if (typeof body.woke !== "boolean" || typeof body.cursor !== "number") return { kind: "fail", reason: "bad body" };
    return { kind: "ok", woke: body.woke, cursor: body.cursor };
  } catch (err) {
    return { kind: "fail", reason: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network" };
  }
}

export function startPeerWaker(deps: PeerWakerDeps): PeerWakerHandle {
  const stopController = new AbortController();
  const fetchFn = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => abortableSleep(ms, stopController.signal));
  const waitSeconds = deps.waitSeconds ?? WAIT_SECONDS;
  const timeoutMs = deps.requestTimeoutMs ?? waitSeconds * 1000 + ABORT_SLACK_MS;
  const recheckMs = deps.unconfiguredRecheckMs ?? UNCONFIGURED_RECHECK_MS;

  const done = (async () => {
    let cursor = 0;
    let failures = 0;
    let lastFailure: string | null = null;
    let token: string | null = null;
    while (!stopController.signal.aborted) {
      let base: string | null;
      try {
        base = acceptedRelayUrl(deps.readUrl());
      } catch {
        base = null;
      }
      if (base && token === null) token = await deps.readToken().catch(() => null);
      if (stopController.signal.aborted) break;
      if (!base || !token) {
        await sleep(recheckMs);
        continue;
      }
      const outcome = await waitOnce(fetchFn, base, token, cursor, waitSeconds, timeoutMs, stopController.signal);
      if (stopController.signal.aborted) break;
      if (outcome.kind === "ok") {
        if (lastFailure !== null) deps.log.info({ relay: base }, "peer waker: relay reachable again");
        lastFailure = null;
        failures = 0;
        if (outcome.woke) {
          cursor = Math.max(cursor, outcome.cursor);
          deps.emit(PEER_INBOX_EVENT, { cursor });
          deps.log.debug({ cursor }, "peer waker: inbox woke");
        }
        continue;
      }
      if (outcome.reason === "http 401") token = null;
      if (outcome.reason !== lastFailure) {
        deps.log.warn({ relay: base, reason: outcome.reason }, "peer waker: relay wait failed; boards fall back to their 60s poll");
        lastFailure = outcome.reason;
      }
      await sleep(nextBackoffMs(failures++));
    }
  })();

  return {
    stop: () => stopController.abort(),
    done,
  };
}
```

- [ ] **Step 4: Export the token reader** (`lib/daemon/handlers/secrets.ts`, after `loadBoardSecrets`)

```ts
/** The board's relay token, as `rt team join` stores it. */
export function readSwitchboardToken(readSecretFn: ReadSecretFn = defaultReadSecret): Promise<string | null> {
  return readSecretFn("rt", "switchboardToken");
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test lib/daemon/__tests__/peer-waker.test.ts`
Expected: PASS. If "a half-open connection is cut by the request timeout" fails because the rejection reason's `name` is `"AbortError"` rather than `"TimeoutError"` in this Bun, keep the test and map both names to `"timeout"` only when `stop` is not aborted (`stop.aborted ? "network" : "timeout"`).

- [ ] **Step 6: Run the raw-output guard**

Run: `bun test lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/daemon/peer-waker.ts lib/daemon/__tests__/peer-waker.test.ts lib/daemon/handlers/secrets.ts
git commit -m "daemon: add the peer waker that turns relay mail into peer-inbox"
```

---

### Task 3: Start the waker in the daemon, plus a real-relay integration test

**Files:**
- Modify: `lib/daemon.ts` (handle declaration near `let cron`, start after the cron wiring around line 1111, stop in the same unit's `stop()` around line 1226)
- Test: `lib/daemon/__tests__/peer-waker-relay.test.ts` (new)

**Interfaces:**
- Consumes: `startPeerWaker`, `readSwitchboardToken` (Task 2); `emit` (daemon's broadcast plus cron fan-out); `getSetting` (already imported in `lib/daemon.ts`).

- [ ] **Step 1: Write the integration test** (spawns the real relay from source on a free port)

```ts
// lib/daemon/__tests__/peer-waker-relay.test.ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { childEnv } from "../../subprocess.ts";
import { PEER_INBOX_EVENT, startPeerWaker, type PeerWakerDeps } from "../peer-waker.ts";

const RELAY = join(import.meta.dir, "..", "..", "..", "apps", "board", "switchboard", "server.ts");
const ADMIN = "admin-secret";
const quiet = { debug() {}, info() {}, warn() {} } as unknown as PeerWakerDeps["log"];

let dir: string;
let proc: ReturnType<typeof Bun.spawn>;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "relay-"));
  proc = Bun.spawn(["bun", "run", RELAY], {
    env: { ...childEnv(), SWITCHBOARD_ADMIN_TOKEN: ADMIN, SWITCHBOARD_DB: join(dir, "sb.sqlite"), PORT: "0" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  let text = "";
  while (!/listening on :(\d+)/.test(text)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`relay exited: ${text}`);
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  base = `http://127.0.0.1:${/listening on :(\d+)/.exec(text)![1]}`;
});

afterAll(() => {
  proc.kill();
  rmSync(dir, { recursive: true, force: true });
});

async function register(username: string): Promise<string> {
  const res = await fetch(`${base}/boards`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  return ((await res.json()) as { token: string }).token;
}

test("a publish reaches the recipient's waker in well under a second", async () => {
  const ada = await register("ada");
  const grace = await register("grace");
  const woke: number[] = [];
  const waker = startPeerWaker({
    log: quiet,
    emit: (type) => {
      if (type === PEER_INBOX_EVENT) woke.push(Date.now());
    },
    readUrl: () => base,
    readToken: async () => ada,
  });
  await Bun.sleep(150);
  const sent = Date.now();
  await fetch(`${base}/envelopes`, {
    method: "POST",
    headers: { authorization: `Bearer ${grace}`, "content-type": "application/json" },
    body: JSON.stringify({ id: "e1", to: "ada", type: "re-review-request", sentAt: sent, payload: {} }),
  });
  for (let i = 0; i < 100 && woke.length === 0; i++) await Bun.sleep(10);
  waker.stop();
  await waker.done;
  expect(woke).toHaveLength(1);
  expect(woke[0]! - sent).toBeLessThan(1000);
});

test("a held wait outlasts Bun's default 10s idle timeout", async () => {
  const linus = await register("linus");
  const res = await fetch(`${base}/inbox/wait?since=0&timeout=12`, { headers: { authorization: `Bearer ${linus}` } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ woke: false, cursor: 0 });
}, 20_000);
```

- [ ] **Step 2: Run it**

Run: `bun test lib/daemon/__tests__/peer-waker-relay.test.ts`
Expected: PASS (Tasks 1 and 2 already landed). If the second test fails with a connection reset, Task 1's `idleTimeout` is missing.

- [ ] **Step 3: Wire the waker into the daemon** (`lib/daemon.ts`)

Add the imports beside the other daemon imports:

```ts
import { startPeerWaker } from "./daemon/peer-waker.ts";
import { readSwitchboardToken } from "./daemon/handlers/secrets.ts";
```

(If `./daemon/handlers/secrets.ts` is already imported, add `readSwitchboardToken` to that import instead.)

Declare the handle next to `let cron: ReturnType<typeof startCron>;`:

```ts
  let peerWaker: ReturnType<typeof startPeerWaker> | undefined;
```

Start it right after the two `eventsBus.onBroadcast(...)` lines that follow `cron = startCron(...)`:

```ts
        peerWaker = startPeerWaker({
          log: loggerHandle.childLogger("peer-waker"),
          emit,
          readUrl: () => getSetting<string>("board.switchboardUrl").value,
          readToken: () => readSwitchboardToken(),
        });
```

Stop it in the same unit's `stop()`, beside `cron?.dispose();`:

```ts
        peerWaker?.stop();
```

- [ ] **Step 4: Run the daemon's boot tests and the guards**

Run: `bun test lib/__tests__/no-raw-output.test.ts lib/__tests__/no-eager-tui.test.ts lib/daemon/__tests__/`
Expected: PASS. A daemon test that asserts the exact set of background subsystems or open handles may need the waker added to its expectation; update it only for the waker.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon.ts lib/daemon/__tests__/peer-waker-relay.test.ts
git commit -m "daemon: start the peer waker with the background subsystems"
```

---

### Task 4: The `board.peerAsks` setting and the board's loader

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (row after `board.reReview`)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts` (entry after `board.reReview`)
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts` (entry after `board.reReview`)
- Modify (generated): `packages/rt-client/src/settings/schema.lock.json`
- Modify: `apps/board/src/triage/config.ts` (`loadReReviewConfig` region)
- Test: `apps/board/src/__tests__/triage-config-peer-asks.test.ts` (new)

**Interfaces:**
- Produces: registry key `board.peerAsks` (`{ enabled?: boolean }`, default `{ enabled: true }`); `loadPeerAsksConfig(resolve?: GetSettingFn): PeerAsksConfig` with `interface PeerAsksConfig { enabled: boolean }`.

- [ ] **Step 1: Write the failing board test**

```ts
// apps/board/src/__tests__/triage-config-peer-asks.test.ts
import { describe, expect, test } from 'bun:test';

import type { getSetting } from '@mattstack/rt-client';
import { loadPeerAsksConfig } from '../triage/config.ts';

type GetSettingFn = typeof getSetting;

function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T>(key: string) => ({
    value: values[key] as T,
    provenance: [],
  })) as GetSettingFn;
}

describe('loadPeerAsksConfig', () => {
  test('unset defaults to enabled: a new member gets automatic asks', () => {
    expect(loadPeerAsksConfig(fakeResolve({}))).toEqual({ enabled: true });
  });

  test('{ enabled: false } turns automatic asks off', () => {
    expect(
      loadPeerAsksConfig(fakeResolve({ 'board.peerAsks': { enabled: false } }))
    ).toEqual({ enabled: false });
  });

  test('a resolver throw degrades to enabled, never crashes', () => {
    const throwing = (() => {
      throw new Error('unknown settings key: board.peerAsks');
    }) as GetSettingFn;
    expect(loadPeerAsksConfig(throwing)).toEqual({ enabled: true });
  });

  test('a non-boolean enabled is a loud config error', () => {
    expect(() =>
      loadPeerAsksConfig(fakeResolve({ 'board.peerAsks': { enabled: 'yes' } }))
    ).toThrow('"enabled" must be a boolean');
  });

  test('does not read board.triage: auto-doctor stays a separate opt-in', () => {
    expect(
      loadPeerAsksConfig(fakeResolve({ 'board.triage': { enabled: false } }))
    ).toEqual({ enabled: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/board && bun test src/__tests__/triage-config-peer-asks.test.ts`
Expected: FAIL, `loadPeerAsksConfig` is not exported.

- [ ] **Step 3: Add the registry row, schema and example**

`registry-defs.ts`, after the `board.reReview` row:

```ts
  {
    key: "board.peerAsks",
    type: "object",
    scopes: ["user", "team"],
    merge: "deep",
    default: { enabled: true },
    description: "Gate for starting the agent when a teammate's board asks this one for a review, re-review or replies ({enabled}); rt's cron.triage step installs the board-peer trigger only while this is on. Auto-doctor stays under board.triage.",
  },
```

`registry-schemas.ts`, after `"board.reReview"`:

```ts
  "board.peerAsks": z.looseObject({ enabled: z.boolean().optional() }),
```

`__tests__/schema-examples.ts`, after the `"board.reReview"` entry:

```ts
  "board.peerAsks": {
    good: [{}, { enabled: false }],
    bad: [{ value: { enabled: "no" }, path: ["enabled"] }],
    layer: [{ enabled: true }],
  },
```

- [ ] **Step 4: Regenerate the lock, build rt-client, run the settings tests**

Run: `bun run cli.ts settings schema lock && (cd packages/rt-client && bun run build) && bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/schema-lock.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS; `git diff --stat` shows `schema.lock.json` gained a `board.peerAsks` entry.

- [ ] **Step 5: Add the loader** (`apps/board/src/triage/config.ts`)

Replace `RE_REVIEW_DEFAULTS` and the body of `loadReReviewConfig` with one shared reader, keeping `loadReReviewConfig`'s doc comment on it:

```ts
export interface PeerAsksConfig {
  enabled: boolean;
}

/** Both switches are store-only and ship enabled; a resolver throw degrades
    to that default rather than silently switching the feature off. */
function loadEnabledFlag(
  key: 'board.reReview' | 'board.peerAsks',
  resolve: GetSettingFn
): { enabled: boolean } {
  const raw = storeValue<unknown>(key, resolve, 'defaulting to enabled');
  if (raw === undefined || raw === null) return { enabled: true };
  const source = `settings key "${key}"`;
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new Error(`${source} must be an object`);
  const { enabled } = raw as Record<string, unknown>;
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new Error(`${source} "enabled" must be a boolean`);
  }
  return { enabled: (enabled as boolean | undefined) ?? true };
}

export function loadReReviewConfig(
  resolve: GetSettingFn = getSetting
): ReReviewConfig {
  return loadEnabledFlag('board.reReview', resolve);
}

export function loadPeerAsksConfig(
  resolve: GetSettingFn = getSetting
): PeerAsksConfig {
  return loadEnabledFlag('board.peerAsks', resolve);
}
```

Run `grep -rn RE_REVIEW_DEFAULTS apps/board/src apps/board/bin` and replace any other use with `{ enabled: true }`.

- [ ] **Step 6: Run the board config tests**

Run: `cd apps/board && bun test src/__tests__/triage-config-peer-asks.test.ts src/__tests__/triage-config-rereview.test.ts src/__tests__/triage-config.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/rt-client/src/settings apps/board/src/triage/config.ts apps/board/src/__tests__/triage-config-peer-asks.test.ts
git commit -m "settings: add board.peerAsks, on by default, and the board's loader"
```

---

### Task 5: The `board-peer` cron trigger, the setup step and the migration

**Files:**
- Modify: `lib/setup/cron-install.ts` (add `PeerTrigger`, `peerTrigger`, `findCronTrigger`)
- Modify: `lib/setup/steps/skills.ts` (`cronTriageRun`)
- Create: `lib/setup/migrations/board-peer-trigger.ts`
- Modify: `lib/setup/migrations/index.ts`
- Modify tests: `lib/setup/__tests__/steps-b.test.ts` (the `cron.triage` describe, lines ~1300-1372)
- Test: `lib/setup/__tests__/cron-install.test.ts` (append), `lib/setup/__tests__/migration-board-peer-trigger.test.ts` (new)

**Interfaces:**
- Consumes: `PEER_INBOX_EVENT` (Task 2), `board.peerAsks` (Task 4).
- Produces: `peerTrigger(triageRun: string[]): PeerTrigger` returning `{ name: "board-peer", event: "peer-inbox", run: [...triageRun, "--peer"], debounceMs: 300 }`; `findCronTrigger(name: string, deps?: InstallCronTriggerDeps): CronTrigger | undefined`; migration id `2026-10-01-board-peer-trigger`.

- [ ] **Step 1: Write the failing cron-install tests** (append to `lib/setup/__tests__/cron-install.test.ts`; add the imports to its import block)

```ts
import { PEER_INBOX_EVENT } from "../../daemon/peer-waker.ts";
import { peerTrigger } from "../cron-install.ts";

describe("peerTrigger", () => {
  test("is the triage invocation plus --peer, on the waker's event, with a short debounce", () => {
    expect(peerTrigger(["bun", "run", "/b/bin/triage.ts"])).toEqual({
      name: "board-peer",
      event: "peer-inbox",
      run: ["bun", "run", "/b/bin/triage.ts", "--peer"],
      debounceMs: 300,
    });
  });

  test("listens on exactly the event the daemon waker broadcasts", () => {
    expect(peerTrigger([]).event).toBe(PEER_INBOX_EVENT);
  });
});
```

- [ ] **Step 2: Write the failing migration test**

```ts
// lib/setup/__tests__/migration-board-peer-trigger.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { installCronTrigger, triageTrigger } from "../cron-install.ts";
import { boardPeerTriggerMigration } from "../migrations/board-peer-trigger.ts";
import type { ApplyContext } from "../apply.ts";

const ctx = {} as ApplyContext;
const triggers = () => getSetting<{ triggers: Array<{ name: string; run: string[] }> }>("rt.cron").value?.triggers ?? [];

describe("2026-10-01-board-peer-trigger", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-peer-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("adds board-peer beside an installed board-triage, reusing its run", async () => {
    installCronTrigger(triageTrigger(["/A/board", "triage"]));
    expect(await boardPeerTriggerMigration.run(ctx)).toEqual({ state: "done", detail: "Peer asks now start as soon as they arrive" });
    expect(triggers().map((t) => t.name)).toEqual(["board-triage", "board-peer"]);
    expect(triggers()[1]!.run).toEqual(["/A/board", "triage", "--peer"]);
  });

  test("running it twice leaves one board-peer", async () => {
    installCronTrigger(triageTrigger(["/A/board", "triage"]));
    await boardPeerTriggerMigration.run(ctx);
    await boardPeerTriggerMigration.run(ctx);
    expect(triggers().filter((t) => t.name === "board-peer")).toHaveLength(1);
  });

  test("skips a Mac with no board triage installed", async () => {
    expect(await boardPeerTriggerMigration.run(ctx)).toEqual({ state: "skipped", detail: "Board triage isn't installed on this Mac" });
    expect(triggers()).toEqual([]);
  });

  test("skips when peer asks are off", async () => {
    installCronTrigger(triageTrigger(["/A/board", "triage"]));
    setSetting("board.peerAsks", { enabled: false }, "user");
    expect(await boardPeerTriggerMigration.run(ctx)).toEqual({ state: "skipped", detail: "Automatic peer asks are off" });
    expect(triggers().map((t) => t.name)).toEqual(["board-triage"]);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `bun test lib/setup/__tests__/cron-install.test.ts lib/setup/__tests__/migration-board-peer-trigger.test.ts`
Expected: FAIL, missing exports and module.

- [ ] **Step 4: Add the trigger helpers** (`lib/setup/cron-install.ts`, after `triageTrigger`; `findCronTrigger` after `readTriggers`)

```ts
export interface PeerTrigger extends CronTrigger {
  name: "board-peer";
  event: "peer-inbox";
  debounceMs: 300;
}

/** `triageRun` is the resolved triage invocation; the peer pass is the same entry with `--peer`. */
export function peerTrigger(triageRun: string[]): PeerTrigger {
  return { name: "board-peer", event: "peer-inbox", run: [...triageRun, "--peer"], debounceMs: 300 };
}
```

```ts
export function findCronTrigger(name: string, deps: InstallCronTriggerDeps = realInstallCronTriggerDeps()): CronTrigger | undefined {
  return readTriggers(deps.getSetting).find((t) => t.name === name);
}
```

- [ ] **Step 5: Write the migration and register it**

```ts
// lib/setup/migrations/board-peer-trigger.ts
import { getSetting } from "../../settings/resolve.ts";
import { findCronTrigger, installCronTrigger, peerTrigger } from "../cron-install.ts";
import type { MigrationDef } from "./index.ts";

export const boardPeerTriggerMigration: MigrationDef = {
  id: "2026-10-01-board-peer-trigger",
  title: "Start peer asks as soon as they arrive",
  async run() {
    if (getSetting<{ enabled?: boolean }>("board.peerAsks").value?.enabled !== true) {
      return { state: "skipped", detail: "Automatic peer asks are off" };
    }
    const triage = findCronTrigger("board-triage");
    if (!triage) return { state: "skipped", detail: "Board triage isn't installed on this Mac" };
    installCronTrigger(peerTrigger(triage.run));
    return { state: "done", detail: "Peer asks now start as soon as they arrive" };
  },
};
```

`lib/setup/migrations/index.ts`:

```ts
import { boardPeerTriggerMigration } from "./board-peer-trigger.ts";
```

```ts
export const MIGRATIONS: MigrationDef[] = [boardPeerTriggerMigration];
```

(The import of a value from `./board-peer-trigger.ts` while that file imports only the `MigrationDef` type back is not a runtime cycle.)

- [ ] **Step 6: Update the setup step** (`lib/setup/steps/skills.ts`, replace `cronTriageRun`)

```ts
function hookOn(key: "board.reReview" | "board.peerAsks"): boolean {
  if (!getDef(key)) return false;
  return getSetting<{ enabled?: boolean }>(key).value?.enabled === true;
}

async function cronTriageRun(ctx: ApplyContext): Promise<StepOutcome> {
  const reReview = hookOn("board.reReview");
  const peerAsks = hookOn("board.peerAsks");
  if (!reReview && !peerAsks) return { state: "skipped", detail: "The board's re-review and peer ask hooks are off" };

  const board = resolveTool(ctx.p, "board").exec;
  const resolution = resolveBoardTriage(ctx.p, getKnownRepos(), board);

  if (resolution.kind === "missing") {
    return { state: "skipped", detail: "The board binary was not found. Run rt deps resolve board first" };
  }

  if (reReview) installCronTrigger(triageTrigger(resolution.run));
  if (peerAsks) installCronTrigger(peerTrigger(resolution.run));
  return { state: "done", detail: "Installed the board triage skill" };
}
```

Add `peerTrigger` to the existing `../cron-install.ts` import in `skills.ts`.

- [ ] **Step 7: Update the `cron.triage` tests in `steps-b.test.ts`**

Replace the "board.reReview off" test with these two:

```ts
    test("both hooks off -> skipped, nothing installed", async () => {
      setSetting("board.reReview", { enabled: false }, "user");
      setSetting("board.peerAsks", { enabled: false }, "user");
      const p = bundledProbes({ tools: ["board"] });
      const { ctx } = makeCtx(p);
      expect(await cronTriageStep.run(ctx)).toEqual({ state: "skipped", detail: "The board's re-review and peer ask hooks are off" });
      expect(getSetting("rt.cron").value).toBeUndefined();
    });

    test("re-review off, peer asks on -> only board-peer is installed", async () => {
      setSetting("board.reReview", { enabled: false }, "user");
      const p = bundledProbes({ tools: ["board"] });
      const { ctx } = makeCtx(p);
      expect(await cronTriageStep.run(ctx)).toEqual({ state: "done", detail: "Installed the board triage skill" });
      const triggers = getSetting<{ triggers: { name: string }[] }>("rt.cron").value?.triggers ?? [];
      expect(triggers.map((t) => t.name)).toEqual(["board-peer"]);
    });
```

In "enabled, board only bundled", change the length and add the peer row:

```ts
      expect(triggers).toHaveLength(2);
      expect(triggers[0]!.run).toEqual([join(appRoot, HELPERS_DIR, "board"), "triage"]);
      expect(triggers[1]).toEqual({ name: "board-peer", event: "peer-inbox", run: [join(appRoot, HELPERS_DIR, "board"), "triage", "--peer"], debounceMs: 300 });
```

In "a registered board checkout", change to:

```ts
      expect(triggers).toHaveLength(2);
      expect(triggers[0]!.run).toEqual(["bun", "run", join(boardCheckout, "bin", "triage.ts")]);
      expect(triggers[1]!.run).toEqual(["bun", "run", join(boardCheckout, "bin", "triage.ts"), "--peer"]);
```

In "idempotent re-run", change `toHaveLength(1)` to `toHaveLength(2)`.

- [ ] **Step 8: Run the setup tests**

Run: `bun test lib/setup/__tests__/cron-install.test.ts lib/setup/__tests__/migration-board-peer-trigger.test.ts lib/setup/__tests__/steps-b.test.ts lib/setup/__tests__/update-safe.test.ts lib/setup/__tests__/apply.test.ts commands/__tests__/setup-copy.test.ts`
Expected: PASS. If `setup-copy.test.ts` fails only because the new migration now appears in an update run's output, read the diff, confirm it is the migration's title and detail, then update with `bun test commands/__tests__/setup-copy.test.ts --update-snapshots`.

- [ ] **Step 9: Commit**

```bash
git add lib/setup
git commit -m "setup: install the board-peer cron trigger and migrate existing Macs"
```

---

### Task 6: `board triage --peer`

**Files:**
- Create: `apps/board/src/triage/peer-pass.ts`
- Create: `apps/board/src/peer/materialize-deps.ts`
- Modify: `apps/board/src/triage/memory-store.ts` (export `CRON_CLAIM_STALE_MS`)
- Modify: `apps/board/src/server.ts` (lines ~495-504: `peerDeps` comes from `boardMaterializeDeps`)
- Modify: `apps/board/bin/triage.ts` (top gate and claim, `runTriage` wrap, nudge block, latch gate)
- Modify: `apps/board/src/triage/nudge.ts` (`plainReason` `disabled` copy)
- Test: `apps/board/src/__tests__/triage-peer-pass.test.ts` (new); update `apps/board/src/__tests__/triage-nudge.test.ts` if it pins the old `disabled` copy

**Interfaces:**
- Consumes: `loadPeerAsksConfig` (Task 4); `tryClaimCron`, `releaseCron` (existing); `runPeerTick(client, deps)` (existing, `src/peer/inbox.ts`).
- Produces: `claimCronWaiting(opts: { tryClaim: (now: number) => string | false; now?: () => number; sleep?: (ms: number) => Promise<void>; maxWaitMs?: number; pollMs?: number }): Promise<string | false>`; `triageShouldRun(peerMode: boolean, on: { triage: boolean; reReview: boolean; peerAsks: boolean }): boolean`; `boardMaterializeDeps(log: (line: string) => void): Omit<MaterializeDeps, 'reportAuth'>`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/board/src/__tests__/triage-peer-pass.test.ts
import { describe, expect, test } from 'bun:test';

import { claimCronWaiting, triageShouldRun } from '../triage/peer-pass.ts';

describe('triageShouldRun', () => {
  const off = { triage: false, reReview: false, peerAsks: false };

  test('the peer pass runs only for automatic asks', () => {
    expect(triageShouldRun(true, { ...off, peerAsks: true })).toBe(true);
    expect(triageShouldRun(true, { triage: true, reReview: true, peerAsks: false })).toBe(false);
  });

  test('the full pass runs when any of the three switches is on', () => {
    expect(triageShouldRun(false, off)).toBe(false);
    expect(triageShouldRun(false, { ...off, triage: true })).toBe(true);
    expect(triageShouldRun(false, { ...off, reReview: true })).toBe(true);
    expect(triageShouldRun(false, { ...off, peerAsks: true })).toBe(true);
  });
});

describe('claimCronWaiting', () => {
  test('takes a free claim at once', async () => {
    const sleeps: number[] = [];
    const token = await claimCronWaiting({
      tryClaim: () => 'tok',
      sleep: async ms => void sleeps.push(ms),
    });
    expect(token).toBe('tok');
    expect(sleeps).toEqual([]);
  });

  test('waits for a held claim and takes it once released', async () => {
    let t = 0;
    let attempts = 0;
    const token = await claimCronWaiting({
      tryClaim: () => (++attempts < 4 ? false : 'tok'),
      now: () => t,
      sleep: async ms => {
        t += ms;
      },
    });
    expect(token).toBe('tok');
    expect(attempts).toBe(4);
    expect(t).toBe(3_000);
  });

  test('gives up after the stale window', async () => {
    let t = 0;
    const token = await claimCronWaiting({
      tryClaim: () => false,
      now: () => t,
      sleep: async ms => {
        t += ms;
      },
    });
    expect(token).toBe(false);
    expect(t).toBe(120_000);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/board && bun test src/__tests__/triage-peer-pass.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Export the stale window** (`apps/board/src/triage/memory-store.ts`)

Change `const CRON_CLAIM_STALE_MS = 2 * 60_000;` to `export const CRON_CLAIM_STALE_MS = 2 * 60_000;`.

- [ ] **Step 4: Write `peer-pass.ts`**

```ts
// apps/board/src/triage/peer-pass.ts
import { CRON_CLAIM_STALE_MS } from './memory-store.ts';

const CLAIM_POLL_MS = 1_000;

export function triageShouldRun(
  peerMode: boolean,
  on: { triage: boolean; reReview: boolean; peerAsks: boolean }
): boolean {
  return peerMode ? on.peerAsks : on.triage || on.reReview || on.peerAsks;
}

/** The peer pass waits for a full pass's claim instead of exiting: a full pass
    already past its nudge read would otherwise strand a fresh ask until the
    next MR change. Bounded by the stale window, after which the claim is
    reclaimable anyway. */
export async function claimCronWaiting(opts: {
  tryClaim: (now: number) => string | false;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  pollMs?: number;
}): Promise<string | false> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const deadline = now() + (opts.maxWaitMs ?? CRON_CLAIM_STALE_MS);
  for (;;) {
    const token = opts.tryClaim(now());
    if (token !== false) return token;
    if (now() >= deadline) return false;
    await sleep(opts.pollMs ?? CLAIM_POLL_MS);
  }
}
```

- [ ] **Step 5: Extract the board's materialize deps**

```ts
// apps/board/src/peer/materialize-deps.ts
import type { MaterializeDeps } from './inbox.ts';
import { finishSentNudge, resolveSentNudge, writeNudge } from './nudges.ts';
import { writePeerReview } from './peer-reviews.ts';

/** The board's real stores behind materializeEnvelope, for the server's tick
    and the triage peer pass alike. */
export function boardMaterializeDeps(
  log: (line: string) => void
): Omit<MaterializeDeps, 'reportAuth'> {
  return {
    writePeerReview,
    writeNudge,
    resolveSentNudge: (mrUrl, resolution, from) =>
      resolveSentNudge(mrUrl, resolution, undefined, from),
    finishSentNudge: (mrUrl, finish, ifSentBefore, nudgeId, from) =>
      finishSentNudge(mrUrl, finish, ifSentBefore, undefined, nudgeId, from),
    log,
  };
}
```

In `apps/board/src/server.ts`, replace the `const peerDeps: Omit<MaterializeDeps, 'reportAuth'> = { ... };` literal (lines ~495-504) with:

```ts
const peerDeps = boardMaterializeDeps(line => console.error(line));
```

Add `import { boardMaterializeDeps } from './peer/materialize-deps.ts';` and drop any import (`writePeerReview`, `MaterializeDeps`) that is now unused in `server.ts`; keep `writeNudge`, `resolveSentNudge` and `finishSentNudge` if other code in the file still uses them (check with grep).

- [ ] **Step 6: Add `--peer` to `bin/triage.ts`**

Add imports:

```ts
import { boardMaterializeDeps } from '../src/peer/materialize-deps.ts';
import { runPeerTick } from '../src/peer/inbox.ts';
import { claimCronWaiting, triageShouldRun } from '../src/triage/peer-pass.ts';
```

and add `loadPeerAsksConfig` to the existing `../src/triage/config.ts` import.

Replace the gate and claim (the lines from `const triage = loadTriageConfig();` through `if (lockToken === false) { process.exit(0); }`) with:

```ts
const peerMode = process.argv.includes('--peer');
const triage = loadTriageConfig();
const reReview = loadReReviewConfig();
const peerAsks = loadPeerAsksConfig();
if (
  !triageShouldRun(peerMode, {
    triage: triage.enabled,
    reReview: reReview.enabled,
    peerAsks: peerAsks.enabled,
  })
)
  process.exit(0);

const lockToken = peerMode
  ? await claimCronWaiting({ tryClaim: tryClaimCron })
  : tryClaimCron(Date.now());
if (lockToken === false) {
  process.exit(0);
}
```

Wrap the auto-doctor call and its log line so the peer pass skips them:

```ts
  if (!peerMode) {
    const result = await runTriage({
      // ...the existing argument object, unchanged...
    });
    console.log(
      `triage: dispatched ${result.dispatched}, escalated ${result.escalated}, skipped ${result.skipped}`
    );
  }
```

In the switchboard block, pull the inbox first in peer mode and gate the nudge pass on `board.peerAsks` in both modes:

```ts
  if (boardConfig.switchboard.url && switchboardToken) {
    const client = makeSwitchboardClient(
      boardConfig.switchboard.url,
      switchboardToken
    );
    if (peerMode)
      await runPeerTick(
        client,
        boardMaterializeDeps(line => console.error(line))
      );
    const ownUrls = new Set((await fetchOwnMrs()).map(m => m.mrUrl));
    const nudgeResult = await runNudgePass({
      // ...every existing field unchanged, except:
      cfg: { ...triage, enabled: peerAsks.enabled },
    });
```

Gate the latch pass:

```ts
  if (!peerMode && latchToken && reReview.enabled) {
```

- [ ] **Step 7: Update the `disabled` copy** (`apps/board/src/triage/nudge.ts`, `plainReason`)

```ts
    case 'disabled':
      return 'Automatic asks are off';
```

Run `grep -rn "Auto re-review is off" apps/board` and update any test that pins the old phrase.

- [ ] **Step 8: Run the board tests that cover this**

Run: `cd apps/board && bun test src/__tests__/triage-peer-pass.test.ts src/__tests__/triage-nudge.test.ts src/__tests__/triage-memory-store.test.ts src/__tests__/peer-tick.test.ts src/__tests__/peer-runtime.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 9: Smoke the entry under an isolated HOME**

Run: `cd apps/board && env -i PATH="$PATH" HOME="$(mktemp -d)" bun run bin/triage.ts --peer; echo "exit $?"`
Expected: `exit 0` and no stack trace (no switchboard configured, so it gates out or finds nothing).

- [ ] **Step 10: Commit**

```bash
git add apps/board/bin/triage.ts apps/board/src/triage apps/board/src/peer/materialize-deps.ts apps/board/src/server.ts apps/board/src/__tests__
git commit -m "board: add triage --peer and gate automatic asks on board.peerAsks"
```

---

### Task 7: The board server ticks on `peer-inbox`; awaits-click follows `board.peerAsks`

**Files:**
- Modify: `apps/board/src/peer/runtime.ts` (add `PEER_INBOX_EVENT`, `tickOnPeerInbox`)
- Modify: `apps/board/src/server.ts` (`triageEnabled` at ~543 and its use at ~559; the `subscribe` callback at ~4279)
- Test: `apps/board/src/__tests__/peer-runtime.test.ts` (append)

**Interfaces:**
- Consumes: `loadPeerAsksConfig` (Task 4); `peering.tickNow` (existing).
- Produces: `PEER_INBOX_EVENT = 'peer-inbox'`; `tickOnPeerInbox(type: string, isWriter: boolean, tickNow: () => Promise<void>): void`.

- [ ] **Step 1: Write the failing test** (append to `peer-runtime.test.ts`; add `PEER_INBOX_EVENT, tickOnPeerInbox` to its `../peer/runtime.ts` import)

```ts
describe('tickOnPeerInbox', () => {
  test('the writer ticks on peer-inbox', () => {
    let ticks = 0;
    tickOnPeerInbox(PEER_INBOX_EVENT, true, async () => void ticks++);
    expect(ticks).toBe(1);
  });

  test('a non-writer never ticks: it does not own the peer state', () => {
    let ticks = 0;
    tickOnPeerInbox(PEER_INBOX_EVENT, false, async () => void ticks++);
    expect(ticks).toBe(0);
  });

  test('other daemon events are ignored', () => {
    let ticks = 0;
    tickOnPeerInbox('project-mrs', true, async () => void ticks++);
    expect(ticks).toBe(0);
  });

  test('the event name matches the daemon waker', () => {
    expect(PEER_INBOX_EVENT).toBe('peer-inbox');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/board && bun test src/__tests__/peer-runtime.test.ts`
Expected: FAIL, missing exports.

- [ ] **Step 3: Add the reaction** (`apps/board/src/peer/runtime.ts`, after `makePeering`)

```ts
/** Matches PEER_INBOX_EVENT in lib/daemon/peer-waker.ts. */
export const PEER_INBOX_EVENT = 'peer-inbox';

/** Ticks never overlap (tickNow collapses a burst into one follow-up), so a
    flurry of wakes costs one extra pull at most. */
export function tickOnPeerInbox(
  type: string,
  isWriter: boolean,
  tickNow: () => Promise<void>
): void {
  if (type === PEER_INBOX_EVENT && isWriter) void tickNow();
}
```

- [ ] **Step 4: Wire it into the server** (`apps/board/src/server.ts`)

Inside the `subscribe((type, data) => { ... })` callback, as its first statement:

```ts
      tickOnPeerInbox(type, writer, peering.tickNow);
```

Add `tickOnPeerInbox` to the existing `./peer/runtime.ts` import.

Replace `triageEnabled()`:

```ts
/** Automatic asks off, or a settings read that fails, leaves inbound asks
    waiting for a click. */
function peerAsksEnabled(): boolean {
  try {
    return loadPeerAsksConfig().enabled;
  } catch {
    return false;
  }
}
```

and its call site:

```ts
  const inbound = pendingNudgesByMr(readNudges(), peerAsksEnabled());
```

Import `loadPeerAsksConfig` from `./triage/config.ts`, and drop `loadTriageConfig` from that import if nothing else in `server.ts` uses it (check with grep).

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd apps/board && bun test src/__tests__/peer-runtime.test.ts src/__tests__/peer-state.test.ts src/__tests__/server-nudge-dismiss.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/board/src/peer/runtime.ts apps/board/src/server.ts apps/board/src/__tests__/peer-runtime.test.ts
git commit -m "board: tick on peer-inbox and read board.peerAsks for awaiting asks"
```

---

### Task 8: Review-state reports echo the ask their run answers

**Files:**
- Modify: `apps/board/src/peer/nudges.ts` (`NudgeState.materializedAt`)
- Modify: `apps/board/src/peer/inbox.ts` (stamp `materializedAt`; pass review-state `nudgeId`)
- Modify: `apps/board/src/review-state.ts` (`ReviewState.runStartedAt`, `writeReviewState`)
- Create: `apps/board/src/peer/ask-echo.ts`
- Modify: `apps/board/src/server.ts` (review branch of `handleAgentSignal`, ~4033-4050)
- Test: `apps/board/src/__tests__/peer-ask-echo.test.ts` (new); `apps/board/src/__tests__/review-state.test.ts` (append); `apps/board/src/__tests__/peer-inbox.test.ts` (append, and update the three `deps.nudges` `toEqual` blocks)

**Interfaces:**
- Produces: `NudgeState.materializedAt?: number`; `ReviewState.runStartedAt?: number`; `askIdForRun(nudges: readonly NudgeState[], mrUrl: string, author: string, runStartedAt: number | undefined): string | undefined`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/board/src/__tests__/peer-ask-echo.test.ts
import { describe, expect, test } from 'bun:test';

import { askIdForRun } from '../peer/ask-echo.ts';
import type { NudgeState } from '../peer/nudges.ts';

const MR = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

function ask(over: Partial<NudgeState>): NudgeState {
  return { id: 'a1', mrUrl: MR, iid: 4821, from: 'ada', receivedAt: 100, ...over };
}

describe('askIdForRun', () => {
  test("picks the author's latest ask that arrived before the run started", () => {
    const nudges = [
      ask({ id: 'old', materializedAt: 100 }),
      ask({ id: 'new', materializedAt: 200 }),
    ];
    expect(askIdForRun(nudges, MR, 'ada', 250)).toBe('new');
  });

  test('an ask that lands mid-run belongs to the next run', () => {
    const nudges = [
      ask({ id: 'first', materializedAt: 100 }),
      ask({ id: 'retry', materializedAt: 300 }),
    ];
    expect(askIdForRun(nudges, MR, 'ada', 250)).toBe('first');
  });

  test('ignores respond asks, other authors and other MRs', () => {
    const nudges = [
      ask({ id: 'respond', kind: 'respond', materializedAt: 100 }),
      ask({ id: 'grace', from: 'grace', materializedAt: 100 }),
      ask({ id: 'other', mrUrl: `${MR}0`, materializedAt: 100 }),
    ];
    expect(askIdForRun(nudges, MR, 'ada', 250)).toBeUndefined();
  });

  test('matches the author case-insensitively', () => {
    expect(askIdForRun([ask({ from: 'ada' })], MR, 'Ada', 250)).toBe('a1');
  });

  test('a row from before materializedAt existed falls back to receivedAt', () => {
    expect(askIdForRun([ask({ receivedAt: 100 })], MR, 'ada', 250)).toBe('a1');
  });

  test('no run start on file means no echo', () => {
    expect(askIdForRun([ask({})], MR, 'ada', undefined)).toBeUndefined();
  });
});
```

Append to `review-state.test.ts`:

```ts
describe('writeReviewState runStartedAt', () => {
  test('the first launch write stamps the run start', () => {
    const p = reviewFilePath(URL_A);
    writeReviewState(p, { mrUrl: URL_A, iid: 4821, status: 'queued' }, 1000, db);
    expect(readReviewStates(db).get(URL_A)?.runStartedAt).toBe(1000);
  });

  test('moving on within a run keeps the stamp', () => {
    const p = reviewFilePath(URL_A);
    writeReviewState(p, { mrUrl: URL_A, iid: 4821, status: 'queued' }, 1000, db);
    writeReviewState(p, { status: 'reviewing' }, 2000, db);
    writeReviewState(p, { status: 'done', outcome: 'comment' }, 3000, db);
    expect(readReviewStates(db).get(URL_A)?.runStartedAt).toBe(1000);
  });

  test('a relaunch after the run finished stamps a new start', () => {
    const p = reviewFilePath(URL_A);
    writeReviewState(p, { mrUrl: URL_A, iid: 4821, status: 'queued' }, 1000, db);
    writeReviewState(p, { status: 'done' }, 2000, db);
    writeReviewState(p, { status: 'reviewing' }, 3000, db);
    expect(readReviewStates(db).get(URL_A)?.runStartedAt).toBe(3000);
  });

  test('a relaunch after an error stamps a new start', () => {
    const p = reviewFilePath(URL_A);
    writeReviewState(p, { mrUrl: URL_A, iid: 4821, status: 'queued' }, 1000, db);
    writeReviewState(p, { status: 'error' }, 2000, db);
    writeReviewState(p, { status: 'queued' }, 3000, db);
    expect(readReviewStates(db).get(URL_A)?.runStartedAt).toBe(3000);
  });
});
```

Append to `peer-inbox.test.ts` inside `describe('materializeEnvelope')`:

```ts
  describe('ask echo', () => {
    test('a finishing review-state passes its nudgeId to finish', () => {
      const deps = fakeDeps();
      materializeEnvelope(
        envelope({
          payload: { mrUrl: URL_A, iid: 4821, status: 'done', outcome: 'comment', updatedAt: 500, nudgeId: 'ask-1' },
        }),
        deps,
        1000
      );
      expect(deps.finishes[0]?.nudgeId).toBe('ask-1');
    });

    test('a review-state with no nudgeId still finishes on the updatedAt guard', () => {
      const deps = fakeDeps();
      materializeEnvelope(
        envelope({ payload: { mrUrl: URL_A, iid: 4821, status: 'done', updatedAt: 500 } }),
        deps,
        1000
      );
      expect(deps.finishes[0]).toEqual({
        mrUrl: URL_A,
        finish: { result: 'done', at: 1000 },
        ifSentBefore: 500,
      });
    });

    test('an inbound ask records when this board materialized it', () => {
      const deps = fakeDeps();
      materializeEnvelope(
        envelope({ id: 'env-9', type: 're-review-request', payload: { mrUrl: URL_A, iid: 4821 } }),
        deps,
        1234
      );
      expect(deps.nudges[0]?.materializedAt).toBe(1234);
    });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/board && bun test src/__tests__/peer-ask-echo.test.ts src/__tests__/review-state.test.ts src/__tests__/peer-inbox.test.ts`
Expected: FAIL (missing module, missing fields, `nudgeId` undefined).

- [ ] **Step 3: Add the fields**

`apps/board/src/peer/nudges.ts`, in `NudgeState`:

```ts
  /** This board's own clock when the ask was materialized, comparable with
      ReviewState.runStartedAt where the relay's receivedAt is not. */
  materializedAt?: number;
```

`apps/board/src/review-state.ts`, in `ReviewState` beside `startedAt`:

```ts
  /** When the current run began: stamped by the write that moves the lane
      from nothing, done or error into queued or reviewing. */
  runStartedAt?: number;
```

- [ ] **Step 4: Stamp the run start in `writeReviewState`**

Add `readByHandle` to the `./state/index.ts` import, then:

```ts
const RUN_STARTS: ReadonlySet<ReviewStatus> = new Set(['queued', 'reviewing']);

export function writeReviewState(
  handle: string,
  patch: Partial<ReviewState> & { status: ReviewStatus },
  now: number = Date.now(),
  db: Database = getStateDb()
): ReviewState {
  const prev = readByHandle(handle, db) as ReviewState | null;
  const startsRun =
    RUN_STARTS.has(patch.status) &&
    (!prev || prev.status === 'done' || prev.status === 'error');
  const stamped =
    startsRun && patch.runStartedAt === undefined
      ? { ...patch, runStartedAt: now }
      : patch;
  const updated = updateByHandle(handle, stamped, now, db);
  if (updated) return updated as ReviewState;
  if (stamped.mrUrl === undefined || stamped.iid === undefined) {
    throw new Error(
      `review state write with no prior row and no identity: ${handle}`
    );
  }
  const next: ReviewState = {
    // ...the existing field-by-field list, reading `stamped.` instead of `patch.`...
    runStartedAt: stamped.runStartedAt,
    startedAt: now,
    updatedAt: now,
  };
```

(Keep every existing field in `next`; only the source object name changes and `runStartedAt` is added.)

- [ ] **Step 5: Stamp `materializedAt` and pass `nudgeId`** (`apps/board/src/peer/inbox.ts`)

In the ask branch's `deps.writeNudge({ ... })`, add `materializedAt: now,` after `receivedAt: e.receivedAt,`.

In the review-state branch's `deps.finishSentNudge(...)` call, replace the `undefined` argument (the nudge id) with `p.nudgeId`.

- [ ] **Step 6: Write `ask-echo.ts`**

```ts
// apps/board/src/peer/ask-echo.ts
import { canonicalUsername } from './envelope.ts';
import type { NudgeState } from './nudges.ts';

/** The ask a review run answers: the author's latest review or re-review ask
    on this MR that this board already held when the run started. An ask that
    lands mid-run belongs to the next run, so a late report from this one can
    never finish it. */
export function askIdForRun(
  nudges: readonly NudgeState[],
  mrUrl: string,
  author: string,
  runStartedAt: number | undefined
): string | undefined {
  if (runStartedAt === undefined) return undefined;
  const who = canonicalUsername(author);
  let best: { id: string; at: number } | undefined;
  for (const n of nudges) {
    if (n.mrUrl !== mrUrl || n.kind === 'respond') continue;
    if (canonicalUsername(n.from) !== who) continue;
    const at = n.materializedAt ?? n.receivedAt;
    if (at > runStartedAt) continue;
    if (!best || at > best.at) best = { id: n.id, at };
  }
  return best?.id;
}
```

- [ ] **Step 7: Echo it from the emitter** (`apps/board/src/server.ts`, review branch of `handleAgentSignal`)

Inside the `if (authorUsername && canonicalUsername(authorUsername) !== canonicalUsername(config.defaultMember))` block, before `enqueueOutbox(`:

```ts
      const askId = askIdForRun(
        readNudges(),
        signal.mrUrl,
        authorUsername,
        readReviewStates().get(signal.mrUrl)?.runStartedAt
      );
```

and add to the `review-state` payload, after `updatedAt: emittedAt,`:

```ts
          ...(askId ? { nudgeId: askId } : {}),
```

Add `import { askIdForRun } from './peer/ask-echo.ts';`.

- [ ] **Step 8: Update the existing nudge expectations**

In `peer-inbox.test.ts`, the three `expect(deps.nudges).toEqual([...])` blocks (around lines 250, 288 and 327) each gain `materializedAt: 1000,` (the `now` those tests pass) in the expected object.

- [ ] **Step 9: Run the tests and typecheck**

Run: `cd apps/board && bun test src/__tests__/peer-ask-echo.test.ts src/__tests__/review-state.test.ts src/__tests__/peer-inbox.test.ts src/__tests__/peer-state.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 10: Confirm no schema bump is needed**

Run: `grep -n "CREATE TABLE IF NOT EXISTS agent_states\|CREATE TABLE IF NOT EXISTS nudges" -A6 apps/board/src/state/db.ts`
Expected: both tables store the state as one JSON text column, so the new optional fields need no `SCHEMA_VERSION` change. If either table has a column per field instead, stop and report it.

- [ ] **Step 11: Commit**

```bash
git add apps/board/src/peer apps/board/src/review-state.ts apps/board/src/server.ts apps/board/src/__tests__
git commit -m "board: echo the ask a review run answers so a late report can't finish a retry"
```

---

### Task 9: Docs and whole-branch verification

**Files:**
- Modify: `apps/board/docs/agent-actions.md` ("Reviewer-side automation", the opening paragraph and "Nudge handling")
- Modify: `apps/board/docs/peer-boards.md` (the switchboard section)

- [ ] **Step 1: Update `agent-actions.md`**

Replace the opening paragraph of "Reviewer-side automation" with:

```markdown
`bun run triage` is a one-shot pass meant for a cron entry (rt cron or a plain
crontab line, either works). It does three jobs behind three switches: the
auto-doctor job is off unless `triage.enabled` is `true`; the nudge job is on
unless `board.peerAsks` turns it off; the latch job is on unless the
`board.reReview` setting turns it off. `bun run triage --peer` is the nudge
job alone: rt's `board-peer` trigger runs it the moment the daemon hears from
the relay that an ask arrived, so an ask starts in seconds.
```

At the top of "Nudge handling", replace the first sentence with:

```markdown
**Nudge handling.** An incoming review, re-review or reply ask from a peer
board is picked up and dispatched as soon as it arrives, if `board.peerAsks`
is on (the default) and every guardrail clears:
```

- [ ] **Step 2: Update `peer-boards.md`**

Add after the deploy instructions in the switchboard section:

```markdown
### Push

Boards no longer wait a minute for asks. The rt daemon on each Mac holds a
long-poll on the relay (`GET /inbox/wait?since=<cursor>&timeout=25`), which
returns the moment mail lands for that board without consuming it. The daemon
then broadcasts `peer-inbox`: the board pulls its inbox on that event, and
rt's `board-peer` cron trigger runs `board triage --peer` to start the agent.
The board's own 60s poll stays as the fallback, so a daemon or relay that is
down only costs speed.

Deploy the relay before shipping a release that carries the waker; the relay
change is additive and older boards keep polling.
```

- [ ] **Step 3: Run every suite this branch touches**

Run, from the repo root: `bun run test`
Run: `cd apps/board && bun test && bun run typecheck`
Run, from the repo root: `bun run check`
Expected: all PASS. Report any failure with its output; do not mark the task done on a red suite.

- [ ] **Step 4: Render the board and look at it**

Start the board from this worktree under an isolated HOME (`cd apps/board && env HOME="$(mktemp -d)" bun run serve`, or the fixture mode its README names), open it in Fast Browser, and screenshot an MR row carrying an inbound ask and one carrying a sent ask, in light and dark. Say plainly anything that reads wrong. The awaits-click state now follows `board.peerAsks`, so with the default an inbound ask must not show the "awaits click" cue.

- [ ] **Step 5: Commit**

```bash
git add apps/board/docs
git commit -m "docs: peer asks start on arrival through the daemon waker"
```

- [ ] **Step 6: Hand back for rollout (human-gated, do not run)**

Report that these remain for Matt: deploy the relay to Railway; merge the PR once CodeRabbit and CI are green; cut the release so each Mac's daemon restarts with the waker and the migration adds `board-peer`; then time one real ask between two boards.
