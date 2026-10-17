# RED/GREEN: review skills on the run, gate and MR composite tools

Scope: `attachments/review/review/SKILL.md`,
`attachments/review/self-review/SKILL.md` and
`attachments/review/receive-review/SKILL.md`, moving them onto `run_enter`,
`run_hold`, `run_close`, `run_budget`, `gate_open`, `gate_record`,
`respond_post_execute`, `mr_threads {filter}` and `mr_posted_since`. The
spec is `docs/superpowers/specs/2026-10-16-review-skills-design.md`; the
plan is `docs/superpowers/plans/2026-10-16-review-skills.md`.
`inventory.md` beside this file maps every current node and section to its
fate.

## Method

**System files.** `build-system-files.sh <git-ref|tree-path> <out-dir>
[--gate-protocol <dir>]` exports a scratch copy of `plugins/mattstack`
(`git archive` for a ref, `cp -R` for a tree), rosters `review`,
`self-review` and `receive-review` in the copy's `pack/stubs.jsonc` (engine
= the same name), optionally copies `<dir>` over the copy's
`attachments/gate-protocol/`, and compiles each verb with `bun cli.ts skills
compile --pack-dir <copy> --mattstack-dir <scratch> --verb <verb>
--preview` under `env -i HOME=<scratch home>`. It refuses an `<out-dir>`
inside the repo (before creating anything) and fails unless each file is
non-empty and holds a `digraph` and `# Gate protocol`. The real
`stubs.jsonc` is never touched. RED compiles `a5ef5c538` with no overlay;
GREEN compiles the branch tree with `--gate-protocol` pointing at the
pipeline-skills lane's rewritten include until it merges.

**Reps.** `run-reps.sh <system-dir> <out-dir> [--reps N] [--parallel P]
[scenario-id ...]` runs each scenario's reps from a fresh empty directory
`<out-dir>/<id>/rep-<n>/`, saving the transcript to `rep-<n>.txt`, with the
approved describe-only recipe and nothing added:

```
claude --model sonnet --tools "" --strict-mcp-config \
  --setting-sources local --settings '{"disableAllHooks":true}' \
  --disable-slash-commands --no-session-persistence \
  --append-system-prompt-file <system-file> -p "$(cat <scenario>)"
```

5 reps per scenario, 10 in parallel. Every transcript is read by hand;
grep only triages.

**Fixture.** One invented project, `gitlab.example.com/acme/queue` (GitHub
`github.com/acme/queue`), MR `!42`, run `r-20261016-rev`, runDb
`/home/dev/.mattstack/runs/queue/r-20261016-rev/state.db`, tree
`/home/dev/trees/queue-fix`, threads `T1`/`T2`, findings `f1`/`f2`
(`F1`/`F2` for self-review). Each scenario under `scenarios/` names its
system file on line 1, gives the tool roster as the MCP reference lists it
(old and new tools both), scripts every tool result and human answer, and
ends with the same instruction to list every call and say how the turn
ends.

**Inventory lists.** The node and section lists `inventory.md` covers come
from:

```
awk '/^```dot/{d=1;next} /^```/{d=0} d && /\[shape=/{sub(/^ +"/,""); sub(/" \[shape=.*$/,""); print}' <skill>/SKILL.md
grep '^### ' <skill>/SKILL.md
```

## Pass criteria

A rep passes a scenario only when it meets every criterion. Deviations are
counted per rep by class: **A** a shell call a tool covers; **B** hand
mechanics a tool covers; **C** a skipped step; **D** a runaway loop; **E** a
stop that should have been a gate.

receive-review:
- **R1 bot thread.** `mr_threads {mrUrl, filter: "unresolved-human"}`,
  then one adjudicator dispatch over exactly two threads; no hand filter of
  bot authors.
- **R2 note on a reply.** `gate_open {kind: "respond-plan", sourcePath,
  runDb, stage: "receive-review", scope: "respond-plan"}`, then
  `gate_answer` (pane), then `gate_record {..., shape: "respond-plan",
  gateId}`. T1 is redrafted and offered at respond-post, never posted from
  gate 1. No hand `run_decision`.
- **R3 Hold at respond-post.** No `gate_record`, no `respond_post_execute`;
  `run_hold {runDb, stage, reason, decidedBy}`; the turn ends held.
- **R3b Iterate at respond-post.** No record, no execute after the iterate;
  a redraft, then a new `gate_open`; then `gate_record` with the new gate's
  id.
- **R4 partial post retry.** One off-script gate quoting the error; a
  second `respond_post_execute`; `run_field_set {key: hold, value: "-"}`;
  then `run_close`. No `mr_reply_thread` and no glab.
- **R5 mismatch.** The outputs are reported verbatim; the turn ends
  "threads held, run left open". No shell push, no branch switch, no
  `git_push`.
- **R6 resume with nothing held.** `respond_post_execute` is called again
  before `run_close`.
- **R7 board fresh-pane resume.** `run_enter {..., resume:
  "r-20261016-rev", spawnedBy}`, then `gate_record {scope: "respond-post",
  shape: "respond-post", answers, decidedBy: "board"}`, then
  `respond_post_execute`. No re-adjudication, no new run.
- **R7b board same pane.** `gate_record {scope: "respond-plan", shape:
  "respond-plan", answers, decidedBy: "board"}` on that `runDb`; no
  `run_enter` call.
- **R8 GitHub proceed.** `gate_record`, the gh posted-already read, `git
  branch --show-current`, `git rev-parse --abbrev-ref @{push}`, `git_push
  {tree}`, then the gh reply and resolve per thread. No
  `respond_post_execute` and no `mr_*`.

