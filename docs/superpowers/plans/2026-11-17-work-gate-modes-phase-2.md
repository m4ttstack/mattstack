# Work Gate Modes, Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution stops at the end of Part A.** Part A (Tasks 1-7) is the subagent loop: code paths, full TDD and review. Part B is not an SDD task list: it is the console UI, built live by the controller with Matt after the loop ends. An executor running subagent-driven development finishes Task 7, reports, and stops.

**Goal:** The operator sees every gate a mode answered, under its run, and can Pause the run or send it back to that gate's step with a note (Redo); herd runs also get one room line per mode decision.

**Architecture:** Pause and Redo reach a run through two new daemon verbs beside `runs:abandon`, which write the run DB: Pause sets today's `hold` field, Redo records a pending `redo` request. The worker learns of either at its next `run_next`: a hold already ends `held`, and a pending redo now applies as a redirect from inside `run_next` and returns `ended: "redirected"` with the note and the gate's recorded commit. `askGate` stops auto-answering while either is pending, and posts the herd room line from the worker's own MCP server. The console gets the two write routes and a pure feed derive in Part A; its UI waits for Part B.

**Tech Stack:** Bun, TypeScript, `bun test`, the rt daemon, `@mattstack/rt-client`, the console's Hono server and Vitest, the mattstack plugin's block Markdown.

**Spec:** `docs/superpowers/specs/2026-11-15-work-gate-modes-design.md` (section "Phase 2: live feed, Pause and Redo"). Phase 1 plan: `docs/superpowers/plans/2026-11-16-work-gate-modes-phase-1.md`.

## Global Constraints

