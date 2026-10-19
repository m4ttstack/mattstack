# Pipeline skills on the run engine, gate and provision tools

## Why

Wave 2 put the pipeline's bookkeeping behind MCP tools: the run engine
(`run_enter`, `run_next`, `run_resolve`, `run_hold`, `run_close`,
`run_budget`), run-aware gates (`gate_ask`/`gate_answer` with `runDb` and
`stage`, `gate_reconcile`, `gate_record`, `gate_open`) and the opt-in
`worktree_provision` options (`codes`, `precheck`, `reuse`, `runDb`,
`budget`). The skills still draw that bookkeeping by hand. The `work`
orchestrator walks a 32-node graph of `run_stage`/`run_field_set`/
`run_decision` calls, every stage repeats a hold triplet, and
gate-protocol (5.3K source words, inlined in work, provision and plan, and
in three more pipeline stages) draws the bracket, the `waiting-gate`
arming and clearing, the CAS winner, the decision record and the late
signal discard. Agents pay for that text on every run and drift from it:
a skipped `shipTarget` clear reuses an old ship consent, a hand-built
`<attempt>` overwrites an earlier decision, a retry counter held in prose
resets on compaction, a forgotten `waiting-gate` makes the stop hook
bounce the turn.

This wave rewrites the orchestrator, the five early stages and the gate
protocol to call those tools. Tools return results; the graph still owns
every gate and every judgment step keeps its own section.

## Goals

- `work` starts, resumes and walks a run with `run_enter`, `run_next` and
  `run_resolve` (with `attempt` for idempotent retries). No `run_stage`
  start/done/redirect, no produce check, no sentinel clears, no
  `shipTarget` clear, no `pipeline-stages` write by hand.
- Every hold in these skills is one `run_hold` call.
- Every counter diamond these skills draw is backed by `run_budget`, so it
  survives compaction and resume.
- gate-protocol drives the run-aware gate tools: `gate_ask` with `runDb`
  and `stage` brackets the gate and arms `waiting-gate`; `gate_answer` and
  `gate_reconcile` record the decision and clear the marker; one
  `gate_reconcile` node serves all three re-entry triggers; `gate_record`
  records a registry-less form answer. The no-run path (board, herd
  panes, forge verbs) keeps working with the same calls minus the run
  params.
- gate-protocol's structured-context reference (805 words) leaves the
  inlined text: it moves to a sidecar file the include vendors, read only
  by a site that opens a structured gate.
- stage-provision uses `worktree_provision`'s `precheck`, `reuse`,
  `codes`, `runDb` and `budget`, and branches on refusal codes, not prose.
- Team-pack fills keep attaching: every host node text a fill attaches to is
  kept verbatim.

## Non-goals

- No edits to ship, stage-ship, watch-ci, stage-watch-ci (the
  ship-ci-skills lane), stage-evidence, the review, forge or shepherdr
  skills, or any team pack. Those keep their own run and gate lines
  until their lanes move them.
- No rt code changes. `run_stage start`'s supersede stays on: ship,
  watch-ci, sync-open-mrs, review, self-review, receive-review and the
  shepherdr job template still call `run_start` + `run_stage start`
  (listed in the report so the refusal can flip once they move) The refusal flipped on
  2026-10-18, after they moved.
- No new tools. `run_record_commits` (recon C7) and a `branch_create`
  fallback tool do not exist; implement and self-review keep their
  `git log` node, provision keeps its plain-branch git nodes.
