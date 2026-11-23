# Daemon Restart Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daemon restart, from an update or by hand, no longer fails agents' calls.

**Architecture:** The daemon binds `rt.sock` early in boot and answers "starting" until its handlers are ready, and on shutdown answers "stopping" while it drains in-flight requests. Both daemon clients (`rtCommand`, `daemonQuery`) retry for a bounded time when the connection could not be made or the daemon said it is unavailable, and never when a made connection dropped. `rt events wait` reconnects the way `rt gate wait` does.

**Tech Stack:** Bun, TypeScript, `Bun.serve` over a unix socket, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-23-automatic-updates-design.md`, Part 1. This plan covers Part 1 except the busy check, which moves to the Part 2 plan with its first caller. Parts 2 and 3 and the org setting get their own plans.

## Global Constraints

- A request is retried only when the daemon cannot have acted on it: the connect failed (socket file missing, or connect refused), or the daemon replied `unavailable`. A connection that was made and then dropped or timed out is never retried.
- Retry budget: about 20 seconds in total (`DAEMON_RETRY_BUDGET_MS = 20_000`). After it, each client returns what it returns today: `rtCommand`'s `rt daemon unreachable at …` result, `daemonQuery`'s null.
- The new daemon binds `rt.sock` after the park gate and after `evictStaleDaemon`, and before the databases open. The socket bind does not wait behind the API port bind.
- Drain cap: 5 seconds (`DRAIN_CAP_MS = 5_000`), well under launchd's `ExitTimeOut` of 30s.
- The unavailable reply is HTTP 503 with body `{ ok: false, error, unavailable }`, `unavailable` being `"starting"` or `"stopping"`. Error text, exactly: `rt daemon is starting; try again in a moment` and `rt daemon is restarting; try again in a moment`.
- Run `bun test` from the repo root only (`AGENTS.md`). Run only the targeted test files named in each task; CI runs the rest.
- After any change under `packages/rt-client/src`, run `bun run build` in `packages/rt-client` (`.claude/rules/workspace-packages.md`).
- No `console.*` or raw stream writes under `lib/` or `commands/` (`.claude/rules/output-layer.md`); daemon code logs through its logger.
- Comments state only a constraint the code cannot show.

## Review Focus

1. A request the daemon accepted and then dropped (a mutating verb such as a chat post) must be sent exactly once. Test in Task 3.
2. A daemon that never comes back: the call returns the same `rt daemon unreachable at …` error after the budget, and the next call within the cool-off returns at once instead of stalling another 20s. Tests in Task 3.
3. A client that predates this change gets the 503 body from a starting daemon: it must read as a sensible error sentence, since that client shows `error` as is. Test in Task 1.
4. A long-poll waiter (`events:wait`, `gate:wait`) open at shutdown gets its normal empty or timeout reply, not a dropped connection or a 500 from a closed database. Test in Task 2.
5. A booting daemon must never unlink the socket of a daemon that is still alive: `evictStaleDaemon` runs before the bind. Test in Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/daemon/socket-availability.ts` (new) | The `SocketAvailability` state, the unavailable reply, in-flight counting |
| `lib/daemon/socket-server.ts` | Answers `unavailable` unless serving; counts in-flight requests |
| `lib/daemon/drain.ts` (new) | `drainSocket`: stop serving, settle waiters, wait for in-flight |
| `lib/daemon.ts` | Unit order: early `socket-server`, `socket-ready`, final `socket-drain` |
| `lib/daemon/events-bus.ts`, `lib/daemon/gates-store.ts` | `settleWaiters()` split out of close |
| `packages/rt-client/src/transport.ts` | `rtCommand` retry, cool-off, shared retry helpers |
| `lib/daemon-client.ts` | `daemonQuery` retry on `unavailable`; longer wait after a tray-acked start |
| `commands/events.ts` | `rt events wait` / `tail` reconnect |

---

### Task 1: The socket binds early and answers "starting"

**Files:**
- Create: `lib/daemon/socket-availability.ts`
- Modify: `lib/daemon/socket-server.ts`, `lib/daemon.ts` (units `api-server`, `socket-server`, new `socket-ready`; `evictStaleDaemon` moves)
- Test: `lib/daemon/__tests__/socket-server.test.ts`, `lib/daemon/__tests__/boot-order.test.ts`

**Interfaces:**
- Produces:

