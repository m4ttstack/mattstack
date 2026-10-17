# Pipeline skills on the run engine, gate and provision tools: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `work` orchestrator, stage-provision, stage-plan, stage-implement, stage-self-review, stage-gates and the gate-protocol include so they call the merged run, gate and provision tools instead of drawing that bookkeeping.

**Architecture:** Skill text only (Markdown + dot graphs) under `plugins/mattstack/attachments/`. Each skill is tested the writing-skills way: a RED baseline against today's compiled text, then GREEN against the rewrite, with fresh single-shot agents. gate-protocol's structured-context reference moves to a sidecar file vendored with the include.

**Tech Stack:** Markdown skills, Graphviz dot (`render.sh`, `check-dot.py`), `rt skills compile/check` (`bun cli.ts`), `claude -p` for test reps.

**Spec:** `docs/superpowers/specs/2026-10-16-pipeline-skills-design.md` (read it whole; the plan argues from it and does not repeat its graphs).

## Global Constraints

- Write fence: `plugins/mattstack/attachments/pipeline/{work,stage-provision,stage-plan,stage-implement,stage-self-review,stage-gates}/**`, `plugins/mattstack/attachments/gate-protocol/**`, `plugins/mattstack/.claude-plugin/plugin.json`, `plugins/mattstack/pack/requires.json`, `plugins/mattstack/docs/superpowers/tests/2026-10-16-pipeline-skills/**`, `apps/board/skills/**` (only the output of `bun run skills:expand:board`, never hand edits), `docs/superpowers/{specs,plans}/`, `.superpowers/`.
- Never edit the review, forge, ship, watch-ci, stage-ship, stage-watch-ci, stage-evidence or shepherdr skills, `lib/**`, or anything under `~/.mattstack/orgs/`.
- Any built binary or `rt` run that could touch `~/.mattstack` runs with an isolated HOME and `--mattstack-dir <scratch>`; scratch lives under `/private/tmp/claude-501/.../scratchpad` (the session scratchpad), never in the repo.
- No employer names, team slugs, ticket ids or personal names in any committed file (certify's purity greps and `bun run purity` enforce it). Test fixtures use `acme`, `gitlab.example.com/acme/queue`, run `r-20261016-abc`, runDb `/home/dev/.mattstack/runs/queue/r-20261016-abc/state.db`.
- No em dashes or en dashes in new text; the plugin's own style uses `--` sparingly and `:` otherwise.
- Node vocabulary and rules: mattstack:process-digraphs (one exact call per `plaintext` node, every decision edge labelled, every loop budgeted, STOP rules, a `### <exact node text>` section per judgment box).
- Kept node texts (fills attach to them; never reword): stage-provision `Follow the domain's provision flow`, `Domain flow result?` (out-edge labels `it provisions a tree`, `it raises a question`, `already provisioned: this tree and its branch`), `Gate provision (table below)`, `provision answer?` (labels `ticket: create one`, `ticket: recheck the id`, `slug: their typed text`, `a domain answer`, `iterate: redo with their note`, `hold`), `worktree_provision result?`. Section headings `## Gate \`provision\``, `## Domain rules`, `## Gate \`plan\`` stay.
- Budget convention: charge `run_budget` on the event (a refusal, a blocking round, a Fresh pick) and branch on `exhausted`; `limit` = the count at which the diamond's "yes" fires (`= 3?` is `limit: 3`; "once already?" is `limit: 2`). `budget.error` reads as exhausted.
- Test reps: `claude --model sonnet --tools "" --strict-mcp-config --append-system-prompt-file <system-file> -p "$(cat <scenario>)"` from a fresh empty directory per rep (not inside the repo, so no git status leaks), 5 reps per scenario per version, read by hand.
- Size targets: gate-protocol SKILL.md under 2500 words (from 5337), work SKILL.md under 1200 words (from 2083).

## Review Focus

1. **No run at all** (a board or herd pane, a forge verb): every gate-protocol node must be walkable with the run params omitted, and nothing may tell such a pane to call a `run_*` tool. Pinned by scenario S8 in Task 2.
2. **A run write that fails after a gate opened** (`runErrors` on the `gate_ask`/`gate_open` result): the protocol says quote it in one line and carry on at `paneAction?`; never re-ask. Pinned by a sentence in Task 2's `gate_ask result?` section and S4's script (one rep set returns `runErrors`).
3. **An engine refusal mid-pipeline** (`run_next` or `run_resolve` refuses, e.g. a `to` outside the manifest): `work` records a hold quoting the refusal (`run_hold`) and ends held, never hand-writes stage rows. Pinned by S2b in Task 3.
4. **`run_resolve` retried with the same answer** (pane resent after compaction): pass `attempt`, accept `repeated: true` as applied. Pinned by S2's second half in Task 3.
5. **An older daemon** (`daemon-outdated` on precheck): provision proceeds without the precheck. Pinned by S5b in Task 4.

---

### Task 1: Test harness and RED baseline

**Files:**
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-pipeline-skills/red-green.md`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-pipeline-skills/scenarios/S1-stage-end.md` ... `S8-no-run-wait.md` (list below)
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-pipeline-skills/build-system-files.sh`

**Interfaces:**
- Produces: `build-system-files.sh <tree-or-git-ref> <out-dir>` writing one system file per verb (`work.md`, `stage-provision.md`, `stage-plan.md`, `stage-self-review.md`, `board-gate.md`) to `<out-dir>`; the scenario files; the RED table in `red-green.md`. Tasks 2-5 rerun the same script on the working tree for GREEN.

- [ ] **Step 1: Write `build-system-files.sh`.** Follow the method in `plugins/mattstack/docs/superpowers/tests/2026-10-10-evidence-skills/red-green.md`: export a scratch copy of `plugins/mattstack` (`git archive <ref> plugins/mattstack`, or a copy of the working tree when the argument is a path), add to the copy's `pack/stubs.jsonc` roster entries for `work`, `stage-provision`, `stage-plan`, `stage-self-review` (and the copy's `pack/skills.jsonc` a one-pipeline `feature` list: provision plan gates implement self-review), then `bun cli.ts skills compile --pack-dir <copy> --mattstack-dir <scratch> --verb <verb> --preview > <out>/<verb>.md` per verb, all with an isolated HOME. `board-gate.md` is gate-protocol's body alone (frontmatter stripped), standing in for a no-run board pane. The script edits only the scratch copy; it refuses to run when `<out-dir>` is inside the repo.
- [ ] **Step 2: Run it on `main`** and confirm each system file contains `# Gate protocol` where the verb includes it and a `digraph`. Expected: five non-empty files.
- [ ] **Step 3: Write the eight scenarios.** Each names the system file it runs against, sets the scene in the fixture project, scripts every tool result the agent will see, and ends: "List every tool call you make, in order, with exact arguments, until the turn ends or the stage hands back. Then say how the turn ends." Scenarios and their pass criteria (copy the criteria into `red-green.md`):
  - S1 stage end (`work.md`): plan returned with `approach` and `evidence-plan` written; `run_next` returns `{ended: "done", next: {stage: "gates", attempt: 1, status: "running", file: "<abs>/stage-gates/SKILL.md"}}`. Pass: one `run_next {runDb, stage: "plan"}`, then reads the gates file; no `run_stage`, `run_snapshot` or `run_field_set`.
  - S2 failure gate Go back (`work.md`): `run_next` on ship returns `failed`, scope `ship-failed:2`, `earlier: [provision, plan, gates, implement, self-review]`; the gate answers `{next: "redirect", to: "implement", note: "the fix needs a test"}` by `board`. Pass: `run_resolve {runDb, stage: "ship", next: "redirect", to: "implement", note, attempt: 2, decidedBy: "board"}`, then the implement file; no `shipTarget` or produce write, no `run_stage`. Second half: the same call is sent again after a compaction and returns `repeated: true`; pass = treats it as applied.
  - S2b engine refusal (`work.md`): `run_resolve` refuses (`to` not a manifest stage). Pass: `run_hold` with the refusal as reason, ends held; no hand-written stage rows.
  - S3 compacted resume (`work.md`): context holds run id `r-20261016-abc`; `run_enter` returns `resumed`, `at: {stage: "plan", attempt: 1, status: "running"}`; `run_field_get waiting-gate` returns a gate id; `gate_reconcile` returns `answered` with `{tier: "direct-tdd", next: "proceed"}` by `board`. Pass: `run_enter {resume: "r-20261016-abc"}` (not `runDb`), `gate_reconcile`, then acts on the recorded plan answer without re-asking; no new run, no `run_stage start`.
  - S4 unattended wait (`stage-plan.md`): under a run, `gate_ask` returns `paneAction: "wait"` (one rep set adds `runErrors: ["waiting-gate: disk full"]`); later the wait finishes. Pass: `gate_ask` carries `runDb` and `stage: "plan"`; one background `rt gate wait <id>`; turn ends `holding at gate <id>`; no AskUserQuestion, no hand-written `gate` or `waiting-gate`; on re-entry `gate_reconcile {id, runDb, stage}`; with `runErrors`, one line quoting it and the same path.
  - S5 occupied ticket branch (`stage-provision.md`, no domain): precheck returns one `attached` claimed tree on `acme-12-fix-login`; the gate answers Resume. Pass: precheck before any provision; the resume question on the `provision` gate; then `worktree_provision {repoName, branch: "acme-12-fix-login", reuse: true, runDb, stage: "provision"}` and `EnterWorktree`; no hand-written `branch`/`worktree` when `recorded: true`. S5b: precheck refused `daemon-outdated`. Pass: provisions with `codes: true` and `runDb`, no precheck retry, no stage failure.
  - S6 third blocking round (`stage-self-review.md`): after compaction a review finds blocking findings and `run_budget` returns `{spent: 3, limit: 3, exhausted: true}`. Pass: `run_budget {key: "review-rounds", limit: 3, stage: "self-review"}` then `run_stage {action: "fail", stage: "self-review", reason}`; no fourth fix round.
  - S7 daemon down, unattended (`stage-plan.md`): run `spawnedBy` set; `gate_ask` refuses "rt daemon unreachable". Pass: `run_stage {action: "fail", stage: "plan", reason: <the refusal verbatim>}`; no form.
  - S8 no run, herdr pane (`board-gate.md`): a board wrapper's gate, no run; `gate_ask` returns `paneAction: "wait"`; later a doorbell arrives and `gate_reconcile` returns `answered`. Pass: no `runDb`/`stage` on any call, no `run_*` call, one background wait, `gate_reconcile {id}` on the doorbell.
- [ ] **Step 4: Run RED.** System files from `main`, 5 reps per scenario (S2b and S5b count as their own scenarios), in parallel, each from a fresh empty directory under the scratchpad. Read every transcript by hand.
- [ ] **Step 5: Record RED** in `red-green.md`: method, fixture, pass criteria, a RED table (scenario, pass count, the deviations seen, quoted). Expected: most RED scenarios fail on criteria naming new tools; that is the baseline, not a bug.
- [ ] **Step 6: Commit** `plugins/mattstack/docs/superpowers/tests/2026-10-16-pipeline-skills/` with message `tests: RED baseline for the pipeline skills rewrite`.

### Task 2: gate-protocol on the run-aware gate tools

**Files:**
- Modify: `plugins/mattstack/attachments/gate-protocol/SKILL.md` (rewrite)
- Create: `plugins/mattstack/attachments/gate-protocol/structured-context.md`
- Regenerate: `apps/board/skills/**` via `bun run skills:expand:board`
- Modify: `plugins/mattstack/docs/superpowers/tests/2026-10-16-pipeline-skills/red-green.md` (GREEN rows for S4, S7, S8)

**Interfaces:**
- Consumes: Task 1's script and scenarios S4, S7, S8.
- Produces (cited by work, provision, plan and by the review and ship lanes; keep the texts exactly): nodes `Trigger: a site reaches its gate`, `Trigger: a site opened its gate with gate_open`, `gate_ask {questions, kind: <scope>, context?, subject?, runDb?, stage?}`, `paneAction?`, `Present the in-pane gate form`, `gate_answer {id, answers, runDb?, stage?}`, `rt gate wait <id> as a background Bash task`, `End the turn: holding at gate <id>`, `gate_reconcile {id, runDb?, stage?}`, `Act on a write-in`, `Act on the gate answer at the site` (success outcome); sections `## Runs integration`, `## Attendance`, `## Off-script gate`, `## Structured context (gate-ctx@1)`, `## Answers are option values`, `## Closed gates, Hold / Iterate`, `## Doorbell`, `## Red flags`.

- [ ] **Step 1: List outside citations.** Run `grep -rnoE "gate-protocol'?s? [A-Z][A-Za-z /-]+|presentation: \"?form\"? branch|deliberate[- ]pick" plugins/mattstack/attachments apps/board/skills-src | grep -v attachments/gate-protocol` and record each cited heading or phrase; each must keep a home with that wording in the rewrite (the spec names "Runs integration", "Structured context", "presentation: form branch", "the deliberate-pick rule").
- [ ] **Step 2: Move structured context.** Cut `## Structured context (gate-ctx@1)`'s body (today's lines 409-470) into `structured-context.md` verbatim, with a one-line heading. In SKILL.md keep the heading and two sentences: a site that opens a structured gate builds its source per `${CLAUDE_SKILL_DIR}/structured-context.md` and opens it with `gate_open`; nothing else in this protocol needs it.
- [ ] **Step 3: Rewrite the graph** to the spec's gate-protocol design: the nodes in Interfaces above plus `Build the gate's questions and context`, `gate_ask result?`, `Daemon down: is the gated pane unattended?`, `Under a run: fail the stage at the gate?`, `run_stage {action: fail, stage, reason: <the gate_ask refusal, verbatim>}`, `Present the gate form with no registry`, `gate_record {runDb, stage, scope, shape: answers, answers, decidedBy: pane}`, the two once-budgets (`run_budget {key: gate-fix:<scope>, limit: 2, stage}` behind `Under a run (gate_ask fix)?`, `run_budget {key: gate-remap:<scope>, limit: 2, stage}` behind `Under a run (answer remap)?`, each feeding today's counter diamond), `Fix what the gate_ask refusal names`, `Map the gate answer to exact option values`, `gate_answer result?`, `Say which surface won`, `Holding an open gate: under a run?`, `run_field_set {key: waiting-gate, value: <id>, stage}` (cancelled-form path only), the three re-entry triggers into the one `gate_reconcile` node, `gate_reconcile status?`, `A write-in to act on (actOnWriteIn)?`, `STOP: never invent an answer or re-ask a closed gate`, and the outcomes. No `run_field_set {key: gate}`, no `run_decision`, no 2-second wait node.
- [ ] **Step 4: Rewrite the sections** per the spec's "Kept sections", "Runs integration keeps its name", "Sites not yet on the tools", "Review shapes" and "Attendance" bullets. `gate_ask result?`'s section carries the `runErrors` line (Review Focus 2) and the `labelsTruncated` fact (no hand truncation). Trim `## Red flags` to rows the tools do not enforce. Run `wc -w`; expected under 2500.
- [ ] **Step 5: Check the graph.** Run `bash plugins/mattstack/plugin/skills/process-digraphs/render.sh plugins/mattstack/attachments/gate-protocol/SKILL.md` and `python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py plugins/mattstack/attachments/gate-protocol/SKILL.md`; expected: both exit 0 with no warnings. Run `sh plugins/mattstack/tests/certify.sh plugins/mattstack/attachments/gate-protocol/`; expected: exit 0.
- [ ] **Step 6: Re-run the Step 1 grep**; every recorded citation still resolves.
- [ ] **Step 7: Regenerate the board copy.** `bun run skills:expand:board`; then `git status apps/board/skills` shows only regenerated files; run `bun test lib/__tests__/no-board-skills-drift.test.ts apps/board/src/__tests__/skills-respond-open-gate.test.ts apps/board/src/__tests__/skills-review-open-gate.test.ts` from the repo root (the last two from `apps/board` if they need its preload); expected: all pass.
- [ ] **Step 8: GREEN for S4, S7, S8.** Build system files from the working tree, 5 reps each, read by hand; add GREEN rows to `red-green.md`. Expected: 5/5 each. A miss: fix the wording in the form writing-skills names for that failure, rerun that scenario (at most 2 refactor rounds; then report BLOCKED with the transcripts).
- [ ] **Step 9: Commit** SKILL.md, structured-context.md, `apps/board/skills`, `red-green.md`: `gate-protocol: drive the run-aware gate tools; structured context to a sidecar`.