- No changes to the review shapes or to `gate_open` sites (those are the
  review lane's).

## Anti-goals

- A skill that lets a tool pick a gate answer or act on a spent budget.
  Tools return; the graph routes every refusal, spent budget and gate.
- A broken no-run path. Board, herd and forge panes include the same
  gate-protocol with no run; every run param stays optional.
- A host node rename that silently detaches a team fill.
- A pipeline that stops at the first `run_next` because a skill fed it
  the wrong stage or skipped `run_enter`'s manifest.

## Constraints

- Field contract (stop hook, console): `hold`, `waiting-gate`, `gate`,
  `pipeline-stages`, `shipTarget` and decision scopes `hold:<stage>:<n>`,
  `redirect:<stage>:<n>`. The tools write them; the skills no longer do,
  except `waiting-gate` after a cancelled form (no tool arms it there).
- `run_next` and `run_resolve` refuse a run with no manifest; only
  `run_enter` (start or resume) writes one. Every way into `work` goes
  through `run_enter`.
- An include target carries no placeholders and no slots
  (`loadInclude`). Its extra files are vendored at
  `parts/include-gate-protocol/` and `${CLAUDE_SKILL_DIR}` in its body is
  rewritten to that folder, which is how the sidecar is reached.
- Any gate-protocol edit needs `bun run skills:expand:board` and the
  regenerated `apps/board/skills` committed in the same PR (approved by
  the shepherd for generated output only).
- `bun run purity` before every push; no employer names, slugs or ticket
  ids in the PR body.

## Design

### work (the orchestrator)

```
Request -> A run id in context? -> yes: run_enter {flags, skillDir, resume: <runId>, spawnedBy?}
        -> no: Request names existing work?
  no: new work -> run_enter {flags, skillDir, ticket?, spawnedBy?, fresh: true}
  yes          -> run_list {repo, pipelines} -> Newest running run? -> Gate clarify (AskUserQuestion only)
                  resume -> run_enter {..., resume: <id>};  fresh -> run_enter {..., fresh: true};  hold -> Held
run_enter result?
  started    -> Ticket named? -> Tracker In Progress -> Account pick? -> run_decision account-pool@1
  resumed    -> At which row? failed -> failure gate; done -> close; running -> waiting-gate on the run?
  error      -> STOP: report the tool's message
Resumed into a running stage:
  run_field_get {key: waiting-gate} -> set? -> gate_reconcile {id, runDb, stage}
    answered -> Re-enter the stage at that gate's site, acting on the recorded answer
    open     -> Re-enter the stage holding at that gate (relaunch rt gate wait, end the turn)
    closed   -> Read the stage file from the top
  not set -> Read the stage file from the top
Read the stage file at the position and follow it  (box)
How did the stage file end?
  returned                 -> run_next {runDb, stage}
  handed back a Go back    -> run_resolve {runDb, stage, next: redirect, to, note, attempt, decidedBy}
run_next ended?
  done + next   -> Read the stage file (next position)
  done + last   -> Gate close
  failed        -> Gate <stage>-failed:<n>
  held/waiting  -> Held: end the turn
  closed        -> Run abandoned (or done)
Gate answers -> run_resolve {runDb, stage, next, to?, note?, attempt, decidedBy}
run_resolve applied?
  retry/redirect/iterate -> Read the stage file (next position)
  hold -> Held;  abandon -> Run abandoned;  done -> Run done
```

- **Entry.** "Existing work" keeps today's meaning: the request resumes
  something, or this session already holds a run id (after compaction, or
  a herd brief that started the run with `run_start`). A run id in
  context goes to `resume`, never `runDb`: resume adopts the running
  attempt, backfills a missing manifest and starts the first stage of a
  run that never got one, where `runDb` (inherit) would write nothing and
  leave `run_next` refusing. `spawnedBy` makes `run_enter` start fresh
  without listing candidates, so an unattended pane never asks clarify.
- **Candidates come from `run_list`, not `run_enter`.** `run_enter`'s
  candidate scan filters on work type alone, and every work verb records
  work type `work` (per-pipeline bindings), so its list would offer a
  feature run to a bugfix verb. `run_list {repo, pipelines:
  {{run-list.pipelines}}}` keeps today's pipeline filter. `work` always
  passes `resume` or `fresh: true`, so `run_enter`'s candidates mode is
  never reached.
- **clarify** stays AskUserQuestion only (no run yet). Options: the
  newest running run (Recommended), Start fresh, Hold.
- **Resumed.** `at.status` routes: `failed` reopens that stage's failure
  gate (attempt = `at.attempt`); `done` (only the last stage can be done
  with nothing running) opens close; `running` checks `waiting-gate`
  first. Adopting the attempt keeps its `started_at`, so a `waiting-gate`
  armed before the session died still counts for `run_next`; left alone,
  a re-asked gate under a new id would never clear it and the stage would
  read `waiting` forever. `gate_reconcile` on the armed id settles it:
  answered (recorded, marker cleared) re-enters the stage at the site
  whose scope that gate carries and acts on the recorded answer, so a
  decided question stays decided; open re-enters the stage holding at
  that gate (one background `rt gate wait`, end the turn); closed
  (marker cleared) reads the stage file from the top. *My call.*
- **Stage file.** `Position.file` is absolute; a `null` file (a
  single-stage manifest) does not occur for `work`.
- **Go back handed back.** plan's Go back and implement's "Go back to
  plan" end their stage file with `{to, note, decidedBy}`; the
  orchestrator applies it with `run_resolve` (the stage's running row
  ends `redirected`, produces from `to` on are cleared, consent fields
  cleared, `to` started). One owner for stage rows stays true.
- **Failure gate** `<stage>-failed:<n>` (scope from `run_next`): questions
  `action` (Retry / Abandon), `next` (Proceed / Iterate here / Go back /
  Hold) and `to` over `earlier`. Mapping to `run_resolve.next`: Proceed +
  Retry = `retry`, Proceed + Abandon = `abandon`, Iterate here =
  `iterate`, Go back = `redirect` + `to`, Hold = `hold`. `attempt` = `n`.
- **Close gate** `close`: `next` (Done / Iterate here / Go back / Hold),
  `to` over `stages`. Done = `done`, Iterate here = `iterate` with `to` =
  `implement`, Go back = `redirect`, Hold = `hold`; `stage` = the last
  stage, `attempt` = its latest attempt.
- **decidedBy** for `run_resolve` is the gate result's `by` (the CAS
  winner), or `pane` for a handed-back Go back typed in the pane.