```ts
// lib/daemon/socket-availability.ts
export type SocketState = "starting" | "serving" | "stopping";
export interface SocketAvailability { state: SocketState; inFlight: number }
export function createSocketAvailability(): SocketAvailability; // { state: "starting", inFlight: 0 }
export const UNAVAILABLE_STATUS = 503;
export function unavailableBody(state: "starting" | "stopping"):
  { ok: false; error: string; unavailable: "starting" | "stopping" };

// lib/daemon/socket-server.ts
export function startSocketServer(opts: {
  handleCommand: HandleCommand; log: Logger;
  availability?: SocketAvailability; // absent means always serving
}): Server;
```

- [ ] **Step 1: Write the failing tests** in `socket-server.test.ts`, using the file's existing server-start helper:

```ts
describe("startSocketServer: availability", () => {
  test("a starting daemon answers 503 unavailable and never calls handleCommand", async () => {
    // availability.state = "starting"; POST /chat:post
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "rt daemon is starting; try again in a moment", unavailable: "starting" });
    expect(calls).toEqual([]);
  });
  test("a stopping daemon answers 503 with the restarting sentence", async () => {
    expect(await res.json()).toEqual({ ok: false, error: "rt daemon is restarting; try again in a moment", unavailable: "stopping" });
  });
  test("a serving daemon dispatches, and inFlight is 1 during the handler and 0 after", async () => {});
  test("inFlight returns to 0 when the handler throws", async () => {});
  test("with no availability passed, requests dispatch as before", async () => {});
});
```

In `boot-order.test.ts`, change `EXPECTED_ORDER` to:

```ts
["logger", "park-gate", "socket-server", "rt-pid", "path-resolution", "events-db", "state-db",
 "background-subsystems", "handlers", "socket-ready", "api-server", /* the rest unchanged */]
```

Add a test that a unit failing after `rt-pid` (make the `events-db` seam throw) leaves neither `rt.pid` nor `rt.sock` behind. Add a test that the `evictStaleDaemon` seam is called before the `bindSocketServer` seam (record call order through the seams `makeBootContext` already takes; add an `evictStaleDaemon` seam if there is none).

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/socket-server.test.ts lib/daemon/__tests__/boot-order.test.ts`
Expected: FAIL (no `availability` option; order differs).

- [ ] **Step 3: Implement `socket-availability.ts` and the `availability` option.** In `fetch`, before reading the body: when `availability.state !== "serving"`, return `Response.json(unavailableBody(state), { status: 503 })`. Otherwise increment `inFlight`, and decrement in a `finally`.

- [ ] **Step 4: Reorder the units in `lib/daemon.ts`.**
  - `socket-server` moves to directly after `park-gate`. Its `start` awaits `evictStaleDaemon(log)` first, then binds with the boot context's `SocketAvailability` (created in `makeBootContext`, state `"starting"`).
  - `api-server` no longer calls `evictStaleDaemon`. Its comment about binding API before the socket is replaced: a failed API bind still exits through the fatal-boot path, and `runUnits` stops the started `socket-server` unit on the way out.
  - New unit `socket-ready`, directly after `handlers`: `start` sets `availability.state = "serving"`; `stop` is empty.
  - `rt-pid` moves to directly after `socket-server`: a daemon that holds the socket always has its pid on file, so a later daemon's `evictStaleDaemon` finds it, and `removeRuntimeFiles` (which unlinks `rt.sock` only when `rt.pid` names this process) cleans up a boot that fails after the bind. Replace the unit's "written only after both servers are bound" comment with that constraint.
  - `setPhase("socket")` stays with the bind.

- [ ] **Step 5: Run to verify they pass**

Run: `bun test lib/daemon/__tests__/socket-server.test.ts lib/daemon/__tests__/boot-order.test.ts lib/daemon/__tests__/boot-reconcile.test.ts lib/daemon/__tests__/lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 6: Check the tray's reading of a starting daemon.** Read `rt-tray/Sources/DaemonClient.swift` (`querySocket`, `isRunning`, `querySupervision`) and `rt-tray/Sources-core/Services/LaunchSettle.swift`. A 503 `unavailable` body must count as "daemon not answering yet", exactly like a missing socket, so the tray never kickstarts a daemon that is booting. If the decode already yields nil for that body, write that finding in the commit message; if not, fix it with a check in `rt-tray/Tests/MattstackCoreChecks`.