### Task 3: work orchestrator on the run engine

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/work/SKILL.md` (rewrite)
- Modify: `red-green.md` (GREEN rows for S1, S2, S2b, S3)

**Interfaces:**
- Consumes: Task 2's node `gate_reconcile {id, runDb?, stage?}` and outcome `Act on the gate answer at the site`; the stage files' hand-back outcomes `Hand the Go back answer to the orchestrator` (plan) and `Tell the orchestrator the triage was wrong: Go back to plan` (implement), which Task 5 keeps.
- Produces: the hand-back contract stages follow: a stage that ends at a Go back outcome hands `{to, note, decidedBy}`; the orchestrator's diamond `How did the stage file end?` has labels `returned` and `handed back a Go back`.

- [ ] **Step 1: Rewrite the graph** to the spec's work design. Plaintext nodes, one call each: `run_enter {flags, skillDir, resume: <runId>, spawnedBy?}`, `run_enter {flags, skillDir, ticket?, spawnedBy?, fresh: true}`, `run_list {repo, pipelines}`, `run_field_get {key: waiting-gate}`, `gate_reconcile {id, runDb, stage}`, `run_decision {contract: account-pool@1, scope: run, selection, decidedBy}`, `run_next {runDb, stage}`, `run_resolve {runDb, stage, next, to?, note?, attempt, decidedBy}` (gate answers) and `run_resolve {runDb, stage, next: redirect, to, note, attempt, decidedBy}` (hand-back), `run_hold {runDb, stage, reason: <the refusal>, decidedBy: pane}` for an engine refusal (Review Focus 3). Boxes with their own sections: `Read the stage file at the position and follow it`, `Re-enter the stage at that gate's site`, `Gate clarify, AskUserQuestion only: Resume it / Start fresh / Hold`, `Gate <stage>-failed:<attempt>`, `Gate close`, `Tracker: In Progress, assigned to the operator`. Keep the STOP for a `run_enter` error ("report the tool's message; no run_enter tool means rt needs an update").
- [ ] **Step 2: Rewrite the prose.** Keep "Stages" with `{{pipeline.table}}` and `{{run-start.flags:work}}`, `{{run-list.pipelines}}` in the resume filter line, `{{slot:tiering}}`, `{{include:gate-protocol}}`, `{{include:wrap-up-form}}`. Replace "What the graph cannot show" with the spec's work bullets (entry, candidates from `run_list`, clarify, resumed routing including the `waiting-gate` reconcile, `Position.file`, hand-back, answer-to-`next` mapping, `attempt`, `decidedBy`, `repeated: true`, a finished run stays finished, the orchestrator's gates answer "fail the stage at the gate?" no, account back-fill). Keep the Gate questions table (`to` options from `earlier`/`stages`, split over 4; one candidate labelled **Go back to `<stage>`**) and drop the `Selections:` lines. Run `wc -w`; expected under 1200.
- [ ] **Step 3: Check the graph** (render.sh, check-dot.py, certify.sh on `attachments/pipeline/work/`); expected: exit 0, no warnings.
- [ ] **Step 4: GREEN for S1, S2, S2b, S3**, 5 reps each, rows in `red-green.md`; expected 5/5; at most 2 refactor rounds, else BLOCKED.
- [ ] **Step 5: Commit** `work: walk the run with run_enter, run_next and run_resolve`.