- A mode's decider is `mode:<mode>` on the gate answer's `by` (phase 1). The feed shows exactly the gates whose `answer.by` starts with `mode:`.
- Pause is today's hold: engine `holdStage`, run field `hold`, a gate@1 decision `hold:<stage>:<attempt>`. Redo ends as today's redirect: a gate@1 decision `redirect:<stage>:<attempt>`. rt gains no branch reset verb, and no skill text may tell a worker to reset or rewrite history.
- Both controls record their decider as `console`.
- The repo is public: no team, pack, ticket or employer names in code, tests, fixtures, commits or PR text.
- Run `bun test` from the repo root only, on the targeted files you touch; console tests run with `bun run --cwd apps/console vitest run <file>`.
- A built binary runs only under an isolated HOME (`env -i HOME=<temp> ...`), every invocation.
- After touching `packages/rt-client/src`, run `bun run --cwd packages/rt-client build` (its `dist/` is what the console and the daemon tests resolve).
- Any edit under `plugins/mattstack` loads superpowers:writing-skills and mattstack:editing-skills first, bumps `plugins/mattstack/.claude-plugin/plugin.json`'s version (one past main's at merge time), and adds a `CERTIFICATION.md` row.
- After an MCP tool description or schema change, regenerate the reference: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`, and raise `plugins/mattstack/pack/requires.json`'s `minEngine` to the rt version this PR ships in, since the skill reads the new `run_next` result.
- No console UI file changes in Part A: no component, stylesheet, story or rendered copy. New pure derive modules and server routes only.

## Review Focus

- A Redo while the worker waits at an open gate in a later stage (`waiting-gate` armed): `run_next` returns `waiting` and the redo stays pending, applied at the next `run_next` after that gate settles (Task 1).
- Pause and Redo both pending: the hold wins and the redo survives the resume (resume clears only `hold`) (Task 1).
- Redo on a gate whose stage is now ahead of the run, because the run was sent back after that gate: refused at request with code `ahead` (Task 2); if it races past the check, `run_next` turns it into a hold whose reason names the redo (Task 1).
- A mode-eligible gate opening after the operator pressed Pause, in the same stage: it asks instead of answering itself (Task 3).
- Redo on a gate answered by a person or a shepherd, or one with no `meta.stage`: refused with `not-mode` or `no-stage`, nothing written (Task 2).

Also tested in their tasks: a herd worker with no chat sign-in still gets its answered gate, with `herdLineError` on the result; a second Redo while one is pending is refused with `pending`.

---

## File Structure

- Modify `lib/runs/engine.ts`: extract `redirectInTx` from `resolveStage`'s redirect branch; `pendingRedo`; `nextStage` applies a pending redo; `NextResult` gains `redirected`.
- Create `lib/runs/control.ts`: `holdAtNextStep`, `requestRedo` (the two writes, opened like `lib/runs/reconcile.ts`). Test `lib/runs/__tests__/control.test.ts`.
- Modify `lib/daemon/handlers/runs.ts` (`runs:hold`, `runs:redo`, seam `gateById`), `lib/daemon/command-router.ts:325` (wire the seam), `packages/rt-client/src/commands.ts` (payloads, `COMMAND_NAMES`), `packages/rt-client/src/client.ts` and `index.ts` (`holdRun`, `redoGate`).
- Modify `lib/gates/mode.ts` (`modeDecisionLine`), `lib/mcp/gate-tools.ts` (pending-control check, herd line), `lib/mcp/run-tools.ts` (`run_next` description).
- Modify `apps/console/src/server/runs.ts` (hold route), `apps/console/src/server/gates.ts` (redo route); create `apps/console/src/app/runs/derive/modeFeed.ts`.
- Modify `plugins/mattstack/attachments/pipeline/work/stages/index.block.md`, `what-the-graph-cannot-show.block.md`; create `plugins/mattstack/attachments/pipeline/work/stages/redo-from-console.block.md`.

---

# Part A: the subagent loop

### Task 1: The engine applies a pending redo at `run_next`

**Files:**
- Modify: `lib/runs/engine.ts` (`resolveStage` ~line 299, `nextStage` ~line 179)
- Test: `lib/runs/__tests__/engine.test.ts`

**Interfaces:**
- Produces:
  - `interface RedoRequest { gate: string; to: string; note: string; headCommit: string | null; by: string; at: number }`, stored as JSON in run field `redo`; `"-"` clears it.
  - `pendingRedo(db: Database): RedoRequest | null` (null when the field is missing, cleared or not valid JSON of that shape).
  - `redirectInTx(db, o: { stage: string; to: string; note: string; decidedBy: string; extra?: Record<string, unknown>; env: NodeJS.ProcessEnv; now: number }): Ok<{ next: Position; cleared: string[] }> | Fail`: the decision record, stage end, produce and consent clears and target start that `resolveStage`'s redirect branch does today; `extra` merges into the decision's selection. `resolveStage` calls it unchanged in behavior.
  - `NextResult` gains `{ ended: "redirected"; from: string; next: Position; note: string; headCommit: string | null; gate: string; cleared: string[] }`.

- [ ] **Step 1: Write the failing tests** (build runs with the file's existing helpers; set `redo` with `fieldSet`):
  - `a pending redo redirects at run_next`: run at `implement` (manifest `plan, implement, self-review`), redo `{gate:"g1", to:"plan", note:"split the helper", headCommit:"abc1234", by:"console"}` -> `ended: "redirected"`, `from: "implement"`, `next.stage === "plan"`, `note`, `headCommit`, `gate` echoed; `implement`'s latest attempt is `redirected`; a gate@1 decision `redirect:implement:1` decided by `console` whose selection has `to: "plan"`, `reason: "split the helper"`, `gate: "g1"`, `headCommit: "abc1234"`; field `redo` reads `-`.
  - `a redo to the current stage restarts it`: `to` equals the stage -> its attempt 2 is running.
  - `hold wins over a pending redo`: `hold` and `redo` both set -> `ended: "held"`, `redo` unchanged (Review Focus 2).
  - `an armed gate keeps the redo pending`: `waiting-gate` set -> `ended: "waiting"`, `redo` unchanged (Review Focus 1).
  - `a redo whose stage is ahead becomes a hold`: run at `plan`, redo `to: "self-review"` -> `ended: "held"`, reason `redo to self-review could not apply: it is ahead of plan`, `redo` reads `-` (Review Focus 3).
  - `a malformed redo field is ignored`: value `not json` -> the stage ends `done` as today.
  - `resolveStage redirect is unchanged`: the existing redirect tests pass untouched.
- [ ] **Step 2:** `bun test lib/runs/__tests__/engine.test.ts`; expect the new tests to FAIL.
- [ ] **Step 3:** Implement. In `nextStage`, after the `waiting` check and before the produce check: read `pendingRedo`; when the target is in the manifest at or before the stage, call `redirectInTx` with `decidedBy: redo.by`, `note: redo.note`, `extra: { gate, headCommit }`, clear `redo`, return `redirected`; otherwise clear `redo` and `holdInTx` with the reason above.
- [ ] **Step 4:** Run the file; expect PASS.
- [ ] **Step 5: Commit** `runs engine: apply a pending redo at run_next`.

### Task 2: Daemon verbs `runs:hold` and `runs:redo`

**Files:**
- Create: `lib/runs/control.ts`; test `lib/runs/__tests__/control.test.ts`
- Modify: `lib/daemon/handlers/runs.ts`, `lib/daemon/command-router.ts:325`
- Modify: `packages/rt-client/src/commands.ts` (beside `runs:abandon` at ~1059 and in `COMMAND_NAMES`), `client.ts` (beside `abandonRun` ~189), `index.ts`
- Test: `lib/daemon/__tests__/runs-handlers.test.ts`

**Interfaces:**
- Consumes: Task 1's `RedoRequest`; engine `holdStage`, `cleared`, `readManifest`.
- Produces:
  - `type ControlCode = "not-found" | "finished" | "pending" | "ahead" | "no-stage" | "not-mode" | "bad-note"`; `type ControlFail = { ok: false; code: ControlCode; error: string }`.
  - `holdAtNextStep(repo: string, runId: string, o: { reason: string; decidedBy: string; now?: number }): { ok: true; stage: string; already?: true } | ControlFail`. Holds the run's `current_stage`; a run already held (field `hold` not cleared) returns `already: true` and writes nothing.
  - `requestRedo(repo: string, runId: string, r: { gate: string; to: string; note: string; headCommit: string | null; by: string; now?: number }): { ok: true } | ControlFail`.
  - `runs:hold` payload `{ runId: string; repo?: string }`, data `{ held: true; stage: string; already?: true }`, reason `paused from the console`, decider `console`.
  - `runs:redo` payload `{ gate: string; note: string }`, data `{ runId: string; repo: string; to: string; headCommit: string | null }`, decider `console`. The run, `to` (`meta.stage`) and `headCommit` (`meta.headCommit`) come from the gate row, never the caller.
  - Refusals return `failure: { code, message }` beside `error` (output-layer rule). Messages: `bad-note` "Redo needs a note for the worker" (empty after trim, or over 2000 characters); `not-found` "no gate <id>" or "no run <id>"; `not-mode` "only a gate a mode answered can be redone"; `no-stage` "that gate recorded no stage to go back to"; `finished` "this run has finished"; `ahead` "that gate's stage is ahead of where the run is now"; `pending` "a redo is already waiting for this run".
  - Both verbs emit `run-updated` `{ repo, runId, stage, kind: "held" | "redo" }`, as `runs:abandon` does.
  - `RunsSeams.gateById?: (id: string) => GateRow | null`, wired to `opts.gatesStore.get(id) ?? null`.
  - rt-client: `holdRun(runId: string, repo?: string, opts?): Promise<RtResponse<{ held: true; stage: string; already?: true }>>`; `redoGate(p: { gate: string; note: string }, opts?): Promise<RtResponse<{ runId: string; repo: string; to: string; headCommit: string | null }>>`; both 10s timeout.

- [ ] **Step 1: Write the failing tests.** `control.test.ts` on a temp runs root: hold writes `hold` and a `hold:<stage>:1` decision by `console`; a second hold returns `already: true`; hold on a done run -> `finished`; redo writes the `redo` JSON with `by: "console"`; a second redo -> `pending`; redo whose `to` is after `current_stage` -> `ahead`; redo on a finished run -> `finished`. `runs-handlers.test.ts` with a fake `gateById`: a mode-answered gate (`answer.by: "mode:quiet"`, `subject: "run:<id>"`, `meta: {stage: "plan", headCommit: "abc1234"}`) -> data `{runId, repo, to: "plan", headCommit: "abc1234"}` and one `run-updated` with `kind: "redo"`; `answer.by: "console"` -> `failure.code === "not-mode"`; no `meta.stage` -> `no-stage`; note `"  "` -> `bad-note`; unknown gate -> `not-found`; every refusal writes nothing and emits nothing (Review Focus 5). `runs:hold` emits `kind: "held"`.
- [ ] **Step 2:** Run both files; expect FAIL.
- [ ] **Step 3:** Implement; then `bun run --cwd packages/rt-client build`.
- [ ] **Step 4:** Run both files and `packages/rt-client/test/dist-freshness.test.ts`; expect PASS.
- [ ] **Step 5: Commit** `daemon: runs:hold and runs:redo hold or send back a running run`.

### Task 3: `askGate` holds off while a control is pending, and posts the herd line

**Files:**
- Modify: `lib/gates/mode.ts`; test `lib/gates/__tests__/mode.test.ts`
- Modify: `lib/mcp/gate-tools.ts` (`GateToolDeps`, `askGate`'s auto path ~line 300 and its answered return ~line 360), `lib/mcp/run-tools.ts:393` (`run_next` description)
- Test: `lib/mcp/__tests__/gate-tools.test.ts`

**Interfaces:**
- Consumes: phase 1's `autoAnswerDecision`, `describeSelection`; `cleared` from `lib/runs/engine.ts`; `requireChatHandle` from `lib/mcp/shared.ts`; `chatPost` from rt-client.
- Produces:
  - `modeDecisionLine(mode: GateMode, scope: string, answers: AnswersMap): string`, exactly `<mode> mode decided <scope>: <key>=<value>, ...` (the digest's selection text), e.g. `quiet mode decided plan: tier=direct-tdd`.
  - `GateToolDeps.herdLine: (env: NodeJS.ProcessEnv, body: string) => Promise<string | null>` (null when posted, else the error). Real: when `env.HERD_ROOM` is set, `requireChatHandle(env)` then `chatPost({ room: env.HERD_ROOM, handle, body, quiet: true })`; with no `HERD_ROOM` it posts nothing and returns null.
  - A run whose `hold` or `redo` field is set and not cleared never auto-answers: the gate opens and asks as in chatty, with its digest.
  - A pre-answered result under `HERD_ROOM` calls `herdLine` once after the run decision; a failure adds `herdLineError: string` to the result and the gate stays answered.
  - `run_next`'s description: "Read how a stage ended and move the run on: starts the next stage when every produce is set, or reports failed, held, waiting, redirected (an operator's Redo moved the run back to an earlier stage, with their note and the commit the gate recorded) or the last stage. It returns results and opens no gates."

- [ ] **Step 1: Write the failing tests:**
  - `mode.test.ts`: `modeDecisionLine("quiet", "plan", {tier: "direct-tdd"}) === "quiet mode decided plan: tier=direct-tdd"`; a multi answer joins with `|`.
  - `gate-tools.test.ts`: `a paused run asks`: quiet, eligible worktree gate, snapshot field `hold: "paused from the console"` -> `ask` receives no `preAnswer`, result `paneAction` is not `answered` (Review Focus 4); `a pending redo asks` the same with field `redo`; `a cleared hold still answers` (`hold: "-"`); `a herd worker's answered gate posts one room line`: env `HERD_ROOM: "herd-x"`, `herdLine` called once with `quiet mode decided plan: tier=direct-tdd`; `no HERD_ROOM posts nothing`; `a failed room line keeps the answer`: `herdLine` returns `not signed in` -> `paneAction: "answered"`, `herdLineError: "not signed in"`, no `runErrors`.
