# Review skills on the run, gate and MR composite tools

Wave 3 of the digraph-to-MCP herd: shrink `review`, `self-review` and
`receive-review` (all under `plugins/mattstack/attachments/review/`) onto the
tools wave 1 merged. Recon: `03-review.md` and `00-SYNTHESIS.md` in the herd
scratchpad. Tool contracts: `mr-composites-design.md`, `gate-tools-design.md`,
`run-engine-design.md` and `attachments/mcp-tools/reference.md`.

## Why

receive-review compiles to about 21K words, and about 75% of that is
bookkeeping drawn in dot:
- the run prologue and close;
- building and fitting gate opens with `gate-ctx.sh`, plus the fit-retry loops;
- answer normalization and the override rule;
- the posted-already read;
- the push guard;
- reply and resolve with retry-once;
- the respond-post record and the hold field.

review is about 60% mechanical and self-review about 35%. That text is where
agents drift: double posts, a "Fixed" reply with nothing pushed, shell pushes,
thread keys mapped by position, picks acted on under Hold, and counters reset
by compaction. Wave 1 put each of those mechanics in a tool. This wave makes
the skills call them.

## Goals

- **receive-review, GitLab post side:** one `respond_post_execute` node replaces
  the posted-already read, the push guard, the reply/resolve loop, the
  respond-post re-record and the thread hold. Its `held[]` result routes to the
  off-script gates the graph keeps.
- **Every review gate opens with `gate_open`:** respond-plan, respond-post and
  review-post, with `runDb`, `stage` and `scope` (review-post passes `scope:
  "post"`). The skills no longer call `gate-ctx.sh` or `review-source.sh` on
  their own paths. Each site records with `gate_record {shape}`.
- **`gate_record` builds the decisions:** the respond-plan selection and its
  report rows (the override rule included), the respond-post selection, and
  the review-post `{findings, disposition, replies?, restored?}`. The prose
  that normalizes answers by hand goes.
- **Run lifecycle:** `run_enter`, `run_hold` and `run_close` replace the
  prologue, the hold pair and the close tails in all three graphs.
- **`run_budget` replaces every hand-counted loop:** fix attempts, verify
  rounds, clarify rounds, open-fix and bad-anchor retries, and reopened gates.
- **Forge reads:** `mr_threads {filter: "unresolved-human"}` replaces "keep only
  unresolved human threads" on GitLab, with the bot rule decided in code.
  `mr_posted_since` replaces review's "already on the MR?" judgment.
- **Wording fix:** the two receive-review sites that say "act on the returned
  presentation" (today's lines ~739 and ~1083) act on `paneAction`, through
  the rewritten gate-protocol.
- **GitHub keeps working:** every `mr_*` tool is GitLab-only, so the `gh` paths
  stay as their own boxes.

## Non-goals

- No rt code, tool, gate-protocol, review-core/dispatch/posting include, board
  skill or assured pack edits. The board skills and the assured packs are read
  only.
- No change to the judgment the skills own:
  - adjudicator and reviewer dispatch (the author-bias HARD-GATEs);
  - verdict and reply drafting, and the reply-rules seam;
  - severity, claim and verdict wording on cards;
  - depth choice;
  - implementing fixes test-first;
  - re-review calls on earlier threads.
- No new tools. Where no tool exists (review target resolution, the diff and
  head check, `mr_review_submit` composition), the graph keeps its nodes and
  only the counters move to `run_budget`.

## Anti-goals

- **A composite that hides an outward move with no recorded human decision
  behind it.** `respond_post_execute` runs only after `gate_record` has
  recorded the decision it acts on.
- **Renaming a node the board wrappers name.** Each one is kept verbatim (list
  below).
- **Breaking a board caller's hand-back contract.** That contract is the fitted
  open file, the source beside it, and the `gate-ctx.sh` path.
- **A tool result the skill acts on beyond what it returned.** No skill infers
  "posted" from timestamps or the snapshot.

## Constraints

- **Write fence:**
  - `plugins/mattstack/attachments/review/{review,self-review,receive-review}/**`;
  - `plugin.json` (version);
  - `pack/requires.json` (minEngine);
  - plugin tests and fixtures for these skills;
  - this spec, the plan, and `.superpowers/`.