### Task 4: stage-provision on worktree_provision's options

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/stage-provision/SKILL.md`
- Modify: `red-green.md` (GREEN rows for S5, S5b)

**Interfaces:**
- Consumes: Task 2's gate-protocol (the provision gate walks it with `runDb` and `stage: "provision"`).
- Produces: nothing new for other tasks; the kept node texts in Global Constraints.

- [ ] **Step 1: Rewrite the graph** to the spec's provision design, keeping every node text and edge label listed in Global Constraints. New plaintext nodes: `worktree_provision {repoName, ticket | branch, ticketTitle?, precheck: true}`, `worktree_provision {repoName, ticket | branch, ticketTitle?, codes: true, runDb, stage: provision, budget: {key: provision-refusals, limit: 2}}`, `worktree_provision {repoName, branch: <the picked branch>, reuse: true, runDb, stage: provision}`, `run_budget {key: fresh-tree, limit: 2, stage: provision}`, `run_hold {runDb, stage: provision, reason, decidedBy}`; split every two-call node (`run_field_set {key: branch}` and `run_field_set {key: worktree}` become two nodes on each path that writes them by hand; the plain-branch `rev-parse` and `status --porcelain` become two). Diamonds: `Precheck result?` (labels: trees to resume; nothing in the way; refused daemon-outdated; refused daemon-unreachable or repo-unknown; refused otherwise), `worktree_provision result?` routing on `code` (busy reads `budget.exhausted`), `Reuse result?`, `Fresh trees this attempt = 2?` (reads the budget's `exhausted`), `Recorded on the run?`.
- [ ] **Step 2: Rewrite the prose.** One-sentence run-state line; "What the graph cannot show" gains the precheck rule (which lists the gate offers: `attached`, a surviving `localBranch`, `sameTicket` only with no domain rules; all in the one `resume_in` question, at most 3 trees plus **Fresh tree**), the Fresh branch-mode suffix (`<slug>-<n>`, lowest free, precheck skipped), `reuse` refusing the main checkout and disposable trees, and `budget.error` read as exhausted. Gate table keeps its rows (resume_in options now from the precheck); drop the `Selection:` line.
- [ ] **Step 3: Check the graph** (render.sh, check-dot.py, certify.sh); expected exit 0, no warnings.
- [ ] **Step 4: GREEN for S5, S5b**, 5 reps each; expected 5/5; at most 2 refactor rounds.
- [ ] **Step 5: Commit** `stage-provision: precheck, reuse and refusal codes; persisted fresh-tree budget`.

### Task 5: stage-plan, stage-implement, stage-self-review, stage-gates

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/stage-plan/SKILL.md`, `stage-implement/SKILL.md`, `stage-self-review/SKILL.md`, `stage-gates/SKILL.md`
- Modify: `red-green.md` (GREEN rows for S6; re-run S4 and S7 on the new stage-plan)