- The gate's own decision is recorded by the gate tools (answers map);
  the `Selections:` lines go.
- Kept as is: tracker In Progress, the account back-fill decision,
  tiering slot, wrap-up include, "a finished run stays finished", the
  orchestrator's own gates answering "fail the stage at the gate?" no.

### Stage files (provision, plan, implement, self-review, gates)

- The five-line "Run state" paragraph becomes one sentence: the
  orchestrator owns the stage's rows; read consumes with `run_field_get`,
  write produces with `run_field_set {stage}`, end a failure with
  `run_stage {action: fail, stage, reason}`.
- Every hold triplet (`run_decision hold:` + `run_field_set hold` +
  outcome) becomes `run_hold {runDb, stage, reason, decidedBy}` + outcome.
- Every gate walks gate-protocol with `runDb` and `stage`; the
  `Selection:` lines go (the tools record the answers map).
- A Go back ends the stage at an outcome that hands `{to, note,
  decidedBy}` to the orchestrator (plan, implement).

### stage-provision

```
mode worker? -> git status in $PWD -> clean? -> run_field_set branch -> run_field_set worktree
Domain rules inlined? -> Follow the domain's provision flow -> Domain flow result?
  it provisions a tree / no domain -> worktree_provision {..., precheck: true}
Precheck result?
  trees to resume (attached; or sameTicket with no domain; or a surviving local branch) -> Gate provision
  nothing in the way -> worktree_provision {..., codes: true, runDb, stage: provision, budget: {key: provision-refusals, limit: 2}}
  refused daemon-unreachable or repo-unknown -> plain branch fallback
  refused daemon-outdated -> provision without the precheck (today's behavior)
  refused otherwise -> run_stage fail
worktree_provision result?        (node text kept: the fills attach here)
  provisioned -> EnterWorktree {path}
  refused branch-attached -> Gate provision
  refused daemon-unreachable or repo-unknown -> plain branch fallback
  refused busy, budget not exhausted -> retry the provision
  any other refusal, or busy with the budget exhausted -> run_stage fail
Gate provision answers:
  resume in <tree or branch> -> Picked tree read held?
    no -> worktree_provision {repoName, branch: <its branch>, reuse: true, runDb, stage: provision}
    yes (followups-2) -> worktree_provision {repoName, branch: <its branch>, reuse: true, takeOver: true, runDb, stage: provision}
  fresh tree -> run_budget {key: fresh-tree, limit: 2, stage: provision} -> exhausted? no: provision; yes: fail
  ticket / slug / domain / iterate -> Follow the domain's provision flow  (unchanged labels)
  hold -> run_hold
Reuse result? reused or provisioned -> EnterWorktree; refused (tree-held included) -> run_stage fail
EnterWorktree -> Recorded on the run? yes -> ticket?; no (recordError) -> run_field_set branch -> run_field_set worktree
```

