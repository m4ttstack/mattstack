# Gate Kit Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With an rt setting on, every pane gate opened through `gate_ask` or `gate_open` shows whole in the gate-form mod's kit form. Submit means continue, More actions offers Pause run and Go back to stage, and the form closes itself without any keypress.

**Architecture:**
- The gate-form mod hooks the mattstack MCP `gate_ask` and `gate_open` calls and adds `kitForm: true` when it can draw here.
- The gate tool passes that to the daemon only when `rt.gates.kitForm` is on. The daemon presents the gate as `kit` (no option cap, nudge set, never Escape), and the tool returns `paneAction: "kit"` with a `kitForm` block.
- The mod opens the form and answers through `rt gate answer`. It wakes the agent with `$.prompt.submit`, and watches each gate with `rt gate wait` so it can close the form when the gate is answered elsewhere.

**Tech Stack:** Bun/TypeScript (rt CLI, daemon, MCP server, `packages/rt-client`), Claude Code mods (TS/JSX against `@mattstack/mod-kit`, built by `bun run mods:build` into `plugins/<name>/`), mattstack compiled skills (`rt skills compile`).

**Spec:** `docs/superpowers/specs/2026-11-13-gate-kit-forms-design.md`

**Base:** branch `gate-kit-forms`, stacked on `rt-572-drop-gate-next` (#1138). Rebase onto it whenever Darla (rt chat `darla.xq0w`) says it moved. #1138 adds `BOARD_ONLY_KINDS` in `lib/daemon/handlers/gate.ts`. If it isn't on the base yet when Task 3 starts, rebase first; if it's still missing, define it there as `["review-post", "respond-plan", "respond-post"]` and tell Darla.

## Global Constraints

- **The setting:** `rt.gates.kitForm`, boolean, scope `["machine"]`, default `false`.
- **The switch:** kit presentation only when the setting is on AND the call carries `kitForm: true` AND the daemon has a pane id and a session. Otherwise every path behaves exactly as today.
- **Presentation values:** `"form" | "wait" | "kit"`. Only the daemon sets it, at open time.
- **Run control answers:**
  - Pause run is `{next: "hold"}`.
  - Go back to stage is `{next: "go-back", to: "<stage>"}`.
  - `next` may be wrapped as `{value, note}`.
  - There's no Abandon row.
- **Menu wording, verbatim:** `More actions ▾`, `Pause run`, `Go back to stage ▸`.
- **No new Escape:** never send a keypress into a pane for a `kit` gate.
- **Board-only kinds** (`review-post`, `respond-plan`, `respond-post`) never get a kit form. They get the "Open on board" band, whose URL is the deck board address plus `?gate=<id>`. Never use a `*.mattstack` URL.
- **Wire contracts:** `validateGateAnswers` error strings are pinned by `packages/rt-client/test/gate-answers.test.ts`, so existing strings never change.
- **rt-client `dist`:** after changing anything in `packages/rt-client/src`, rebuild its `dist` (`.claude/rules/workspace-packages.md`).
- **Mod rules:**
  - `export function register(on: On)`, with one matcherless `on(event)` per event
  - literal atom refs, no `import(`, and never declare `h` or `Fragment`
  - Client props under 100,000 characters
- **Tests:** run only targeted tests for touched files locally. Mods use `bun run mods:test` and `claude plugin test plugins/gate-form`.
- **Repo hygiene:** no mattstack ticket ids in employer-visible surfaces (none are touched here). Comments state constraints only.
- **Skill edits:** load `superpowers:writing-skills` and `mattstack:editing-skills` before touching any skill or attachment.

## Review Focus

1. **A gate answered on the board while the kit form is open.** The form closes with "Answered on the board", the agent wakes from the doorbell, and nothing is typed into the pane. (Task 4 and Task 10 tests.)
2. **The mod reloads or the session resumes with a kit gate still open.** The form and its watcher come back, and a stale submit is refused by the CAS, which shows as the form's error. (Task 10 test.)
3. **A pane without the mod, VS Code, or a subagent's `gate_ask` with the setting on.** The result is today's form or wait, and the chunks are unchanged. (Task 5 and Task 9 tests.)
4. **A run gate under a herd worker.** The form shows, but More actions is absent. (Task 5 test.)
5. **Two gates opened in one pane back to back, with different kinds.** Both keep their own forms in a queue, and closing one never closes the other. (Task 9 test.)

---

### Task 1: The `rt.gates.kitForm` setting

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (next to the other `rt.*` machine rows)
- Modify: `packages/rt-client/src/settings/schema.lock.json`
- Test: `packages/rt-client/src/settings/__tests__/schema-lock.test.ts` (existing)

**Interfaces:**
- Produces: setting key `rt.gates.kitForm`, read with `getSetting("rt.gates.kitForm").value === true`.

- [ ] **Step 1:** Add the row:
  - `key: "rt.gates.kitForm"`, `type: "boolean"`, `scopes: ["machine"]`, `default: false`, `merge: "replace"`
  - description: `"Show pane gates in the gate-form mod's kit form instead of Claude Code's question form. Needs the gate-form plugin. Off by default while the kit form is a prototype."`
- [ ] **Step 2:** Regenerate the lock the way `schema-lock.ts` documents, then run `bun test packages/rt-client/src/settings/__tests__/schema-lock.test.ts` from the repo root. Expected: PASS.
- [ ] **Step 3:** Rebuild rt-client `dist`. Commit `settings: add rt.gates.kitForm (machine, off)`.

### Task 2: Reserved run-control answer keys

**Files:**
- Modify: `packages/rt-client/src/gate-answers.ts` (`validateGateAnswers`)
- Modify: `lib/mcp/herd-tools.ts:106` (`invalidAnswers`)
- Test: `packages/rt-client/test/gate-answers.test.ts`, `lib/mcp/__tests__/herd-tools*.test.ts` (whichever covers `invalidAnswers`)

**Interfaces:**
- Produces: `export const RUN_CONTROL_NEXT = ["hold", "go-back"] as const` and `export function isRunControl(questions: GateQuestion[], answers: Record<string, unknown>): boolean`, both exported from `packages/rt-client/src/gate-answers.ts`.

- [ ] **Step 1: Write the failing tests** in `gate-answers.test.ts`:
  - `validateGateAnswers(qs, {next: "hold"})` is `null` for a gate with unanswered questions and no `next` question.
  - `{next: {value: "hold", note: "lunch"}}` is `null`.
  - `{next: "go-back", to: "plan"}` is `null`.
  - `{to: "plan"}` alone is `"to is allowed only with next: go-back"`.
  - `{next: "abandon"}` is `"next must be hold or go-back"`.
  - `{next: "hold", tier: "light"}` still checks `tier` against its options.
  - A gate that asks its own `next` question keeps today's behaviour: option membership applies, and `{next: "hold"}` on it is checked against that question's options.
  - Every existing assertion stays green.
- [ ] **Step 2:** Run `bun test packages/rt-client/test/gate-answers.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.**
  - When the gate has no `next` question, `next` and `to` are reserved and checked by the two new strings above.
  - When `next`'s value is in `RUN_CONTROL_NEXT`, the missing-answers check is skipped. Anything that is answered is still validated.
  - `isRunControl(questions, answers)` is true when `answerValue(answers.next)` is in `RUN_CONTROL_NEXT` and `questions` has no `next` question.
- [ ] **Step 4:** Make `invalidAnswers` skip `next` and `to` the same way, delegating to `validateGateAnswers` for the reserved-key checks. Add a test: `herd_gate_answer` with `{next: "hold"}` on a gate without `next` is accepted.
- [ ] **Step 5:** Run both test files. Expected: PASS. Rebuild rt-client `dist`. Commit `gates: accept reserved next/to run-control answers`.

### Task 3: Daemon presents `kit`, and returns `boardOnly`

**Files:**
- Modify: `packages/rt-client/src/gate-presentation.ts`
- Modify: `packages/rt-client/src/commands.ts`:
  - `GateOrigin.presentation` (207)
  - the `gate:ask` payload and data (1355-1375)
  - `herd:diagnose` `openGates.presentation` (1441)
- Modify: `lib/daemon/handlers/gate.ts`:
  - `invalidOrigin` (141-162)
  - the `gate:open` presentation checks (506-523)
  - `gate:ask` (778-842)
  - fork-check (885)
- Modify: `lib/daemon/gate-push.ts:90-95` (the shepherd fan-out phrase)
- Modify: `commands/gate.ts:405-412` (`withGateTokens`)
- Test: `lib/daemon/__tests__/gate-ask-handler.test.ts`, `packages/rt-client/test/gate-presentation*.test.ts` (create it if none exists), `commands/__tests__/gate-fork-check-cli.test.ts`

**Interfaces:**
- Produces:
  - `gatePresentation(args: {paneId?, sessionId?, questions, kit?: boolean}): "form" | "wait" | "kit"`
  - the `gate:ask` payload gains `kitForm?: boolean`
  - `gate:ask` data gains `boardOnly: boolean` and `presentation: "form" | "wait" | "kit"`
- Consumes: `BOARD_ONLY_KINDS` from #1138 (see Base).

- [ ] **Step 1: Write the failing tests:**
  - `gatePresentation({paneId: "p", sessionId: "s", questions: [q5opts], kit: true})` is `"kit"`.
  - The same call without `kit` is `"wait"`.
  - `kit: true` with no session is `"wait"`.
  - Handler: `gate:ask` with `kitForm: true`, a pane and a session stores `origin.presentation: "kit"` and `nudge.session`.
  - A board-only kind with `kitForm: true` is `"wait"` with `boardOnly: true`.
  - A normal kind returns `boardOnly: false`.
  - `formCapExceeded` is absent for a kit gate.
  - fork-check: a `kit` gate never allows AskUserQuestion.
  - `invalidOrigin` accepts `presentation: "kit"` only when it comes from the ceremony. A caller-supplied `"kit"` on `gate:open` is refused with `'presentation "kit" is set by gate:ask only'`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `kit` wins over the option cap. Board-only kinds are `wait` whatever `kit` says.
  - Set `nudge` for `form` and `kit` alike.
  - `boardOnly` is `BOARD_ONLY_KINDS.includes(kind)`.
  - The fan-out phrase names a kit gate as "shown in the kit form".
  - `withGateTokens` passes `kit` through.
- [ ] **Step 4:** Run the tests plus `bun test lib/daemon/__tests__/gate-*.test.ts commands/__tests__/gate*.test.ts`. Expected: PASS. Rebuild rt-client `dist`. Commit `gates: daemon presents kit gates and reports boardOnly`.

### Task 4: Never Escape a kit gate

**Files:**
- Modify: `lib/daemon/reconciler.ts:300-337` (the `leave-blocked` retry)
- Test: `lib/daemon/__tests__/reconciler*.test.ts`, `lib/daemon/__tests__/gate-push*.test.ts`

**Interfaces:**
- Consumes: `origin.presentation === "kit"` from Task 3.

- [ ] **Step 1: Write the failing tests:**
  - reconciler: a `leave-blocked` expectation for a `kit` gate never calls `injectEscape`, and it's marked `confirmed` on its first sweep.
  - gate-push: answering a `kit` gate from `by: "board"` rings the doorbell and never calls the Escape injector. This pins today's form-only probe.
- [ ] **Step 2:** Run. Expected: the reconciler case FAILs; the gate-push case passes already.
- [ ] **Step 3:** In `checkExpectations`, read the row (`deps.store.get(pe.gateId)`). A `kit` presentation counts as delivered.
- [ ] **Step 4:** Run. Expected: PASS. Commit `reconciler: never send Escape for a kit gate`.

### Task 5: Gate tools take the mod's flag and return `paneAction: "kit"`

**Files:**
- Modify: `lib/mcp/gate-tools.ts`:
  - `askGate` (182-247)
  - `openGate` (510-563)
  - `reconcileGate` (565-596)
  - `recordAnswered` (335)
  - the `gate_open` and `gate_ask` input schemas
- Modify: `lib/mcp/tools.ts:258-276` (the `gate_ask` schema and description)
- Modify: `lib/gates/form.ts:85-89` (`PaneAction`, `paneActionFor`)
- Test: `lib/mcp/__tests__/gate-tools*.test.ts`, `lib/gates/__tests__/form.test.ts`

**Interfaces:**
- Consumes:
  - `getSetting` (Task 1)
  - `gate:ask` `kitForm` / `boardOnly` (Task 3)
  - `isRunControl` (Task 2)
  - `earlier()` from `lib/runs/engine.ts:203-207`
- Produces the result shape Task 9 reads:
  ```ts
  paneAction: "form" | "wait" | "kit"
  boardOnly: boolean
  kitForm?: {
    questions: GateQuestion[]
    context?: string
    controls: { pause: boolean; goBack: string[] }
  }
  ```
  - `GateToolDeps` gains `kitFormOn(): boolean`, real: `getSetting("rt.gates.kitForm").value === true`.

- [ ] **Step 1: Write the failing tests** (`kitFormOn` stubbed):
  - setting on + `kitForm: true` + a daemon reply of `presentation: "kit"`: `paneAction: "kit"`, `formChunks: []`, and a `kitForm` block with all questions, uncapped.
  - setting off + `kitForm: true`: the daemon payload has no `kitForm`, and the result is byte-identical to today's.
  - Under a run, a kit gate writes `waiting-gate=<id>`.
  - `controls`:
    - `{pause: true, goBack: ["plan", "provision"]}` for a run whose earlier stages are those.
    - `{pause: false, goBack: []}` with no run.
    - Empty when the gate owner starts with `herd:`.
  - `gate_open` with `handBack: true` and `kitForm: true` passes through as today.
  - `gate_open` on a kit gate puts its fitted `formContext` in `kitForm.context`.
  - `boardOnly` is passed through from the daemon on every result.
  - `reconcileGate` on an answer `{next: "hold"}` returns `next: "hold"` and writes no gate@1 decision for the scope.
  - `runErrors`, `labelsTruncated`, `supersededId` and `contextDropped` still appear when present.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Accept the optional `kitForm` boolean in both schemas; it's documented as "set by the gate-form mod; never pass it yourself".
  - `paneActionFor` maps `kit` to `"kit"`.
  - Leave `kitForm` out of the result when the daemon's presentation isn't `kit`.
- [ ] **Step 4:** Run `bun test lib/mcp/__tests__/gate-tools*.test.ts lib/gates/__tests__/form.test.ts lib/__tests__/agent-safe.test.ts`. Expected: PASS. Commit `gate tools: kit presentation behind rt.gates.kitForm`.

### Task 6: Skill rules for kit gates and run controls

**Files:**
- Modify: `plugins/mattstack/attachments/gate-protocol/index.block.md` (the `paneAction` routing)
- Modify: `plugins/mattstack/attachments/gate-protocol/build-questions.block.md` (the line saying `hold` and `go-back` reach a site only through a hand-back)
- Create: `plugins/mattstack/attachments/gate-protocol/run-control-answer.block.md`
- Recompile and bump per `mattstack:editing-skills`

**Interfaces:**
- Consumes: `paneAction: "kit"` (Task 5) and `reconcileGate`'s `next` (Task 5).

- [ ] **Step 1:** Load `superpowers:writing-skills` and `mattstack:editing-skills`. Run the RED baseline they describe. A fresh agent, given a compiled stage, must:
  - never call AskUserQuestion when a gate result says `paneAction: "kit"`
  - send `next: hold` and `next: go-back` answers from `gate_reconcile` to `run_resolve`
  Record what it does today.
- [ ] **Step 2:** Add the `paneAction: "kit"` branch: "The gate shows in the kit form. Never present it; end your turn holding at the gate. The answer arrives as your next input; call `gate_reconcile`."
- [ ] **Step 3:** Add `run-control-answer`: a reconciled answer with `next: hold` goes to `run_resolve {next: hold}`, and `next: go-back` with `to` goes to `run_resolve {next: redirect, to}`, at every run gate. The site's own questions aren't acted on, and the gate isn't treated as decided.
- [ ] **Step 4:** Compile, run `rt skills check --strict`, and run the GREEN check with the same fresh-agent prompt. Commit `gate-protocol: kit paneAction and run-control answers`.

### Task 7: Attention signals know kit gates

**Files:**
- Modify: `lib/runs/attention.ts:85-120`
- Modify: `lib/daemon/herd-watchdog.ts:140-157`
- Test: `lib/runs/__tests__/attention*.test.ts`, `lib/daemon/__tests__/herd-watchdog*.test.ts`

**Interfaces:**
- Consumes: open gates with `origin.presentation === "kit"`.

- [ ] **Step 1: Write the failing tests:**
  - A run whose agent is idle, with an open kit gate for its session, reads "at gate" and is never "stale", even after 30 minutes.
  - The herd watchdog treats a worker with an open kit gate as awaiting an answer, the same as `at-gate`, and never pokes it.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, reading the open gates through the store calls each module already has.
- [ ] **Step 4:** Run. Expected: PASS. Commit `attention: an open kit gate is at gate, not idle`.

### Task 8: Answered views name run controls

**Files:**
- Modify: `packages/gate-kit/src/summary.ts:221-300`
- Test: `packages/gate-kit` tests next to `summary.ts`

- [ ] **Step 1: Write the failing tests:** a summary of an answer `{next: "hold"}` shows `Paused the run`, and `{next: "go-back", to: "plan"}` shows `Went back to plan`. Neither shows `(none)`.
- [ ] **Step 2:** Run with the package's own runner (`bun run check` names it). Expected: FAIL.
- [ ] **Step 3:** Implement. Run. Expected: PASS. Commit `gate-kit: answered views name run controls`.

### Task 9: Kit menu widget, and gate-form's gate mode

**Files:**
- Create: `packages/mod-kit/src/widgets/menu.ts`, `packages/mod-kit/src/components/menu.tsx`, and tests next to them
- Modify: `packages/mod-kit/src/index.ts` (exports)
- Modify: `mods/gate-form/src/register.tsx`
- Modify: `mods/gate-form/src/form/state.ts`, `form/view.ts`, `form/input.ts`
- Modify: `mods/gate-form/src/gate/reply.ts`, `gate/parse.ts`
- Modify: `mods/gate-form/types/index.d.ts`
- Create: `mods/gate-form/src/gate/rt.ts` (finding and running `rt`)
- Test: `mods/gate-form/src/**/*.test.ts`, `mods/gate-form/harness/*.test.ts`

**Interfaces:**
- Consumes: the Task 5 result shape.
- Produces:
  - `menu(spec: {label: string; rows: MenuRow[]; open: boolean; selected: number}): Line[]`, where `MenuRow = {id: string; label: string; rows?: MenuRow[]}`
  - in gate-form: `Form` gains `gateId?: string`, `controls?: {pause: boolean; goBack: string[]}`, `source: "gate" | "ask" | "demo"`
  - `formsAtom` replaces `formAtom`: an ordered list, one entry per gate id. Bump `shape` to `forms-1`, and a stored `form-3` value loads as a one-entry list.

- [ ] **Step 1: Write the failing tests for the menu widget:**
  - It draws as one quiet button labelled `More actions ▾`.
  - When open, it lists rows under it with `├`/`└`. A row with `rows` shows `▸`, and its sub-list opens to the right.
  - Keyboard: Enter opens, arrows move, Enter picks, and Escape closes.
- [ ] **Step 2: Write the failing gate-form tests:**
  - **The hook takes over.** On `mcp__plugin_mattstack_mattstack__gate_ask`, the hook adds `kitForm: true` when the last recorded surface is terminal or desktop and `e.agentId` is unset. `tool.call` carries no surface, so the mod records `e.surface` into `surfaceAtom` on every `AbovePrompt` `ui.render` (that band renders every frame); no recorded surface counts as cannot draw. It adds nothing in VS Code, on mobile, or for a subagent.
  - **The result is rewritten.** A result with `paneAction: "kit"` opens a form with `source: "gate"`. The agent's result keeps every original field except `kitForm`, and adds the instruction text from the spec ("The gate is open in the kit form…").
  - **Other results pass through unchanged.**
  - **Large results.** A non-JSON result (spilled) falls back to reading the gate with `rt gate list --json`.
  - **The form follows the daemon's rules.**
    - Submit is disabled until every question is answered.
    - "Something else" shows only on `writeIn: true` questions.
    - More actions shows Pause run when `controls.pause`, and Go back to stage ▸ with one row per `controls.goBack` stage. It's absent when both are empty.
  - **Recording an answer.** Submit runs `rt gate answer <id> --answers <json> --by pane --session <$.session.id()>`. On success the form is marked answered and `$.prompt.submit` sends `Gate <id> was answered in the kit form. Call gate_reconcile for it.`. On failure the form stays open with the error, and the picks are kept.
  - **Run controls.** Pause run sends `{next: "hold"}`; Go back to stage ▸ plan sends `{next: "go-back", to: "plan"}`.
  - **Ctrl-X** leaves the gate open and submits `The user set gate <id> aside to talk about it first. Don't present it again; it stays open in the kit form.`
  - **Queueing.** Two gates in a row give two forms in open order. A result with `supersededId` replaces that gate's form.
- [ ] **Step 3:** Run `bun run mods:test`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Find `rt` the way `plugins/mattstack/hooks/enter-worktree-check.ts:37-48` does.
  - Run it through `$.process.run`.
  - `/gate-form-demo` and the `ask` tool keep working with `source: "demo"` and `"ask"`. Drop the demo's own `next` question, since #1138 removed it from real gates.
- [ ] **Step 5:** Run `bun run mods:test`, `bun run mods:build`, `claude plugin validate plugins/gate-form` and `claude plugin test plugins/gate-form`. Expected: PASS, and the build freshness check is empty. Commit per sub-step: `mod-kit: menu widget`, then `gate-form: take over kit gates from gate_ask and gate_open`.

### Task 10: Watchers, restore on start, and the Open on board band

**Files:**
- Modify: `mods/gate-form/src/register.tsx`
- Create: `mods/gate-form/src/gate/watch.ts`, `mods/gate-form/src/board-band.tsx`
- Test: `mods/gate-form/src/gate/watch.test.ts`, `mods/gate-form/harness/*.test.ts`

**Interfaces:**
- Consumes: `formsAtom` (Task 9), `bandAbovePrompt` from `@mattstack/mod-kit`, and the deck board address.
- Produces: `boardAtom`, the list of `{gateId, kind}` for open board-only gates.

- [ ] **Step 1: Write the failing tests:**
  - **The watcher.** Opening a kit form starts `$.process.spawn({argv: [rt, "gate", "wait", id], env: {CLAUDE_CODE_SESSION_ID: ""}})`. When it returns answered by `board`, that gate's form only is marked answered elsewhere and closed with `Answered on the board`. Other forms stay.
  - **Restore on start.** `session.start` lists this session's open gates (`rt gate list --json`, filtered to `nudge.session === $.session.id()`). It restores a form and a watcher for each `kit` gate, and a band entry for each board-only gate. Nothing is restored for gates that are closed.
  - **A stale submit.** Submitting a form whose gate was answered elsewhere while no watcher ran shows the CAS refusal as the form error, and the form then closes.
  - **The board band.**
    - A `gate_ask` result with `boardOnly: true` and `presentation: "wait"` adds a band above the prompt: `<kind title> is waiting on the board` plus `[ Open on board ]`.
    - The button runs `open <board>/?gate=<id>`, where `<board>` comes from `deck list --json` (the `board` row's port on `http://localhost`).
    - With no board address, the band says `Board address not found` and has no button.
    - The watcher clears the band.
    - With several entries, the band names the newest plus `N more`.
  - **The herdr bell.** Opening a kit form rings it the way `plugins/mattstack/hooks/herdr-doorbell.sh` does.
- [ ] **Step 2:** Run `bun run mods:test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run mods:test`, `bun run mods:build` and `claude plugin test plugins/gate-form`. Expected: PASS. Commit `gate-form: watch gates, restore on start, Open on board band`.

### Task 11: Install gate-form with mattstack

**Files:**
- Modify: `marketplace/marketplace.json` (a gate-form entry shaped like human-todos')
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`dependencies: ["human-todos", "gate-form"]` and a version bump)
- Modify: `mods/gate-form/mod.json` / `plugins/gate-form/.claude-plugin/plugin.json` (version bump), `mods/gate-form/README.md`
- Test: `scripts/__tests__/no-plugin-ci-jobs.test.ts` (existing), the marketplace checks in `bun run check`

- [ ] **Step 1:** Add the entries. In the README, say that the kit form only takes over gates once `rt settings set rt.gates.kitForm true --scope machine` is run, and that the setting is off by default.
- [ ] **Step 2:** Run the targeted marketplace and plugin checks (`bun test scripts/__tests__/no-plugin-ci-jobs.test.ts`, `rt skills check --strict`). Make sure gate-form has its plugin CI job, as human-todos does. Expected: PASS.
- [ ] **Step 3:** Commit `marketplace: gate-form installs with mattstack`.

### Task 12: Live check with Matt

- [ ] **Step 1:** Build gate-form into this session's dev-mods folder (`bun run mods:watch --into <dev-mods root>`), set `rt.gates.kitForm` to true in an isolated way Matt approves, and run `/reload-plugins`.
- [ ] **Step 2:** Open sample gates in this pane through `gate_ask` with:
  - 6 options on one question
  - a write-in question
  - a run gate with earlier stages
  - a board-only kind
  Answer one on the board while its form is open.
- [ ] **Step 3:** Let Matt look and tweak live, per the live UI polish rules. Batch tests and the spec updates at the pause. Then hand back to the SDD final review.

## Self-review notes

- **Spec coverage:**
  - setting: Task 1
  - switch and flag: Tasks 5 and 9
  - daemon kit, no cap and nudge: Task 3
  - result fields kept: Task 5
  - mod takeover, answer and wake: Task 9
  - form rules and More actions: Task 9
  - run-control check: Task 2
  - recording and routing: Tasks 5 and 6
  - answered views: Task 8
  - no Escape: Task 4
  - watchers and restore: Task 10
  - attention: Task 7
  - herdr bell: Task 10
  - board-only band: Tasks 3 and 10
  - install: Task 11
- **Consistency:** `kitForm` is the input flag, the payload flag and the result block's name on purpose: one concept, from the mod to the daemon.
