# Review skills on the run, gate and MR composite tools: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking. Every skill edit also needs
> superpowers:writing-skills and mattstack:process-digraphs (load both
> before editing a SKILL.md).

**Goal:** Rewrite `review`, `self-review` and `receive-review` so their
graphs call `run_enter`/`run_hold`/`run_close`/`run_budget`,
`gate_open`/`gate_record`, `respond_post_execute`, `mr_threads {filter}` and
`mr_posted_since` in place of hand-drawn mechanics, keeping every judgment
step and the GitHub paths.

**Architecture:** Markdown skills with one dot digraph each, plus one
`### <node text>` section per judgment box. The gate mechanics come from
gate-protocol, which the pipeline-skills lane is rewriting in the `rosie`
worktree. These skills cite its new node and section names.
Behavior is tested with describe-only `claude -p` reps against verbs
compiled from a scratch copy of the plugin.

**Tech Stack:**
- Markdown and Graphviz dot (`render.sh`, `check-dot.py`);
- `rt skills compile/check` (`bun cli.ts`);
- `claude -p` for the test reps;
- `certify.sh`.

**Spec:** `docs/superpowers/specs/2026-10-16-review-skills-design.md`
(approved, gate 82a28155). Read it whole before any task: its Design
sections are the per-skill target graphs, and its Behavior changes table
is the contract.

## Global Constraints

- **Write fence:**
  - `plugins/mattstack/attachments/review/{review,self-review,receive-review}/**`;
  - `plugins/mattstack/.claude-plugin/plugin.json`;
  - `plugins/mattstack/pack/requires.json`;
  - `plugins/mattstack/docs/superpowers/tests/2026-10-16-review-skills/**`;
  - this plan, the spec, and `.superpowers/`.

  Nothing else: no gate-protocol, no review-* includes, no `apps/board`, no
  `lib/`.
- **Scripts:** `scripts/gate-ctx.sh`, `scripts/review-source.sh` and their
  `tests/` stay byte-identical. `lib/gates/__tests__/parity.test.ts` reads
  them in place.
- **Node texts kept verbatim** (the board wrappers name them):
  - `Caller owns the review gates?`
  - `Review caller's answer?`
  - `Write the review report and its json sibling`
  - `Build the open`
  - `code-changes answer?`
  - `Hand back the verdict table and the respond-plan open's path`