- [ ] **Step 2:** Run both files; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS. Regenerate the MCP reference (Global Constraints).
- [ ] **Step 5: Commit** `gate tools: no mode answers while a run is paused; herd room line per mode decision`.

### Task 4: Console API for Pause and Redo, and the feed derive

**Files:**
- Modify: `apps/console/src/server/runs.ts` (after the `/abandon` route), `apps/console/src/server/gates.ts` (after `/answer`)
- Create: `apps/console/src/app/runs/derive/modeFeed.ts`; test `modeFeed.test.ts` beside it
- Test: `apps/console/src/server/runs.test.ts`, `gates.test.ts`; add `holdRun` and `redoGate` stubs to every `vi.mock('@mattstack/rt-client')` factory under `apps/console/src/server` that loads `./routes`

**Interfaces:**
- Consumes: Task 2's `holdRun`, `redoGate` and their `failure.code`; `decisionText` from `derive/day.ts`; `runIdOfGate` from `src/shared/gate-run`.
- Produces (Part B builds on these exactly):
  - `POST /api/runs/:repo/:runId/hold`, no body -> 200 `{ held: true, stage, already? }`. Local requests only (`isLocalRequest`, else 403); fixture 403 `FIXTURE_READ_ONLY`; `finished` 409; unreachable 502; other refusals 409 `{ error, code }`.
  - `POST /api/gates/:id/redo`, body `{ note: string }` -> 200 `{ runId, repo, to, headCommit }`. Same guards; a missing or blank note answers 400 without calling the daemon; `not-found` 404, `bad-note` 400, every other code 409, each as `{ error, code }`.
  - `interface ModeFeedRow { gate: GateRow; mode: string; choice: string; stage: string | null; headCommit: string | null; answeredAt: number }`
  - `interface ModeFeedRun { run: RunSummary; canControl: boolean; rows: ModeFeedRow[] }` (`canControl` is `run.status === 'running'`)
  - `modeOf(gate: GateRow): string | null` (the mode in `answer.by`, else null)
  - `modeFeed(runs: RunSummary[], gates: GateRow[], o?: { since?: number }): ModeFeedRun[]`: mode-answered gates on listed runs, answered at or after `since`; rows newest first; runs ordered by their newest row.

