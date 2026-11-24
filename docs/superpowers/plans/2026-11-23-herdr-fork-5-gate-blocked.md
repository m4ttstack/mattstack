# herdr fork plan 5: gate panes shown as blocked

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pane whose Claude is waiting on a mattstack gate form shows as blocked in herdr, through a new herdr blocker verb (fork commit 5) that the gate-form mod raises while any form is open.

**Architecture:** herdr gets a per-source store of outside blockers on `TerminalState`; the effective-state merge turns an idle pane blocked while any blocker is raised, and the message rides the pane's `blocked` state label. Two socket methods and two `herdr pane` verbs set and clear a source's blocker. The gate-form mod computes "a form is open" after every write of its forms list and calls the verbs, quietly ignoring a herdr that lacks them.

**Tech Stack:** Rust (herdr fork, cargo nextest, `just`), TypeScript mod on the Claude Code mods engine (`claude-code/testing` harness, bun test).

**Spec:** `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/happy-oyster/docs/superpowers/specs/2026-11-23-herdr-fork-design.md`, section 6 and Order item 5. Plan 1 (release pipeline, version scheme): same folder, `plans/2026-11-23-herdr-fork-1-fork.md`.

## Global Constraints

- Two repos. herdr side: worktree `/Users/matt/Documents/GitHub/herdr-ms/.worktrees/gate-blocked`, branch `ms/gate-blocked` from `origin/mattstack/0.9.5`. Never touch `/Users/matt/Documents/GitHub/herdr-ms`'s main checkout files. mattstack side: this worktree, branch `gate-blocked`, writes only under `mods/gate-form/**`, its generated `plugins/gate-form/**` (CI fails a PR whose `plugins/` differs from a fresh `bun run mods:build`), and this plan.
- herdr commits: lowercase, no emojis, **no AI co-author lines** (herdr-ms `CLAUDE.md`). The herdr side lands on `mattstack/0.9.5` as **one feature commit** (spec: one commit per feature), README bullet in the same commit.
- mattstack commits end with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line.
- herdr tests: `cargo nextest` (or `just test-one <filter>`) under an isolated HOME: `env -i HOME=$(mktemp -d) PATH="$PATH" ...`. Plain `cargo test` fails from cross-test interference. zig 0.16.0 must be on PATH. A built herdr runs only under `env -i HOME=<temp dir>`.
- Names: socket methods `pane.report_blocker` and `pane.clear_blocker`; CLI `herdr pane report-blocker <pane_id> --source <ID> [--message <TEXT>]` and `herdr pane clear-blocker <pane_id> --source <ID>`. The mod's source is `mattstack:gate`.
- herdr's "Stable client endpoint contract": add new methods, never change an advertised method's params. Never edit generation-1 fixtures (`tests/fixtures/endpoint-method-shapes-v1.json`). Do not edit `skills/herdr/SKILL.md`, `docs/next/CHANGELOG.md`, `docs/versions/*`, `docs/preview/*`.
- Mod: on a herdr without the verb (non-zero exit, a refused or failed run), the gate works exactly as before, with no toast and no error.
- Publishes ask first through `herd_ask`: the push to the fork's `mattstack/0.9.5`, and dispatching `ms-release.yml` for `0.9.5-ms.2`, which waits until `0.9.5-ms.1` is published.

## Review Focus

1. **A crash or reload with a form open.** A module reload forgets in-memory state; the session start must re-sync from the stored forms list, clearing a blocker no open form backs. Test: `a session start with no open form clears a blocker left by an earlier load` (Task 5).
2. **Out-of-order herdr calls.** Two writes close together (an answer, then the next queued plugin ask) must reach herdr in write order, or a late clear can land after a raise. Test: `answering one plugin ask while the next one opens leaves the blocker raised` (Task 5).
3. **Working then idle again.** The agent resumes work while a form is set aside, then idles: blocked must come back without a new report. Test: `working_wins_over_external_blocker_and_blocked_returns_on_idle` (Task 1).
4. **A Claude pane, whose own state reports herdr drops.** The blocker must apply to a pane whose state comes only from screen detection. Test: `external_blocker_blocks_screen_detected_claude_pane_and_emits_status_change` (Task 2).
5. **The agent exits with the blocker still raised.** No stale blocked state on the shell, or on the next agent started in that pane. Test: `process_exit_clears_external_blockers` (Task 1).