- **Precheck everywhere.** Ticket mode never refuses an occupied branch: it
  quietly cuts `<branch>-2`, so today's "branch already checked out" edge
  is reached only in branch mode. The precheck runs before every
  provision except the one a Fresh tree answer asked for, and the gate
  offers `attached` trees (exact branch), the surviving local branch
  (`localBranch` with no tree), and, only when no domain rules are
  inlined, `sameTicket` trees. A domain flow owns `sameTicket` already
  (its own slug question).
- **Resume uses `reuse`** in branch mode with the picked tree's branch: it
  hands back a claimed or unmanaged tree and records `branch` and
  `worktree`, checks a surviving branch out again instead of cutting a
  new one, and refuses the main checkout or a disposable tree (the stage
  fails quoting the refusal).
- **Fresh tree** keeps today's once-only rule as a persisted budget, and
  skips the precheck. Ticket mode provisions as usual (the daemon cuts
  `<branch>-2`). Branch mode has no such cut, and the plain branch would
  either refuse or check the surviving branch out again, so Fresh passes
  a new branch: the slug with the lowest free `-<n>` suffix. *My call.*
- **An older daemon.** `precheck` and `reuse` call a daemon verb older
  daemons lack (`daemon-outdated`). Precheck then provisions without it,
  exactly as today; a `reuse` refused that way fails the stage quoting
  it (the human can pick Fresh on a retry).
- **busy** gets one retry through the call's own `budget` option
  (`budget.error` reads as exhausted, per the provision spec).
- Node texts kept for the fills: `Follow the domain's provision flow`,
  `Domain flow result?` with edge labels `it provisions a tree`, `it
  raises a question`, `already provisioned: this tree and its branch`,
  `Gate provision (table below)`, `provision answer?` with labels
  `ticket: create one`, `ticket: recheck the id`, `slug: their typed
  text`, `a domain answer`, `iterate: redo with their note`, `hold`, and
  `worktree_provision result?`.
- Plain-branch fallback, worker mode and `ticket` recording are
  unchanged, with each two-call node split into one call per node.

### stage-plan

Unchanged judgment (Read the ticket, Pick the tier, Print the triage
block, the HARD-GATE and its rationalization table). Proceed records
`execution-strategy@1` and writes `approach` and `evidence-plan` (three
nodes, as today); Iterate re-reads; Go back hands back to the
orchestrator; Hold is `run_hold`.

### stage-implement

Unchanged judgment. "Go back to plan" hands `{to: plan, note: the triage
mismatch, decidedBy: pane}` back.

### stage-self-review

`Review rounds = 3?` is `run_budget {key: review-rounds, limit: 3, stage:
self-review}` read through the same diamond, charged each time a review
finds blocking findings. A resumed or compacted stage keeps its count;
a new attempt starts at zero.

### stage-gates

Boilerplate only.

### gate-protocol

The graph:

