# Peer asks start in seconds

Date: 2026-10-01. Branch: `board-peer-latency`. Status: design approved in
brainstorming.

## Problem

Asking a teammate's board for a review, a re-review or replies ("ask
agent") can take minutes to hours to start their agent, and the asker's row
lags the same way.

- The recipient board pulls its relay inbox on a 60s tick
  (`apps/board/src/peer/runtime.ts`). The relay only stores; `GET /inbox`
  returns at once and nothing pushes.
- The agent starts only when the board triage pass runs, and that pass is an
  `rt.cron` trigger on the daemon's `project-mrs` broadcast
  (`lib/setup/cron-install.ts`), which fires only when some MR in a tracked
  repo changes (`lib/daemon/project-sync.ts`). An arriving ask does not fire
  it, so on a quiet evening the ask waits for an unrelated MR change.
- The asker sees "launched" and every later status change on its own 60s
  tick.
- Asks start automatically only when `board.triage.enabled` is on, which is
  off by default and also turns on auto-doctor.

Sending is already immediate: the ask publishes inline
(`apps/board/src/server.ts`, the ask route) and status reports go out through
`kickOutbox`.

## Goal

With both machines awake, an ask starts the recipient's agent about 5s after
the click, and each status change reaches the asker's row within seconds. A
new mattstack member gets this with no setting to flip.

## Decisions