---

## herdr side (fork commit 5)

### Task 1: Outside blockers in terminal state

**Files:**
- Modify: `src/terminal/state.rs` (field on `TerminalState` ~line 136, `new`, `recompute_effective_state` ~2404, release `release_agent_with_mutation` ~1811, process exit in `set_detected_state_with_screen_signals_at` ~359, respawn reset `clear_agent_runtime_identity_after_respawn` ~2325; tests in `mod tests`)
- Modify: `src/terminal/metadata.rs` (`effective_presentation_for_state_at_with_ttl` ~395)

**Interfaces:**
- Produces:
  - field `external_blockers: BTreeMap<String, Option<String>>` (source → message; `BTreeMap` so the message picked is stable)
  - `pub fn set_external_blocker(&mut self, source: &str, message: Option<String>) -> Option<TerminalStateMutation>`: inserts or replaces the source's entry
  - `pub fn clear_external_blocker(&mut self, source: &str) -> Option<TerminalStateMutation>`: removes it; absent source is a no-op returning `None`
  - both follow the existing setter shape: snapshot previous label, known agent, state and presentation, mutate, return `recompute_effective_state(...)` wrapped in a `TerminalStateMutation`

- [ ] **Step 1: Write failing tests in `state.rs` `mod tests`** (use `test_terminal()` and the existing detected-state helpers to put an agent on screen as idle or working):
  - `external_blocker_turns_idle_into_blocked`: screen idle → `set_external_blocker("mattstack:gate", Some("Plan review"))` → `terminal.state == AgentState::Blocked`, and the effective presentation's `state_labels["blocked"] == "Plan review"`
  - `working_wins_over_external_blocker_and_blocked_returns_on_idle`: blocker raised, screen working → `Working`; screen idle again (no new report) → `Blocked`
  - `clearing_last_external_blocker_restores_idle`: raise from `a` and `b`, clear `a` → still `Blocked`; clear `b` → `Idle`
  - `clearing_an_unknown_blocker_source_changes_nothing`: returns `None`, state unchanged
  - `external_blocker_leaves_unknown_pane_unknown`: no agent detected (`Unknown`) → stays `Unknown`
  - `metadata_blocked_label_wins_over_external_blocker_message`: a `report-metadata` `blocked` state label is kept over the blocker's message
  - `release_agent_clears_external_blockers` and `process_exit_clears_external_blockers`: after either, `external_blockers` is empty and the state is not `Blocked`

- [ ] **Step 2: Run, expect compile failure** — `env -i HOME=$(mktemp -d) PATH="$PATH" just test-one external_blocker` (and the two `_clears_` names). Expected: FAIL, `set_external_blocker` not found.

- [ ] **Step 3: Implement.** In `recompute_effective_state`, after the existing state is computed: `if state == AgentState::Idle && !self.external_blockers.is_empty() { state = AgentState::Blocked }`. Working, Blocked and Unknown pass through. In the presentation builder, when the state is Blocked and a blocker has a message, add `"blocked" → message` to `state_labels` only if no metadata label for `blocked` exists (check the exact key spelling `report-metadata --state-label` stores and use that). Clear `external_blockers` in the release path, in the process-exit branch (wherever `hook_authority` is cleared for the exiting agent), and in the respawn reset. Carry `external_blockers` across a live handoff only if `agent_metadata` is carried there; otherwise leave it out of persistence.

- [ ] **Step 4: Run the Step 2 filters.** Expected: PASS. Then `just test-one terminal::` to confirm no neighbor broke.

- [ ] **Step 5: Commit** — `git commit -m "terminal: per-source outside blockers turn an idle pane blocked"`

### Task 2: Socket methods, app events, CLI verbs, docs