**Interfaces:**
- Consumes: Task 3's hand-back contract; Task 2's gate-protocol.
- Produces: kept outcome texts `Hand the Go back answer to the orchestrator`, `Tell the orchestrator the triage was wrong: Go back to plan`.

- [ ] **Step 1: Apply the shared stage changes** to all four: the one-sentence run-state line in place of the five-line paragraph; every hold triplet replaced by `run_hold {runDb, stage: <stage>, reason, decidedBy}` then the held outcome; drop `Selection:` lines.
- [ ] **Step 2: stage-plan.** Keep every judgment section and the HARD-GATE table verbatim. The Go back outcome's section says what it hands back (`to` from the gate's `to` answer, the note, the gate's `by`).
- [ ] **Step 3: stage-implement.** "Go back to plan" hands `{to: plan, note: the triage mismatch, decidedBy: pane}`.
- [ ] **Step 4: stage-self-review.** Insert `run_budget {key: review-rounds, limit: 3, stage: self-review}` between `Blocking findings?` (yes) and `Review rounds = 3?`, which now reads its `exhausted`; the diamond's section says a compacted or resumed stage keeps the count and a new attempt starts at zero.
- [ ] **Step 5: Check the graphs** (render.sh, check-dot.py, certify.sh on each of the four dirs); expected exit 0, no warnings.
- [ ] **Step 6: GREEN for S6; re-run S4, S7** (stage-plan changed), 5 reps each; expected 5/5; at most 2 refactor rounds.
- [ ] **Step 7: Commit** `stages: run_hold, persisted review rounds, one-line run state`.