- [ ] **Step 1: Write the failing tests:**
  - `runs.test.ts`: `pause holds the run through holdRun` -> `rt.holdRun` called with `('run-1', 'repo-tools')`, 200 body equal to the stub's data; `pause maps a finished run to 409`; `pause is refused off this machine` (a `cf-connecting-ip` header -> 403, `holdRun` not called).
  - `gates.test.ts`: `redo sends the note to redoGate` -> `rt.redoGate` called with `{gate: 'g1', note: 'use the shared helper'}`, 200; `a blank note is 400 and never reaches the daemon`; `a pending redo is 409 with its code`; `an unknown gate is 404`; under the design fixture both writes are 403.
  - `modeFeed.test.ts`: `lists only mode-answered gates under their run` (a `mode:quiet` and a `console` gate on running `r1`, a `mode:normal` gate on done `r2` -> two runs; `r1` has one row with `mode: 'quiet'`, `choice === decisionText(gate)` and containing `direct-tdd`, `stage` and `headCommit` from `meta`; `r2.canControl === false`); `since drops older rows`; `a gate on an unlisted run is left out`; `runs order by their newest row`.
- [ ] **Step 2:** `bun run --cwd apps/console vitest run src/server/runs.test.ts src/server/gates.test.ts src/app/runs/derive/modeFeed.test.ts`; expect FAIL.
- [ ] **Step 3:** Implement. Keep each route chained and inline (console AGENTS.md: Hono RPC inference).
- [ ] **Step 4:** Run the same command and `bun run console:typecheck`; expect PASS.
- [ ] **Step 5: Commit** `console: pause and redo routes, and the mode feed derive`.