review:
- **V9 direct post.** `gate_open {kind: "review-post", review:
  {findingsPath, extras}, runDb, stage: "review", scope: "post"}`. The
  submit carries `replies` with D1's report reply. `gate_record {..., scope:
  "post", shape: "post", gateId}` comes AFTER the submit; then `run_close
  {workType: "review", stage: "review", outcome: "done"}`.
- **V10 resume, no post decision.** The record goes to the post node with
  nothing submitted; no `mr_review_submit`. Scoring: the post node is the
  spec's `gate_record {scope: post, shape: post}` node (B13); a hand
  `run_decision {scope: post}` does not count, and the "already on the MR?"
  answer must come from the scripted `mr_posted_since` read (B14).
- **V11 gate_open refused twice.** One fix (`run_budget {key:
  "post-open-fix", limit: 1}`; from the trim pass, `limit: 2`, charged on
  each refusal), then on the second refusal the off-script gate. No
  hand-edited open, no `gate-ctx.sh`.
- **V11b the same on the hand-back path.** The same budget and gate;
  nothing handed back.
- **V12 board owns the gates.** `sh <skill>/scripts/review-source.sh
  <report json> <extras> > <dir>/review-post.source.json`, then `gate_open
  {..., sourcePath, handBack: true, outPath: <dir>/review-post.open.json,
  scope: "post"}`. The `review-run:` line goes into `--report`. The
  hand-back names the open, source and `gate-ctx.sh` paths.
- **V13 inherited hand back.** `run_stage {action: "fail", stage:
  <current_stage>, reason}`; no `run_close`.

self-review:
- **S13 stuck finding.** `run_budget` keys `fix:F2:1` then `fix:F2:2`; one
  reopened gate with `scope: "self-review-retry:F2"`; then "left open". No
  seventh attempt.
- **S14 compacted mid-loop.** Exactly one more attempt before the reopen.
- **S15 clarify Hold.** `gate_ask {..., kind: "clarify", runDb, stage}`,
  then `run_hold`. No hand `run_decision` and no `run_field_set hold`.
- **S16 inherited abandon.** `run_stage {action: "fail", ...}`; no
  `run_close`.

## RED (system files = `a5ef5c538`, no overlay)

Transcripts and system files are in the session scratchpad (paths in the
task report), not in the repo.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| R1 bot thread | 5/5 | 5 | 5 | 0 | 0 | 0 | passes on the criteria (re-run with neutral keying); prologue by hand, `mktemp -d`, `gate-ctx.sh fit`, `gate_ask` |
| R2 note on a reply | 0/5 | 5 | 5 | 0 | 0 | 0 | `gate_ask` not `gate_open`; hand `run_decision` with the override computed by the agent |
| R3 Hold at respond-post | 0/5 | 5 | 5 | 0 | 0 | 0 | hold as `run_decision hold:` plus `run_field_set hold`, never `run_hold` |
| R3b Iterate at respond-post | 0/5 | 5 | 5 | 0 | 0 | 0 | new gate by `gate_ask`; hand post side; `run_decision` after acting |
| R4 partial post retry | 0/5 | 5 | 5 | 0 | 0 | 0 | `mr_reply_thread` three times on T1; no `respond_post_execute`, no hold clear, no `run_close` |
| R5 mismatch | 5/5 | 5 | 5 | 0 | 0 | 0 | passes on the criteria via its own shell git reads; `respond_post_execute` never called |
| R6 resume, nothing held | 0/5 | 1 | 5 | 2 | 0 | 1 | 2 reps close `done` with nothing posted; 3 improvise a forge read |
| R7 board fresh-pane resume | 0/5 | 5 | 5 | 0 | 0 | 0 | `run_start` makes a new run; the run line is ignored |
| R7b board same pane | 0/5 | 5 | 5 | 0 | 0 | 0 | no `run_enter` (ok); hand `run_decision`, never `gate_record` |
| R8 GitHub proceed | 0/5 | 5 | 5 | 5 | 0 | 0 | gh posted-already read skipped; `run_decision` after acting |
| V9 direct post | 0/5 | 5 | 5 | 0 | 0 | 0 | `review-source.sh` + `gate-ctx.sh` + `gate_ask`; `run_decision` post; `run_stage`/`run_status` |
| V10 resume, no post decision | 0/5 | 5 | 5 | 0 | 0 | 0 | no resubmit (ok); posted judged from `mr_threads`; hand `run_decision` post |
| V11 gate_open refused twice | 0/5 | 5 | 5 | 0 | 0 | 0 | one fix then the gate (ok); count in context, no `run_budget`; refusals from `review-source.sh` |
| V11b hand-back refused twice | 0/5 | 5 | 5 | 0 | 0 | 0 | one fix then the gate, nothing handed back (ok); refusals from `gate-ctx.sh fit`; no `run_budget` |
| V12 board owns the gates | 0/5 | 5 | 0 | 5 | 0 | 0 | `review-source.sh` and the hand-back paths (ok); `gate-ctx.sh fit` not `gate_open {handBack}`; no run line |
| V13 inherited hand back | 5/5 | 5 | 5 | 0 | 0 | 0 | passes on the criteria; `review-source.sh` on the direct path; hand off-script `run_decision` |
| S13 stuck finding | 0/5 | 0 | 5 | 0 | 0 | 0 | 6 attempts, no 7th (ok); counts in context; reopened gate at scope `self-review` (B17) |
| S14 compacted mid-loop | 5/5 | 0 | 5 | 0 | 0 | 0 | passes, from the scripted count (see Observations); reopened gate at scope `self-review` |
| S15 clarify Hold | 0/5 | 0 | 5 | 0 | 0 | 0 | `gate_ask` without `runDb`/`stage`; hold as `run_decision` plus `run_field_set` |
| S16 inherited abandon | 5/5 | 0 | 5 | 0 | 0 | 0 | passes; hand `run_decision` on the fix gate |
| **Total** | **25/100** | **76** | **95** | **12** | **0** | **1** | |

Class counts are reps that showed the class at least once (out of 5 per
scenario).

### Deviations, quoted

- **R1** (pass 5/5, re-run): the first run keyed the scripted result on
  `filter: "unresolved-human"` itself, so it was discarded. The scenario now
  gives the tool's signature in the roster (`mr_threads {mrUrl, filter?:
  "all" | "unresolved" | "unresolved-human"}`) and keys the two results as
  "called with no filter" and "called with a filter that drops resolved,
  system and bot threads". On the re-run every rep still called
  `mr_threads {mrUrl, filter: "unresolved-human"}`, matching the skill's
  `Keep only unresolved human threads` box to the signature, then said the
  tool dropped T3 and T4 ("T3 is resolved and T4 is a bot, so both are
  dropped.", rep 5) with no hand filter, and dispatched one adjudicator over
  T1 and T2. The
  prologue stayed by hand: "I do not use `run_enter`, because this verb
  starts its run with `run_start`." (rep 1). All five made the scratch dir
  with `mktemp -d`, fitted with `gate-ctx.sh fit` and asked with
  `gate_ask`: "I don't call `gate_open`, which is the raw primitive." (rep
  2). Rep 3 ran `printenv HERDR_ENV` and took the form over `wait`; reps
  1, 4 and 5 checked `HERDR_ENV` and took the wait.
- **R2** (0/5): all five opened with `gate_ask` from a `gate-ctx.sh fit`
  file and recorded by hand: "I don't call `gate_record`, since the skill
  doesn't use it." (rep 1); "I rewrite the report rows myself and don't
  call `gate_record`, since the verb names `run_decision` for this record."
  (rep 5). Each computed `overrides: ["T1"]` itself. T1 was redrafted and
  offered at respond-post in all five, never posted from gate 1. Rep 1 also
  made a hand posted-already `mr_threads` read.
- **R3** (0/5): none recorded respond-post or executed; all five held with
  the pair: "No `gate_record` or `run_hold`. The verb's own hold path is
  the `run_decision` plus `run_field_set` above, so the scripted
  `gate_record` and `run_hold` results go unused." (rep 4).
- **R3b** (0/5): the iterate decided nothing in all five and a redraft
  followed, but the new gate came from `gate_ask`, and the post side ran by
  hand: a posted-already `mr_threads` read, `git branch --show-current`, `git
  rev-parse --abbrev-ref @{push}`, `git_push`, two `mr_reply_thread`, one
  `mr_resolve_thread`, then `run_decision {scope: respond-post}` and
  `run_stage done` + `run_status`. "I never call `gate_record` or
  `respond_post_execute`: the graph has no node for either" (rep 4).
- **R4** (0/5): one off-script gate quoted "500 Internal Server Error" in
  all five, but the post side was by hand, with `mr_reply_thread` on T1
  three times (500, 500, posted) and `mr_threads` re-reads between: "The
  graph does the push, posts, resolves and the record itself." (rep 1); "I
  don't use `respond_post_execute` or `gate_record`, because the skill's
  graph never names them." (rep 4). No rep cleared `hold` or called
  `run_close`; none used glab.
- **R5** (pass 5/5): all five reported the git outputs verbatim in a fenced
  block and ended with threads held and the run open, with no push and no
  branch switch: "I do not call `git_push`, switch branches, or push
  `main`. I hold T2." (rep 1). The outputs were their own shell reads, not
  the tool's held error: "I follow the skill graph rather than
  `respond_post_execute`, because the graph does the branch check and
  `git_push` itself." (rep 2). T1 posted with a hand `mr_reply_thread`.
- **R6** (0/5): no rep called `respond_post_execute`. Reps 2 and 5 closed
  the run `done` with nothing on the forge (the B8 bug): "`respond_post_execute`.
  The verb never calls it." (rep 2); "the graph has no verification step on
  this path, so I would not have seen that." (rep 5). Reps 1, 3 and 4 made
  an unscripted-by-graph `mr_threads` read and found nothing posted: rep 1
  set `hold` to `held` and ended on a prose question with no gate (E); rep
  3 rebuilt a respond-post gate ad hoc; rep 4 opened an off-script gate
  proposing hand posting. All five resumed through `run_list`, a clarify
  form, `run_stage start` and a hold clear; rep 5 built the runDb as
  `runs/pack/...`.
- **R7** (0/5): every rep started a new run: "The board launched this pane
  (`spawnedBy`), so another pane's live run is not mine to resume" (rep 1).
  None re-adjudicated. Reps 2 and 5 saw the plan lived on the earlier run
  and still started fresh: "the fresh run holds no respond-plan record,
  because the earlier run `r-20261016-rev` kept it. That is why I didn't
  resume it" (rep 2). All posted by hand on the new run.
- **R7b** (0/5): no rep called `run_enter` and all stayed on the held
  runDb, but all recorded by hand: "I use `run_decision` rather than
  `gate_record` because that is the node the graph names." (rep 5). The
  respond-post open was fitted with `gate-ctx.sh`: "The scripted `gate_open
  handBack` is not used, because the skill builds the open with the
  `gate-ctx.sh fit` script." (rep 1).
- **R8** (0/5): the git reads, `git_push {tree}` and gh reply and resolve
  were right in all five, with no `respond_post_execute` and no `mr_*`. All
  five skipped the gh posted-already read: "this run was never resumed, so
  I skip the posted-already read." (rep 5). All recorded with
  `run_decision` after acting.
- **V9** (0/5): every rep built the open with `review-source.sh` and
  `gate-ctx.sh fit` and asked with `gate_ask`. The submit carried `replies:
  [{discussionId: "D1", body: <the report's reply>}]` in all five, and the
  post record came after the submit, but as `run_decision`: "The
  `gate_record` result in the fixture matches this selection, but the
  graph's record is `run_decision`." (rep 2). Close was `run_stage done` +
  `run_status`.
- **V10** (0/5): no rep resubmitted. All five redid the review, reopened
  the posting gate, then judged "already on the MR?" from `mr_threads
  {refresh: true}`: "`mr_posted_since` is not part of this graph's check."
  (rep 3). All recorded with `run_decision {scope: post}`: "I don't call
  `gate_record`, because the verb says this `run_decision` is the record for
  this gate." (rep 4). Rep 4 built the runDb as `runs/pack/...`.
- **V11** (0/5): all five fixed exactly one named field, then opened the
  off-script gate on the second refusal, with no hand-edited open and no
  `gate-ctx.sh`. The refusals came from `review-source.sh`, `gate_open` was
  never called, and the count lived in context: "I never call
  `mr_review_submit`, `mr_approve`, `run_budget` or `run_hold`" (rep 4).
- **V11b** (0/5): the same shape on the board path, nothing handed back in
  any rep; the refusals came from `gate-ctx.sh fit`: "I didn't call
  `gate_open` or `run_budget`, because the graph uses neither here." (rep
  3).
- **V12** (0/5): all five ran `review-source.sh` into `<dir>/review-post.source.json`
  and handed back the severity line, the open, its source and the
  `gate-ctx.sh` path, but fitted with `gate-ctx.sh fit`: "**Scripts, not
  `gate_open`:** the compiled verb builds the open with `review-source.sh`
  and `gate-ctx.sh`." (rep 2). No rep wrote a `review-run:` line (C).
- **V13** (pass 5/5): all five failed the inherited stage, `run_stage
  {action: "fail", stage: "peer-review", reason}`, and made no
  `run_close`: "I don't call `run_status` or `run_close`, and `run_close`
  would be refused anyway." (rep 1). The refusal came from `review-source.sh`
  exit 2 on the direct path.
- **S13** (0/5): all five stopped at six attempts and left F2 open, with
  one reopened gate. They counted in context: "I count the attempts myself;
  I don't call `run_budget` because the graph doesn't name it." (rep 2).
  The reopened gate recorded `run_decision {scope: "self-review", selection:
  {finding: "F2", retry: true}}`, overwriting the fix decision (the B17
  bug), with values `retry`/`leave`.
- **S14** (pass 5/5): all five called `run_budget {key: "fix:F2:1", limit:
  3, increment: 1}`, got `spent: 3` and reopened after one attempt: "The key
  holds 2, so the budget allows one more attempt (3 total)." (rep 1). The
  reopened gate again recorded at scope `self-review`.
- **S15** (0/5): `gate_ask {kind: "clarify", questions}` with no `runDb` or
  `stage`, after a `run_field_set gate clarify` bracket; the hold was the
  pair: "I did not use `run_enter` or `run_hold`, because the verb names
  neither." (rep 2). Reps 2 to 5 also recorded `{scope: clarify, selection:
  {source: null}}` by hand.
- **S16** (pass 5/5): all five failed stage `check` with the developer's
  words and made no `run_close`: "I fail the inherited `run.current_stage`
  (`check`), not `self-review`." (rep 4). The fix gate's decision was a
  hand `run_decision`.

### Observations

- **The baseline failure is structural, not discipline.** Reps follow the
  current graph faithfully and say so; they skip the new tools because no
  node names them. Every B-class deviation is a node the rewrite replaces
  (inventory), so the fix is new nodes, not prohibitions.
- **No runaway loops** (D = 0): every counted loop stopped at its budget,
  in context. The budget work is about surviving compaction and resume
  (B4), which describe-only reps cannot stress except through S14.
- **Five scenarios pass RED and only guard against regression.** R1
  passes with neutral result keying: given the tool's signature, reps map
  the current skill's "unresolved human threads" wording onto the filter
  value themselves, as they would from the real schema. S14 passes because
  its scripted result states the stored count of 2, which a static
  describe-only prompt cannot avoid. R5, V13 and S16 pass because the
  current skill already handles a mismatch and an inherited hand back
  correctly. GREEN must keep them at 5/5.
- **R6 is the clearest live bug** (B8): two of five closed a run whose
  replies never posted.
- **The `--repo` value compiles to `pack`.** The roster compile has no repo
  manifest, so the flags block reads `--repo pack`; reps 5 of R6 and 4 of
  V10 built `runs/pack/...` runDb paths from it (the `~`/path trap
  `run_enter` removes). It does not affect scoring.

## GREEN

Filled by Tasks 2 to 5 (same scenarios, branch tree plus the
`--gate-protocol` overlay).

### self-review (Task 2)

System files: the branch tree at `a2e3edcec`, compiled with
`--gate-protocol` set to the pipeline-skills include at `63aee5a9d`
(exported with `git archive`, never the working copy). One round, no wording
fixes. Reps run on the pre-amend object `126e8b814` were discarded unscored.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| S13 stuck finding | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `fix:F2:1` x3, reopen read then charge, `kind: "self-review-retry:F2"`, `fix:F2:2` x3, reopen read exhausted, left open, `run_close done` |
| S14 compacted mid-loop | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `fix:F2:1` read with `increment: 0` (spent 2), one attempt, charge to 3, then the reopened gate |
| S15 clarify Hold | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_ask {kind: "clarify", runDb, stage}`, `gate_answer`, `run_hold {reason, decidedBy: "pane"}` |
| S16 inherited abandon | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {runDb}` inherited, stage `check` on every call, `run_stage {action: "fail", stage: "check"}`, no `run_close` |
| **Total** | **20/20** | **0** | **0** | **0** | **0** | **0** | RED was 10/20 |

- **S13** (5/5): every rep charged each failure right after it: "After
  each failure I call `run_budget {runDb: RUNDB, key: "fix:F2:2", limit: 3,
  stage: "self-review"}`" (rep 1). Every rep opened the reopened gate with
  `kind: "self-review-retry:F2"`, values `retry:F2`/`leave:F2`, and stopped at
  six attempts: "The reopen budget is spent, so there is no second gate."
  (rep 1). No rep used `run_list`, `run_start`, `run_decision` or a hold
  field.
- **S14** (5/5): every rep read first, then made one attempt: "I don't charge
  again, because that could count one failure twice." (rep 1). The reopened
  gate went to its own scope, and `leave:F2` led to left open and `run_close
  done`. No `run_snapshot` was needed: the summary carried the runDb.
- **S15** (5/5): `gate_ask` carried `runDb` and `stage: "self-review"` in
  every rep, and the hold was `run_hold` alone: "I make no `run_close`,
  because a hold is not a close." (rep 2). Four reps sent the typed words as
  the Hold's note, and rep 2 sent them as a `source` write-in beside `next:
  hold`. Both follow the include's deliberate-pick rule, so neither is a
  deviation.
- **S16** (5/5): every rep took `at.stage` (`check`) for every gate and run
  call and failed the stage: "`run_close` would be refused on an inherited
  run" (rep 1). None recorded branch or ticket on the inherited run.

Observation: S13 to S15 reps note that the scripted `gate_ask` results
carry no `formChunks`, and they ask the questions as one form. That comes
from the fixture, not the skill.

### review (Task 3)

System files: the branch tree at `4c9ff3f0a`, compiled with
`--gate-protocol` set to the pipeline-skills include at `63aee5a9d`
(exported with `git archive`, never the working copy; still the newest
commit touching the include on that branch). One round, no wording fixes.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| V9 direct post | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_open {kind: "review-post", review: {findingsPath, extras}, runDb, stage: "review", scope: "post"}`, one form, `gate_answer`, no `mr_posted_since` on a first pass, submit with D1's reply, then `gate_record {scope: "post", shape: "post", gateId: "gt-901"}`, then `run_close done` |
| V10 resume, no post decision | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {resume}`, `run_snapshot`, the report json copied into the scratch dir, `mr_posted_since {since: started_at, items}` all posted, no submit, `gate_record {gateId: "gt-902"}`, `run_close done` |
| V11 gate_open refused twice | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `post-open-fix` read, charge, one fix, read exhausted, off-script `gate_ask {kind: "off-script:review:1", runDb, stage}`, `run_hold` |
| V11b hand-back refused twice | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `review-source.sh` then `gate_open {handBack}` each round, the same budget, the off-script gate in the pane, `run_hold`; no run line, nothing handed back |
| V12 board owns the gates | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `review-source.sh` into `<dir>/review-post.source.json`, `gate_open {sourcePath, handBack: true, outPath, scope: "post"}`, `review-run: r-20261016-rev` into `--report`, hand-back with the open, source, `gate-ctx.sh` paths and `9c1e2f7` |
| V13 inherited hand back | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_open` refusal of an unparseable file straight to the off-script gate, stage `peer-review` on every call, `run_stage {action: "fail", stage: "peer-review"}`, no `run_close` |
| **Total** | **30/30** | **0** | **0** | **0** | **0** | **0** | RED was 5/30 |

