# Work Gate Modes, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work-run gates whose every question has a forward recommendation, and whose declared reach the run's mode allows, answer themselves at open, recorded as decided by the mode; every gate that still asks shows what the mode decided since the operator last answered.

**Architecture:** A pure module (`lib/gates/mode.ts`) decides eligibility, the effective mode and the digest. `askGate` in `lib/mcp/gate-tools.ts` calls it after the run resolves; an eligible gate is opened pre-answered through a new `preAnswer` field on the daemon's `gate:ask`, so it is never delivered to a pane or a shepherd. The gate protocol gains one branch for a gate that comes back answered. Pipelines opt in per open by declaring `reach`.

**Tech Stack:** Bun, TypeScript, `bun test`, the rt daemon, the mattstack plugin's block Markdown.

**Spec:** `docs/superpowers/specs/2026-11-15-work-gate-modes-design.md` (phase 1 sections: Modes, When a gate answers itself, Recording, Declaring reach, The digest).

## Global Constraints

- Mode values, exactly: `every-gate`, `worktree`, `draft-mr`, `checkpoint-free`. Default `every-gate`.
- Reach values, exactly: `worktree`, `draft`, `teammates`, `public`. `public` never answers itself in any mode.
- Mode allows: `worktree` -> {worktree}; `draft-mr` -> {worktree, draft}; `checkpoint-free` -> {worktree, draft, teammates}; `every-gate` -> {}.
- A mode's decider string is `mode:<mode>` (e.g. `mode:draft-mr`), on both the gate answer's `by` and the run's gate@1 decision.
- Run field for the per-run override: `gate-mode`. It wins over the setting. An unknown value reads as `every-gate`.
- The repo is public: no team, pack, ticket or employer names in code, tests, fixtures, commits or PR text.
- Run `bun test` from the repo root only (AGENTS.md); run only the targeted test files you touch.
- Any edit under `plugins/mattstack` loads superpowers:writing-skills and mattstack:editing-skills first, bumps `plugins/mattstack/.claude-plugin/plugin.json`'s version, and an edit under `attachments/gate-protocol` also runs `bun run skills:expand:board` and commits `apps/board/skills`.
- After the MCP tool schema change, regenerate `plugins/mattstack/attachments/mcp-tools/reference.md` with `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`.
- Settings are registered through the rt:settings skill's procedure (registry def, zod schema, schema lock); never read them outside the resolver.

## Review Focus