### Task 6: Version, floor, compile and checks

**Files:**
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version), `plugins/mattstack/pack/requires.json` (`minEngine`)
- Modify: `docs/superpowers/specs/2026-10-16-pipeline-skills-design.md` (deviation table)

- [ ] **Step 1: Bump.** `git fetch origin main`; set `plugin.json` `version` to the next patch above `origin/main`'s and `requires.json` `minEngine` to the same string.
- [ ] **Step 2: Whole-plugin checks**, from the repo root with an isolated HOME and scratch mattstack dir, exactly as the `plugin-mattstack` job runs them: the check-dot sweep over every plugin `.md` with a dot block, certify over every skill and attachment dir, `bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir <scratch> --strict`, `bun cli.ts skills compile --dry-run --pack-dir "$PWD/plugins/mattstack" --mattstack-dir <scratch>`, `bash plugins/mattstack/plugin/skills/process-digraphs/test-check-dot.sh`, the hook tests (`bash hooks/tests/test-pipeline-gate-stop.sh`, `sh tests/test-gate-stop-hook.sh` in `plugins/mattstack`). Expected: every one exits 0.
- [ ] **Step 3: Compile `work` end to end** with Task 1's script on the working tree; read the compiled `work.md` and `stage-provision.md` for: every placeholder substituted, gate-protocol inlined once per verb, no structured-context body inlined, the sidecar vendored at `parts/include-gate-protocol/structured-context.md`, and `${CLAUDE_SKILL_DIR}` in the pointer rewritten to that folder.
- [ ] **Step 4: Word counts.** Record source and compiled word counts for each touched skill against today's (the spec's Why numbers) in `red-green.md`.
- [ ] **Step 5: Deviation table.** Add `## Test results` to the spec: one row per scenario with RED and GREEN pass counts and the deviation types seen (shell calls a tool covers, hand-written run fields, skipped steps, runaway loops, a stop that should have been a gate), linking `red-green.md`.
- [ ] **Step 6: `bun run purity`**; expected exit 0.
- [ ] **Step 7: Commit** `mattstack <version>: pipeline skills on the run engine, gate and provision tools`.
