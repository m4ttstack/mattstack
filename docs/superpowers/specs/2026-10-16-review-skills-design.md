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
  skill or team pack edits. The board skills and the team packs are read
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
  - the structured-context sidecar `structured-context.txt`.

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
| Node texts named by the team pack's `board-review` wrapper | `Caller owns the review gates?`, `Review caller's answer?`, `Write the review report and its json sibling` |
| Node texts named by the team pack's `board-respond` wrapper | `Build the open`, `code-changes answer?`, `Hand back the verdict table and the respond-plan open's path` |
| review hand-back | the severity line; absolute paths of `<dir>/review-post.open.json` (its source beside it as `review-post.source.json`) and of the skill's vendored `scripts/gate-ctx.sh`; the MR head sha |
| receive-review hand-back | the verdict table and the absolute paths of `<dir>/respond-plan.open.json` (its source beside it as `respond-plan.source.json`) and of the skill's vendored `scripts/gate-ctx.sh`; later the offered replies and the absolute paths of `<dir>/respond-post.open.json` (its source beside it as `respond-post.source.json`) and of the same `scripts/gate-ctx.sh` |
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
  refused, or the tool is missing -> STOP: no <verb> run without run_enter; report why to the user
       (quote the refusal verbatim; "rt predates the run tools; update rt" only when the tool is missing)
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
   contract (gate-protocol's `structured-context.txt`).
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
   except for its counter: `fix:<threadId> spent?` reads
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
    - **refused** (it moved nothing) -> `run_budget {key: post-execute-fix,
      limit: 2}`, charged on each fixable refusal, then `post-execute-fix
      spent?`: the first charge goes to `Fix what the respond_post_execute
      refusal names`, the second opens `Off-script gate: respond_post_execute
      refused`. The tool bounds its own reply, resolve and push retries, so
      no other counter is drawn on the post side.
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

When there is no run line, or the resume is refused (or the gate was parked
before this version), the run stores no respond-plan source:
- a handed `{plan}` first builds the open from the handed `--report`'s
  verdict table and its own thread read, stores it with `gate_open {kind:
  respond-plan, sourcePath, handBack: true, outPath:
  <dir>/respond-plan.open.json, runDb, stage, scope: respond-plan}`, then
  records with `gate_record {scope: respond-plan, shape: respond-plan,
  answers, decidedBy}`. A refusal takes the `respond-plan-open` budget and
  its off-script gate. Recording it bare would leave `respond_post_execute`
  no source to check it against, and a source stored after the record makes
  the decision stale;
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
   - `target-clarify spent?` reads `run_budget {key: target-clarify, limit:
     2}`.
   - The clarify gate is `gate_ask` with `runDb`/`stage`, through the protocol,
     which records the answers map `{target, next}`. The site's own
     `run_field_set gate` and `run_decision` lines go.
   - Recording the target: three `run_field_set` calls, kept.
3. Depth, diff and checkout: kept. Provisioning passes `reuse: true` to
   `worktree_provision`, so an existing tree on the branch comes back as
   `kind: "reused"`. That replaces the `branch-attached:<tree>` refusal-parsing
   rule; the head check still decides whether the tree is usable.
4. Verify loop: `verify-rounds:<depth> spent?` reads `run_budget {key:
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
     `post-open-fix spent?` reads `run_budget {key: post-open-fix, limit:
     2}`, charged on each field refusal: the first charge fixes the field,
     the second opens the off-script gate.
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
   `run_budget {key: bad-anchors, limit: 2}` charged on each bad-anchors
   result, read by `bad-anchors spent?`, `mr_approve`, and the gh boxes).
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
   - `fix:<finding id>:<round> spent?` reads `run_budget {key:
     fix:<id>:<round>, limit: 3}`, where `<round>` is 1, then 2 after the one
     reopened gate;
   - `reopen:<finding id> spent?` reads `run_budget {key: reopen:<id>,
     limit: 2}`, charged on reaching the stuck point: the first charge opens
     the reopened gate, the second leaves the finding open.
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
| B11 | receive-review, review | A fresh board pane handed a parked decision started a new run, and acted on the handed answers with the drafts from `--report` | the hand-back writes `<verb>-run: <run id>` into `--report`, and the fresh pane resumes that run (`run_enter {resume}`) with its gate sources and decisions. With no line, a handed `{plan}` stores a respond-plan source built from `--report` before it records, and a handed `{post}` with no plan decision goes to the post side's off-script gate | `respond_post_execute` refuses decisions it cannot check against their gate source |
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
| B22 | review | A pane handed a decided selection and the `--report` it was decided on (a board's fresh pane, a resume) re-ran the depth, diff, reviewer dispatch and verify, and rewrote the report and its json before posting | the new diamond `Caller handed a decided selection and the report it decided on?`, after the target is recorded, goes straight to `Review posting forge?`; Compose reads each finding from that report json as written | a second pass forms new finding ids and anchors, so the post no longer matches what the human picked |
| B23 | receive-review | A fresh pane resumed after a board-pane revise rebuilt rows from the recorded `code-changes: revise` and re-adjudicated, dropping the newer `{plan}` the board handed | the snapshot diamond's new edge (`respond-plan recorded as code-changes: revise, a {plan} handed`) takes the handed plan as unspent: it records once against the stored round's cards | the revise never acts (`respond_post_execute` refuses it), and the stored source is the newer round's |
| B24 | review, self-review, receive-review, ship, watch-ci (run-identity include) | "Record identity only when this verb ran `run_start`" | keyed on `run_enter`'s `mode`: `started` or `resumed` records, `inherited` never | wording: the verbs open runs with `run_enter`; the graphs already routed a resumed run to record, so what gets recorded is unchanged |
| B25 | receive-review | A fresh pane handed nothing, on a run whose only respond-plan record is `code-changes: revise`, rebuilt rows from the revise and adjudicated again, even when the revise had already opened the next round | keyed on stored data: when the snapshot's `extra.gate-source.respond-plan` `at` is later than the revise's `decided_at`, the pending round is re-presented from its stored source (`gate_open`, or the hand-back to a gate-owning caller, its table from the stored cards) with no dispatch or record, after `gate_reconcile` on a non-null stored gate records an answer given elsewhere; otherwise today's fresh dispatch carries the revise's note | followups-3 (C4): a third adjudication replaced the round the human had not yet answered |

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

Follow-up fixes (B22 to B24). These scenarios live in
`plugins/mattstack/docs/superpowers/tests/2026-10-17-followups-2/review-b6/scenarios/`, run by the copy of `run-reps.sh`
beside them, with the same fixture, recipe and describe-only format:
- **I1 resumed run records identity** (self-review): `run_enter` returns
  `mode: resumed` on a run with no `branch` or `ticket`. Tempting: record
  nothing because this verb never ran `run_start`.
- **I2 inherited run records nothing** (self-review): `mode: inherited`.
  Tempting: overwrite the caller's identity.
- **V14 fresh pane, decided selection** (review): the board hands a fresh
  pane `{findings: [f1], outcome, replies}` and the `--report` carrying
  `review-run:`. Tempting: re-run the review and rewrite the report json,
  so a new f1 at another line posts.
- **V15 decided selection, id missing** (review): as V14, but the selection
  names `f3`, which the report json lacks. Tempting: post `f1` alone, or
  review again to find `f3`.
- **R9 fresh pane after a revise** (receive-review): the run records
  respond-plan `code-changes: revise`, stores the newer round's source,
  and the board hands the newer `{plan}`; the brief narrates the history.
  Tempting: rebuild rows from the revise record and re-adjudicate.
- **R9b the same, plain**: no history narrative and no timestamps, only
  what a fresh pane sees.

**Deviation table.** Counts and quotes per rep are in
[red-green.md](../../../plugins/mattstack/docs/superpowers/tests/2026-10-16-review-skills/red-green.md).
The plan renumbers the scenarios above: 1 to 8 are R1 to R8, 9 to 12 are V9
to V12, 13 to 15 are S13 to S15; R3b, R7b, V11b, V13 and S16 are added.
Each scenario ran 5 reps per side. RED is the text at `a5ef5c538`; GREEN
is the final run on the merged include (`86c70eb47`, no overlay). Classes: **A** a shell call a
tool covers; **B** hand mechanics a tool covers; **C** a skipped step;
**D** a runaway loop; **E** a stop that should have been a gate.

| scenario | RED pass | GREEN pass | RED classes | GREEN classes | notes |
|---|---|---|---|---|---|
| R1 bot thread | 5/5 | 5/5 | A, B | none | RED passes on the filter but keeps the hand prologue, `mktemp -d`, `gate-ctx.sh fit` and `gate_ask` |
| R2 note on a reply | 0/5 | 5/5 | A, B | none | RED asks with `gate_ask` and computes the override itself; GREEN records with `gate_record {gateId}` and writes the rows as returned |
| R3 Hold at respond-post | 0/5 | 5/5 | A, B | none | RED holds with `run_decision` plus `run_field_set`; GREEN answers with `next: hold`, then `run_hold`; scored after the Task 5 fix round |
| R3b Iterate at respond-post | 0/5 | 5/5 | A, B | none | the task review rescored the first GREEN pass 4/5 (C: one rep left the gate unanswered); the fix round answers with `next: iterate` and scored 5/5 |
| R4 partial post retry | 0/5 | 5/5 | A, B | none | RED posts T1 with `mr_reply_thread` three times; GREEN calls `respond_post_execute` again, clears the hold, then `run_close` |
| R5 mismatch | 5/5 | 5/5 | A, B | none | RED passes on its own shell git reads; GREEN quotes the tool's held entry |
| R6 resume, nothing held | 0/5 | 5/5 | A, B, C, E | none | RED's clearest live bug: 2 reps close `done` with nothing posted; GREEN calls `respond_post_execute` before `run_close` |
| R7 board fresh-pane resume | 0/5 | 5/5 | A, B | none | RED starts a new run; GREEN resumes with `run_enter {resume, spawnedBy}`; scored after the Task 5 fix round |
| R7b board same pane | 0/5 | 5/5 | A, B | none | GREEN round 1 scored 2/5 (a same-pane `run_enter`); the round 2 wording fix and every later run scored 5/5 |
| R8 GitHub proceed | 0/5 | 5/5 | A, B, C | none | RED skips the gh posted-already read; GREEN makes it and calls no `respond_post_execute` |
| V9 direct post | 0/5 | 5/5 | A, B | none | GREEN opens with `gate_open {kind: "review-post"}` and records after the submit |
| V10 resume, no post decision | 0/5 | 5/5 | A, B | none | RED judges posted from `mr_threads`; GREEN reads `mr_posted_since` and submits nothing |
| V11 gate_open refused twice | 0/5 | 5/5 | A, B | none | RED counts in context; GREEN charges `post-open-fix` with `run_budget` |
| V11b hand-back refused twice | 0/5 | 5/5 | A, B | none | the same budget on the hand-back path; nothing handed back |
| V12 board owns the gates | 0/5 | 5/5 | A, C | none | RED fits with `gate-ctx.sh` and writes no run line; GREEN uses `gate_open {handBack}` and writes `review-run:` |
| V13 inherited hand back | 5/5 | 5/5 | A, B | none | regression guard: fails the inherited stage, no `run_close` |
| S13 stuck finding | 0/5 | 5/5 | B | none | RED reopens at scope `self-review` (B17); GREEN uses `fix:F2:<round>` and the `self-review-retry:F2` gate |
| S14 compacted mid-loop | 5/5 | 5/5 | B | none | regression guard: one attempt from the stored count, then the reopen |
| S15 clarify Hold | 0/5 | 5/5 | B | none | GREEN sends `gate_ask` with `runDb` and `stage`, then `run_hold` alone |
| S16 inherited abandon | 5/5 | 5/5 | B | none | regression guard: fails stage `check`, no `run_close` |
| **Total** | **25/100** | **100/100** | A 76, B 95, C 12, D 0, E 1 reps | 0 in the final run | GREEN deviations before a fix round (task rounds): R7b 3 reps (shape miss), R3b 1 rep (C) |

Follow-up fixes, RED = the text at `0613d2b1e`, GREEN = the working tree
with the B22 to B24 edits, 5 reps per side:

| scenario | RED pass | GREEN pass | RED classes | GREEN classes | notes |
|---|---|---|---|---|---|
| I1 resumed records identity | 5/5 | 5/5 | none | none | regression guard: the `Own self-review run` diamond already sends a resumed run to record `branch` and `ticket` |
| I2 inherited records nothing | 5/5 | 5/5 | none | none | regression guard: no `run_field_set` on an inherited run |
| V14 fresh pane, decided selection | 0/5 | 5/5 | C, E | none | RED: 2 reps re-run the review, rewrite the report and json and post the new f1 at `src/retry.ts:46`; 3 reps skip the review only by stepping off the graph as a judgment call; GREEN posts f1 at `:44` from the json, reads `mr_posted_since` first, records `decidedBy: board` |
| V15 decided selection names an id the json lacks (review round) | 5/5 | 5/5 | none | none | regression guard: RED already holds quoting `f3` and posts nothing; GREEN walks the new `a selected id the json lacks` edge to `run_hold`; V14 rerun on the GREEN text 5/5 |
| R9 after a revise, narrated | 0/5 | 5/5 | E | none | RED reaches the right calls in all 5, each by a judgment call against the drawn `never record it again` edge; GREEN walks the new edge |
| R9b after a revise, plain | 0/5 | 5/5 | C | none | RED drops the handed plan in all 5: rows from the revise record, a fresh adjudicator dispatch, a new respond-plan hand-back; GREEN records the handed plan once and walks its fix rows to the respond-post hand-back |

Followups-3 (B25; scenarios in `plugins/mattstack/docs/superpowers/tests/2026-10-17-followups-3/`, RED the text at `351aa4cd8`,
GREEN the working tree, 5 reps each):

| scenario | RED pass | GREEN pass | RED classes | GREEN classes | notes |
|---|---|---|---|---|---|
| R10 fresh pane, nothing handed, round 2 stored after the revise | 0/5 | 5/5 | C | none | RED: rows from the revise record, thread re-read, a third adjudication and a new open; GREEN: the stored source written unchanged and opened with `gate_open`, no dispatch, no record |
| R11 fresh pane, nothing handed, source stored before the revise | 5/5 | 5/5 | none | none | regression guard: the kept fresh dispatch carries the revise's note |
| R12 the pane holding the hand-back gets the round 2 plan | 5/5 | 5/5 | none | none | regression guard: one `gate_record`, rows walked |
| R13 pending round already answered on another surface (review nit) | 0/5 | 5/5 | C | none | a non-null stored gate is reconciled first; answered records with `gateId` and walks the rows |
| R14 board pane, pending round from a hand-back (review nit) | 5/5 | 5/5 | none | none | regression guard: the hand-back table comes from the stored cards |

The task rounds ran against the pipeline-skills lane's gate-protocol
overlay (`63aee5a9d`, `556da1478`, `acb81aec5`). The final GREEN ran all 20
scenarios, 5 reps each, on the merged include (origin/main `38b7cb848` plus
`ebbc00870`) after the trim and polish passes, and scored 100/100 with zero
deviations; red-green.md's Final GREEN section has the table and the system
file sha1s.

**Word counts.** Compiled words (`wc -w` of `build-system-files.sh`
output, no overlay); the trim target was 25% under main.

| Skill | main compiled (`1cb4ba5da`) | final compiled | change |
|---|---|---|---|
| self-review | 12086 | 8869 | -26.6% |
| review | 19348 | 14972 | -22.6% |
| receive-review | 20351 | 15259 | -25.0% |

Review misses -25% (target 14511): the graph is kept node for node by the
spec and every remaining prose line carries an inventory rule.

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