- **gate-protocol citations**, exactly as the pipeline-skills lane names them
  (DM #6006):
  - `Trigger: a site opened its gate with gate_open`
  - `paneAction?`
  - `### Present the in-pane gate form`
  - `gate_answer {id, answers, runDb?, stage?}`
  - `rt gate wait <id> as a background Bash task`
  - `End the turn: holding at gate <id>`
  - `gate_reconcile {id, runDb?, stage?}`
  - `## Off-script gate` (scope `off-script:<site>:<n>`, questions `action`
    and `next`)
  - `## Structured context (gate-ctx@1)`, with the sidecar
    `structured-context.md`

  Before each task, re-check them against
  `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/rosie/plugins/mattstack/attachments/gate-protocol/SKILL.md`
  (read only). When a name moved, use the new one and DM
  `pipeline-skills.3c57`.
- **Budget keys** (`run_budget {runDb, key, limit, stage: <stage>}`). Each
  failure charges `increment: 1`, and the counter diamond reads `exhausted`.

  | Skill | Key | Limit |
  |---|---|---|
  | receive-review | `respond-plan-open` | 3 |
  | receive-review | `respond-post-open` | 3 |
  | receive-review | `fix:<threadId>` | 3 |
  | receive-review | `post-execute-fix` | 1 |
  | review | `target-clarify` | 2 |
  | review | `verify-rounds:<depth>` | 2 |
  | review | `post-open-fix` | 1 |
  | review | `bad-anchors` | 1 |
  | self-review | `fix:<findingId>:<round>` | 3 |
  | self-review | `reopen:<findingId>` | 1 |

  `<round>` starts at 1 and becomes 2 after the one reopened gate.
- **Run line:** at a hand-back, write `receive-review-run: <run id>` or
  `review-run: <run id>` into the handed `--report`.
- **Scratch files:** a new directory inside the session scratchpad (under
  `/private/tmp/claude-<uid>/`), never `mktemp -d`.
- **Any `rt`/`bun cli.ts` run:** an isolated HOME (`env -i HOME=<scratch>
  PATH="$PATH"`) and `--mattstack-dir <scratch>`.
- **Test reps** are describe-only, using the shepherd-approved recipe (gate
  77440bd4):

  ```
  claude --model sonnet --tools "" --strict-mcp-config \
    --setting-sources local --settings '{"disableAllHooks":true}' \
    --disable-slash-commands --no-session-persistence \
    --append-system-prompt-file <system-file> -p "$(cat <scenario>)"
  ```

  - Run each rep from a fresh empty directory under the scratchpad.
  - 5 reps per scenario per side, read by hand.
  - Never add a flag that gives a rep a tool.
- **Commits:** end every message with `Co-Authored-By: Claude Opus 5.5
  <noreply@anthropic.com>`.
- **Copy:** no em or en dashes in skill text; no employer names, slugs or
  ticket ids.
- **Subagents:**
  - implementers `opus`, effort `high`;
  - per-task reviewers `opus`, `high`;
  - the final whole-branch review `opus`, `xhigh`.

## Review Focus

1. **A board pane re-entered at a host box** (`{plan, by}` then `{post, by}`
   in the same pane). It must record on the run it already holds, never
   start a second run. Pinned by Task 4's scenario R7b.
2. **A respond-post re-ask after Iterate.** It must open a new gate and
   record against the new gate only. `gate_record` on the old gate id is
   stale and refused. Pinned by Task 5's scenario R3b.
3. **A GitHub run of receive-review.** It must never reach
   `respond_post_execute` or `mr_threads`. Pinned by R8.
4. **An inherited run** (a pipeline hands `runDb`). It must never reach
   `run_close`. A hand back fails the stage with `run_stage`. Pinned by
   Task 2's S16 and Task 3's V13.
5. **A `gate_open` refusal on the hand-back path.** It must route through
   the same budget and off-script gate as the direct path, never hand back a
   half-written open file. Pinned by V11b.

---

### Task 1: Harness, preservation inventory and RED baseline

**Files:**
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-review-skills/build-system-files.sh`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-review-skills/inventory.md`
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-review-skills/scenarios/*.md`
  (the scenario list below)
- Create: `plugins/mattstack/docs/superpowers/tests/2026-10-16-review-skills/red-green.md`

**Interfaces:**
- Produces: `build-system-files.sh <git-ref|tree-path> <out-dir>
  [--gate-protocol <dir>]`, which writes `review.md`, `self-review.md` and
  `receive-review.md` to `<out-dir>`. `--gate-protocol` overlays that
  directory onto the scratch copy's `attachments/gate-protocol/` before
  compiling. GREEN passes the rosie worktree's gate-protocol, until
  pipeline-skills merges.
- Produces: the scenario files, consumed by Tasks 2 to 5 for GREEN.

- [ ] **Step 1: Write `build-system-files.sh`.**
  - Follow `plugins/mattstack/docs/superpowers/tests/2026-10-10-evidence-skills/red-green.md`'s
    method:
    1. Export a scratch copy of `plugins/mattstack` (`git archive <ref>
       plugins/mattstack`, or `cp -R` for a path).
    2. Add roster entries `review`, `self-review` and `receive-review` to the
       copy's `pack/stubs.jsonc`, each with `engine` = its own name.
    3. Apply the optional gate-protocol overlay.
    4. Run `bun cli.ts skills compile --pack-dir <copy> --mattstack-dir
       <scratch> --verb <verb> --preview > <out>/<verb>.md`, under an
       isolated HOME.
  - Refuse when `<out-dir>` is inside the repo.
  - When a verb name fails to compile, read `lib/skills/sources.ts` for how
    an engine is named, and fix the roster entry. Never edit the real
    `stubs.jsonc`.
- [ ] **Step 2: Run it on `HEAD`** (main's skills). Expected: three non-empty
  files, each containing `digraph` and `# Gate protocol`.
- [ ] **Step 3: Write `inventory.md`.**
  - One table per skill, one row per current node and per `###` section.
  - Columns: `current text`, then `fate` (`kept` / `tool: <name>` /
    `replaced by: <new node>` / `gone: <why>`), then `spec ref`.
  - Fill the fate from the spec's Design and Behavior changes.
  - A row with no fate is a defect: stop and resolve it against the spec
    before moving on.
- [ ] **Step 4: Write the scenarios.**
  - **Fixture:** project `gitlab.example.com/acme/queue` (GitHub:
    `github.com/acme/queue`), run `r-20261016-rev`, runDb
    `/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db`, tree
    `/home/dev/trees/queue-fix`.
  - **Each scenario:**
    - names its system file;
    - scripts every tool result and every human answer;
    - ends with: "List every tool call you make, in order, with exact
      arguments, until the turn ends or the verb hands back. Then say how
      the turn ends."
  - **Each scenario's pass criteria go into `red-green.md`.**

  receive-review:
  - **R1 bot thread** (`receive-review.md`). `mr_threads` returns two human
    threads plus `dropped: {resolved: 1, system: 0, bot: 1}`.
    - Pass: `mr_threads {mrUrl, filter: "unresolved-human"}`, then one
      adjudicator dispatch over exactly two threads; no hand filter of bot
      authors.
  - **R2 note on a reply.** respond-plan is answered `{"thread-1": {value:
    "reply:T1", note: "softer"}, "thread-2": "fix:T2", "code-changes":
    "approve"}`, and `gate_record` returns `rows` with T1 `gate1:
    "override"`.
    - Pass: `gate_open {kind: "respond-plan", sourcePath, runDb, stage:
      "receive-review", scope: "respond-plan"}`, then `gate_answer` (pane),
      then `gate_record {..., shape: "respond-plan", gateId}`.
    - T1 is redrafted and offered at respond-post, never posted from gate 1.
      No hand `run_decision`.
  - **R3 Hold at respond-post.** The answer is `next: hold`, with post picks
    ticked.
    - Pass: no `gate_record`, no `respond_post_execute`; `run_hold {runDb,
      stage, reason, decidedBy}`; the turn ends held.
  - **R3b Iterate at respond-post.**
    - Pass: no record, no execute; a redraft, then a new `gate_open`; then
      `gate_record` with the new gate's id.
  - **R4 partial post retry.** `respond_post_execute` returns `posted: [T2],
    held: [{threadId: T1, kind: "reply", error: "500 Internal Server
    Error"}]`. The off-script answer is `next: iterate`. The second call
    returns `alreadyPosted: [{threadId: T1}]` and `held: []`.
    - Pass: one off-script gate quoting the error; a second
      `respond_post_execute`; `run_field_set {key: hold, value: "-"}`; then
      `run_close`.
    - No `mr_reply_thread` and no glab.
  - **R5 mismatch.** `held: [{T2, kind: "mismatch", error: "<two git
    outputs>"}]`.
    - Pass: the outputs are reported verbatim; the turn ends "threads held,
      run left open".
    - No shell push, no branch switch, no `git_push`.
  - **R6 resume with nothing held.** `run_enter` returns `resumed`, and the
    snapshot has respond-post recorded with no `held`.
    - Pass: `respond_post_execute` is called again before `run_close`.
  - **R7 board fresh-pane resume.** Handed `{post: {...}, by: "board"}` plus a
    `--report` whose text has `receive-review-run: r-20261016-rev`.
    - Pass: `run_enter {..., resume: "r-20261016-rev", spawnedBy}`, then
      `gate_record {scope: "respond-post", shape: "respond-post", answers,
      decidedBy: "board"}`, then `respond_post_execute`.
    - No re-adjudication, no new run.
  - **R7b board same pane.** The verb handed back at respond-plan earlier in
    the same conversation (`runDb` in context), and is now handed `{plan,
    by: "board"}`.
    - Pass: `gate_record {scope: "respond-plan", shape: "respond-plan",
      answers, decidedBy: "board"}` on that `runDb`; no `run_enter` call.
  - **R8 GitHub proceed.** `github.com/acme/queue/pull/12`, one fix row and
    one override, respond-post proceeds.
    - Pass: `gate_record`, the gh posted-already read, `git branch
      --show-current`, `git rev-parse --abbrev-ref @{push}`, `git_push
      {tree}`, then the gh reply and resolve per thread.
    - No `respond_post_execute` and no `mr_*`.

  review:
  - **V9 direct post.** `gate_open` (review-post) returns a gate whose answer
    picks `findings-1: [f1, f2]`, `thread-1: [post:D1]` and `outcome:
    approve`. `mr_review_submit` returns `published: true, approved: true`.
    - Pass: `gate_open {kind: "review-post", review: {findingsPath, extras},
      runDb, stage: "review", scope: "post"}`.
    - The submit carries `replies` with D1's report reply.
    - `gate_record {..., scope: "post", shape: "post", gateId}` comes AFTER
      the submit; then `run_close {workType: "review", stage: "review",
      outcome: "done"}`.
  - **V10 resume, no post decision.** `mr_posted_since` returns the summary
    item `posted: true`.
    - Pass: the record goes to the post node with nothing submitted; no
      `mr_review_submit`.
  - **V11 gate_open refused twice.**
    - Pass: one fix (`run_budget {key: "post-open-fix", limit: 1}`), then on
      the second refusal the off-script gate.
    - No hand-edited open, no `gate-ctx.sh`.
  - **V11b the same on the hand-back path.**
    - Pass: the same budget and gate; nothing handed back.
  - **V12 board owns the gates.**
    - Pass: `sh <skill>/scripts/review-source.sh <report json> <extras> >
      <dir>/review-post.source.json`, then `gate_open {..., sourcePath,
      handBack: true, outPath: <dir>/review-post.open.json, scope: "post"}`.
    - The `review-run:` line goes into `--report`.
    - The hand-back names the open, source and `gate-ctx.sh` paths.
  - **V13 inherited hand back.** A pipeline hands `runDb`; a review script
    refuses and the human hands back.
    - Pass: `run_stage {action: "fail", stage: <current_stage>, reason}`; no
      `run_close`.

  self-review:
  - **S13 stuck finding.** Three failing attempts; the reopened gate answers
    `finding: retry:F2`; three more fail.
    - Pass: `run_budget` keys `fix:F2:1` then `fix:F2:2`; one reopened gate
      with `scope: "self-review-retry:F2"`; then "left open".
    - No seventh attempt.
  - **S14 compacted mid-loop.** `run_budget {increment: 0}` shows `spent: 2`.
    - Pass: exactly one more attempt before the reopen.
  - **S15 clarify Hold.**
    - Pass: `gate_ask {..., kind: "clarify", runDb, stage}`, then `run_hold`.
    - No hand `run_decision` and no `run_field_set hold`.
  - **S16 inherited abandon.**
    - Pass: `run_stage {action: "fail", ...}`; no `run_close`.
- [ ] **Step 5: Run RED.** Use the system files from Step 2, 5 reps per
  scenario, in parallel, each from a fresh empty directory. Read every
  transcript.
- [ ] **Step 6: Record RED in `red-green.md`:**
  - method, fixture and criteria;
  - a table of scenario, pass count, and the deviations seen, quoted, with
    counts by class (shell call a tool covers, hand mechanics a tool covers,
    skipped step, runaway loop, stop that should have been a gate).
- [ ] **Step 7: Commit** the test directory: `tests: RED baseline and
  inventory for the review skills rewrite`.

### Task 2: self-review

**Files:**
- Modify: `plugins/mattstack/attachments/review/self-review/SKILL.md`
- Modify: `.../tests/2026-10-16-review-skills/red-green.md` (GREEN rows S13
  to S16)

**Interfaces:**
- Consumes: Task 1's script, and scenarios S13 to S16.
- Produces: the run block pattern Tasks 3 to 5 copy, with skill-specific
  text:
  - nodes `run_enter {flags, skillDir, stage: self-review, runDb?, resume?,
    spawnedBy?}`, `self-review run_enter mode?`, `run_hold {runDb, stage,
    reason, decidedBy} for self-review`, and `run_close {runDb, workType:
    self-review, stage: self-review, outcome}`;
  - the section `### Gate self-review clarify: Resume / Start fresh / Hold`,
    kept.

- [ ] **Step 1: Rewrite the graph and sections** per the spec's "Shared: the
  run" and "self-review" sections:
  - the `run_enter` prologue;
  - holds through `run_hold`;
  - own close through `run_close`, inherited abandon through `run_stage
    fail`;
  - both counters through `run_budget`;
  - the fix gate and the clarify gate through `gate_ask {runDb, stage}` and
    the include (answers maps `{fix, next}` and `{source, next}`);
  - the stuck gate at `scope: "self-review-retry:<finding id>"`, with values
    `retry:<id>` and `leave:<id>`;
  - the fill off-script gate citing the include's `## Off-script gate`.

  Delete the `run_list`, `run_start`, `run_stage start`, hold-clear and
  `run_status` nodes, and the hand `run_decision` lines. Keep the
  HARD-GATE, the red flags, the test-first loop and every kept section from
  `inventory.md`.
- [ ] **Step 2: Static checks.** Expected: all exit 0.

  ```
  bash plugins/mattstack/plugin/skills/process-digraphs/render.sh plugins/mattstack/attachments/review/self-review/SKILL.md
  python3 plugins/mattstack/plugin/skills/process-digraphs/check-dot.py plugins/mattstack/attachments/review/self-review/SKILL.md
  (cd plugins/mattstack && sh tests/certify.sh attachments/review/self-review/)
  ```
- [ ] **Step 3: GREEN.** Run `build-system-files.sh <worktree> <out>
  --gate-protocol <rosie gate-protocol dir>`, then S13 to S16 with 5 reps
  each. Pass: every criterion, no deviation.
  - On a miss, fix the wording (a positive recipe for a shape miss, a
    prohibition plus a red-flag row for a discipline miss), then re-run that
    scenario.
  - Three rounds at most; then report BLOCKED with the transcripts.
- [ ] **Step 4: Record GREEN rows** in `red-green.md`, then commit both
  files: `self-review: run, gate and budget tools`.

### Task 3: review

**Files:**
- Modify: `plugins/mattstack/attachments/review/review/SKILL.md`
- Modify: `red-green.md` (V9 to V13)

**Interfaces:**
- Consumes: Task 2's run block pattern (copy it with `review` in place of
  `self-review` in node texts), and scenarios V9 to V13.
- Produces: nothing other tasks read.

- [ ] **Step 1: Rewrite** per the spec's "review" section:
  - the run block, plus `resume` from a handed `--report`'s `review-run:`
    line;
  - the clarify target gate through `gate_ask {runDb, stage}`, its rounds
    through `run_budget target-clarify`;
  - `worktree_provision {repoName, branch, reuse: true}`, dropping the
    `branch-attached` parsing rule;
  - verify rounds through `run_budget verify-rounds:<depth>`;
  - the posting gate:
    - direct: `gate_open {kind: review-post, review: {findingsPath,
      extras}, runDb, stage, scope: post}`, with the copy into the scratch
      dir when the report json is elsewhere;
    - hand-back: `review-source.sh`, then `gate_open {sourcePath, handBack:
      true, outPath, ...}`, plus the run line;
    - legacy: `gate_ask {kind: review-post, scope: post, runDb, stage}`;
    - `gate_open result?` with `run_budget post-open-fix`;
  - `This review already on the MR?` through `mr_posted_since` (items: the
    summary's first line, each anchored comment), GitLab only, asked only on
    a resume with no post decision;
  - the bad-anchors retry through `run_budget bad-anchors`;
  - every posted edge, gh included, ending at `gate_record {runDb, stage,
    scope: post, shape: post, gateId | answers + decidedBy}` (after
    posting), which replaces the `run_decision ... scope: post` node;
  - off-script gates citing the include's shape (the selection-schema
    paragraph goes);
  - the close through `run_close`.

  Keep:
  - the three board-named nodes;
  - target resolution;
  - depth, diff and checkout;
  - Compose (trimmed to placement, the cap, `replies` from `thread-<n>`, and
    the restored rules);
  - every off-script origin;
  - review-posting's include.
- [ ] **Step 2: Static checks** (as Task 2, on `review/`), plus `sh
  plugins/mattstack/attachments/review/review/tests/test-review-source.sh`.
  Expected: exit 0, all checks pass.
- [ ] **Step 3: GREEN**, V9 to V13, 5 reps each, as Task 2 Step 3.
- [ ] **Step 4: Record and commit:** `review: run, gate, budget and
  posted-since tools`.

### Task 4: receive-review, entry to the row walk

**Files:**
- Modify: `plugins/mattstack/attachments/review/receive-review/SKILL.md`
  (graph and sections up to `Next report row, in verdict-table order?`)
- Modify: `red-green.md` (R1, R2, R7, R7b)

**Interfaces:**
- Consumes: Task 2's run block pattern, and scenarios R1, R2, R7, R7b.
- Produces, for Task 5:
  - the node `Any thread offered (a finalized fix or an override)?`, the
    entry to the post half;
  - the node `What did the caller hand receive-review?` with a `{post}`
    alone edge to Task 5's `gate_record` respond-post node;
  - scratch dir variable naming: `<dir>`.

- [ ] **Step 1: Rewrite the first half** per the spec's "receive-review"
  steps 1 to 8 and "Caller-handed decisions":
  - **The run block:** `resume` from `receive-review-run:`; re-entry reads
    the snapshot (`respond-plan` decision plus
    `extra.gate-source.respond-plan` cards for rows; never re-record).
  - **Identity:** `run_field_set {key: mr}` and `run_field_set {key:
    branch}` as nodes, own or inherited, keeping a set `mr`.
  - **Threads:** `mr_threads {mrUrl, filter: "unresolved-human"}` on GitLab,
    and the gh read plus `Keep only unresolved human threads (GitHub)` with
    the username bot rule.
  - **Build the open:** the scratch file `<dir>/respond-plan.source.json`;
    the field table kept; the structured-context sidecar cited.
  - **The respond-plan gate:**
    - direct: `gate_open {kind: respond-plan, sourcePath, runDb, stage,
      scope: respond-plan}`, then the include at `Trigger: a site opened its
      gate with gate_open`;
    - the pane-only `next` (Continue / Iterate here / Hold) in a last form
      call. Hold answers nothing and goes to `run_hold`;
    - hand-back: the `handBack` call, the run line, then `Hand back the
      verdict table and the respond-plan open's path`;
    - `gate_open result?` with `run_budget respond-plan-open`, and its
      off-script gate.
  - **Recording:** `gate_record {..., scope: respond-plan, shape:
    respond-plan, gateId | answers + decidedBy, contextDropped?}`. Rows are
    written from its `rows` in today's row format. `gate-1-context: dropped`
    goes into a saved report when `contextDropped` is true.
  - **The fix loop counter:** `run_budget fix:<threadId>`.
  - **Wording:** the "act on the returned presentation" wording goes; the
    include's `paneAction?` decides.

  Delete:
  - the fit node, its exit-code diamond, fit-attempts and fix-source nodes,
    and its off-script pair;
  - the prose-mode recipe;
  - the normalization and override prose;
  - the snapshot-only reading;
  - the matching red-flag rows.

  Keep the HARD-GATE, the verdict and reply rules, and the board-named
  nodes.
- [ ] **Step 2: Static checks** (as Task 2, on `receive-review/`), plus `sh
  plugins/mattstack/attachments/review/receive-review/tests/test-gate-ctx.sh`.
  The graph's post half may still be the old text this task. It must still
  parse and pass check-dot.
- [ ] **Step 3: GREEN** R1, R2, R7b (R7 is scored in Task 5; it needs the
  post half), 5 reps each.
- [ ] **Step 4: Record and commit:** `receive-review: run, gate_open,
  gate_record and the human-thread filter`.

### Task 5: receive-review, the post half

**Files:**
- Modify: `plugins/mattstack/attachments/review/receive-review/SKILL.md`
  (from `Any thread offered ...?` to the end, plus Red flags)
- Modify: `red-green.md` (R3, R3b, R4, R5, R6, R7, R8)

**Interfaces:**
- Consumes: Task 4's entry node and the `{post}` alone edge.
- Produces: nothing other tasks read.

- [ ] **Step 1: Rewrite the post half** per the spec's "receive-review"
  steps 9 to 11:
  - **The offer rule:** fixes and overrides only, kept.
  - **`Build the respond-post open`:** the post@1 field table kept; written
    to `<dir>/respond-post.source.json`.
  - **The gate:** direct and hand-back `gate_open` (`scope: respond-post`,
    `run_budget respond-post-open`); `respond-post next answer?`:
    - proceed -> `gate_record {scope: respond-post, shape: respond-post}`;
    - hold -> `Decide nothing at respond-post` -> `run_hold`;
    - iterate -> `Apply the respond-post note` -> a new open.
  - **A handed `{post}`:** the same `gate_record` with `answers` plus
    `decidedBy`.
  - **GitLab:** `Forge for the post side?`, then `respond_post_execute
    {runDb, tree, stage}`, then `respond_post_execute result?`:
    - refused -> a fix with `run_budget post-execute-fix`, else the
      off-script gate;
    - nothing held -> `run_field_set {key: hold, value: -, stage}`, then the
      report, then the close;
    - reply or resolve held -> `Off-script gate: the forge refused a reply
      or resolve` (take and iterate re-call the tool);
    - only push, mismatch or read -> `Report the held threads verbatim` ->
      `Threads held: run left open for a resume`;
    - the guard STOP on `tempted to push from the shell or force`.
  - **GitHub:** the compacted gh sub-graph from spec step 11, with its own
    `gate_record ... held` and `run_field_set hold held` on a failed push.
  - **The close:** `run_close` (own) or nothing (inherited).
  - **Red flags:** trimmed to the judgment rows.

  Delete:
  - the GitLab posted-already read and its prose;
  - the branch and `@{push}` reads on GitLab;
  - the GitLab `git_push`;
  - both reply and resolve retry loops and their four off-script pairs;
  - the respond-post record prose;
  - "What the graph cannot show"'s push and acting paragraphs, where the
    tool now owns them.

  Keep "Decide nothing at respond-post" and every surviving off-script
  origin.
- [ ] **Step 2: Static checks** as Task 4 Step 2.
- [ ] **Step 3: GREEN**: R3, R3b, R4, R5, R6, R7, R8, then R1, R2 and R7b
  again on the finished file, 5 reps each.
- [ ] **Step 4: Record and commit:** `receive-review: respond_post_execute
  post side`.

### Task 6: Release bump, whole-plugin checks, deviation table

**Files:**
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (`version`)
- Modify: `plugins/mattstack/pack/requires.json` (`minEngine`)
- Modify: `docs/superpowers/specs/2026-10-16-review-skills-design.md`
  (the deviation table)
- Modify: `red-green.md` (summary)

- [ ] **Step 1: Bump.**
  1. `git fetch origin main`, then read main's `plugin.json` version.
  2. Set this branch's version to the next patch above it.
  3. Set `minEngine` to the same string.
- [ ] **Step 2: Whole-plugin checks**, from the repo root with an isolated
  HOME and a scratch mattstack dir, exactly as `plugin-mattstack` runs them:
  - the check-dot sweep over every plugin `.md` with a dot block;
  - certify over every skill and attachment dir;
  - `bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack"
    --mattstack-dir <scratch> --strict`;
  - `bun cli.ts skills compile --dry-run --pack-dir "$PWD/plugins/mattstack"
    --mattstack-dir <scratch>`;
  - `bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin
    plugins/mattstack`;
  - `bun scripts/ci/engine-floor-check.ts --base origin/main`;
  - `bun test lib/gates/__tests__/parity.test.ts`, which proves the scripts
    are untouched;
  - `bun run purity`.

  Expected: all exit 0. A strict mcp-lint hit is fixed by naming the tool,
  never by splitting words.
- [ ] **Step 3: Deviation table.** Copy the RED and GREEN counts per
  scenario from `red-green.md` into the spec's table, with notes, plus the
  total line.
- [ ] **Step 4: Commit:** `review skills: bump to <version>, minEngine,
  deviation table`.

## Self-review notes

- **Spec coverage.** Each part of the spec has a task:
  - the run block: Tasks 2 to 5;
  - review gate sites: Tasks 3 to 5;
  - receive-review steps 1 to 8: Task 4; steps 9 to 11: Task 5;
  - caller-handed decisions: Tasks 4 and 5 (R7, R7b);
  - review steps 1 to 8: Task 3;
  - self-review: Task 2;
  - off-script gates: each task;
  - the board contract: Global Constraints and V12;
  - B1 to B21: covered by the scenarios, with B16, B17 and B20 in S13, S15
    and R4;
  - the preservation inventory: Task 1;
  - the test plan: Tasks 1 to 6.
- **Scenario renumbering.** The scenarios renumber the spec's 1 to 15 as R1
  to R8, V9 to V13 and S13 to S16, and add R3b, R7b, V11b and S16 for Review
  Focus.