**Files:**
- Modify: `src/api/schema.rs` (~204, enum `Method`), `src/api/schema/panes.rs` (params next to `PaneReportAgentParams` ~362), `src/api/server.rs` (~684 method names), `src/api/mod.rs` (~67 mutating list), `src/logging.rs` (~113), `src/app/api.rs` (~1189 dispatch), `src/app/api/panes.rs` (handlers next to `handle_pane_report_metadata` ~1700), `src/app/actions.rs` (new `AppEvent` arms next to `HookStateReported` ~1491, through `update_terminal_state_with_completion_policy`), `src/cli/spec.rs` (subcommands ~638, spec test ~1180), `src/cli/pane.rs` (dispatch ~39, parsers, help ~1701), `src/cli/completion.rs` if it lists verbs
- Modify: `docs/next/api/herdr-api.schema.json` (regenerate with the repo's `just` recipe, never by hand), `docs/next/website/src/content/docs/cli-reference.mdx` (~274), `docs/next/website/src/content/docs/socket-api.mdx`, plus the `ja/` and `zh-cn/` copies if `scripts.test_docs_translation_parity` requires them
- Modify: `README.md` ("What's different": one bullet)
- Test: `src/app/actions.rs` tests, `tests/cli/panes.rs`, `src/cli/spec.rs` tests

**Interfaces:**
- Consumes: Task 1's `set_external_blocker` / `clear_external_blocker`.
- Produces (the mod relies on exactly this):
  - `Method::PaneReportBlocker(PaneReportBlockerParams { pane_id: String, source: String, message: Option<String> })`, serde name `pane.report_blocker`
  - `Method::PaneClearBlocker(PaneClearBlockerParams { pane_id: String, source: String })`, serde name `pane.clear_blocker`
  - `AppEvent::ExternalBlockerReported { pane_id, source, message }`, `AppEvent::ExternalBlockerCleared { pane_id, source }`
  - CLI `herdr pane report-blocker <pane_id> --source <ID> [--message <TEXT>]`, `herdr pane clear-blocker <pane_id> --source <ID>`; exit 0 on success, non-zero on an unknown pane or an empty source. Clearing a source with no blocker exits 0.

- [ ] **Step 1: Write failing tests.**
  - `src/app/actions.rs`: `external_blocker_blocks_screen_detected_claude_pane_and_emits_status_change`: a Claude pane whose state comes from screen detection reads idle; `ExternalBlockerReported{source: "mattstack:gate", message: Some("Plan review")}` → pane state `Blocked` and one `pane.agent_status_changed` event with `agent_status: blocked` and `state_labels.blocked == "Plan review"`; `ExternalBlockerCleared` → event back to idle or done.
  - `src/app/actions.rs`: `external_blocker_report_for_unknown_pane_is_ignored` (no panic, no event).
  - `src/cli/spec.rs`: extend `spec_marks_runtime_required_options_as_required` with `["pane","report-blocker"]` and `["pane","clear-blocker"]`, `source` required.
  - `tests/cli/panes.rs`, next to the report-agent test (~596): `pane_report_blocker_and_clear_blocker_round_trip`: report a custom agent idle, `herdr pane report-blocker <pane> --source mattstack:gate --message "Plan review"` → `agent get` shows `agent_status == "blocked"`; `herdr pane clear-blocker <pane> --source mattstack:gate` → not blocked; a second `clear-blocker` exits 0. While raised, `herdr agent wait <pane> --until blocked` returns at once.

- [ ] **Step 2: Run, expect failure** — `env -i HOME=$(mktemp -d) PATH="$PATH" just test-one external_blocker` and `just test-one report_blocker`. Expected: FAIL to compile.

- [ ] **Step 3: Implement** the schema, handlers (trim `source`, refuse empty; trim `message`, empty → `None`; unknown pane answers the same error the other pane handlers do), the two `AppEvent` arms, every method list, and both CLI layers (clap spec and the hand parser with a USAGE string in `report_agent`'s style). Regenerate the schema JSON; add the docs entries and the README bullet: `- **Gate blocked state.** \`herdr pane report-blocker\` and \`clear-blocker\` let a tool other than the agent's integration show a pane as blocked while it waits on a person, such as a mattstack gate form.`

- [ ] **Step 4: Run** the Step 2 filters, then the docs contract recipe from the justfile. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "pane: report-blocker and clear-blocker verbs on pane.report_blocker and pane.clear_blocker"`

### Task 3: Whole-suite verification and the one feature commit

- [ ] **Step 1:** `env -i HOME=$(mktemp -d) PATH="$PATH" just check` (formatting, nextest, maintenance scripts). Expected: green. Then `for t in ms/tests/*.sh; do env -i HOME=$(mktemp -d) PATH="$PATH" bash "$t" || echo "FAIL $t"; done`. Expected: no `FAIL`.
- [ ] **Step 2:** Squash the branch's commits since `origin/mattstack/0.9.5` into one: `git reset --soft origin/mattstack/0.9.5 && git commit -m "gate blocked state: pane blockers raised by outside sources"` (body: one line on what it does; no AI co-author line).
- [ ] **Step 3:** Smoke test the built binary under an isolated HOME: start a server in `env -i HOME=<temp>`, run `herdr pane report-blocker` against a pane, read `herdr agent get`, stop that server by its PID.

Push and release happen in **Ship**, after both sides are done.

---

## mattstack side (gate-form mod)

### Task 4: Blocker arguments and the waiting title

**Files:**
- Create: `mods/gate-form/src/gate/blocker.ts`, `mods/gate-form/src/gate/blocker.test.ts`
- Modify: `mods/gate-form/src/gate/forms.ts`, `mods/gate-form/src/gate/forms.test.ts`

**Interfaces:**
- Produces:
  - `export const BLOCKER_SOURCE = 'mattstack:gate'`
  - `export function raiseArgs(paneId: string, message: string): string[]` → `['herdr', 'pane', 'report-blocker', paneId, '--source', 'mattstack:gate', '--message', message]`
  - `export function clearArgs(paneId: string): string[]` → `['herdr', 'pane', 'clear-blocker', paneId, '--source', 'mattstack:gate']`
  - `export function waitingTitle(list: Form[]): string | null` in `forms.ts`: `null` with no open form; else the current form's title, with `, N more waiting` when `openCount > 1` (the text `waitingForm` in `register.tsx` builds today, which then uses this)

- [ ] **Step 1: Write failing tests**: `blocker.test.ts` asserts both argv arrays exactly; `forms.test.ts` adds `waitingTitle is null with no open form, the current title alone, and counts the rest` (`[]` → `null`; one open `a` → `'a'`; `a`, `b` open → `'a, 1 more waiting'`; all answered → `null`).
- [ ] **Step 2: Run** `bun test --tsconfig-override=./packages/mod-kit/tsconfig.json --preload ./packages/mod-kit/test/jsx-preload.ts mods/gate-form/src/gate` from the repo root. Expected: FAIL, missing exports.
- [ ] **Step 3: Implement** the three functions; switch `waitingForm` to `waitingTitle`.
- [ ] **Step 4: Run** Step 2's command. Expected: PASS.
- [ ] **Step 5: Commit** — `gate-form: blocker argv and the waiting title`

### Task 5: Raise and clear the blocker from the mod

Load the `plugin-authoring` skill before editing hooks.

**Files:**
- Modify: `mods/gate-form/src/register.tsx`, `mods/gate-form/harness/world.ts`, `mods/gate-form/mod.json` (version `0.7.5` → `0.7.6`), `mods/gate-form/README.md` (one short paragraph: in herdr, a pane with an open form shows as blocked)
- Create: `mods/gate-form/harness/blocker.test.tsx`
- Regenerate: `plugins/gate-form/**` with `bun run mods:build`

**Interfaces:**
- Consumes: Task 4's `raiseArgs`, `clearArgs`, `waitingTitle`; `openCount`, `QUICK_TIMEOUT_MS`.
- Produces: `syncBlocker($: EngineInterface, forms: Form[]): Promise<void>` in `register.tsx`, and in `world.ts` a `blockers: string[][]` list of `herdr pane ...` runs (kept out of `bells`, so the existing bell assertion in `watch.test.tsx` holds) plus an option `herdr?: Answer` a test uses to make those runs fail.

Behavior to build:
- Module state `blocker: { shown?: string | null; chain: Promise<void> }`: `shown` is the message last sent (`null` = cleared, `undefined` = unknown after a load).
- `syncBlocker` does nothing outside herdr (`HERDR_ENV !== '1'` or no `HERDR_PANE_ID`, read the way `ringBell` reads them). Otherwise target = `waitingTitle(forms)`; when it differs from `shown`, run `raiseArgs` (target a string) or `clearArgs` (target `null`) with `timeoutMs: QUICK_TIMEOUT_MS`, then set `shown = target` whatever the outcome, catching every failure. Runs are chained on `blocker.chain` so they reach herdr in write order.
- Call it, not awaited, at the end of `writeForms` with the written list, so every source (rt gates, `$.gateForm.ask`, the `ask` tool) and every ending (answer, cancel, set aside keeps it open, orphan close) goes through one place. Board-only gates live in `boardAtom`, never in the forms list, so they raise nothing.
- `session.start`: sync once from `readForms` after `closeOrphans`, so a load with `shown` unknown and nothing open clears a stale blocker.
- `session.end`: if `shown !== null`, run `clearArgs` with a timeout no longer than `next.budget` allows, then `next(e)`.

- [ ] **Step 1: Write failing harness tests** in `blocker.test.tsx` (world with `env: { HERDR_ENV: '1', HERDR_PANE_ID: 'p-1' }` unless the test says otherwise; use `eventually` for detached work):
  - `a gate form raises the blocker with its title, and its answer clears it`: `w.blockers` gets `raiseArgs('p-1', 'plan-review')`, then after the pane's answer `clearArgs('p-1')`
  - `a second gate keeps the blocker raised and updates its message until the last form ends`: raise `plan-review`, then raise `plan-review, 1 more waiting`; first answered → raise of the second's title; last answered → clear
  - `a gate set aside keeps the blocker raised`: a `chat` message on the form → no clear
  - `a board-only gate raises nothing`: `boardResult` → `w.blockers` empty
  - `an ask-tool form and a plugin ask raise and clear the blocker` (the plugin ask through the `CONSUMER` pattern in `plugin-ask.test.tsx`; its timeout also clears)
  - `answering one plugin ask while the next one opens leaves the blocker raised`
  - `outside herdr nothing is sent to herdr`: no env → `w.blockers` empty
  - `a herdr without the verb leaves the gate working`: `herdr` option answers `failed('unknown command')`; the form opens, the answer records (`w.ran` has `gate answer`), no toast mentions herdr
  - `a session start with no open form clears a blocker left by an earlier load`
  - `session end clears a raised blocker`
- [ ] **Step 2: Run** `bun run mods:build && claude plugin test plugins/gate-form`. Expected: the new tests FAIL, every existing test passes.
- [ ] **Step 3: Implement** as described above; bump `mod.json`; add the README paragraph.
- [ ] **Step 4: Run** `bun run mods:build && claude plugin test plugins/gate-form && claude plugin validate plugins/gate-form && bun run mods:typecheck && bun run mods:test`. Expected: all PASS, and `git status --porcelain plugins/` shows only gate-form's rebuilt files.
- [ ] **Step 5: Commit** — `gate-form: show the pane as blocked in herdr while a form is open` (include `plugins/gate-form`)

---

## Ship

1. **herdr push.** `herd_ask` to push `ms/gate-blocked`'s one feature commit to `origin/mattstack/0.9.5` (a publish to the fork's shared branch). On yes: `git push origin ms/gate-blocked:mattstack/0.9.5` from the herdr worktree (fast-forward only; refetch and rebase if it moved).
2. **herdr release.** Confirm `v0.9.5-ms.1` is published (`gh release view v0.9.5-ms.1 -R m4ttstack/herdr`). `herd_ask` to dispatch `gh workflow run ms-release.yml -R m4ttstack/herdr -f branch=mattstack/0.9.5` for `0.9.5-ms.2`; on yes, run it and `gh run watch`.
3. **mattstack PR.** `git_push {tree, setUpstream: true}` (pre-push check must pass), then `mr_create` with `draft: false` on `m4ttstack/mattstack`, then hand it to a live pr-usher (`chat_buddies` → `rt chat dm <usher> "pr-usher handoff: <url> author=<me>"`), and babysit it if none acks in 10 minutes.

Out of scope, named for the next plan: rt's minimum fork build (spec section 3, replacing `HERDR_FLOOR`) rising to `0.9.5-ms.2`. The mod needs no floor, since it degrades quietly.