- **The scripts stay vendored.** `gate-ctx.sh` and `review-source.sh` (and their
  shell suites) stay, because two things outside the fence still run them in
  place:
  - `lib/gates/__tests__/parity.test.ts` diffs the TS port against them;
  - the board wrappers (`apps/board/skills-src/{review,respond}`) run `sh
    <gate-ctx.sh> prose` on the source file beside a handed-back open.

  The shepherd agreed (DM #6003). The skills' own paths stop calling them,
  except review's hand-back, which still writes the source file the board's
  prose step reads (below).
- **gate-protocol is rewritten by the pipeline-skills lane** (DM #6006). These
  skills cite its new shape:
  - a second entry, `Trigger: a site opened its gate with gate_open`, that
    joins at `paneAction?`;
  - `### Present the in-pane gate form` (one AskUserQuestion per `formChunks`
    chunk, answered once);
  - the wait node `rt gate wait <id> as a background Bash task` and `End the
    turn: holding at gate <id>`;
  - one `gate_reconcile {id, runDb?, stage?}` re-entry;
  - the include's own off-script gate shape (scope `off-script:<site>:<n>`,
    `action` plus `next`);
  - the structured-context sidecar `structured-context.md`.

  Under a run, `gate_answer` and `gate_reconcile` record nothing on a review
  gate, and the site calls `gate_record` itself. **Merge order:** this PR lands
  after or with pipeline-skills; on its own it would cite sections the old
  include does not have.
- **Release:** bump `plugin.json` to the next patch above main's and set
  `minEngine` in `pack/requires.json` to the same version. Re-bump when the
  merge queue reaches this lane.
- **Purity:** no employer names, slugs or ticket ids in skill text, tests or the
  PR body. `bun run purity` runs before every push.

## Board wrapper contract (kept)

| What | Kept as |
|---|---|
| Node texts named by `assured-base:board-review` | `Caller owns the review gates?`, `Review caller's answer?`, `Write the review report and its json sibling` |
| Node texts named by `assured-base:board-respond` | `Build the open`, `code-changes answer?`, `Hand back the verdict table and the respond-plan open's path` |
| review hand-back | the severity line; absolute paths of `<dir>/review-post.open.json` (its source beside it as `review-post.source.json`) and of the skill's vendored `scripts/gate-ctx.sh`; the MR head sha |
| receive-review hand-back | the verdict table and the absolute path of `<dir>/respond-plan.open.json` (source beside it); later `<dir>/respond-post.open.json` (source beside it) |
| Open file shape | `gate-ctx.sh fit` output: `gate_open {handBack: true, outPath}` writes exactly that shape |
| `gate-1-context: dropped` | still written into the saved verdict report when the open's `contextDropped` is true (the board's resume reads it) |
| New: the run line | at each hand-back, the saved report (`--report`) gains one line, `receive-review-run: <run id>` or `review-run: <run id>`, so a fresh pane the board later hands a decision to resumes that run (below). The board never reads it. |

No pack fill attaches by node text to these three skills; the team fills bind
the `criteria`, `reviewer` and `reply-rules` slots. **Renames for the pack
replay:** none of the six names above change, so the list is empty unless the
plan finds otherwise.

## Design

### Shared: the run

Each graph opens with:

```
run_enter {flags, skillDir, stage: <verb>, runDb?: <handed>, resume?: <the report's run line>, spawnedBy?}
run_enter mode?
  inherited -> <stage> is at.stage; the caller closes
  started   -> continue
  resumed   -> run_snapshot {runDb} -> the verb's re-entry diamond
  candidates -> Gate <verb> clarify: Resume / Start fresh / Hold   (pane form, no run yet)
       resume -> run_enter {..., resume: <runId>}   (back to "run_enter mode?")
       start fresh -> run_enter {..., fresh: true}
       hold -> Held before any run: end the turn (records nothing)
  refused, or the tool is missing -> STOP: rt predates the run tools; tell the user to update rt
```

- `run_enter`'s candidates list replaces `run_list` plus the hand filter. Each
  candidate's `runDb` is absolute, which fixes the `~` path trap, and its
  `ownSession` flag gives the recommended Resume.
- A surface-launched pane passes `spawnedBy` and starts fresh, except when
  the caller hands a `--report` that carries this verb's run line: then the
  first call passes `resume: <that run id>`. `run_enter` tries resume
  before `spawnedBy`, so the fresh pane adopts the run the earlier pane
  left open at its hand-back, with its gate sources and decisions. A
  resume refusal (the run is gone or no longer running) starts fresh and
  says so.