- [ ] **Step 7: Check the pty gate trigger.** If `lib/daemon/socket-server.ts` or `lib/daemon.ts` is not matched by `GLITTER_TRIGGERS` in `scripts/ci/test-scope.ts`, add `lib/daemon/socket-server.ts` and `lib/daemon/socket-availability.ts`.

- [ ] **Step 8: Commit**

```bash
git add lib/daemon lib/daemon.ts scripts/ci rt-tray
git commit -m "daemon: bind rt.sock early and answer starting until handlers are ready"
```

---

### Task 2: The old daemon drains before it exits

**Files:**
- Create: `lib/daemon/drain.ts`
- Modify: `lib/daemon/events-bus.ts`, `lib/daemon/gates-store.ts`, `lib/daemon.ts` (new last unit `socket-drain`), `lib/daemon/shutdown.ts` (header comment)
- Test: `lib/daemon/__tests__/drain.test.ts` (new), `lib/daemon/__tests__/boot-order.test.ts`, the existing events-bus and gates-store tests

**Interfaces:**
- Consumes: `SocketAvailability` from Task 1.
- Produces:

```ts
// lib/daemon/drain.ts
export const DRAIN_CAP_MS = 5_000;
export async function drainSocket(
  availability: SocketAvailability,
  deps: { settleWaiters(): void; sleep(ms: number): Promise<void>; now(): number; capMs?: number },
): Promise<{ drained: boolean; left: number }>;

// events bus and gates store each gain
settleWaiters(): void; // what close() does to waiters today, without closing the db
```

- [ ] **Step 1: Write the failing tests** in `drain.test.ts`:

```ts
test("sets state to stopping before anything else", async () => {});
test("calls settleWaiters once, after state is stopping", async () => {});
test("returns { drained: true, left: 0 } as soon as inFlight reaches 0", async () => {
  // inFlight 2, a fake sleep that drops it to 0 on the second call
});
test("gives up at the cap: returns { drained: false, left: 1 } once now() passes 5_000ms", async () => {});
test("returns at once when nothing is in flight", async () => {});
```

Add to the events-bus tests: a pending `wait` resolves `{ events: [], cursor: <head> }` on `settleWaiters()`, and the bus still accepts `emit` afterwards. Add to the gates-store tests: a pending wait resolves `{ status: "timeout" }` on `settleWaiters()`, and the store still reads afterwards. In `boot-order.test.ts`, append `"socket-drain"` as the last entry of `EXPECTED_ORDER`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/drain.test.ts lib/daemon/__tests__/boot-order.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement.** `settleWaiters()` on both stores, with `close()` / `close_()` calling it. `drainSocket`: set `state = "stopping"`, call `settleWaiters()`, then poll `inFlight` every 50ms until 0 or the cap.

- [ ] **Step 4: Add the `socket-drain` unit as the last unit in `buildUnits`**, so reverse-order shutdown runs it first, while the databases are still open. `start` is empty. `stop` awaits `drainSocket` with both stores' `settleWaiters`, and logs `{ left }` at `warn` when `drained` is false. The existing `socket-server` stop (`server.stop(true)`) stays as the final force-close.

- [ ] **Step 5: Fix the header comment in `lib/daemon/shutdown.ts`:** launchd's `ExitTimeOut` is 30s, not 5s.

- [ ] **Step 6: Run to verify they pass**

Run: `bun test lib/daemon/__tests__/drain.test.ts lib/daemon/__tests__/boot-order.test.ts lib/daemon/__tests__/shutdown.test.ts lib/daemon/__tests__/lifecycle.test.ts` plus the events-bus and gates-store test files.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/daemon lib/daemon.ts
git commit -m "daemon: drain in-flight socket requests before shutdown"
```

---

### Task 3: `rtCommand` retries while the daemon restarts

**Files:**
- Modify: `packages/rt-client/src/transport.ts`, `packages/rt-client/src/index.ts`
- Test: `packages/rt-client/test/transport.test.ts`, `packages/rt-client/test/transport-node.test.ts`

**Interfaces:**
- Produces:

```ts
export const DAEMON_RETRY_BUDGET_MS = 20_000;
export const DAEMON_DOWN_COOLOFF_MS = 30_000;
/** 100, 200, 400, 800, then 1000 for every later attempt. */
export function nextRetryDelay(attempt: number): number;
/** True for a 503 body a starting or stopping daemon sent. */
export function isUnavailable(r: unknown): r is { ok: false; error: string; unavailable: "starting" | "stopping" };
export interface RtResponse<T = unknown> { /* existing fields */ unavailable?: "starting" | "stopping" }
export async function rtCommand<T = unknown>(cmd: string, payload: Record<string, unknown>,
  opts?: { sockPath?: string; timeoutMs?: number; retryBudgetMs?: number }): Promise<RtResponse<T>>;