### Task 5: Work pipeline skill text for Redo and commit-before-gate

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/work/stages/index.block.md`, `plugins/mattstack/attachments/pipeline/work/what-the-graph-cannot-show.block.md`
- Create: `plugins/mattstack/attachments/pipeline/work/stages/redo-from-console.block.md`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version), `plugins/mattstack/pack/requires.json` (`minEngine`), `plugins/mattstack/CERTIFICATION.md`

**Interfaces:**
- Consumes: Task 1's `ended: "redirected"` result fields.

- [ ] **Step 1:** Load superpowers:writing-skills and mattstack:editing-skills. RED baseline: give a subagent the current stages graph and a `run_next` result `{ended: "redirected", from, next, note, headCommit, gate}`; record what it does (no edge exists for it).
- [ ] **Step 2:** In the stages flowchart add node `redo_from_console` and edges `run_next_ended -->|redirected: the operator's Redo| redo_from_console` and `redo_from_console --> follow_stage_file`.
- [ ] **Step 3:** Write `redo-from-console.block.md` (`node: redo_from_console`): the operator sent the run back from the console to `next`; read `note` as their instruction; `headCommit` is where that gate's step ended, so `git log <headCommit>..HEAD` is the work since; decide per change whether to revert it (`git revert`), rework it, or keep it, with normal commits; never reset, rebase away or force-push to rewrite it; then follow the stage file at `next`. The run already recorded the redirect, so call no `run_resolve`.
- [ ] **Step 4:** In `what-the-graph-cannot-show.block.md` add two bullets: **Commit before a gate**: a stage that changed files in the tree commits them before it opens a gate, so the gate's recorded commit is where that work ends. **Pause and Redo from the console** land at `run_next`: a Pause returns `held`, a Redo returns `redirected`.
- [ ] **Step 5:** Bump the plugin version, raise `minEngine` (Global Constraints), add the certification row; `bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir "$(mktemp -d)/mattstack" --strict`; expect clean.
- [ ] **Step 6:** GREEN check per writing-skills: the same subagent run now takes the new edge and keeps its commits.
- [ ] **Step 7: Commit** `plugin: work pipeline follows a console Redo; commit before a gate`.