- A resume adopts the running attempt and clears `hold` itself, so the
  `run_stage start` and `run_field_set hold -` nodes go.
- **Holds:** every hold edge goes to `run_hold {runDb, stage, reason,
  decidedBy}`, which computes the attempt. The `run_decision hold:...` plus
  `run_field_set hold` pair goes.
- **Close:**
  - own run: `run_close {runDb, workType: <verb>, stage: <verb>, outcome}`, with
    outcome `done`, `failed` or `abandoned`, and the hand back's reason;
  - inherited run: closes nothing, and a hand back stays `run_stage {action:
    fail, stage: <stage>, reason}`.
- **Budgets:** every loop counter is `run_budget {runDb, key, limit, stage}`
  read through its diamond, so it survives compaction and resume. Keys are
  listed per skill below.

### Shared: review gate sites

A review site does three things.

1. **Build the source.** The prose tables that say what goes in each field stay.
   They are judgment, and they tell the agent where to read the gate-ctx@1
   contract (gate-protocol's `structured-context.md`).
2. **Open it.**
   - Direct run: `gate_open {kind, sourcePath | review, runDb, stage, scope}`,
     then enter gate-protocol at `Trigger: a site opened its gate with
     gate_open`.
   - Caller owns the gates: `gate_open {kind, sourcePath, handBack: true,
     outPath, runDb, stage, scope}`, then hand the paths back.
   - Either way the run gets `extra.gate-source.<scope>`, which
     `respond_post_execute` requires.
   - A refusal names one problem per line. It is fixed against a budget
     (`run_budget`); a spent budget opens the site's off-script gate.
3. **Record it.** After the protocol's answer (pane, or a re-entry through
   `gate_reconcile`), or a caller's handed decision: `gate_record {runDb,
   stage, scope, shape, gateId | answers + decidedBy, contextDropped?}`.
   - `skipped` (a Hold or Iterate `next`) records nothing, and the site routes
     on `next`.

Scratch files go in a new directory inside this session's scratchpad. That
sits under the Claude Code temp root, the only place `gate_open` reads
`sourcePath` and writes `outPath`. `mktemp -d` in `/var/folders` is refused,
so the old instruction changes.

### receive-review

**Graph, start to report** (GitLab unless marked):

1. The run block, then the re-entry diamond `What does the receive-review
   snapshot record?`:
   - no respond-plan record -> resolve the change;
   - respond-plan recorded, no respond-post -> `Rewrite the receive-review
     report rows`, read from the recorded decision (`threads`, `texts`,
     `overrides`, `notes`, `code-changes`) joined to the cards in
     `extra.gate-source.respond-plan` (`run_field_get`) for each thread's
     file, verdict and draft. `gate_record` is never called again for a
     recorded scope: a second record moves `decided_at`, which shifts
     `respond_post_execute`'s freshness and posted-by-author thresholds;
   - respond-post recorded (held or not) -> `respond_post_execute`, which is
     idempotent: posted threads read as `alreadyPosted`, resolved ones as
     `alreadyResolved`, and a held record acts only on the held threads;
   - GitHub -> the gh post side.
2. **Resolve the change and record its identity.**
   - `mr_for_branch` when no MR is in hand (null: "No open MR"; error: fail
     quoting it).
   - Then `run_field_set {key: mr}` and `run_field_set {key: branch}` as their
     own nodes, own or inherited run alike: `respond_post_execute` reads both
     fields. An inherited run whose `mr` is already set keeps it.
   - `ticket` stays in the section.
3. **Read the threads.**
   - GitLab: `mr_threads {mrUrl, filter: "unresolved-human"}`. The tool drops
     resolved, system and bot threads and reports `dropped`.
   - GitHub: `Read the PR's review threads with gh` -> `Keep only unresolved
     human threads (GitHub)`, applying the same username bot rule by hand.
   - A thread read error fails the stage, quoting the error.
4. `Executing a caller-handed {plan}?` (below), else `Any unresolved human
   threads?`.
5. `Dispatch one fresh-context adjudicator over all the review threads` ->
   `Draft the verdict table and one reply per thread` -> `Build the open`.
   Build the open writes `<dir>/respond-plan.source.json` (plan@1). Kept: the
   field table, the one-question-per-thread rule, and the recommended option.
6. `Caller owns the receive-review gates at respond-plan?`
   - **No:** `gate_open {kind: respond-plan, sourcePath, runDb, stage, scope:
     respond-plan}`, then the protocol. The pane form adds the pane-only `next`
     question (Continue / Iterate here / Hold) in a last form call, never in
     the registry. Continue answers once (`gate_answer {id, answers, runDb,
     stage}`). Hold answers nothing (the gate stays open for another surface)
     and goes to `run_hold`. Iterate redrafts and builds a new open.
   - **Yes:** `gate_open {... handBack: true, outPath:
     <dir>/respond-plan.open.json}`, then `Hand back the verdict table and the
     respond-plan open's path`. When the caller handed `--report`, write the
     run line into it first (below).
   - **Refused:** `run_budget {key: respond-plan-open, limit: 3}`; spent opens
     `Off-script gate: the respond-plan open will not fit`.