export const __test__: { resetCoolOff(): void };
```

`retryBudgetMs: 0` turns retrying off. `timeoutMs` stays per attempt.

- [ ] **Step 1: Write the failing tests** in `transport.test.ts`, each against a temp socket path passed as `sockPath`, with `__test__.resetCoolOff()` in `beforeEach`:

```ts
test("socket file missing, then a server appears: the call succeeds", async () => {
  // start Bun.serve on the path after 300ms
  expect(res).toEqual({ ok: true, data: { n: 1 } });
});
test("stale socket file (no listener), then a server appears: the call succeeds", async () => {});
test("a starting reply is retried until the server serves", async () => {
  // server answers 503 unavailableBody twice, then 200
  expect(hits).toBe(3);
});
test("a connection the server accepted and then closed is sent exactly once", async () => {
  // server destroys the socket inside fetch
  expect(hits).toBe(1);
  expect(res.ok).toBe(false);
});
test("a timeout is not retried", async () => {
  // timeoutMs: 100 against a handler that never answers
  expect(hits).toBe(1);
  expect(isDaemonTimeout(res.error)).toBe(true);
});
test("budget spent: the error still starts with DAEMON_UNREACHABLE_PREFIX", async () => {
  // retryBudgetMs: 300, nothing ever listens
  expect(res.error!.startsWith(DAEMON_UNREACHABLE_PREFIX)).toBe(true);
});
test("after a spent budget the next call returns without retrying", async () => {
  // second call with retryBudgetMs: 5_000 returns in under 200ms
});
test("a success clears the cool-off", async () => {});
test("retryBudgetMs: 0 makes one attempt", async () => {});
test("an unavailable reply after the budget is returned as the daemon sent it", async () => {
  expect(res).toEqual({ ok: false, error: "rt daemon is starting; try again in a moment", unavailable: "starting" });
});
test("nextRetryDelay: 100, 200, 400, 800, 1000, 1000", () => {});
```

Add the first two and the "exactly once" case to `transport-node.test.ts` too, so the node path (`postOverSocket`) is pinned.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test packages/rt-client/test/transport.test.ts packages/rt-client/test/transport-node.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Split today's body into one attempt that reports `{ response, connectFailed }`, and a loop around it. `connectFailed` is true only when the error shows no connection was made; pin the exact error shapes (Bun `fetch` and `postOverSocket`) from what the first two tests throw, and treat every other error as not retryable. The cool-off is module state per socket path: set when a budget is spent, cleared on any answered request, and while set a call makes one attempt.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test packages/rt-client/test/transport.test.ts packages/rt-client/test/transport-node.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild the package**

Run: `(cd packages/rt-client && bun run build)` then `bun test packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client
git commit -m "rt-client: retry a call while the daemon restarts"
```

---

### Task 4: `daemonQuery` retries while the daemon restarts

**Files:**
- Modify: `lib/daemon-client.ts`
- Test: `lib/__tests__/daemon-client.test.ts` (or the existing daemon-client test file; find it with `ls lib/__tests__ | grep daemon-client`)

**Interfaces:**
- Consumes: `DAEMON_RETRY_BUDGET_MS`, `nextRetryDelay`, `isUnavailable` from `packages/rt-client/src/transport.ts`.
- Produces: `SocketQueryAttempt` gains `unavailable: boolean`. `daemonQuery`, `daemonQueryAttributed`, `daemonSocketQuery`, `isDaemonRunning` and `pingDaemon` keep their signatures.

- [ ] **Step 1: Write the failing tests:**

```ts
test("trySocketQuery reports an unavailable reply as response null, unavailable true", async () => {});
test("daemonQueryAttributed retries an unavailable reply and returns the real answer", async () => {
  // server: 503 starting twice, then { ok: true }
  expect(attempt.response).toEqual({ ok: true });
});
test("an unavailable daemon past the budget returns response null without asking the tray to start one", async () => {
  expect(trayStartCalls).toBe(0);
});
test("after the tray acks a start, the wait for the socket runs up to the retry budget", async () => {
  // server appears 5s (fake clock) after the ack: the query succeeds
});
test("waitForSocket does not count a starting reply as up", async () => {});
test("isDaemonRunning is false for a starting daemon", async () => {});
test("a timed-out query is not retried", async () => { expect(hits).toBe(1); });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test <the daemon-client test file>`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `trySocketQuery`: a body for which `isUnavailable` is true returns `{ response: null, refused: false, timedOut: false, unavailable: true }`.
  - `daemonQueryAttributed`: while the attempt is `unavailable`, sleep `nextRetryDelay(n)` and try again, up to `DAEMON_RETRY_BUDGET_MS`. An unavailable daemon is running, so this path never calls `attemptRestart` and never warns.
  - After `attemptRestart()` returns true, `waitForSocket` runs with a total of `DAEMON_RETRY_BUDGET_MS` (it returns as soon as a ping gets a real answer). With no tray ack the behavior is today's: no long wait, one warning.
  - `waitForSocket`'s ping counts only a response that is not `unavailable`.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test <the daemon-client test file>`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon-client.ts lib/__tests__