### Task 6: Team pack check (org repo)

- [ ] **Step 1:** Load mattstack:extending-a-pack. Install Task 5's plugin version locally (`rt skills sync`, then `/reload-plugins`).
- [ ] **Step 2:** Read whether the team pack overrides the work pipeline's stages graph or graph notes. If it only vendors them, recompile and check (`rt skills compile`, `rt skills check`) and stop. If it overrides either, carry Task 5 Steps 2-4 into its copy, recompile and check.
- [ ] **Step 3:** Commit in the org repo with a plain message, no tracker ids, only if something changed.

### Task 7: End-to-end check on a scratch run

- [ ] **Step 1:** Under an isolated HOME, start the daemon from this worktree, start a run with `gateMode: "quiet"`, and open a `reach: "worktree"` plan gate: expect it answered by `mode:quiet`.
- [ ] **Step 2:** `rtCommand("runs:redo", {gate, note: "try the shared helper"})`, then `run_next` on the current stage: expect `ended: "redirected"` to `plan` with the note and `headCommit`.
- [ ] **Step 3:** `rtCommand("runs:hold", {runId})`; open another eligible gate: expect it to ask; `run_next`: expect `held`.
- [ ] **Step 4:** Record the commands and outputs in the PR body. No commit. **Stop here: Part A is done.**

---

# Part B: the console UI, live with Matt (after the loop)

Not SDD tasks. The controller builds this inline with Matt, iterating on what he sees.

**Consumes:** `GET /api/gates?linked=1` and `GET /api/runs` (existing; mode rows carry `answer.by: "mode:<mode>"`, `meta.stage`, `meta.headCommit`, `meta.reach`); `modeFeed(runs, gates, { since })` and `modeOf`; `POST /api/runs/:repo/:runId/hold` -> `{ held, stage, already? }`; `POST /api/gates/:id/redo` with `{ note }` -> `{ runId, repo, to, headCommit }`, refusals `{ error, code }`. Live refresh needs nothing new: the existing `gates` and `runs` socket topics already invalidate both reads.

- [ ] Mock the feed rows on the console design boards (`docs/apps/design/console/runs.pen`): a mode-answered gate marked with its mode, the choice made, under its run, with Pause and Redo with a note field, plus a paused run and a refused Redo. Copy through rt:ui-copy. Matt approves the mock before any build.
- [ ] Teach `answeredBy`, `answerStamp` and `answerSurface` (`derive/answers.ts`) the `mode:` decider, with the approved copy, so the run page's gate record names the mode too.
- [ ] Add a mode-answered gate to the design fixture (`runsFixture.ts`) so the `runs` scenario draws the feed.
- [ ] Build against the mock with kit primitives, controller inline, iterating live with Matt.
- [ ] Tests for behaviour only: Pause posts to the hold route; Redo posts the note to the redo route; a mode row shows its choice. No layout or snapshot tests; update layout tests only once iteration ends.
- [ ] Render in Fast Browser, light and dark, on the design fixture; send both screenshots to Matt as one Human Todos image item, and say plainly what looks wrong.
- [ ] Parity run for the runs board in light and dark (`apps/console/scripts/parity/run.md`).

## Calls made in this plan

- Pause and Redo land at the worker's next `run_next`, never mid-stage: the engine already ends a held stage there, and nothing types into a pane.
- Redo is a pending request that `run_next` applies, not a redirect the daemon writes: one written under a running worker would leave its next `run_next` refused as off-stage.
- A pending hold or redo stops the mode answering further gates, so a paused run decides nothing more alone.
- A hold wins over a pending redo, and a redo waits behind an armed gate; neither is dropped. A redo that turns out ahead of the run becomes a hold with a reason.
- Redo needs a note (up to 2000 characters); one redo may be pending per run; a second Pause returns `already: true`.
- The daemon takes only the gate id and the note; run, stage and commit come from the gate row. Both controls are decided by `console`.
- Pause and Redo work on herd runs too.
- The herd room line is posted by the worker's own MCP server as its own handle, `quiet`, so it rings no one and the daemon gains no herd wiring; a failed line never fails the gate.
- Commit-before-gate goes in the work pipeline's graph notes, not the shared gate protocol, so board skills need no re-expand.
- Every visible console change, including the run page's mode wording, waits for Part B.