```
Trigger: a site reaches its gate -> Build the gate's questions and context
-> gate_ask {questions, kind: <scope>, context?, subject?, runDb?, stage?}
gate_ask result?
  ok -> paneAction?
  refused: daemon unreachable -> Daemon down: is the gated pane unattended?
  refused: other -> Under a run (gate_ask fix)? -> run_budget {key: gate-fix:<scope>, limit: 2, stage}
                    -> Fixed this gate_ask call once already? -> Fix what the refusal names -> gate_ask
paneAction?
  form -> Present the in-pane gate form (formChunks, one call per chunk) -> answered / cancelled / dismissed
  wait -> rt gate wait <id> as a background Bash task -> End the turn: holding at gate <id>
answered -> Map the gate answer to exact option values -> gate_answer {id, answers, runDb?, stage?}
gate_answer result?
  recorded -> A write-in to act on (actOnWriteIn)?
  conflict -> Say which surface won -> A write-in ...?
  refused: not an option value -> remap budget (run_budget under a run) -> remap once, else hold
  refused: closed or not found -> STOP: never invent an answer or re-ask a closed gate
cancelled -> Holding an open gate: under a run? -> run_field_set {key: waiting-gate} -> wait -> end turn
Re-entry triggers (wait finished, words at a held gate, doorbell) -> gate_reconcile {id, runDb?, stage?}
gate_reconcile status?
  answered, alreadyReconciled -> Late gate signal discarded
  answered -> A write-in ...?
  closed -> STOP: never invent ...
  open, words in hand -> Map ... -> gate_answer
  open, no words -> Holding an open gate ...
Daemon down: attended -> Present the gate form with no registry -> Under a run? -> gate_record {..., shape: answers, answers, decidedBy: pane}
Daemon down: unattended -> fail the stage at the gate? (run_stage fail) / verb ends quoting the refusal
```

- **What the tools now do.** `gate_ask` with `runDb`/`stage` writes `gate`,
  computes `paneAction`, arms `waiting-gate` on wait, middle-truncates
  oversized labels instead of refusing, and returns `formChunks`.
  `gate_answer`/`gate_reconcile` record the answers map with the CAS
  winner's `by`, discard late signals (`alreadyReconciled`), clear
  `waiting-gate`, and compute `writeIn`/`actOnWriteIn`. The graph loses
  the bracket node, both "set waiting-gate?" diamonds, the three
  already-reconciled diamonds, the 2-second wait node, the clear node, the
  take-the-winner box, the record diamond and node, and the two write-in
  diamonds.
- **A second entry for `gate_open`.** A site that opens a structured gate
  calls `gate_open` itself (its source, validation refusals and fitting are
  the site's), then enters the protocol at `Trigger: a site opened its gate
  with gate_open`, which joins at `paneAction?`. `gate_open`'s result
  carries the same `id`, `paneAction` and `formChunks`, and under a run it
  has already written `gate` and armed `waiting-gate`.
- **Review shapes.** Under a run, `gate_answer` and `gate_reconcile`
  record nothing on a review gate (`respond-plan`, `respond-post`,
  `review-post`, or scope `post`) unless `record: true`; the protocol says
  so in one line and leaves the `gate_record` call to the site.
- **Attendance** shrinks to the daemon-down case (the only branch where no
  `paneAction` exists): under a run, `spawnedBy`; with no run, the launch
  instruction (a surface-launched pane is unattended).
- **Once-budgets.** "Fixed this gate_ask call once already?" and
  "Resubmitted this gate_answer once already?" are `run_budget` calls
  under a run (keys `gate-fix:<scope>`, `gate-remap:<scope>`, limit 2,
  scoped to the stage's attempt); with no run they count in context, since
  both loops close inside one turn.
- **`## Runs integration` keeps its name**, rewritten: under a run, every
  gate tool call passes `runDb` and `stage`, and that is what brackets
  the gate, arms `waiting-gate` and records the decision. Every site
  that walks the protocol passes them, moved or not; a site that does not
  gets no marker and the stop hook bounces its turn.
- **Sites not yet on the tools** (ship, watch-ci, evidence, review, forge,
  board) still draw their own `run_field_set {key: gate}` bracket and
  `run_decision` lines. They run where the site draws them: the bracket
  before `gate_ask` (the tool writes the same value), the record after the
  protocol's success outcome (it upserts the scope the tool recorded,
  with the site's shape). A review gate (`respond-plan`, `respond-post`,
  `review-post`) records nothing through `gate_answer` by default, so its
  site's record is the only one, as today.