git commit -m "daemon-client: retry a query while the daemon restarts"
```

---

### Task 5: `rt events wait` reconnects

**Files:**
- Modify: `commands/events.ts`
- Test: `commands/__tests__/events.test.ts` (create beside the other command tests if absent)

**Interfaces:**
- Produces:

```ts
export async function pollWithReconnect(
  pattern: string, after: number | undefined, waitMs: number, deadline: number | null,
  deps?: { query: typeof daemonQuery; sleep(ms: number): Promise<void>; now(): number },
): Promise<{ events: any[]; cursor: number } | { budget: true }>;
```

- [ ] **Step 1: Write the failing tests:**

```ts
test("a null reply is retried and the next answer is returned", async () => {});
test("backs off 1s, 2s, 4s, then 5s for every later retry", async () => {
  expect(sleeps).toEqual([1_000, 2_000, 4_000, 5_000, 5_000]);
});
test("writes one diagnostic line on the first retry only", async () => {});
test("stops with { budget: true } when the deadline passes, and never sleeps past it", async () => {});
test("an ok:false reply from the daemon still fails with its error", async () => {});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test commands/__tests__/events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** `pollOnce` becomes `pollWithReconnect`, mirroring `waitForGate` in `commands/gate.ts`: the same 1s start and 5s cap, the diagnostic through `out.diagnostic`. `wait` passes its own deadline and maps `{ budget: true }` to its existing timeout result; `tail` passes `null`. `rt events emit` is unchanged: a mutating call fails as it does today.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test commands/__tests__/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/events.ts commands/__tests__/events.test.ts
git commit -m "events: rt events wait reconnects across a daemon restart"
```

---

### Task 6: End-to-end proof and docs

**Files:**
- Modify: `e2e/tests/daemon.test.ts`, `docs/release-and-distribution.md`
- Test: `e2e/tests/daemon.test.ts`

- [ ] **Step 1: Write the failing e2e test** in `e2e/tests/daemon.test.ts`, using that file's own daemon-start helper and isolated HOME:

```ts
test("a call made while the daemon restarts succeeds", async () => {
  // start the daemon; stop it with SIGTERM; start a call to `ping` through rtCommand
  // while it is down; start the daemon again 500ms later
  expect(res.ok).toBe(true);
});
test("a long-poll open at shutdown ends with an empty result, not an error", async () => {
  // events:wait with waitMs 30_000; SIGTERM the daemon
  expect(res).toMatchObject({ ok: true, data: { events: [] } });
});
```

- [ ] **Step 2: Run it**

Run: `bun test --preload ./e2e/setup.ts e2e/tests/daemon.test.ts`
Expected: PASS (Tasks 1 to 4 already make it pass; a failure here is a real gap, fix it in the task that owns the code).

- [ ] **Step 3: Update `docs/release-and-distribution.md`.** In the section that describes the daemon restart after an update, state in a few lines: the daemon answers "starting" and "stopping", clients retry for about 20 seconds, a dropped request is not retried, and sessions started before this change need `/reload-plugins` to get the retry.

- [ ] **Step 4: Run the pty gate for the socket**

Run: `bun run test:pty`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e docs
git commit -m "daemon: e2e proof of calls surviving a restart; docs"
```