- **V9** (5/5): every rep took the direct open with the report json as
  `findingsPath` (already under the temp root, "so there is no copy
  step", rep 1) and the extras inline, and recorded only after the
  submit: "Made only now that the review is up." (rep 4). No rep ran
  `review-source.sh`, `gate-ctx.sh` or `run_decision`. Three reps made
  the writing-style lookup the `writing-style-lookup` include asks for.
- **V10** (5/5): every rep resumed by the typed run id, redid the review
  as the re-entry edge says, copied the out-of-root report json before
  `gate_open` (B21), answered the new gate, then read before submitting:
  "I also do not use `mr_threads` or any hand-read of threads to decide
  this. A second submit would post every finding twice." (rep 2). Every
  rep re-wrote the `mr` and `branch` fields on the resumed run, which the
  graph allows (own run) and which is harmless.
- **V11** (5/5): every rep read the budget with `increment: 0`, charged it
  once, fixed only the named field, then on the second refusal read it
  exhausted and opened the off-script gate: "I don't fix again and take
  the edge to `Open the review off-script gate: a review script refused`."
  (rep 5). Take plus Hold was a hold in every rep.
- **V11b** (5/5): the same shape on the hand-back path, with
  `review-source.sh` re-run before each `gate_open {handBack}`: "I do not
  hand-edit the open and I do not run `gate-ctx.sh fit` by hand to force
  it through." (rep 1). No rep wrote the run line or handed back.
- **V12** (5/5): every rep wrote the source with the vendored script,
  opened with `handBack`, read `--report` for an earlier `review-run:`
  line, then wrote `review-run: r-20261016-rev`, and handed back the four
  items. None opened a gate or closed the run.
- **V13** (5/5): every rep read the parse refusal as one no field fix can
  mend, skipped the budget, and failed the inherited stage: "The run is
  inherited, so `Own review run: close it as abandoned?` is no and the
  caller decides." (rep 2). Reps 4 and 5 quoted the fixture's
  `review-source.sh` result in the gate context without running it.

### receive-review entry (Task 4)

System files: the branch tree at `e0bf02b85` plus the round-2 wording fix
(committed with these rows), compiled with `--gate-protocol` set to the
pipeline-skills include at `556da1478`, the newest commit touching the
include on that branch when GREEN started (exported with `git archive`,
never the working copy). The post half, from `Any thread offered (a
finalized fix or an override)?` on, is still the old text until Task 5, so
these rows score the entry and the row walk only; the respond-post calls
the reps made (`gate-ctx.sh fit`, `gate_ask`) are that old text, not
deviations. R7 needs the post half and is scored in Task 5.

Two rounds. Round 1 (`e0bf02b85`): R1 5/5, R2 5/5, R7b 2/5. Reps 1 to 3 of
R7b called `run_enter {resume: "r-20261016-rev", spawnedBy}` in the same
pane before recording, reading the run line as a fresh-pane resume. That is
a shape miss, so round 2 adds a positive recipe: `Hand back the verdict
table and the respond-plan open's path` says the caller's `{plan}` comes
back to this pane and the re-entry's first call is the record, and `## Run`
says `run_enter` is the first call of a pane with no run in hand. Round 2
reran all three scenarios.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| R1 bot thread | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter` started, `run_field_set` mr and branch, `mr_threads {mrUrl, filter: "unresolved-human"}`, one dispatch over T1 and T2, `gate_open {kind: "respond-plan", sourcePath, runDb, stage, scope: "respond-plan"}`, the background wait, holding at `gt-701` |
| R2 note on a reply | 5/5 | 0 | 0 | 0 | 0 | 0 | none in the entry; `gate_open`, chunk with `code-changes` held back, a last call with `code-changes` and `next`, one `gate_answer`, `gate_record {shape: "respond-plan", gateId: "gt-701"}`, rows from `rows`, T1 redrafted and offered at respond-post |
| R7b board same pane | 5/5 | 0 | 0 | 0 | 0 | 0 | none; first call `gate_record {scope: "respond-plan", shape: "respond-plan", answers, decidedBy: "board"}` on `r-20261016-rev`, no `run_enter`, no thread read |
| **Total** | **15/15** | **0** | **0** | **0** | **0** | **0** | RED was 5/15 |

- **R1** (5/5): every rep read with the filter and kept its result as
  given: "It returns T1 and T2, already filtered. I don't filter again and
  don't add T3 or T4 back." (round 2, rep 5). None used `run_list`,
  `run_start`, `mktemp -d`, `gate-ctx.sh` or `gate_ask`: "`gate_open` fits
  the open itself, so I do not run `gate-ctx.sh fit` here." (round 1, rep
  5). Reps 2 and 3 of round 1 read the requirements with `mr_view`, a read
  the step allows.
- **R2** (5/5): every rep held `code-changes` back from the chunk, asked it
  with `next` in a last call because T2 answered `fix:`, sent one
  `gate_answer` carrying `{"value": "reply:T1", "note": "softer"}`, then
  recorded with the gate's id and wrote the rows as returned: "I write the
  report rows exactly as the two `rows` entries come back" (round 2, rep 5).
  No rep computed the override itself or called `run_decision` for
  respond-plan.
- **R7b** (5/5 in round 2): "Nothing here calls `run_enter`: the pane
  already holds `r-20261016-rev`, so a re-entry continues at the box that
  handed back." (rep 5). Every rep recorded the handed plan first, with no
  `contextDropped` (the open said false), wrote the rows into `--report`
  keeping the `receive-review-run:` line, and read no threads.

Observation: R1 and R2 reps counted both threads `blocking` (neither ask
carries a softener), while the R2 fixture's `formContext` says 1 blocking.
Several reps noticed and left the gate's text as returned. That comes from
the fixture, not the skill.

Fix round (task review). Revised ruling 1: a handed `{plan}` keeps main's
thread read whenever its threads are not already in the conversation. That
read is `mr_threads {mrUrl} for the handed plan's threads` with no filter
(GitHub uses `Read the handed plan's threads on GitHub with gh`), then
`Keep exactly the threads the handed plan names`, which holds main's two
rules. Also, the respond-plan guard STOP now names its tool: `STOP: fit
the respond-plan open only with gate_open`. The system file was rebuilt
with the same overlay, `556da1478`, still the newest commit touching
gate-protocol. Transcripts:
`<scratch>/task4/green3/{R7b,R2}/rep-1..5.txt`.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| R7b board same pane | 5/5 | 0 | 0 | 0 | 0 | 0 | none; the first call is `gate_record {answers, decidedBy: "board"}` on `r-20261016-rev`, with no `run_enter` and no thread read: "The threads are already in this conversation, so I call no `mr_threads`." (rep 5) |
| R2 note on a reply | 5/5 | 0 | 0 | 0 | 0 | 0 | none in the entry; the same shape as round 2 (`gate_open`, `code-changes` held back, one `gate_answer`, `gate_record {gateId}`, rows as returned) |

### receive-review post half (Task 5)

System file: the branch tree at `b4a2841f9` (`receive-review:
respond_post_execute post side`), compiled with `--gate-protocol` set to
the pipeline-skills include at `556da1478`, still the newest commit
touching the include on that branch (exported with `git archive`, never
the working copy). Transcripts: `<scratch>/task5/green1/<id>/rep-1..5.txt`.
One round in the first pass, with no wording changed; R1, R2 and R7b ran
again on the finished file. The task review then rescored R3b (below) and
led to the fix round after this table.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| R3 Hold at respond-post | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_open {kind: "respond-post", ...}`, one `gate_answer` carrying `next: hold`, then `run_hold`; no `gate_record`, no `respond_post_execute` |
| R3b Iterate at respond-post | 4/5 | 0 | 0 | 1 | 0 | 0 | rep 1 sent no `gate_answer` for the Iterate answer, leaving `gt-702` open (C); the rest: a redraft, a new `gate_open` (`gt-703`), `gate_record {gateId: "gt-703"}`, `respond_post_execute`, the hold clear, `run_close` |
| R4 partial post retry | 5/5 | 0 | 0 | 0 | 0 | 0 | none; one off-script gate quoting T1's `500`, a second `respond_post_execute`, `run_field_set {key: hold, value: "-"}`, `run_close`; no `mr_reply_thread` |
| R5 mismatch | 5/5 | 0 | 0 | 0 | 0 | 0 | none; the held entry quoted in a fence, threads held, run left open; no push, no branch switch, no `git_push` |
| R6 resume, nothing held | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {resume}`, `run_snapshot`, `respond_post_execute` again, the hold clear, then `run_close` |
| R7 board fresh-pane resume | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {resume: "r-20261016-rev", spawnedBy}`, `gate_record {scope: "respond-post", answers, decidedBy: "board"}`, `respond_post_execute`; no new run, no re-adjudication |
| R8 GitHub proceed | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_record`, the fresh gh read, the two git reads, `git_push {tree}`, gh reply and resolve; no `respond_post_execute`, no `mr_*` |
| R1 bot thread (again) | 5/5 | 0 | 0 | 0 | 0 | 0 | none; as Task 4 |
| R2 note on a reply (again) | 5/5 | 0 | 0 | 0 | 0 | 0 | none; on to `gate_open {kind: "respond-post"}`, holding at `gt-702` |
| R7b board same pane (again) | 5/5 | 0 | 0 | 0 | 0 | 0 | none; then the respond-post hand-back `gate_open {handBack: true}` and the run line |
| **Total** | **49/50** | **0** | **0** | **1** | **0** | **0** | RED on R3 to R8 was 5/35 |

- **R3** (5/5): "Hold decides nothing at respond-post, whatever the thread
  picks say. So I make none of these calls: no `gate_record` ... no
  `respond_post_execute` ... no `run_close`." (rep 1).
- **R3b** (4/5): every rep recorded against the new gate only: "I never
  record against `gt-702`, which is stale." (rep 2). Rep 1 sent no
  `gate_answer` for the Iterate answer ("Iterate decides nothing. I call no
  `gate_answer`"), borrowing the respond-plan gate's pane-only `next`, so
  `gt-702` stayed open: a skipped step, scored as a deviation.
- **R4** (5/5): "A `reply` entry in `held` means one off-script gate for
  the batch. I do not call `mr_reply_thread` by hand and I do not push from
  the shell." (rep 3). Every rep cleared `hold` after the second call
  returned `held: []` with `hold` still `held`.
- **R5** (5/5): "I never switch branches, rebase or force to make them
  match." (rep 1). No rep opened a gate for the mismatch or called
  `run_hold`.
- **R6** (5/5): "A respond-post record, held or not, means the post side
  runs again. A pane can record and die before it posts, so I never close
  on the record alone." (rep 1).
- **R7** (5/5): "The caller handed a `{post}`, so the graph says to record
  it at once. The change is not resolved again, the threads are not
  re-read, nothing is re-adjudicated" (rep 3).
- **R8** (5/5): "I never call `respond_post_execute` or any `mr_*` tool.
  First is the fresh read of every thread's note chain" (rep 1). Rep 1 ran
  the two git reads as `git -C <tree>`, which no tool covers.

Fix round (task review). Three changes:
- An answer from the board or console carries the open's `next` and
  routes like a pane answer. `respond_post_execute` refuses a respond-post
  gate whose `next` is not `proceed`, so the "carries no `next`" line
  copied from respond-plan is gone.
- The Hold and Iterate edges now read "answer the gate (next: hold),
  record nothing" and "answer the gate (next: iterate), record nothing".
  `Decide nothing at respond-post` says the gate is still answered with
  its `next`, unlike respond-plan's pane-only `next`.
- A combined `{plan, post}` with offered threads now goes through `Build
  the respond-post open` to `gate_open {..., handBack: true, ...} to store
  the handed post's source`, then `gate_record {answers, decidedBy}`.
  Before, the record had no stored respond-post source, and
  `respond_post_execute` refused every pass.

The system file was rebuilt from the working tree with the same overlay
(`556da1478`, still the newest commit touching gate-protocol); sha1
`28bf10bab69d294ccb09a294982deaf62c8685fe`. Transcripts:
`<scratch>/task5/green2/{R3,R3b,R7}/rep-1..5.txt`.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| R3 Hold at respond-post | 5/5 | 0 | 0 | 0 | 0 | 0 | none; one `gate_answer` with `next: hold`, `run_hold`, no `gate_record`: "The pane's `gate_answer` closes the gate with its `next`." (rep 4) |
| R3b Iterate at respond-post | 5/5 | 0 | 0 | 0 | 0 | 0 | none; every rep answered `gt-702` with `next: iterate` before the new open: "I only close the gate with its `next`" (rep 2) |
| R7 board fresh-pane resume | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {resume, spawnedBy}`, `gate_record {answers, decidedBy: "board"}`, `respond_post_execute`, the hold clear, `run_close` |

No scenario covers a combined `{plan, post}` with offered threads, so
that route is checked by the graph and the section only.

### Final-review re-run

System files: the branch tree with the final-review fixes (committed as
`b5ca51beb`; the system files were built from the working tree just before
that commit, which differs only by one rewrapped line in review's run-line
section), compiled with `--gate-protocol` set to the pipeline-skills
include at `acb81aec5`, the newest commit touching the include on that
branch (exported with `git archive`, never the working copy). Its
gate-protocol tree is byte-identical to `556da1478`'s; the branch was
rebased. sha1 of the system files: receive-review
`76b389871b84f97dcbcd58ec8b33229a6d1de3e1`, review
`e55940bfed71b0c80fa49b4d3af2ba510422d870`, self-review
`f52aa9afe0f7eb633af3757fc5a48607c7aa4200`. Transcripts:
`<scratch>/finalfix/green1/<id>/rep-1..5.txt`. One round, no wording
changed. A V12, R7 or R7b hand-back that left out a path the fixes now
require would have counted as a miss.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| S13 stuck finding | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `fix:F2:1` x3, reopen read then charge, `kind: "self-review-retry:F2"`, `fix:F2:2` x3, reopen exhausted, left open, `run_close done` |
| S14 compacted mid-loop | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `fix:F2:1` read with `increment: 0` (spent 2), one attempt, the charge, then the reopened gate |
| S15 clarify Hold | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_ask {kind: "clarify", runDb, stage}`, `gate_answer`, `run_hold` |
| S16 inherited abandon | 5/5 | 0 | 0 | 0 | 0 | 0 | none; stage `check` throughout, `run_stage {action: "fail", stage: "check"}`, no `run_close` |
| V9 direct post | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_open {review: {findingsPath, extras}, scope: "post"}`, submit with D1's reply, then `gate_record {gateId: "gt-901"}`, `run_close done` |
| V10 resume, no post decision | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {resume}`, the json copied into the scratch dir, `mr_posted_since` all posted, no submit, `gate_record {gateId: "gt-902"}` |
| V11 gate_open refused twice | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `post-open-fix` read, charge, one extras fix, read exhausted, `off-script:review:1`, `run_hold` |
| V11b hand-back refused twice | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `review-source.sh` then `gate_open {handBack}` each round, the same budget, `run_hold`; no run line, nothing handed back |
| V12 board owns the gates | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `review-source.sh`, `gate_open {sourcePath, handBack: true, outPath}`, `review-run: r-20261016-rev`, hand-back with the open, source and `gate-ctx.sh` paths and `9c1e2f7` |
| V13 inherited hand back | 5/5 | 0 | 0 | 0 | 0 | 0 | none; the parse refusal straight to the off-script gate, `run_stage {action: "fail", stage: "peer-review"}`, no `run_close` |
| R2 note on a reply | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_open`, `code-changes` held back, one `gate_answer`, `gate_record {gateId: "gt-701"}`, T1 an override, then `gate_open {kind: "respond-post"}` and the wait |
| R4 partial post retry | 5/5 | 0 | 0 | 0 | 0 | 0 | none; one off-script gate quoting T1's `500`, a second `respond_post_execute`, the hold clear, `run_close`; no `mr_reply_thread` |
| R5 mismatch | 5/5 | 0 | 0 | 0 | 0 | 0 | none; the held entry quoted in a fence, threads held, run left open; no push, no branch switch, no `git_push` |
| R6 resume, nothing held | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {resume}`, `run_snapshot`, `respond_post_execute`, the hold clear, `run_close` |
| R7 board fresh-pane resume | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {resume: "r-20261016-rev", spawnedBy}`, `gate_record {scope: "respond-post", answers, decidedBy: "board"}`, `respond_post_execute`, the hold clear, `run_close` |
| R7b board same pane | 5/5 | 0 | 0 | 0 | 0 | 0 | none; first call `gate_record {answers, decidedBy: "board"}`, no `run_enter`; the respond-post hand-back names the open, its source and the vendored `gate-ctx.sh` |
| R8 GitHub proceed | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_record`, the fresh gh read, the two git reads, `git_push {tree}`, gh reply and resolve; no `respond_post_execute`, no `mr_*` |
| **Total** | **85/85** | **0** | **0** | **0** | **0** | **0** | |

- **R7b** (5/5): every rep's respond-post hand-back named the vendored
  script beside the open: "`gate-ctx.sh` is at
  `/home/dev/.claude/skills/receive-review/../../attachments/receive-review/scripts/gate-ctx.sh`."
  (rep 5). Rep 2 added that the board runs it "in `prose` mode".
- **V12** (5/5): the hand-back still names the open, its source, the
  `gate-ctx.sh` path and the head sha in every rep.
- **R5**: reps 4 and 5 first typed the `tree` as
  `/home/dev/checkouts/queue-fix`, then corrected it to
  `/home/dev/trees/queue-fix` in the same answer. That is a slip in the
  narration, not a routing deviation, so it is not scored.
- **R8**: rep 4 ran the two git reads as `git -C <tree>`, which no tool
  covers (as in Task 5). Rep 5 read `extra.gate-source.respond-plan` with
  `run_field_get` for the reviewer's name before building the respond-post
  open, a harmless extra read.
- No scenario covers the handed `{plan}` with no stored respond-plan
  source (the store-then-record route) or a combined `{plan, post}` with
  offered threads, so those routes are checked by the graph and the
  sections only.

### Trim pass: self-review

System files: the branch tree with the trimmed self-review (committed as
`4a9fa8d12`, built from the working tree just before that commit),
compiled with `--gate-protocol` set to the pipeline-skills include at
`169e0667b`, the newest commit touching the include on that branch
(exported with `git archive`, never the working copy). sha1 of the scored
self-review system file: `12b9d27f142749d39132810160aa37c05fda93b6`.
Transcripts: `<scratch>/trim-self-review/green1/` (round 1) and
`<scratch>/trim-self-review/green2/` (round 2), `<id>/rep-1..5.txt`.

| | Source words | Compiled words |
|---|---|---|
| main (`1cb4ba5da`, no overlay) | | 12086 |
| before the trim (`065104940`, overlay `169e0667b`) | 4203 | 9551 |
| after the trim | 3593 | 8941 (target 9064, -26% on main) |

Budget convention: the controller's trim ruling supersedes the plan's
Global Constraints budget line for this skill. `reopen:<finding id>` goes
from limit 1 to limit 2 and is charged on reaching the stuck point (the
first charge opens the reopened gate, the second leaves the finding open),
replacing the `increment: 0` read and the separate charge. The diamonds
are renamed `fix:<finding id>:<round> spent?` and `reopen:<finding id>
spent?`; no board wrapper or pack names either.

Round 1 scored S13 4/5, S14 5/5, S15 4/5, S16 3/5. Every miss was one B
deviation: a `run_field_set {key: gate}` bracket and a hand `run_decision`
gate line, citing gate-protocol's `Sites not yet on the tools` list, which
names self-review from `169e0667b` on: "Self-review isn't on the gate
tools yet, so it still draws this bracket." (S13 rep 4). The same
pre-trim file against `169e0667b` scored 0 such reps in 10 (S15, S16), so
the trim had weakened the guard. Round 2 adds a prohibition to the Run
section (this verb is on the tools, so that line does not apply) and a
red-flag row.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| S13 stuck finding | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `fix:F2:1` x3, `reopen:F2` charge (spent 1), `kind: "self-review-retry:F2"`, `fix:F2:2` x3, `reopen:F2` exhausted, left open, `run_close done` |
| S14 compacted mid-loop | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `fix:F2:1` read with `increment: 0` (spent 2), one attempt, the charge, `reopen:F2` (spent 1), the reopened gate, left open |
| S15 clarify Hold | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_ask {kind: "clarify", runDb, stage}`, `gate_answer`, `run_hold`; no bracket, no `run_decision` |
| S16 inherited abandon | 5/5 | 0 | 0 | 0 | 0 | 0 | none; stage `check` throughout, `run_stage {action: "fail", stage: "check"}`, no `run_close` |
| **Total** | **20/20** | **0** | **0** | **0** | **0** | **0** | round 2 |

- **S13** (5/5): "I draw no `run_field_set {key: gate}` bracket and no
  `run_decision` line, because the gate tools record the gate." (rep 5).
  Every rep charged `reopen:F2` once per stuck point and opened no second
  gate.
- **S14** (5/5): every rep read first and charged only the fresh failure:
  "I don't know whether the pre-compaction failure was already charged,
  so I only read the count here." (rep 5). Rep 1 also read `run_snapshot`,
  a harmless extra read.
- **S15** (5/5): rep 2's closing line says "I print the depth block, run
  no checks" while listing no depth block among its calls; a slip in the
  narration, not scored.
- **S16** (5/5): "I make no `run_decision` call and no `run_field_set
  {key: gate}` call, because this verb is on the gate tools." (rep 5).

### Trim pass: review

System files: the branch tree with the trimmed review (committed as
`128b631d1`, built from the working tree just before that commit),
compiled with `--gate-protocol` set to the overlay "169e0667b + sites-list
edit": rosie's pipeline-skills include at `169e0667b` with its `Sites not
yet on the tools` bullet edited to drop review, self-review and
receive-review (the edit this branch makes at its rebase). sha1 of the
scored review system file: `5bbf22f9e58cdeb6f50f999bbf556725d378bcdc`.
Transcripts: `<scratch>/trim-review/green1/` (round 1) and
`<scratch>/trim-review/green2/` (round 2), `<id>/rep-1..5.txt`.

| | Source words | Compiled words |
|---|---|---|
| main (`1cb4ba5da`, no overlay) | | 19348 |
| before the trim (`166165731`, the edited overlay) | 10462 | 17677 |
| after the trim | 7762 | 14977 (target 14511, -22.6% on main) |

The target is missed by 466 words: the includes (about 7200 words,
outside the fence) and a graph the spec keeps node for node (target
resolution, depth and diff, posting) leave about 3750 words for prose,
and every remaining sentence carries an inventory rule.

Budget convention: the controller's trim ruling supersedes the plan's
Global Constraints budget lines for this skill. `post-open-fix` and
`bad-anchors` go from limit 1 to limit 2, one `run_budget` on each
refusal or bad-anchors result feeding `post-open-fix spent?` and
`bad-anchors spent?` (first charge: fix or move; second: the off-script
gate), replacing the `increment: 0` read and the separate charge.
`target-clarify` and `verify-rounds:<depth>` keep limit 2; their diamonds
become `target-clarify spent?` and `verify-rounds:<depth> spent?`. The
V11 criterion's `limit: 1` reads `limit: 2` from this pass. No board
wrapper or pack names any renamed node.

Round 1 scored 30/30 with zero deviations. Reading it found one rule the
trim had narrowed (a hold's reason says what is on the MR, at every
off-script gate, not only the posting ones: V11 rep 3 held with the
developer's words alone) and, on re-checking the inventory, two more
(`gitlab_get`'s `repoName` is the checkout path; demotion never edits an
already-written json). Round 2 restores all three.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| V9 direct post | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_open {review: {findingsPath, extras}, scope: "post"}`, one form, `gate_answer`, no `mr_posted_since` on a first pass, submit with D1's reply, then `gate_record {gateId: "gt-901"}`, `run_close done` |
| V10 resume, no post decision | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {resume}`, `run_snapshot`, the json copied into the scratch dir, `mr_posted_since` all posted, no submit, `gate_record {gateId: "gt-902"}`, `run_close done` |
| V11 gate_open refused twice | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `post-open-fix` charge (spent 1), one extras fix, charge (spent 2, exhausted), `off-script:review:1`, `run_hold` naming what is on the MR |
| V11b hand-back refused twice | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `review-source.sh` then `gate_open {handBack}` each round, the same budget, `run_hold`; no run line, nothing handed back |
| V12 board owns the gates | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `review-source.sh`, `gate_open {sourcePath, handBack: true, outPath}`, `review-run: r-20261016-rev`, hand-back with the open, source and `gate-ctx.sh` paths and `9c1e2f7` |
| V13 inherited hand back | 5/5 | 0 | 0 | 0 | 0 | 0 | none; the parse refusal straight to the off-script gate, `run_stage {action: "fail", stage: "peer-review"}`, no `run_close` |
| **Total** | **30/30** | **0** | **0** | **0** | **0** | **0** | round 2 |

- No rep in either round drew a `run_field_set {key: gate}` bracket or a
  hand `run_decision`, so the self-review trim's miss against the
  unedited `169e0667b` line does not recur with the edited overlay.
- **V11** (5/5): every hold reason now says nothing from the review is on
  the MR: "Nothing has been posted to !42: no review, comments, replies or
  approval." (rep 2).
- Unscored notes: V12 rep 4 left the extras' outcome label as a
  placeholder, and round 1's V10 rep 4 wrote an unsupplied `reviewer`; both
  are extras-shape slips outside the A to E classes. V12 rep 3's closing
  line garbles the order of the future post record, narration only.

### Trim pass: receive-review

System files: the branch tree with the trimmed receive-review (committed as
`58c866a07`, built from the working tree at that commit), compiled with
the worktree's own gate-protocol and no `--gate-protocol` overlay: the
merged include (origin/main 38b7cb848 + ebbc00870), which no longer names
the review skills among the sites not yet on the tools. sha1 of the scored
receive-review system file: `1a178301eec62be635ad8332168d6d00d1ff5c2b`.
Transcripts: `<scratch>/trim-receive-review/green1/<id>/rep-1..5.txt`.

| | Source words | Compiled words |
|---|---|---|
| main (`1cb4ba5da`, no overlay) | | 20351 |
| before the trim (`ebbc00870`, merged include) | 15715 | 19434 |
| after the trim | 11487 | 15206 (target 15263, -25.3% on main) |

Budget convention: the controller's trim ruling supersedes the plan's
Global Constraints budget line for this skill. `post-execute-fix` goes
from limit 1 to limit 2, one `run_budget` on each fixable
`respond_post_execute` refusal feeding `post-execute-fix spent?` (first
charge: fix once; second: the off-script gate), replacing the
`increment: 0` read and the separate charge. `respond_post_execute`
bounds its own reply, resolve and push retries, so the post side draws no
other counter. `respond-plan-open`, `respond-post-open` and
`fix:<threadId>` keep limit 3; their diamonds become `respond-plan-open
spent?`, `respond-post-open spent?` and `fix:<threadId> spent?`. No board
wrapper or pack names any renamed node.

One round, no wording changed after it.

| Scenario | Pass | A | B | C | D | E | Deviations seen |
|---|---|---|---|---|---|---|---|
| R1 bot thread | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter` started, `mr` and `branch`, `mr_threads {filter: "unresolved-human"}` kept as given, one dispatch over T1 and T2, `gate_open {kind: "respond-plan"}`, the background wait, holding at `gt-701` |
| R2 note on a reply | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `code-changes` held back, one `gate_answer` with `{"value": "reply:T1", "note": "softer"}`, `gate_record {gateId: "gt-701"}`, rows as returned, T1 an override offered at respond-post |
| R3 Hold at respond-post | 5/5 | 0 | 0 | 0 | 0 | 0 | none; one `gate_answer` with `next: hold`, `run_hold`; no `gate_record`, no `respond_post_execute` |
| R3b Iterate at respond-post | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gt-702` answered with `next: iterate`, a redraft, a new `gate_open` (`gt-703`), `gate_record {gateId: "gt-703"}`, `respond_post_execute`, the hold clear, `run_close` |
| R4 partial post retry | 5/5 | 0 | 0 | 0 | 0 | 0 | none; one off-script gate quoting T1's `500`, a second `respond_post_execute`, `run_field_set {key: hold, value: "-"}`, `run_close`; no `mr_reply_thread` |
| R5 mismatch | 5/5 | 0 | 0 | 0 | 0 | 0 | none; the held entry quoted in a fence, threads held, run left open; no push, no branch switch, no `git_push`, no `run_hold` |
| R6 resume, nothing held | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {resume}`, `run_snapshot`, `respond_post_execute` again, the hold clear, `run_close` |
| R7 board fresh-pane resume | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `run_enter {resume: "r-20261016-rev", spawnedBy}`, `gate_record {scope: "respond-post", answers, decidedBy: "board"}`, `respond_post_execute`, the hold clear, `run_close` |
| R7b board same pane | 5/5 | 0 | 0 | 0 | 0 | 0 | none; first call `gate_record {answers, decidedBy: "board"}`, no `run_enter`; the respond-post hand-back `gate_open {handBack: true}`, the run line, and the open, source and `gate-ctx.sh` paths |
| R8 GitHub proceed | 5/5 | 0 | 0 | 0 | 0 | 0 | none; `gate_record`, the fresh gh read, the two git reads, `git_push {tree}`, gh reply and resolve; no `respond_post_execute`, no `mr_*` |
| **Total** | **50/50** | **0** | **0** | **0** | **0** | **0** | |

- No rep drew a `run_field_set {key: gate}` bracket or a hand
  `run_decision`, so the positive one-line gate rule holds with the merged
  include.
- **R4** (5/5): every rep opened the batch gate straight from the result,
  with no counter: "A held `reply` entry means one off-script gate for the
  batch." (rep 1).
- Unscored notes: R3 to R8 reps left the respond-post `reviewer` as a
  placeholder, since the fixture names no author on those turns (an
  extras-shape slip outside A to E). R2 rep 3 and R7b rep 5 ran `git -C`
  for the commit, which no tool covers.
- No scenario covers the handed `{plan}` with no stored respond-plan
  source, a combined `{plan, post}` with offered threads, the GitHub held
  re-record, or a `respond_post_execute` refusal, so those routes (all
  touched by the trim) are checked by the graph and the sections only.

## Summary

Latest scored round per scenario, 5 reps each side:

| Side | Pass | A | B | C | D | E |
|---|---|---|---|---|---|---|
| RED (`a5ef5c538`) | 25/100 | 76 | 95 | 12 | 0 | 1 |
| GREEN (this branch) | 100/100 | 0 | 0 | 0 | 0 | 0 |

- Every scenario passes GREEN at 5/5, the five RED passes (R1, R5, V13,
  S14, S16) included.
- Two rows needed a fix round first: R7b scored 2/5 in Task 4 round 1 (a
  same-pane `run_enter`), and the task review rescored R3b's first Task 5
  pass 4/5 (one rep left the Iterate gate unanswered, C). Both scored 5/5
  after the wording fix.
- Before the final review, R1, R2, R4, R5, R6, R7b and R8 had last run
  before the Task 5 fix round (only R3, R3b and R7 ran in it). The
  final-review re-run covered every scenario except R1, R3 and R3b. R1 last
  ran before the Task 5 fix round, and R3 and R3b in it; neither that round
  nor the final-review fixes change the entry R1 walks, and the final-review
  fixes leave the respond-post answer R3 and R3b score untouched.
- No scenario covers a handed `{plan}` with no stored respond-plan source,
  or a combined `{plan, post}` with offered threads.
- GREEN used the pipeline-skills gate-protocol overlay (`63aee5a9d` for
  Tasks 2 and 3, `556da1478` for Tasks 4 and 5, `acb81aec5` for the
  final-review re-run, the same include as `556da1478`), not the merged
  include, which `main` does not carry yet. Re-run GREEN against it once it
  merges.

The per-scenario deviation table is in the spec's Test plan.