| Decision | Ruling |
|---|---|
| Target | Seconds, in both directions. |
| Who listens to the relay | The rt daemon, not the board. Agent launches already need the daemon, so this adds no new dependency, and asks still start while the board server is down. |
| Transport | A long-poll wait on the relay that consumes nothing. |
| Who starts the agent | Daemon cron, through a new `triage --peer` mode. The board server still never runs triage. |
| Default | Asks start automatically by default, under a new `board.peerAsks` key. Auto-doctor stays opt-in under `board.triage`. |
| Fallback | The board's 60s tick stays. Push only ever makes things faster. |
| Id echo | Review-state reports echo the ask their run answers (the author's latest ask held when the run started), so a late report cannot finish a newer ask. |
| Compatibility | Three users today. Deploy the relay, then release; no old-relay or old-board handling beyond the 60s tick. |

## Design

### Flow

1. Alice asks Bob's board for a re-review. Her board publishes to the relay,
   as today.
2. The relay wakes the long-poll that Bob's daemon holds. Bob's daemon
   broadcasts `peer-inbox`.
3. About 300ms later the `board-peer` cron trigger runs `board triage
   --peer`, which pulls the ask, clears the guardrails, launches the agent
   and publishes the "launched" outcome. Bob's board server also ticks on the
   broadcast, so the ask shows on his board.
4. The relay wakes Alice's daemon; her board ticks and shows "launched".
   Every later review-state report returns the same way.

When Bob's board server is down, steps 2 and 3 still run and the agent
starts; progress reports go out once his board is back, since the board
server emits them. When the daemon is down, everything falls back to the
60s tick and triage on MR changes. When a machine sleeps, the wait fails,
the waker backs off and reconnects, and the relay keeps what arrived.

### Relay: `GET /inbox/wait`

`GET /inbox/wait?since=<cursor>&timeout=<s>`, same bearer auth as `/inbox`.

- The cursor is the relay's own `received_at` in milliseconds.
- When this board has any unacked envelope with `received_at > since`, the
  call returns at once: `200 { woke: true, cursor: <max received_at> }`.
- Otherwise the relay parks the request as an in-memory waiter keyed by
  username. `publish()` to that username, or to `*`, resolves every waiter
  for the recipients it delivered to, with the new cursor. With nothing by
  `timeout` (default 25, capped at 25), it returns `200 { woke: false,
  cursor: since }`.
- A client disconnect (`req.signal` abort) drops the waiter. A board holds at
  most 4 waiters; a fifth resolves the oldest with `woke: false`.
- The call never fetches or acks. The cursor only moves forward, so a board
  whose envelopes nobody consumes does not make the waker spin.
- One relay process is assumed, which the single SQLite file already
  requires.

### Daemon: the peer waker

New module `lib/daemon/peer-waker.ts`, started with the daemon's other
background subsystems.

- Runs only while the machine is peered: a switchboard URL resolves (the same
  resolution the `account.board-peering` setup row uses) and a board token
  is in the secrets store. While either is missing it re-checks every 5
  minutes, so `rt team join` starts it without a daemon restart.
- Loop: wait with the current cursor; on `woke: true`, broadcast
  `peer-inbox` with `{ cursor }` on the daemon's events bus and keep the new
  cursor; then wait again. The cursor starts at 0, so a fresh daemon gets one
  catch-up wake when anything is already queued.
- Each request carries an abort timeout of the wait plus 10s, so a
  half-open connection after sleep cannot hang the loop.
- Any failure (network, non-2xx) backs off 1s, 2s, 4s, capped at 60s, and
  resets on a 2xx. It logs once per distinct failure kind at warn and each
  wake at debug, following the daemon's logging rules.
- The waker never reads a payload.

### Cron trigger

- `lib/setup/cron-install.ts` gains `peerTrigger(run)`: name `board-peer`,
  event `peer-inbox`, `run` the resolved board invocation plus `triage
  --peer`, `debounceMs: 300`.
- The `cron.triage` setup step installs `board-triage` while
  `board.reReview` is on (unchanged) and `board-peer` while
  `board.peerAsks` is on, each independently.
- A dated `MigrationDef` installs `board-peer` on machines that already have
  `board-triage`, reusing its `run` prefix, when `board.peerAsks` is on.
- The daemon's cron layer re-reads `rt.cron` on a broadcast once its last
  read is 30s old, so a trigger the migration writes after the daemon boots
  arms without a restart.

### Board: `triage --peer`

A mode of `apps/board/bin/triage.ts`.

- Exits 0 unless `board.peerAsks` is on and a switchboard URL and token
  load.
- Takes the same claim as the full pass (`tryClaimCron`). When the claim is
  held it waits, polling every second for up to `CRON_CLAIM_STALE_MS`
  (2 minutes), instead of exiting, so an ask that lands while a full pass is
  past its nudge read is not stranded. If it still cannot claim, it exits and
  the next broadcast retries.
- Under the claim: `runPeerTick` with the board's materialize functions
  (pull, materialize, ack), then `runNudgePass`, then `drainOutbox`, then
  `writeMemory`.
- Runs no doctor and no latch pass. It resolves the GitLab identity only as
  far as the nudge pass needs it (own-MR checks for respond asks).
- The full pass's nudge job reads `board.peerAsks` as well, so both paths
  agree.

### Board server

- On a `peer-inbox` broadcast, the writer calls `peering.tickNow()`. Ticks
  never overlap, so a burst collapses into one tick.
- The 60s interval stays.
- The "awaits click" state on a pending ask (`triageEnabled()` in
  `server.ts`) reads `board.peerAsks`.

### Setting: `board.peerAsks`

- Registry def in `packages/rt-client/src/settings/registry-defs.ts`: type
  object, scopes user and team, merge deep, `default: { enabled: true }`.
  Schema `z.looseObject({ enabled: z.boolean().optional() })`, and
  `schema.lock.json` updated.
- A board loader beside `loadReReviewConfig` (`apps/board/src/triage/config.ts`)
  that fails open to the default, like that one.
- `decideRequest`'s `disabled` check reads this key instead of
  `triage.enabled`. Cooldown and daily budget still come from `board.triage`
  and its defaults (30 minutes, 3 per MR per day).
- Follow the registry checklist in `docs/settings-architecture.md`.

### Id echo on review-state

- `ReviewState` gains an optional `runStartedAt`, stamped by
  `writeReviewState` whenever a write moves the lane from nothing, done or
  error into queued or reviewing. Every launch path, triage or click, goes
  through that write, so no launch site changes.
- `NudgeState` gains an optional `materializedAt` (this board's clock), so
  the comparison below never mixes the relay's clock with this one.
- The review-state emitter in `server.ts` picks the run's ask with
  `askIdForRun`: the MR author's latest review or re-review ask on that MR
  materialized at or before `runStartedAt`. It puts that id on the payload
  as `nudgeId`. An ask that lands mid-run belongs to the next run.
- On the asker's board, `materializeEnvelope` passes a review-state's
  `nudgeId` to `finishSentNudge`, which already retires by id for
  respond-state. With an id, only that ask can finish. Without one (a review
  nobody asked for), today's `updatedAt` guard applies.
- Both new fields are optional fields inside stored JSON, so no
  `SCHEMA_VERSION` bump. Confirm this in the plan.

## Rollout

1. Deploy the relay (Railway). The new route is additive.
2. Ship one mattstack release with the waker, the trigger, the migration,
   `board.peerAsks` and the board changes.

## Testing

- Relay (`apps/board/switchboard/__tests__`): immediate return when
  pending, a parked wait woken by a publish, wake on `*`, timeout, disconnect
  cleanup, the waiter cap, 401.
- Waker (fake fetch and clock): broadcast on wake, cursor carried forward,
  backoff and reset, the abort timeout, start once a token appears.
- Cron and setup: `peerTrigger` shape; the `cron.triage` step installs
  `board-peer` by `board.peerAsks`; the migration adds it once and is
  idempotent.
- `triage --peer`: waits on a held claim, exits when asks are off, runs pull,
  nudge pass and drain, never the doctor or latch pass.
- Board: `peer-inbox` triggers `tickNow`; "awaits click" follows
  `board.peerAsks`; review-state with `nudgeId` finishes only that ask; one
  without falls back to `updatedAt`.
- Integration: the real relay process and the real waker, asserting the
  `peer-inbox` broadcast within 1s of a publish, and a held wait outliving
  Bun's default 10s idle timeout (the relay sets `idleTimeout` above the
  wait cap). The peer pass itself is covered by board unit tests.
- UI: the ask band's status transitions rendered in Fast Browser, light and
  dark.

## Docs

- `apps/board/docs/agent-actions.md`, "Nudge handling": governed by
  `board.peerAsks`, on by default, fired on arrival.
- `apps/board/docs/peer-boards.md`: push through the daemon, the wait route,
  deploy order.

## Out of scope

- Desktop notifications on arrival beyond what the nudge pass already sends.
- Respond-state's "latest ask per asker" echo; it already carries an id.
- Multiple relay replicas.