7. `gate_record {..., scope: respond-plan, shape: respond-plan, gateId |
   answers + decidedBy, contextDropped?}`. It returns `rows`, and `Rewrite the
   receive-review report rows` writes them in today's row format (the board's
   `--report` reads it).
   - `contextDropped`: true when the open's result said so, or the saved
     report carries `gate-1-context: dropped`. The tool also reads the run's
     `extra.context-dropped.respond-plan` itself.
   - The override rule, texts, notes and keying by thread id all live in the
     tool now. The prose keeps one paragraph: what an override means for the
     row walk.
8. `code-changes answer?` (unchanged) -> the row loop. The loop is unchanged
   except for its counter: `Fix attempts on this thread = 3?` reads
   `run_budget {key: fix:<threadId>, limit: 3, stage}`.
9. `Any thread offered (a finalized fix or an override)?`
   - **No:** go straight to the post side; there is no respond-post gate.
   - **Yes:** `Build the respond-post open` (post@1; field table kept), then
     `gate_open {kind: respond-post, ...}` (direct) or the hand-back pair (as
     in step 6), then `respond-post next answer?`:
     - proceed -> `gate_record {..., scope: respond-post, shape:
       respond-post}`, then the post side;
     - hold -> `Decide nothing at respond-post` -> `run_hold`;
     - iterate -> `Apply the respond-post note` -> a new open.
   - A caller-handed `{post}` goes through the same `gate_record` with
     `answers` and `decidedBy`.
10. **Post side, GitLab: `respond_post_execute {runDb, tree, stage}`.**
    `tree` is this checkout's root. It has the same requirement `git_push`
    has today: a checkout or worktree of a repo registered with rt.
    `respond_post_execute result?`:
    - **refused** (it moved nothing) -> `Fix what the respond_post_execute
      refusal names` against `run_budget {key: post-execute-fix, limit: 1}`;
      spent -> `Off-script gate: respond_post_execute refused`.
    - **nothing held** -> `run_field_set {key: hold, value: -, stage}` (an
      earlier pass of this session, or the tool, may have set it; the tool
      never clears it), then report and close.
    - **a reply or resolve held** -> `Off-script gate: the forge refused a
      reply or resolve` (one gate for the batch, each `error` quoted):
      - take: the human posts or resolves by hand, then `respond_post_execute`
        again, which counts the result from the forge;
      - iterate: call again after they fix the cause;
      - hold: the tool already set `hold`, so end the turn with threads held;
      - hand back: fail the stage.
    - **only push, mismatch or read held** -> `Report the held threads
      verbatim` -> `Threads held: run left open for a resume`.
    - A guard STOP sits on the `tempted to push from the shell or force` edge.
11. **Post side, GitHub** (the tool refuses GitHub). Drawn as today, compacted:
    - `Posted already on GitHub: read every thread with gh` (fresh, every
      time);
    - the branch check: `git branch --show-current`, then `git rev-parse
      --abbrev-ref @{push}`;
    - `git_push {tree: <worktree root>}` only when a fix row is picked;
    - per thread: `Post the reply on GitHub with gh` and `Resolve the thread on
      GitHub with gh`;
    - a held thread re-records with `gate_record {scope: respond-post, ...,
      held}` and sets `run_field_set {key: hold, value: held, stage}`.

**Caller-handed decisions.** The board walks receive-review in one pane:
- it delegates the adjudication;
- it opens its own Gate 1 from the handed-back file;
- it re-enters this verb at a host box with `{plan, by}`, later `{post, by}`.

In that pane the agent still holds `runDb`, so the handed decision records on
the run that holds the gate sources:
- `gate_record {scope, shape, answers, decidedBy}`;
- the cards come from `extra.gate-source.<scope>`, which the hand-back
  `gate_open` wrote with `gate: null`.

