# Board Defers to a Live Work Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the board would launch a doctor on an MR whose branch (or an ancestor's) a live work run owns, it rings that worker's Claude session instead of launching.

**Architecture:** Run summaries gain `session` and `mr`. A new daemon verb pair (`inbox:ring`, `inbox:probe`) pushes a framed message into one session's inbox, the same transport the gate doorbell uses. Board triage looks up an owning run before dispatch, rings it, and records a handoff on triage memory; each pass re-checks open handoffs and re-arms the edge when the worker is gone. The manual doctor click gets a confirm dialog and a `ring` mode on `POST /doctor`.

**Tech Stack:** Bun, TypeScript, bun:test, React + `@mattstack/tui-kit` (board client), rt daemon over unix socket via `@mattstack/rt-client`.

**Spec:** `docs/superpowers/specs/2026-10-22-board-defers-to-live-run-design.md`

## Global Constraints

- The ring never injects keystrokes or Escape into a pane: inbox frame only.
- No change to the CI lease, its owners or its TTLs; an attended lease still wins first in triage.
- New daemon handlers log no outcome of their own (`handleCommand` does it).
- Rebuild `packages/rt-client` after touching it: `bun run --cwd packages/rt-client build`.
- rt unit tests run from the repo root (`bun test <path>`); board tests run as `bun run --cwd apps/board test <path>`, never `bun test apps/board` from the root.
- Board UI follows `docs/apps/ui-authoring.md`; copy follows `rt:ui-copy`.
- Public repo: invented names only in fixtures and stories (no real MR urls, people or projects).
- If the run lookup fails, the board behaves exactly as today (doctor launches).

## Review Focus

- **A run that is `running` but whose session is dead** (crashed pane, closed terminal): the ring must report not-delivered and the doctor launch as today; the handoff re-check must lapse it via `inbox:probe`. Pinned in Task 5.
- **Two running runs on one MR** (a stale one never closed plus a new one): pick the most recent `last_event_at`. Pinned in Task 3.
- **MR url spelled with a trailing slash** in the run's `mr` field vs. the board's url: normalize both. Pinned in Task 3.
- **A handoff whose pipeline went green, then red again with a new pipeline id**: the old handoff drops and the new edge rings again (not suppressed). Pinned in Task 5.
- **`listRuns` throws or the daemon is down mid-pass**: no owner logic runs, open handoffs are kept (not lapsed on missing evidence), doctors dispatch as today. Pinned in Task 5.

---

### Task 1: Run summaries carry `session` and `mr`

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (`RunSummary`, ~line 411)
- Modify: `lib/runs/store.ts` (placeholder row ~line 75, `withAttention` ~line 160, the second summary builder ~line 228)
- Test: `lib/runs/__tests__/store.test.ts`