- A real work gate has no `next` question (the protocol reads a missing `next` as proceed, and the daemon refuses an answer key the gate did not ask): it must answer itself, and the answers must carry no `next` key.
- A later non-gate decision (stage-plan's `execution-strategy@1`, decided by `stage-plan`) must not hide earlier mode decisions from the digest.
- A question whose recommended option is a hand-back or abandon verb (`handback`, `abandon`, `iterate`, `go-back`, `hold`): must ask.
- A herd worker's gate (owner `herd:<id>`) in a mode that allows it: the pre-answered open must succeed and must not push to the shepherd.
- The daemon receiving `preAnswer` with a `by` that is not `mode:*`, or answers that fail validation: must refuse the open, never open an unanswered gate silently.

Also tested in their tasks: a gate with one unrecommended question asks; a `gate-mode` typo reads as `every-gate`.

---

## File Structure

- Create `lib/gates/mode.ts`: types `GateMode`, `Reach`; `parseMode`, `modeAllows`, `effectiveMode`, `isWorkPipeline`, `recommendedValues`, `autoAnswerDecision`, `modeDigest`. Pure; no I/O.
- Create `lib/gates/__tests__/mode.test.ts`.
- Modify `packages/rt-client/src/settings/registry-defs.ts`, `registry-schemas.ts`, `schema.lock.json`: two settings.
- Modify `packages/rt-client/src/commands.ts` (`gate:ask` payload), `packages/rt-client/src/client.ts:671` (passthrough list).
- Modify `lib/daemon/handlers/gate.ts` (`gateAsk`, ~line 788): pre-answered open.
- Modify `lib/daemon/__tests__/gate-ask-handler.test.ts`.
- Modify `lib/mcp/gate-tools.ts`: `RunSnapshot.pipeline`, `GateToolDeps.gateMode`/`headCommit`, `askGate` auto path, digest, `reach`/`needsOperator` inputs; `lib/mcp/tools.ts` (`gate_ask` schema).
- Modify `lib/mcp/__tests__/gate-tools.test.ts`.
- Modify `lib/mcp/run-tools.ts` (`run_start` optional `gateMode`).
- Modify `plugins/mattstack/attachments/gate-protocol/index.block.md` and add `answered-by-mode.block.md`; modify the generic work pipeline's gate blocks to declare `reach`.
- Team pack (separate org repo): its work pipeline's gate blocks declare `reach` (Task 8).

---

### Task 1: Mode settings

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (beside `rt.gates.kitForm`, ~line 310)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts` (~line 377)
- Modify: `packages/rt-client/src/settings/schema.lock.json`
- Test: the settings registry tests the rt:settings skill names

**Interfaces:**
- Produces: setting `rt.work.gateMode` (string enum of the four modes, scopes `["user", "machine"]`, default `"every-gate"`, merge `replace`); setting `rt.work.gateModeShadow` (boolean, scopes `["user", "machine"]`, default `false`, merge `replace`).

- [ ] **Step 1:** Load the rt:settings skill and follow its procedure for adding a key.
- [ ] **Step 2: Write the failing test** asserting `getSetting("rt.work.gateMode").value === "every-gate"` and `getSetting("rt.work.gateModeShadow").value === false` with no stores set, and that writing `"draft_mr"` is refused by the schema.
- [ ] **Step 3:** Run it; expect FAIL (unknown key).
- [ ] **Step 4:** Add both defs. Descriptions (plain copy, rt:ui-copy):
  - `rt.work.gateMode`: "How much a work run stops to ask you. every-gate asks at every gate; worktree, draft-mr and checkpoint-free let more gates go ahead on the agent's recommendation. A run can set its own mode."
  - `rt.work.gateModeShadow`: "Record what your gate mode would have picked while every gate still asks you. For trying a mode before trusting it."
- [ ] **Step 5:** Update the schema lock as the skill directs; run the test and the registry lock test; expect PASS.
- [ ] **Step 6: Commit** `settings: add rt.work.gateMode and rt.work.gateModeShadow`.

### Task 2: Pure eligibility, effective mode and digest

**Files:**
- Create: `lib/gates/mode.ts`
- Test: `lib/gates/__tests__/mode.test.ts`

**Interfaces:**
- Consumes: `GateQuestion` from `packages/rt-client/src/index.ts`; `DecisionRow` from `lib/gates/record.ts`.
- Produces:
  - `type GateMode = "every-gate" | "worktree" | "draft-mr" | "checkpoint-free"`
  - `type Reach = "worktree" | "draft" | "teammates" | "public"`
  - `parseMode(v: unknown): GateMode` (unknown -> `"every-gate"`)
  - `parseReach(v: unknown): Reach | null`
  - `modeAllows(mode: GateMode, reach: Reach): boolean`
  - `effectiveMode(runFieldValue: string | undefined, settingValue: unknown): GateMode`
  - `isWorkPipeline(pipeline: string | null): boolean` (false for `review` and `receive-review`, true otherwise, including null)
  - `recommendedValues(q: GateQuestion): string[]` (options with `recommended: true` or a label matching `/\(\s*recommended\s*\)\s*$/i`)
  - `autoAnswerDecision(i: { mode: GateMode; pipeline: string | null; reach: Reach | null; needsOperator?: string; context?: string; questions: GateQuestion[] }): { kind: "answer"; answers: Record<string, string | string[]> } | { kind: "ask"; reason: string }`
  - `modeDigest(decisions: DecisionRow[], sinceAt: number): string | null` (gate@1 decisions decided by `mode:*` after `sinceAt` only)
  - `digestSince(decisions: DecisionRow[]): number` (newest `decided_at` among gate@1 decisions whose `decided_by` does not start with `mode:`, else 0)

- [ ] **Step 1: Write the failing tests** (one `test` each; build questions with a small `q(id, options, multi?)` helper):
  - `every-gate never answers`: mode every-gate, reach worktree, all recommended -> `kind: "ask"`.
  - `draft-mr answers a worktree gate`: options `[{value:"direct-tdd",label:"direct-tdd (Recommended)"},{value:"superpowers",label:"Superpowers"}]` plus `next` with `proceed` recommended -> `{kind:"answer", answers:{tier:"direct-tdd", next:"proceed"}}`.
  - `lowercase suffix counts`: label `"Post reply (recommended)"` is recommended.
  - `recommended flag counts`: `{value:"x",label:"x",recommended:true}`.
  - `draft-mr asks on teammates reach`, `public never answers in checkpoint-free`, `undeclared reach asks` (reach null).
  - `one question without a recommendation asks` (Review Focus 1).
  - `hand-back recommendation asks`: a question whose recommended value is `handback` (also `abandon`, `iterate`, `go-back`, `hold`) -> ask (Review Focus 2).
  - `a gate with no next question answers`: one recommended question, no `next` -> `kind: "answer"`, and `"next" in answers === false` (Review Focus 1).
  - `a next question, when present, must recommend proceed or done`: `next` recommending `iterate` -> ask.
  - `string options are read`: options `["proceed", "hold"]` with no recommendation -> ask; `recommendedValues` returns `[]` for string options with no suffix and the value for `"proceed (Recommended)"`.
  - `multi-select answers the recommended set`: two recommended of three -> answer is the two-value array.
  - `write-in-only question asks`: question with `writeIn: true` and no options.
  - `needsOperator asks` with reason containing the given text.
  - `boards context asks`: context containing `boards@1`.
  - `review pipeline asks`: pipeline `review`.
  - `effectiveMode`: run field `worktree` beats setting `draft-mr`; run field `draft_mr` -> `every-gate` (Review Focus 3); no run field -> setting; bad setting -> `every-gate`.
  - `modeDigest`: two `mode:draft-mr` gate@1 decisions after `sinceAt` and one `pane` gate@1 decision -> string listing exactly the two scopes with their selections, one line each; none after `sinceAt` -> `null`; a non-gate@1 decision (`execution-strategy@1`) is never listed.
  - `digestSince`: newest `decided_at` among gate@1 decisions not decided by `mode:*`; an `execution-strategy@1` decision by `stage-plan` after a mode decision does not move it (Review Focus 2).
- [ ] **Step 2:** `bun test lib/gates/__tests__/mode.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Implement `lib/gates/mode.ts`. Forward-only rule: the stop verbs are `handback`, `hand-back`, `abandon`, `iterate`, `go-back`, `hold`, matched on the recommended option's value before any `:` (values like `iterate: ...` count). A `next` question is optional: when present it must recommend `proceed` or `done`; when absent the rule passes. The answers contain exactly the questions the gate asked, never an added `next`. Options may be strings or objects (`GateOption`). Digest line shape: `- <scope>: <key>=<value>, ...` under a first line `Decided without you since your last answer:`.
- [ ] **Step 4:** Run the tests; expect PASS.
- [ ] **Step 5: Commit** `gates: add mode eligibility, effective mode and digest`.

### Task 3: Daemon opens a gate pre-answered

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (`"gate:ask"` payload, ~line 1374)
- Modify: `packages/rt-client/src/client.ts:671` (add `"preAnswer"` to the passthrough keys)
- Modify: `lib/daemon/handlers/gate.ts` (`gateAsk`, ~line 788, and its `openGate`)
- Test: `lib/daemon/__tests__/gate-ask-handler.test.ts`

**Interfaces:**
- Produces: `gate:ask` payload field `preAnswer?: { answers: GateAnswer["answers"]; by: string }`. When present the result's `data` carries `preAnswered: true` and the settled `row` (status `answered`).
- Side effects of a pre-answered open, exactly: the row is written and answered; the `gate/opened` and `gate/answered` events are emitted (the feed in phase 2 reads `gate/answered` with a `mode:` by). No `push.onOpened`, no `push.onAnswered`, no `firePostAnswerEffects` (so no `dispatchGuarantee`, nothing resumed). `openGate` gains a `skipPush` option for this.

- [ ] **Step 1: Write the failing tests** (the harness passes no `push` today; inject a spy `push` with `onOpened`/`onAnswered` and a spy guarantee dispatcher):
  - `preAnswer opens an answered gate with no delivery`: response `preAnswered: true`, `row.status === "answered"`, `row.answer.by === "mode:draft-mr"`, `row.nudge` absent; `onOpened`, `onAnswered` and the guarantee dispatcher never called; both events emitted.
  - `preAnswer on a herd-owned subject answers without pushing to the shepherd` (owner `herd:h1`, no session) (Review Focus 4).
  - `preAnswer with by "pane" is refused` with error `preAnswer by must start with mode:` and no row created (Review Focus 5).
  - `preAnswer with an answer that is not an option is refused` with the existing validation error and no row created.
- [ ] **Step 2:** Run the file; expect FAIL.
- [ ] **Step 3:** In `gateAsk`: validate `preAnswer` (by prefix `mode:`, `validateGateAnswers` against the questions) before opening; open with presentation `wait`, no `paneId`, no `nudge`, `skipPush: true`; then `store.answer(id, answers, by, {})` and emit `gate/answered` only. Rebuild `packages/rt-client` (`bun run --cwd packages/rt-client build`) since its `dist/` is consumed (workspace-packages rule).
- [ ] **Step 4:** Run the file; expect PASS.
- [ ] **Step 5: Commit** `daemon: gate:ask can open a gate already answered by a mode`.

### Task 4: askGate answers eligible gates, records the decision, and flags shadow

**Files:**
- Modify: `lib/mcp/gate-tools.ts` (`askGate`; `openGate` ~line 569 and the `gate_open` schema in `gateToolDefs`)
- Modify: `lib/mcp/tools.ts` (`gate_ask` input schema)
- Test: `lib/mcp/__tests__/gate-tools.test.ts`

**Interfaces:**
- Consumes: Task 2's `autoAnswerDecision`, `effectiveMode`, `parseReach`; Task 3's `preAnswer`.
- `gate_open`'s `openGate` accepts `reach` and `needsOperator` in its optional-input check and forwards both into `askInput`. When it passes a precomputed `extra.formContext`, any prefix (`Needs you: ...`, Task 5's digest) is prepended to that `formContext` too, so the pane form shows it.
- If `run.decision` fails after the daemon has answered the gate, the answered result still returns, with the failure in `runErrors`.
- Produces:
  - `RunSnapshot.pipeline: string | null` (from the snapshot body's `run.pipeline`).
  - `GateToolDeps.gateMode: () => { mode: unknown; shadow: unknown }` (real: `getSetting("rt.work.gateMode").value`, `getSetting("rt.work.gateModeShadow").value`; a throw reads as every-gate, no shadow).
  - `GateToolDeps.headCommit: (worktree: string) => Promise<string | null>` (real: `git -C <worktree> rev-parse HEAD` via `childEnv()`; null on failure).
  - `gate_ask` / `gate_open` inputs `reach?: string` (one of the four) and `needsOperator?: string`.
  - Auto-answered result: `{ id, paneAction: "answered", status: "answered", decidedBy: "mode:<mode>", answers, next, writeIn: [], actOnWriteIn: false }`.
  - Gate `meta` keys written on every run gate: `reach`, `headCommit`; on a shadow open also `shadowAnswer` and `shadowMode`.

- [ ] **Step 1: Write the failing tests** (use the file's existing fake deps; add `gateMode` and `headCommit` fakes):
  - `draft-mr auto-answers a worktree gate under a work run`: `ask` receives `preAnswer.by === "mode:draft-mr"`; `run.decision` called with scope and the answers and by `mode:draft-mr`; result `paneAction === "answered"`; no `waiting-gate` field write.
  - `run field gate-mode beats the setting`.
  - `shadow opens normally and records the would-be answer in meta`: `ask` has no `preAnswer`, `meta.shadowAnswer` equals the answers, result `paneAction` is not `answered`.
  - `needsOperator prefixes the context`: context sent starts with `Needs you: ` + the reason.
  - `no runDb never auto-answers`.
  - `meta carries reach and headCommit` on an asking gate.
  - `an invalid reach input is refused` with `"reach" must be one of worktree, draft, teammates, public`.
  - `gate_open forwards reach and needsOperator`: a `gate_open` with `reach: "worktree"` under draft-mr auto-answers; one with `needsOperator` shows `Needs you: ` at the start of the returned `formContext`.
  - `a failed run decision after a pre-answer returns runErrors`.
- [ ] **Step 2:** `bun test lib/mcp/__tests__/gate-tools.test.ts`; expect FAIL.
- [ ] **Step 3:** In `askGate`, after the run resolves and the questions are shaped: read the run's `gate-mode` field and `worktree` field from `run.snapshot.fields`, compute the decision; on `answer` and not shadow, send `preAnswer` and record the decision with `run.decision(scope, normalizeAnswers(answers), by)`, then return the answered result; on `answer` with shadow, open normally with the shadow meta; merge `reach`/`headCommit` into `payload.meta` beside `kitControls`.
- [ ] **Step 4:** Run the file; expect PASS.
- [ ] **Step 5:** Regenerate the MCP tools reference (Global Constraints) and commit it with the code.
- [ ] **Step 6: Commit** `gate tools: answer eligible work gates by mode at open`.

### Task 5: Digest on gates that ask

**Files:**
- Modify: `lib/mcp/gate-tools.ts`
- Test: `lib/mcp/__tests__/gate-tools.test.ts`

**Interfaces:**
- Consumes: Task 2's `modeDigest`.
- Consumes: Task 2's `digestSince`.
- Produces: an asking gate under a run gets the digest prepended to its `context` (and to a passed `formContext`), followed by a blank line, with `sinceAt = digestSince(run.snapshot.decisions)`.

- [ ] **Step 1: Write the failing tests:** `asking gate shows decisions since the last human answer` (two mode decisions after a pane decision appear; one before it does not); `a later execution-strategy decision does not hide them`; `no mode decisions leaves context unchanged`; `an auto-answered gate carries no digest`; `a gate_open with formContext shows the digest in formContext`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Prepend in `askGate`'s asking path, before `flattenContext` runs, and to `extra.formContext` when given.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5: Commit** `gate tools: show what the mode decided on gates that ask`.

### Task 6: Per-run mode at start

**Files:**
- Modify: `lib/mcp/run-tools.ts` (`run_start`, ~line 182)
- Modify: `lib/mcp/herd-tools.ts` (`herd_spawn`) and `lib/daemon/handlers/herd.ts` (the worker env built ~line 389)
- Test: `lib/mcp/__tests__/run-tools.test.ts`, the herd tools and herd handler tests

**Interfaces:**
- Produces:
  - `run_start` input `gateMode?: string`; when absent, `run_start` reads env `RT_GATE_MODE`. A valid value writes run field `gate-mode` after the run starts. An invalid explicit `gateMode` is refused before the run starts with `"gateMode" must be one of every-gate, worktree, draft-mr, checkpoint-free`; an invalid `RT_GATE_MODE` is ignored (no field written).
  - `herd_spawn` input `gateMode?: string` (same validation and refusal); the daemon puts it in the worker's env as `RT_GATE_MODE` beside `HERD_ID`, so the worker's `run_start` picks it up with no skill change.
  - The work verb's invocation is unchanged: a solo run uses the setting or `run_field_set gate-mode`; the console launcher passes `gateMode` in phase 3.

- [ ] **Step 1: Write the failing tests:** `run_start` valid value writes the field; invalid value refuses and starts nothing; env `RT_GATE_MODE=worktree` with no input writes `worktree`; env `bogus` writes nothing; `herd_spawn` with `gateMode` puts `RT_GATE_MODE` in the spawned worker's env; invalid `gateMode` refuses the spawn.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS. Regenerate the MCP reference.
- [ ] **Step 5: Commit** `run_start and herd_spawn: accept a per-run gate mode`.

### Task 7: Gate protocol branch and generic pipeline reach labels

**Files:**
- Modify: `plugins/mattstack/attachments/gate-protocol/index.block.md`
- Create: `plugins/mattstack/attachments/gate-protocol/answered-by-mode.block.md`
- Modify: the generic work pipeline's gate blocks under `plugins/mattstack/attachments/pipeline/` (plan, evidence, self-review, CI, ship, mark-ready, close sites)
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version bump), `apps/board/skills` (regenerated)

**Interfaces:**
- Consumes: Task 4's `paneAction: "answered"` result and `reach` input.

- [ ] **Step 1:** Load superpowers:writing-skills and mattstack:editing-skills. Take the RED baseline the writing-skills skill requires: a gated verb given an `answered` result today has no branch for it.
- [ ] **Step 2:** Add to the flowchart: `pane_action -->|answered: decided by a mode| answered_by_mode` and `answered_by_mode --> act_on_answer`. The block says: the gate is already answered and recorded; act on `answers` at the site; never open it again, never present it.
- [ ] **Step 3:** Carry reach through the protocol: the `gate_ask` node becomes `gate_ask {questions, kind: <scope>, context?, subject?, runDb?, stage?, reach?, needsOperator?}`; `build-questions.block.md` and `runs-integration.block.md` say a site names its reach as "Runs integration with kind `<scope>`, reach `<reach>`" and that the walk passes it as `reach`; a site that names none passes none.
- [ ] **Step 4:** In each generic pipeline gate site, name reach per open: plan, clarify, evidence plan, self-review, CI fix, close -> `worktree`; ship -> `draft` while the MR is a draft, `teammates` when a force-push would hit a ready MR; mark-ready -> `teammates`; evidence boards and redaction -> `public`; off-script and failure opens -> none. The close report site lists the run's `mode:` decisions (from `run_snapshot`) when the run's mode is `checkpoint-free`, since no gate is left to carry the digest.
- [ ] **Step 5:** Add `needsOperator` guidance to the plan and evidence-plan sites (and any site whose questions carry domain or product choices): set it, with a one-line reason, when a recommendation turns on a product or people call (what a ticket's author or PM meant, a flag key or value from a conversation, a follow-up ticket, scope beyond the ticket), even when the step has a recommendation.
- [ ] **Step 6:** `bun run skills:expand:board`; `bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir "$(mktemp -d)/mattstack" --strict` (the form `.github/workflows/checks.yml:440` runs, with a scratch dir for `--mattstack-dir`); expect clean.
- [ ] **Step 7:** GREEN check per writing-skills.
- [ ] **Step 8: Commit** `plugin: gate protocol handles mode-answered gates; work pipeline declares reach` (with the version bump and `apps/board/skills`).

### Task 8: Team pack reach labels (org repo)

**Files:** the team pack's work pipeline gate fills in its org repo (path from the rt:settings / mattstack:editing-skills skills; the pack lives in the org clone, not this repo).

- [ ] **Step 1:** Load superpowers:writing-skills and mattstack:extending-a-pack. Install Task 7's plugin version locally first (`rt skills sync`, then `/reload-plugins`): a pack compile vendors the installed mattstack plugin, so an older install vendors a gate protocol with no `reach` input or answered branch.
- [ ] **Step 2:** Name reach on each work gate open with the same mapping as Task 7 Step 4, and add the Task 7 Step 5 `needsOperator` guidance to the pack's plan and evidence-plan sites and its own domain questions.
- [ ] **Step 3:** Recompile and check the pack (`rt skills compile`, `rt skills check`); expect clean.
- [ ] **Step 4:** Commit in the org repo with a plain message: no ticket ids from any tracker (the repo is visible to the employer).

### Task 9: End-to-end check on a scratch run

- [ ] **Step 1:** Under an isolated HOME (AGENTS.md), start the daemon from this worktree, start a run with `gateMode: "draft-mr"`, open a plan gate with `reach: "worktree"` and a recommended tier: expect `paneAction: "answered"` and a gate row answered by `mode:draft-mr`.
- [ ] **Step 2:** Open a mark-ready gate with `reach: "teammates"`: expect it to ask, with the digest line for the plan decision in its context.
- [ ] **Step 3:** Record the commands and outputs in the PR body. No commit.