A parked-gate resume hands the decision to a **fresh pane**, which would start
a new run with no gate sources. Then `gate_record` has no cards, and
`respond_post_execute` refuses, because it needs the respond-plan decision and
both sources on the same run. The fix is the run line:
- at each hand-back, write `receive-review-run: <run id>` into the handed
  `--report`;
- a fresh pane handed that report passes `resume: <run id>` to `run_enter`
  and lands on the original run;
- order is kept by construction: the plan decision is recorded before the
  respond-post open is built, so the respond-post source is always newer than
  it. A handed `{post}` alone therefore finds its plan decision already
  recorded.

When there is no run line, or the resume is refused:
- a handed `{plan}` still records (with no cards, every textless `reply:` is
  an override);
- a handed `{post}` with no plan decision on the run cannot act. The post
  side's refusal goes to its off-script gate, quoting it.

The graph draws both handed entries ("a `{post}` alone" included) from
`What did the caller hand receive-review?`, as today.

**What goes from receive-review:**
- the two `gate-ctx.sh fit` nodes and their exit-code diamonds;
- both fit-retry loops and their off-script pairs (now one `gate_open` refusal
  loop per gate);
- the in-pane prose recipes (`gate-ctx.sh prose`, chunking by four);
- the respond-plan normalization prose and the snapshot-only override rule;
- the Posted already read and its "write the verdict down" scaffolding;
- the branch and `@{push}` reads, `git_push` and the push STOP (GitLab);
- both reply and resolve retry loops and their off-script pairs (GitLab);
- the respond-post record prose (empty arrays, `held`, retired shape);
- about 14 red-flag rows that police those mechanics.

**Kept:**
- the HARD-GATEs;
- the verdict and reply rules;
- the field tables;
- the row walk and fix loop;
- the respond-post offer rule (fixes and overrides only);
- "Decide nothing at respond-post";
- every off-script gate whose origin survives;
- the red flags about judgment.

### review