**Interfaces:**
- Produces: `RunSummary.session: string | null` (the run's `claude-session` field) and `RunSummary.mr: string | null` (its latest `mr` field when it is an http(s) url, else null; pipelines write `-` to clear).

- [ ] **Step 1: Write the failing tests** in `store.test.ts`, using the file's existing run-db fixture helpers:
  - `summary carries the recorded claude session and mr url`: fields `claude-session=sess-1`, `mr=https://gitlab.example.com/acme/app/-/merge_requests/7` → `summary.session === "sess-1"`, `summary.mr === "https://gitlab.example.com/acme/app/-/merge_requests/7"`.
  - `a cleared mr field reads as null`: `mr` written then overwritten with `-` → `summary.mr === null`.
  - `a run with neither field has null session and mr`.
- [ ] **Step 2:** `bun test lib/runs/__tests__/store.test.ts` → the three new tests FAIL.
- [ ] **Step 3:** Add both fields to `RunSummary` with doc comments matching `ticket`/`branch`'s; set them in both summary builders and `null` in the placeholder row. `mr` uses the latest field row by `at` (same rule as `apps/board/src/gates/run-mr.ts` `mrUrlFromRun`).
- [ ] **Step 4:** `bun test lib/runs/__tests__/` → PASS. `bun run --cwd packages/rt-client build` → succeeds; `bun test packages/rt-client/test/dist-freshness.test.ts` → PASS.
- [ ] **Step 5: Commit** `runs: summaries carry the run's claude session and mr url`

### Task 2: Daemon verbs `inbox:ring` and `inbox:probe`

**Files:**
- Create: `lib/daemon/handlers/inbox.ts`
- Modify: `lib/daemon/command-router.ts` (spread `createInboxHandlers()` into `handlers`)
- Modify: `packages/rt-client/src/commands.ts` (two `Commands` entries + the verb list ~line 1392)
- Modify: `packages/rt-client/src/client.ts`, `packages/rt-client/src/index.ts` (wrappers)
- Test: `lib/daemon/__tests__/inbox-handlers.test.ts`

**Interfaces:**
- Produces (rt-client `Commands`):
  - `"inbox:ring": { payload: { session: string; label: string; text: string }; data: { delivered: boolean; reason?: "no-session" | "failed" } }`
  - `"inbox:probe": { payload: { session: string }; data: { reachable: boolean } }`
- Produces (rt-client): `inboxRing(payload: Commands["inbox:ring"]["payload"], o?: RtClientOptions)`, `inboxProbe(payload: Commands["inbox:probe"]["payload"], o?: RtClientOptions)`, both returning `Promise<RtResponse<…data>>`, timeout 5000ms.
- Produces (daemon): `createInboxHandlers(deps?: { resolve: (session: string) => InboxBinding | null; deliver: typeof deliverToInbox; probe: typeof probeInboxReachability })`, defaults `resolveLiveInbox` (`lib/claude-registry.ts`), `deliverToInbox`, `probeInboxReachability` (`lib/daemon/inbox.ts`). Ring body is `wrapCrossSession(label, text)`.

- [ ] **Step 1: Write the failing tests** with injected deps:
  - `ring delivers the wrapped frame to the resolved socket`: assert `deliver` called with the binding's `socketPath` and a body containing the label and text; result `{ ok: true, data: { delivered: true } }`.
  - `ring reports no-session when the session does not resolve` → `{ delivered: false, reason: "no-session" }`, `deliver` not called.
  - `ring reports failed when delivery fails` (`deliver` → `{ ok: false, error: "x" }`) → `{ delivered: false, reason: "failed" }`.
  - `ring rejects a payload without session, label or text` → `ok: false`.
  - `probe is reachable only for a live binding whose socket accepts` (three cases: no binding, probe `unreachable`, probe `reachable`).
- [ ] **Step 2:** `bun test lib/daemon/__tests__/inbox-handlers.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the handler file (model it on `lib/daemon/handlers/herdr.ts`), register it, add the `Commands` entries, verb-list rows and client wrappers.
- [ ] **Step 4:** `bun test lib/daemon/__tests__/inbox-handlers.test.ts` → PASS. Run whichever registry/parity tests fail on an unlisted verb (`rg -l "herdr:start" lib packages/rt-client -g '*.test.ts'`) → PASS. Rebuild rt-client.
- [ ] **Step 5: Commit** `daemon: inbox:ring and inbox:probe push a frame into one session's inbox`

### Task 3: Board run-owner lookup and ring frames

**Files:**
- Create: `apps/board/src/run-owner.ts`
- Test: `apps/board/src/__tests__/run-owner.test.ts`

**Interfaces:**
- Consumes: `RunSummary` (Task 1), `normalizeMrUrl` from `apps/board/src/gates/run-mr.ts`.
- Produces:
  ```ts
  export interface RunOwner { runId: string; session: string; stage: string | null }
  export function findRunOwner(
    q: { mrUrl: string; repo: string; branch: string },
    runs: readonly RunSummary[]
  ): RunOwner | null;
  export type RingFrame =
    | { kind: 'pipeline-red'; iid: number; pipelineId: number | null }
    | { kind: 'needs-rebase'; iid: number; targetBranch: string }
    | { kind: 'downstream-red'; childIid: number; pipelineId: number | null };
  export const BOARD_RING_LABEL = 'board';
  export function ringText(f: RingFrame): string;
  ```
- Owner rule: `status === 'running'`, `session` non-null, and either `normalizeMrUrl(run.mr) === normalizeMrUrl(q.mrUrl)`, or `run.mr === null && run.repo === q.repo && run.branch === q.branch`. Several matches → highest `last_event_at`.

- [ ] **Step 1: Write the failing tests:**
  - `matches a running run by mr url`; `ignores trailing slashes on either url`.
  - `matches by repo and branch only while the run has no mr`; `a run whose mr names another MR does not match on branch`.
  - `skips finished runs and runs with no session`.
  - `picks the most recently active of two running runs`.
  - `ringText` cases: pipeline-red contains `!<iid>`, the pipeline id and "no doctor was launched"; needs-rebase contains the target branch; downstream-red contains `!<childIid>` and "stacked on your branch". Exact wording is the implementer's; assert those substrings only.
- [ ] **Step 2:** `bun run --cwd apps/board test src/__tests__/run-owner.test.ts` → FAIL.
- [ ] **Step 3:** Implement `run-owner.ts` (pure, no IO, Bun-free).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `board: find the live work run that owns an MR, and the frames to ring it with`

### Task 4: Triage memory records handoffs; edges can re-arm

**Files:**
- Modify: `apps/board/src/triage/memory.ts`, `apps/board/src/triage/edge.ts`
- Test: `apps/board/src/__tests__/triage-edge.test.ts`

**Interfaces:**
- Produces (memory.ts, stays Bun-free):
  ```ts
  export interface Handoff {
    runId: string; session: string; stage: string | null;
    kind: 'pipeline-red' | 'needs-rebase';
    pipelineId: number | null;
    /** The MR whose run was rung: this MR, or an ancestor for a stacked child. */
    viaMr: string;
    at: number;
  }
  // MrMemory gains: handoff?: Handoff
  ```
- Produces (edge.ts): `export function rearm(mem: DispatchMemory, mrUrl: string, kind: EdgeKind): void` — `pipeline-red` clears `lastHandledPipelineId` to null, `needs-rebase` sets `lastNeedsRebase` false.

- [ ] **Step 1: Write the failing tests:** `rearm lets the same red pipeline fire again` (markHandled → detectEdges empty → rearm → detectEdges returns the edge); `rearm lets a held rebase fire again`; `rollDay keeps a handoff`.
- [ ] **Step 2:** `bun run --cwd apps/board test src/__tests__/triage-edge.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `triage: memory records a worker handoff; edges can re-arm`

### Task 5: Triage defers to a live run

**Files:**
- Modify: `apps/board/src/triage/run.ts`
- Modify: `apps/board/bin/triage.ts` (wiring)
- Test: `apps/board/src/__tests__/triage-run.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces (`TriageRunDeps`, all optional; absent means the feature is off, as `attendants` does today):
  ```ts
  /** null = the lookup failed; owner logic then stands aside for this pass. */
  listRuns?(): Promise<RunSummary[] | null>;
  ring?(session: string, text: string): Promise<boolean>;
  probe?(session: string): Promise<boolean>;
  ```
- Audit reasons added: `run-active` (outcome = run id), `upstream-run-active` (outcome = ancestor MR url), `ring-failed` (decision `dispatch`, outcome = run id), `handoff-lapsed` (outcome = run id), `handoff-cleared`.

Order inside `runTriage`: `observe` → fetch runs once → **handoff re-check** → `detectEdges` → per-edge loop. In the loop, the owner check sits after the existing stood-down, doctor-in-flight, lease and `upstreamBlocker` checks and before `decide` (a ring spends no budget).

Handoff re-check, per MR memory entry with a `handoff`:
- MR no longer in `mrs`, or its edge cleared (`pipeline-red`: not failed, or a different pipeline id; `needs-rebase`: no longer needs it) → delete the handoff, audit `handoff-cleared`.
- `runs === null` → keep it.
- The owner of `viaMr` is not `handoff.runId`, or `probe(handoff.session)` is false → delete it, `rearm`, audit `handoff-lapsed`.

Per edge, when `runs !== null` and `ring` is wired:
1. Own owner (`findRunOwner` with `repoForMr(edge.mrUrl)` and the facts' `sourceBranch`) → ring the `pipeline-red` or `needs-rebase` frame. Delivered → set `handoff` (`viaMr` = this MR), `markHandled`, audit skip `run-active`, `continue`. Not delivered → audit `ring-failed`, fall through to today's dispatch.
2. Else, for each ancestor in `chainOf(mrs, edge.mrUrl).ancestors` (nearest first): owner found → ring `downstream-red` for it. Delivered → `handoff` (`viaMr` = ancestor), `markHandled`, audit skip `upstream-run-active`, `continue`. Not delivered → audit `ring-failed`, fall through.

Wiring in `bin/triage.ts`: `listRuns` → rt-client `listRuns()`, `res.ok ? res.data.runs : null`, catching throws as null; `ring` → `inboxRing({ session, label: BOARD_RING_LABEL, text })`, true only on `ok && data.delivered`; `probe` → `inboxProbe`, true only on `ok && data.reachable`.

- [ ] **Step 1: Write the failing tests** with fake deps in the file's existing style:
  - `a live run on the branch is rung and no doctor launches` (launchDoctor not called, `memory.mrs[url].handoff.runId` set, audit reason `run-active`, ring text contains the pipeline id).
  - `a needs-rebase edge rings the rebase frame`.
  - `an undelivered ring launches the doctor and audits ring-failed`.
  - `a live run on the parent branch skips the child and rings the parent's worker` (audit `upstream-run-active`).
  - `the MR's own run wins over a parent's run`.
  - `a ring spends no attempt budget` (`attemptsToday` unchanged).
  - `an attended lease still skips before any ring` (ring not called).
  - `listRuns returning null dispatches as today and keeps open handoffs`.
  - `a handoff lapses when its run finishes and the same pipeline is still red` (re-armed, doctor launches the same pass, audit `handoff-lapsed`).
  - `a handoff lapses when the run is running but its session probe fails`.
  - `a handoff clears when the pipeline goes green` and `a new red pipeline after a cleared handoff rings again`.
- [ ] **Step 2:** `bun run --cwd apps/board test src/__tests__/triage-run.test.ts` → new tests FAIL, existing ones PASS.
- [ ] **Step 3:** Implement in `run.ts`; wire `bin/triage.ts`.
- [ ] **Step 4:** Same command → PASS; `bun run board:typecheck` → clean.
- [ ] **Step 5: Commit** `triage: ring a live work run instead of launching a doctor`

### Task 6: Board server: ring on request, and owner/handoff on the snapshot

**Files:**
- Modify: `apps/board/src/doctor-state.ts` (`parseDoctorRequestBody` accepts `ring?: true`)
- Modify: `apps/board/src/server.ts` (`case '/doctor'`, snapshot assembly ~line 987)
- Modify: `apps/board/src/triage/memory-store.ts` (`attachHandoff`)
- Modify: `apps/board/src/client/types.ts` (`BoardMRWithReview`)
- Test: `apps/board/src/__tests__/server-doctor-ring.test.ts` (model on `server-stand-down.test.ts`), `apps/board/src/__tests__/doctor-state.test.ts`

**Interfaces:**
- Produces (client types):
  ```ts
  activeRun?: { runId: string; stage: string | null; viaIid?: number }; // viaIid set when the owner is an ancestor's run
  handoff?: Handoff;
  ```
- Produces: `attachHandoff<T extends { webUrl?: string | null }>(mrs: T[], mem: DispatchMemory): Array<T & { handoff?: Handoff }>`; `attachActiveRuns(rows, runs: RunSummary[] | null, repoFor: (mrUrl) => string)` using `findRunOwner` over the row's own MR, then its ancestors (`chainOf` over the snapshot's own-MR facts).
- The server keeps one `listRuns` result cached for 10s for snapshots; the ring path always re-reads.
- `POST /doctor` with `ring: true`: look up the owner (own, then ancestors), ring the frame for the MR's state (needs-rebase when the body's `mode` is `rebase`, else pipeline-red; downstream-red when the owner is an ancestor's run). Delivered → write the `handoff` under the same cron lock the stand-down route uses, answer `{ ok: true, rung: true, runId }`. No owner → 409 `no work run is active on this MR`. Not delivered → 409 `the worker's session did not answer`. Without `ring`, the route is unchanged ("Launch anyway").

- [ ] **Step 1: Write the failing tests:** `parseDoctorRequestBody accepts ring: true and rejects other ring values`; `ring with a live owner rings and records a handoff`; `ring with no owner is a 409`; `ring whose delivery fails is a 409 and records nothing`; `a doctor post without ring launches as today even with a live owner`; `the snapshot carries activeRun and handoff`.
- [ ] **Step 2:** `bun run --cwd apps/board test src/__tests__/server-doctor-ring.test.ts src/__tests__/doctor-state.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS; `bun run board:typecheck` → clean.
- [ ] **Step 5: Commit** `board: POST /doctor can ring the active worker; rows carry the active run and handoff`

### Task 7: Board client: confirm before a manual doctor, and the handoff line

**Files:**
- Create: `apps/board/src/client/board/run-guard.ts`, `apps/board/src/client/board/RunActiveConfirmDialog.tsx`
- Modify: `apps/board/src/client/board/Board.tsx` (`guardedLaunch`, a `ringWorker` action posting `/doctor` with `ring: true`), `apps/board/src/client/board/row-status.ts` (`doctorLine`)
- Test: `apps/board/src/client/board/__tests__/run-guard.test.ts`, the existing row-status tests

**Interfaces:**
- Produces: `activeRunConfirmFor(flow: LaunchFlow, opts: LaunchOpts, mr: BoardMRWithReview): { runId: string; stage: string | null; viaIid?: number } | null` — non-null only for flows that POST `/doctor` (`doctor`, and `rebase-local` if it does), not for `quiet` or `focus`, and only when `mr.activeRun` is set. Mirrors `presenceConfirmFor`.
- Dialog: tui-kit `ConfirmDialog`, `intent="accent"`. Title names the MR and stage (e.g. "A work run is active on !4127"). Confirm = **Ring worker**, cancel = **Cancel** (holds focus, so Enter backs out). The body says which run and stage, and holds a subtle **Launch doctor anyway** button that runs today's launch.
- `doctorLine`: with no doctor in flight and `mr.handoff` set → `{ tone: 'quiet', word: 'handed to worker', detail: <stage, or "parent's worker" when viaMr is not this MR>, verbs: [] }`. Stand-down still outranks it; an in-flight doctor outranks it.

- [ ] **Step 1: Write the failing tests:** guard returns null for review flows, for focus and quiet, and with no `activeRun`; returns the owner for `doctor`. Row-status: `handoff shows handed to worker`; `parent handoff says parent's worker`; `an in-flight doctor outranks a handoff`; `stand-down outranks a handoff`.
- [ ] **Step 2:** `bun run --cwd apps/board test src/client/board/__tests__/run-guard.test.ts` plus the row-status test file → FAIL.
- [ ] **Step 3:** Implement; wire the dialog next to `PresenceConfirmDialog` in `Board.tsx`. Add a gallery or row story for the dialog and the handoff line, with invented data.
- [ ] **Step 4:** Tests PASS; `bun run board:typecheck` clean; `bun run --cwd apps/board capture:compare` passes, or any diff is only the new line/dialog.
- [ ] **Step 5: UI validation (mandatory):** render the dialog and a row showing "handed to worker" in Fast Browser (Storybook or a fixture board by raw port, never a `*.mattstack` url). Screenshot light and dark, and say plainly anything that reads wrong.
- [ ] **Step 6: Commit** `board: confirm before a manual doctor on a live run; show the worker handoff`

### Task 8: Worker pipeline rule for `[board]` frames

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/work/SKILL.md` (and the plugin version per `mattstack:editing-skills`)

Before editing, load `mattstack:editing-skills`, `superpowers:writing-skills` and `mattstack:process-digraphs` (the work skill is a digraph orchestrator). Follow writing-skills' RED/GREEN for the change.

- [ ] **Step 1: RED:** a baseline subagent run of the current skill, handed a `[board]` CI-failure frame mid-implement, shows what it does without the rule. Record the result.
- [ ] **Step 2:** Add the rule: a `[board]` frame about its own MR is part of the current stage (CI failure: fix before the stage ends; rebase: rebase before the stage ends; no separate fix loop, no hand-off); a `[board]` downstream frame means checking whether its own change broke the child, fixing on its own branch if so, otherwise noting it in the run; in watch-ci a frame about its own MR changes nothing. Put it where the digraph handles out-of-band input, as a node rather than prose, if the skill's shape calls for it.
- [ ] **Step 3: GREEN:** rerun the same scenario; the worker folds the fix in.
- [ ] **Step 4:** `rt skills check` (or the plugin's check named in `.claude/rules/build-and-plugin.md`) → clean; bump the plugin version.
- [ ] **Step 5: Commit** `work: fold a board CI or rebase frame into the current stage`