- **Anchors cited from outside this lane stay findable.** Every section
  heading and phrase that review, forge, ship or board skills cite
  ("Runs integration", "Structured context", "presentation: form branch",
  "the deliberate-pick rule", and any others the plan's grep finds) keeps
  a home with that wording.
- **Kept sections:** Build the gate's questions and context (subject,
  prose layout, where text goes, options, write-ins, the 4-option cap),
  Present the in-pane gate form, Map the gate answer, Act on a write-in,
  the off-script gate (the shared shape: scope `off-script:<site>:<n>`,
  questions `action` and `next`, opened through this graph like any
  gate), Answers are option values, Closed gates /
  Hold / Iterate, a one-line Doorbell, Red flags (trimmed to the ones the
  tools do not enforce).
- **Structured context** moves to `gate-protocol/structured-context.txt`
  (vendored at `parts/include-gate-protocol/`). The protocol keeps a
  two-sentence section of the same name that points at
  `${CLAUDE_SKILL_DIR}/structured-context.txt` and at `gate_open`, so
  receive-review's "gate-protocol's Structured context" reference still
  lands.

Target size: gate-protocol under 2.5K words (from 5.3K), work under 1.2K
before includes (from 2.1K).

## Behavior changes

| Where | Today | After |
|---|---|---|
| work entry | A run id in context still went to `run_start` (a second run) | It resumes that run (`run_enter {resume}`), backfilling the manifest |
| work entry | Resume built `runDb` by hand from the `run_list` row | `run_enter {resume}` resolves it (`run_list` still lists, with the pipeline filter) |
| work resume | `run_stage start` on the current stage (a new attempt, supersede) | The running attempt is adopted; decisions keyed by it stay decided |
| work resume at an armed gate | The new attempt ignored the old marker; the stage re-asked | `gate_reconcile` on the armed gate: an answer given meanwhile is acted on |
| work, every stage end | Agent checked produces and wrote done/fail/start | `run_next` does it; a missing produce fails the stage with `missing produce: ...` |
| work, redirects | Agent cleared produces from `to` and `shipTarget` (skippable) | `run_resolve` clears both in one transaction |
| work, failure/close retries | A resent answer could double-apply | `run_resolve {attempt}` returns `repeated: true` |
| Gate decisions on pipeline sites | Site-shaped selection (`{"next","to","note"}`, `{"tier",...}`) | The answers map keyed by question id (gate-tools ruling) |
| Gate bracket and `waiting-gate` | Hand-written; a forgotten marker bounced the turn | Written by `gate_ask`/`gate_answer`/`gate_reconcile` |
| Oversized option labels | Refused, fixed by hand, re-asked | Truncated by `gate_ask`, reported in `labelsTruncated` |
| Re-entry after a wait or doorbell | 2s wait, manual reconcile check, clear, record | One `gate_reconcile` call |
| Once-budgets in gates, review rounds, fresh tree | Counted in context, reset by compaction | `run_budget`, persisted per stage attempt |
| Provision, ticket mode, branch already in a tree | Silently cut `<branch>-2` | Precheck offers to resume that tree |
| Provision, branch survives its disposed tree | A new `<branch>-2` cut from the default branch | Offered as a resume; `reuse` checks the old branch out |
| Provision resume into the main checkout or a disposable tree | Allowed via EnterWorktree | Refused by `reuse`; the stage fails quoting it |
| convention.md stage and gate contract (followups-2) | Told authors to start their own stage, bracket a gate with a hand-written `gate` field and `run_decision`, and close with `run_status` | Names the engine calls (`run_enter`, `run_next`, `run_resolve`, `run_hold`, `run_close`) and the gate tools that write `gate`, `waiting-gate` and the decision |
| Provision resume into a tree another owner holds (followups-2) | `reuse` returned it; only the gate's option label warned | `reuse` refuses `tree-held` unless `takeOver: true`; the stage passes it only when the human picked an option that read held, and compares the owner against `herd:<whoami herd.id>` |
| Provision `busy` refusal | Stage failed | Retried once (call's own budget) |
| Provision Fresh tree, branch mode | Re-provisioned the same branch name | A new `<slug>-<n>` branch |
| Provision error routing | Matched prose error text | Matched the refusal `code` |
| Pipeline includes | Structured-context reference inlined (805 words) per copy | In a sidecar read only by structured gates |

## Test plan (superpowers:writing-skills)

Describe-only fresh agents, 5 runs per scenario per version (today's
compiled text as RED, the new text as GREEN). Each scenario hands the
agent the skill text (includes inlined) and scripted tool results, and
asks for the exact calls it makes in order.

1. **Stage end.** Plan returns with produces written. Deviation: any
   `run_stage`, `run_snapshot` or `run_field_set` instead of `run_next`.
2. **Go back from the failure gate.** Ship failed; the human answers Go
   back to implement. Deviation: hand clears, a missing `attempt`, a
   `shipTarget` write, or a stage start.
3. **Compacted resume.** Context holds a run id; the plan stage was
   running with `waiting-gate` armed and its gate since answered on the
   board. Deviation: a new run, `runDb` without `resume`, a restarted
   attempt, re-asking the answered gate, or no `gate_reconcile`.
4. **Unattended wait.** `gate_ask` returns `paneAction: wait` under a
   run. Deviation: an AskUserQuestion, a hand-written `waiting-gate`, a
   foreground wait; then on re-entry anything but `gate_reconcile`.
5. **Occupied ticket branch.** Ticket mode, no domain, precheck shows one
   `attached` tree. Deviation: provisioning without the resume question,
   or EnterWorktree without `reuse`.
6. **Third blocking round.** Self-review after compaction; `run_budget`
   returns `exhausted: true`. Deviation: a fourth fix round.
7. **Daemon down, unattended.** `gate_ask` refuses daemon unreachable in
   a spawned pane. Deviation: a form, or anything but failing the stage.
8. **Held tree (followups-2).** Ticket mode, precheck shows one claimed
   `attached` tree whose owner is another herd; the human picks it anyway.
   S9 scripts `whoami` and both reuse results; S9b is the same tree owned
   by this pane's own herd (`herd:<HERD_ID>`); S9c drops `whoami` and the
   `takeOver` result, leaving only the `tree-held` refusal. Deviation: the
   held tree recommended, an own-herd tree labelled held, a first reuse
   call without `takeOver` on a held pick (or with it on an own-herd
   pick), a retry the graph does not draw, or a hand-written field.

The deviation table is under Test results below.

## Test results

Five describe-only reps per scenario, scored by hand against the pass
criteria. RED is `main` at plugin 0.31.15, GREEN is the final text of each
rewritten skill. Per-rep quotes, scenario iterations and word counts are in
[red-green.md](../../../plugins/mattstack/docs/superpowers/tests/2026-10-16-pipeline-skills/red-green.md).

| Scenario | RED | GREEN | Deviations seen at RED |
|---|---|---|---|
| S1 stage end | 0/5 | 5/5 | Shell-level stage rows: `run_snapshot`, `run_stage done`, `run_stage start` instead of `run_next` |
| S2 failure gate Go back | 0/5 | 5/5 | Hand-written run fields (bracket, `waiting-gate`, two `run_decision`s, produce and `shipTarget` clears); a resend started attempt 3 |
| S2b engine refusal | 0/5 | 5/5 | Skipped steps (no `run_resolve` or `run_hold`); a stop that should have been a hold became a re-asked or off-script gate |
| S3 compacted resume | 0/5 | 5/5 | Skipped steps (`run_list` and a clarify form instead of `run_enter`); hand-built runDb; 4 restarted plan as attempt 2; 2s `rt gate wait` instead of `gate_reconcile` |
| S4 unattended wait | 0/5 | 5/5 | Hand-written `gate` and `waiting-gate`; `gate_ask` without `stage`; no `gate_reconcile`; runErrors reps re-armed the marker by hand |
| S5 occupied ticket branch | 0/5 | 5/5 | Skipped `reuse` (3 reps); hand-written `branch` and `worktree` after the tool recorded them (2 reps) |
| S5b precheck on an older daemon | 0/5 | 5/5 | Three-argument provision with no `codes` or `runDb`; hand-written `branch` and `worktree` |
| S6 third blocking round | 0/5 | 5/5 | No `run_budget` call; count read off the `run_snapshot` budgets row; no fourth round (an uncommitted probe with no budget anywhere in the scene made all 5 reps start a fourth round) |
| S7 daemon down, unattended | 5/5 | 5/5 | Passes at RED; every rep still hand-wrote the `gate` bracket |
| S8 no run, herdr pane | 0/5 | 5/5 | Timed `rt gate wait --timeout 2s` re-read instead of `gate_reconcile {id}` |

Totals: RED 5/50, GREEN 50/50.

Followups-2 held-tree rows (scenario files in
`plugins/mattstack/docs/superpowers/tests/2026-10-17-followups-2/b2/`, C1 in `b5/` beside it; RED is the text before
the change, GREEN after):

| Scenario | RED | GREEN | Deviations seen at RED |
|---|---|---|---|
| S9 held tree, results scripted | 5/5 | 5/5 | none: the scripted `whoami` and `takeOver` results lead RED there, so S9 is a guard |
| S9b own herd's tree | 5/5 | 5/5 | none: RED reads `herd:hd-7` as its own herd from the scripted `whoami` |
| S9c held tree, unprimed | 3/5 | 5/5 | 2 reps reuse without `takeOver`, take the `tree-held` refusal, then retry with it, a move the graph does not draw |

| C1 convention.md, an author's gate and run calls (`attachments/parameterized-skills/references/convention.md` as the system file) | 0/5 | 5/5 | every RED rep prescribed `run_start`, a stage `run_stage start`, a hand-written `gate` field plus `run_decision`, and `run_status`; GREEN: `run_enter`, `gate_ask`/`gate_open` with `runDb` and `stage`, `run_hold`, `run_next` from `work`, `run_close` on an own run |

- S5 rerun on the GREEN text: 5/5 on its own criteria (`reuse`, no hand
  writes). Its scripted owner `session:4f1c` now reads as held, and 2 reps
  leave `takeOver` off because S5's scripted form labels the resume
  "(Recommended)" with no held text, unlike what they sent; a fixture
  artifact, since S5 predates the held rule.

- S7 passed 5/5 at RED, so it is a regression guard, not evidence the
  rewrite helped.
- S5's `precheck` criterion is non-discriminating: the scenario's scripted
  precheck result led all 5 RED reps to send `precheck: true`. S5 still
  separates the texts on `reuse` and the hand writes.
- Size targets were re-ruled: gate-protocol under 2500 (met, 2498), `work`
  about 1600 (plan said under 1200; the mandated node texts make that
  unreachable, actual 1732). stage-provision grew from 1228 to 1869 words
  for the same reason.

## Verification

- `render.sh` and `check-dot.py` on every touched SKILL.md; `certify.sh`
  on every touched skill dir.
- `rt skills check --strict` and `rt skills compile --dry-run` under an
  isolated HOME, plus a scratch pack (outside the repo) that binds this
  plugin's pipeline and compiles `work` end to end, read for every
  inlined part.
- `bun run skills:expand:board`, committed; the board skills guard.
- The `plugin-mattstack` CI job; `bun run purity`.
- Plugin version: next patch above main's; `pack/requires.json`
  `minEngine` raised to the same version.

## Left to the builder

- Exact node wording beyond the kept texts, and section prose.
- Whether a two-call node split reads better as two nodes or one node
  per call behind no diamond (both pass check-dot).
- Test fixtures and how the scripted tool results are worded.

## My calls (flag any you disagree with)

- A run id in context resumes rather than inheriting (`runDb`), because
  only resume writes a missing manifest.
- Candidates for clarify come from `run_list` (pipeline filter), not
  `run_enter`'s work-type-only scan.
- A resume into a running stage reconciles an armed `waiting-gate` before
  re-entering the stage.
- An older daemon's `daemon-outdated` on precheck falls back to
  provisioning without it; Fresh in branch mode cuts `<slug>-<n>`.
- Precheck runs on the domain path too, offering `attached` trees and a
  surviving branch; `sameTicket` stays the domain flow's question.
- Resume goes through `reuse` in branch mode, so a disposable tree or the
  main checkout is refused instead of entered.
- `busy` gets one retry; no other provision refusal retries.
- The once-budgets in gate-protocol use `run_budget` only under a run.
- Close's Iterate here keeps `to = implement`.
- No new budget on the human-driven retry and redirect loops: each pass
  goes through a gate.