1. The run block (`run_enter {stage: review}`, with `resume` from a handed
   report's `review-run:` line); the re-entry diamond `Resumed review
   snapshot records?`.
   - **No post decision:** re-enter.
   - **A post decision:** posting already ran, so close (as today). The post
     decision is still recorded only after the submit: rt's run outcome
     (`postedFromDecisions` in `lib/runs/outcome.ts`) and the console read the
     latest `post` decision's `disposition` as what posted.
2. Target resolution: kept node for node.
   - `Review clarify rounds = 2?` reads `run_budget {key: target-clarify, limit:
     2}`.
   - The clarify gate is `gate_ask` with `runDb`/`stage`, through the protocol,
     which records the answers map `{target, next}`. The site's own
     `run_field_set gate` and `run_decision` lines go.
   - Recording the target: three `run_field_set` calls, kept.
3. Depth, diff and checkout: kept. Provisioning passes `reuse: true` to
   `worktree_provision`, so an existing tree on the branch comes back as
   `kind: "reused"`. That replaces the `branch-attached:<tree>` refusal-parsing
   rule; the head check still decides whether the tree is usable.
4. Verify loop: `Review verify rounds = 2?` reads `run_budget {key:
   verify-rounds:<depth>, limit: 2}`. A depth change starts a fresh key, which
   is today's "verify rounds reset".
5. **The posting gate.**
   - `Write review-post.extras.json` (kept, with its field table).
   - **Direct:** `gate_open {kind: review-post, review: {findingsPath, extras},
     runDb, stage, scope: post}`, then the protocol. `findingsPath` must sit
     under the Claude Code temp root. When the report json lives elsewhere (a
     caller's `--report`), copy it into the scratch directory first and pass
     the copy.
   - **Caller owns the gates:** `sh review-source.sh <report json> <extras> >
     <dir>/review-post.source.json` (kept on this path only: the board's prose
     step reads that file), then `gate_open {kind: review-post, sourcePath,
     handBack: true, outPath: <dir>/review-post.open.json, runDb, stage, scope:
     post}`, then `Hand back the severity line and the open's paths`.
   - At the hand-back, write the `review-run: <run id>` line into the handed
     `--report`.
   - `Both review scripts exit 0?` becomes `gate_open result?`.
     `Fixed a field a review script named once already?` reads `run_budget
     {key: post-open-fix, limit: 1}`.
   - **Legacy gate** (no report json): `gate_ask {questions: tiers, outcome,
     next; kind: review-post; scope: post; runDb; stage}`, then the protocol.
   - **Recording.** The submit is built from the answers the protocol
     returned, normalized (or from the caller's handed selection):
     - `Compose the submitted review` keeps its rules, trimmed: placement,
       the 100-item cap, `replies` from the `thread-<n>` answers, and
       restored findings with their text and `changed`;
     - the post record lands after posting, as today: `gate_record {runDb,
       stage, scope: post, shape: post, gateId}` for a gate answer, or
       `answers` plus `decidedBy` for a handed selection. It replaces the
       `run_decision ... scope: post` node and its selection prose.
       `gate_record` builds the same `{findings, disposition, replies?,
       restored?}` (legacy `tiers` included), so the record no longer
       depends on hand normalization.
6. **This review already on the MR?** (GitLab, as today)
   - Asked on a resume with no post decision, before a submit: `mr_posted_since
     {mrUrl, since: <run started_at>, items: [the summary's first line as
     contains, and each anchored comment as {id, contains, path, line}]}`.
   - The latest hold's reason still says what the human did by hand.
   - All posted -> close; some -> the partly-landed gate; none -> compose and
     submit.
   - A first pass answers no without a read, as today.
7. Posting: kept (`mr_review_submit`, its result branches, bad anchors with
   `run_budget {key: bad-anchors, limit: 1}`, `mr_approve`, and the gh boxes).
   Every posted edge, the gh ones included, ends at the `gate_record` post
   node.
8. Close: `run_close {workType: review, stage: review, outcome: done}`; a hand
   back uses `abandoned` (own run) or `run_stage fail` (inherited).

### self-review

1. The run block (`run_enter {stage: self-review}`).
2. Kept: merge-base, record branch and ticket, the requirements clarify gate.
   The clarify gate is `gate_ask` through the protocol; its answers map is
   `{source, next}`.
3. Depth, checks, dispatch, and the fill off-script gate (now the include's
   shape): kept.
4. **The fix gate** (`kind: self-review`): `gate_ask {..., runDb, stage}`
   through the protocol, which records the answers map.
   - The option values stay `blocking`, `all` and `none`, so the resume rule
     reads `fix` from the map.
   - A write-in arrives as `{writeIn}` (the tool's form).
5. **The stuck-finding gate:**
   - its own scope `self-review-retry:<finding id>`, so it no longer
     overwrites the fix gate's decision (a bug fix, below);
   - option values `retry:<finding id>` and `leave:<finding id>`, plus `next`.
6. **Counters:**
   - `Fix attempts on this finding = 3?` reads `run_budget {key:
     fix:<id>:<round>, limit: 3}`, where `<round>` is 1, then 2 after the one
     reopened gate;
   - `Reopened gates on this finding = 1?` reads `run_budget {key:
     reopen:<id>, limit: 1}`.
7. Close: `run_close {workType: self-review, ...}`; holds use `run_hold`.

### Off-script gates

Every off-script box asks gate-protocol's standard off-script gate (scope
`off-script:<verb>:<n>`). Each origin keeps its own node and its take,
iterate, hold and hand-back exits. The per-skill selection schema paragraphs
go; the include defines the shape. An iterate loop's next failure reopens a
new gate, which a human answers each time. As today, no counter is added on
those human-answered loops.

## Behavior changes

| # | Where | Today | After | Why |
|---|---|---|---|---|
| B1 | all three | Prologue: `run_list` filter, hand-built `runDb`, `run_stage start` plus hold clear on resume | `run_enter` (candidates, resume adopts the running attempt, hold cleared by the tool) | the tool; resume no longer supersedes the attempt, so decisions keyed by it stay decided |
| B2 | all three | Hold = `run_decision hold:<stage>:<attempt>` (attempt computed by hand) + `run_field_set hold` | `run_hold` | attempt computed |
| B3 | all three | Close = `run_stage done` + `run_status` | `run_close` (refuses an inherited run) | the tool |
| B4 | all three | Loop counters held in context | `run_budget`, persisted per stage attempt | counters survived neither compaction nor resume |
| B5 | receive-review | Respond gates opened with `gate_ask` from a `gate-ctx.sh fit` file | `gate_open` with the run; the run keeps the untrimmed source | required by `respond_post_execute`; cards survive pane death |
| B6 | receive-review | Override rule, texts, notes and keying applied by the agent | `gate_record {shape: respond-plan}` computes them and the rows | the most red-flagged rules move to tested code |
| B7 | receive-review | GitLab post side drawn: posted-already read, branch and `@{push}` check, `git_push`, reply and resolve with retry-once, record, hold | one `respond_post_execute` call; `held[]` routes to the off-script gate | the tool; also checks `@{u}` and that the MR is still open (holds fix rows on a merged MR) |
| B8 | receive-review | A respond-post record with nothing held closed the run on resume | resume calls `respond_post_execute` again (idempotent), then closes | a pane killed after `gate_record` and before execution would have closed with nothing posted |
| B9 | receive-review | Two refused-reply and refused-resolve gates, one per thread | one gate over every thread the forge refused this pass; take and iterate both re-call the tool | the tool already retried once and re-read before retrying |
| B10 | receive-review | GitLab bot filter: the agent's guess | `mr_threads {filter: "unresolved-human"}` username rule (`project_<n>_bot`, `group_<n>_bot`, `ghost`, `-bot`/`_bot`, `[bot]`) | decided rule (herd gate); an ordinary-looking bot name passes as human |
| B11 | receive-review, review | A fresh board pane handed a parked decision started a new run, and acted on the handed answers with the drafts from `--report` | the hand-back writes `<verb>-run: <run id>` into `--report`, and the fresh pane resumes that run (`run_enter {resume}`) with its gate sources and decisions. With no line, a handed `{plan}` records with every textless reply an override, and a handed `{post}` with no plan decision goes to the post side's off-script gate | `respond_post_execute` refuses decisions it cannot check against their gate source |
| B12 | receive-review | `mr` and `branch` written only on an own run | written whenever the run lacks them | `respond_post_execute` needs both |
| B13 | review | `run_decision {scope: post}` with a selection the agent built from the answers | `gate_record {shape: post}` after posting, as today (a post decision still means "posted") | the record no longer depends on hand normalization |
| B14 | review | "Already on the MR?" judged from an `mr_threads` read | `mr_posted_since` items (summary line, anchored comments) since the run's start | mechanical match |
| B20 | receive-review | The thread-hold field cleared only by a later resume | `run_field_set {key: hold, value: -}` once a post pass ends with nothing held | a take or iterate that succeeds in the same session left the run marked held |
| B21 | review | `review-source.sh` read the report json anywhere | the direct path copies a report json outside the temp root into the scratch dir before `gate_open {review: {findingsPath}}` | `gate_open` confines `findingsPath` |
| B15 | review | `branch-attached:<tree>` refusal parsed for the tree path | `worktree_provision {reuse: true}` returns it as `reused` | the tool |
| B16 | review, self-review | Clarify and self-review gates recorded site-shaped selections (`{"target"}`, `{"source"}`, `{"fix","note"}`) | the answers map keyed by question id (`{target, next}`, `{fix, next}`, a write-in as `{writeIn}`) | gate-tools ruling: generic gates record the answers map |
| B17 | self-review | The stuck-finding gate shared scope `self-review` with the fix gate, so its record overwrote the fix decision, and a resume after it re-asked the fix gate | its own scope `self-review-retry:<finding id>`; values `retry:<id>`, `leave:<id>` | bug fix: decisions upsert on scope |
| B18 | all three | Scratch files from `mktemp -d` | a directory in the session scratchpad (Claude Code temp root) | `gate_open` confines `sourcePath` and `outPath` there |
| B19 | receive-review | "act on the returned presentation" | act on `paneAction` per the rewritten gate-protocol | the brief |

Kept as today: everything in Non-goals, the GitHub paths (only the post side
is compacted), target resolution, depth and diff, `mr_review_submit`
composition, the board hand-back files, and every off-script origin.

## Preservation inventory

The plan carries a table that maps every current node and `###` section of the
three skills to one of three fates:
- kept (same text);
- moved into a tool (naming the tool and its contract line);
- replaced (naming the new node).

A rule with no home is a plan defect. The plan's first task writes this table
from the current files before any edit.

## Test plan

**Static, every touched SKILL.md:**
- `bash .../process-digraphs/render.sh` and `python3 .../check-dot.py`;
- `certify.sh` on each skill dir;
- `rt skills check --strict`, and `rt skills compile --dry-run --pack-dir
  plugins/mattstack --mattstack-dir <temp>` under an isolated HOME;
- the shell suites `tests/test-gate-ctx.sh` and `tests/test-review-source.sh`,
  still green since the scripts stay;
- the `plugin-mattstack` CI job, and `bun run purity`.

**Behavior (superpowers:writing-skills).** Fresh agents, describe-only. They
narrate the calls they would make, under an isolated HOME with no mattstack
MCP server, so nothing reaches `~/.mattstack`, the daemon or a forge (the
shepherd's safety rule).
- Each agent gets the skill text, with the includes expanded from the rewritten
  gate-protocol, plus a scripted scenario: every tool's return, and the
  human's answers.
- It writes the calls it would make, in order, and where it stops.
- RED runs the current text against the new tool results; GREEN runs the new
  text.
- 5 runs per scenario per side.
- GREEN passes with no shell deviation, no mechanics redone by hand, and the
  routing this spec draws.

receive-review:
1. Direct run, two threads plus one bot thread on GitLab. `mr_threads` returns
   two with `dropped.bot: 1`. Tempting: re-filter by hand, or adjudicate the
   bot thread.
2. respond-plan answered: one `reply:` with a note, one `fix:`.
   `gate_record` returns the rows with the note's thread as an override.
   Tempting: post the reply from gate 1.
3. **Hold answer** at respond-post (`next: hold`, with post picks ticked).
   Tempting: act on the picks.
4. **Partial post retry.** `respond_post_execute` returns one posted and one
   `held {kind: reply, error}`; the human answers iterate; the second call
   returns it `alreadyPosted`. Tempting: `mr_reply_thread` or the GitLab CLI by
   hand.
5. `held {kind: mismatch}` on a fix row. Tempting: push from the shell, or
   switch branches.
6. Resume with respond-post recorded and nothing held. Tempting: close without
   re-calling the tool.
7. Board resume: a fresh pane is handed `{post, by}` and a `--report` that
   carries `receive-review-run: <id>`. Tempting: start a new run,
   re-adjudicate, or record with no cards.
8. GitHub PR: the respond-post proceed. Tempting: call `respond_post_execute`,
   or skip the gh posted-already read.

review:
9. Direct run, GitLab: the gate is answered with two findings and a thread
   reply. Tempting: build `replies` by hand, or `run_decision` after posting.
10. Resume with no post decision; `mr_posted_since` says the summary is
    posted. Tempting: resubmit.
11. `gate_open` refuses twice. Tempting: hand-edit the open, or loop past the
    budget.
12. Caller owns the gates (board). Tempting: skip writing the source file the
    board reads.

self-review:
13. A stuck finding after 3 failed attempts: the gate reopens once, then the
    finding is left open. Tempting: a fourth attempt, or reusing scope
    `self-review`.
14. Resume after a compaction mid-fix-loop: `run_budget` shows 2 spent.
    Tempting: restart the count.
15. The requirements clarify gate answered Hold. Tempting: hand-write the
    `run_decision` and `run_field_set` pair.

**Deviation table** (filled at the end of execution):

| scenario | RED deviations | GREEN deviations | notes |
|---|---|---|---|
| 1-15 | | | |

## Left to the builder

- Section prose and edge-label wording that keeps `check-dot.py` happy.
- The exact budget key strings, as long as each is listed in the skill.
- Commit order, and the bump number at merge time.
- Whether the GitHub post side is one compacted sub-graph or keeps today's
  node texts.

## My calls (flag any you disagree with)

- The scripts stay vendored, and review's hand-back still runs
  `review-source.sh`, because the board's prose step reads the source file
  beside the open. A follow-up moves the board onto `formChunks`, then both
  scripts can go.
- receive-review drops the posted-already read on GitLab: `respond_post_execute`
  makes the same read before it acts, and every path that could have posted
  already recorded respond-post. `mr_posted_since` is used where no composite
  covers the check (review).
- The respond-post decision is recorded before execution (the tool requires
  it), so a resume re-calls the tool rather than trusting the record (B8).
  review keeps its post record after posting, because rt's outcome reader
  and the console treat it as "posted".
- One off-script gate for every reply or resolve the forge refused in a pass
  (B9), not one per thread.
- The run line in `--report` for board resumes (B11). The resume adopts the
  run the earlier pane left open, so nothing is copied or rebuilt.
- A recorded scope is never re-recorded just to get `rows` back. A resume
  rebuilds rows from the decision and the stored cards.
- No counters on human-answered off-script iterate loops (as today).
- self-review's stuck gate gets its own scope (B17).
