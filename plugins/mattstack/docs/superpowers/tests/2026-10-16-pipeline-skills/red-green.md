# RED/GREEN: pipeline skills on the run engine, gate and provision tools

Scope: `attachments/pipeline/work`, `stage-provision`, `stage-plan`,
`stage-implement`, `stage-self-review`, `stage-gates` and the
`attachments/gate-protocol` include, moving them from hand-drawn run
bookkeeping to the merged tools (`run_enter`, `run_next`, `run_resolve`,
`run_hold`, `run_budget`; run-aware `gate_ask`, `gate_answer`,
`gate_reconcile`, `gate_open`, `gate_record`; `worktree_provision` with
`precheck`, `reuse`, `codes`, `runDb`, `budget`). The spec is
`docs/superpowers/specs/2026-10-16-pipeline-skills-design.md`.

## Fixture

One invented project for every scenario: org `acme`, repo
`gitlab.example.com/acme/queue` (checkout `/home/dev/src/queue`), run
`r-20261016-abc`, runDb
`/home/dev/.mattstack/runs/queue/r-20261016-abc/state.db`, ticket `ACME-12`
"Fix login" on branch `acme-12-fix-login` (tree
`/home/dev/.mattstack/rt/worktrees/queue/acme-12`), the work skill at
`/home/dev/.claude/plugins/cache/acme/acme/1.4.0/skills/work` with its stage
files beside it.

## Method

System files come from `build-system-files.sh <tree-or-git-ref> <out-dir>`
(beside this file). It exports a scratch copy of `plugins/mattstack` (`git
archive <ref>`, or a copy of a working tree when given a path) and compiles
under an isolated HOME and `--mattstack-dir <scratch>`, writing:

| System file | How |
|---|---|
| `work.md` | `rt skills compile --verb work --preview` from copy A: `work` rostered in `pack/stubs.jsonc`, and a `feature` pipeline (provision, plan, gates, implement, self-review, ship, watch-ci) in a manifest at `<scratch>/repos/queue/skills.jsonc`, so the compiled flags read `--repo queue` |
| `stage-provision.md`, `stage-plan.md`, `stage-self-review.md` | the same compile from copy B, where the three stages are rostered verbs (engine = the same name) and no pipeline is bound |
| `board-gate.md` | gate-protocol's `SKILL.md` body with its frontmatter stripped: a board pane gating with no run |

Two copies, because a name is either a roster verb or a pipeline stage and
compile refuses both. The pipeline keeps ship and watch-ci because a work
verb's pipeline must start with provision, end with watch-ci and include
implement and ship. The script edits only its scratch copies and refuses an
`<out-dir>` inside the repo. `work.md`, `stage-provision.md` and
`stage-plan.md` contain `# Gate protocol` (inlined); all five contain a
`digraph`.

Reps are describe-only and tool-less, the shepherd-approved recipe, each
from its own fresh empty directory under the session scratchpad, 5 per
scenario, run in parallel batches and read by hand:

```sh
claude --model sonnet --tools "" --strict-mcp-config --setting-sources local \
  --settings '{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence \
  --append-system-prompt-file <system-file> -p "$(cat <scenario>)"
```

| Scenario | System file | Scenario file |
|---|---|---|
| S1 stage end | `work.md` | `scenarios/S1-stage-end.md` |
| S2 failure gate Go back | `work.md` | `scenarios/S2-failure-go-back.md` |
| S2b engine refusal | `work.md` | `scenarios/S2b-engine-refusal.md` |
| S3 compacted resume | `work.md` | `scenarios/S3-compacted-resume.md` |
| S4 unattended wait | `stage-plan.md` | reps 1-3 `scenarios/S4-unattended-wait.md`; reps 4-5 `scenarios/S4-unattended-wait-run-errors.md` (gate_ask adds `runErrors: ["waiting-gate: disk full"]`) |
| S5 occupied ticket branch | `stage-provision.md` | `scenarios/S5-occupied-ticket-branch.md` |
| S5b precheck on an older daemon | `stage-provision.md` | `scenarios/S5b-precheck-daemon-outdated.md` |
| S6 third blocking round | `stage-self-review.md` | `scenarios/S6-third-blocking-round.md` |
| S7 daemon down, unattended | `stage-plan.md` | `scenarios/S7-daemon-down-unattended.md` |
| S8 no run, herdr pane | `board-gate.md` | `scenarios/S8-no-run-wait.md` |

Each scenario scripts the results of both today's calls and the new ones,
"each applies only if you make that call", so RED and GREEN read the same
file. That lists new tool names in the prompt, and RED reps pick some up
(S5's `precheck`, see below); the scenario is identical for both versions,
so the RED/GREEN difference still comes from the skill text.

## Pass criteria

- **S1** (plan returned with `approach` and `evidence-plan` written; `run_next`
  returns `{ended: "done", next: {stage: "gates", attempt: 1, status:
  "running", file}}`): one `run_next {runDb, stage: "plan"}`, then a Read of
  the gates file; no `run_stage`, `run_snapshot` or `run_field_set`.
- **S2** (`run_next` on ship returns `failed`, scope `ship-failed:2`,
  `earlier: [provision, plan, gates, implement, self-review]`; the board
  answers Go back to implement, note "the fix needs a test"):
  `run_resolve {runDb, stage: "ship", next: "redirect", to: "implement",
  note, attempt: 2, decidedBy: "board"}`, then the implement file; no
  `shipTarget` or produce write, no `run_stage`. Second half: the same call
  resent after a compaction returns `repeated: true`, and the rep treats it
  as applied.
- **S2b** (`run_resolve` refuses: `to` is not a manifest stage): `run_hold`
  with the refusal as reason, ending held; no hand-written stage rows.
- **S3** (context holds run id `r-20261016-abc` only; `run_enter` returns
  `resumed` at plan attempt 1 running; `waiting-gate` names a gate;
  `gate_reconcile` returns `answered` with `{tier: "direct-tdd", next:
  "proceed"}` by board): `run_enter {resume: "r-20261016-abc"}` (not
  `runDb`), `gate_reconcile`, then acting on the recorded plan answer
  without re-asking; no new run, no `run_stage start`.
- **S4** (under a run, `gate_ask` returns `paneAction: "wait"`; later the
  wait finishes): `gate_ask` carries `runDb` and `stage: "plan"`; one
  background `rt gate wait <id>`; the turn ends `holding at gate <id>`; no
  AskUserQuestion, no hand-written `gate` or `waiting-gate`; on re-entry
  `gate_reconcile {id, runDb, stage}`. With `runErrors`: one line quoting it
  and the same path.
- **S5** (no domain; precheck returns one `attached` claimed tree on
  `acme-12-fix-login`; the gate answers Resume): precheck before any
  provision; the resume question on the `provision` gate; then
  `worktree_provision {repoName, branch: "acme-12-fix-login", reuse: true,
  runDb, stage: "provision"}` and `EnterWorktree`; no hand-written
  `branch`/`worktree` when `recorded: true`.
- **S5b** (precheck refused `daemon-outdated`): provisions with `codes:
  true` and `runDb`, no precheck retry, no stage failure.
- **S6** (after compaction a review finds blocking findings and the
  review-rounds budget returns `{spent: 3, limit: 3, exhausted: true}`):
  `run_budget {key: "review-rounds", limit: 3, stage: "self-review"}` then
  `run_stage {action: "fail", stage: "self-review", reason}`; no fourth fix
  round.
- **S7** (run `spawnedBy` set; `gate_ask` refuses "rt daemon
  unreachable"): `run_stage {action: "fail", stage: "plan", reason: <the
  refusal verbatim>}`; no form.
- **S8** (a board wrapper's gate, no run; `gate_ask` returns `paneAction:
  "wait"`; a doorbell arrives and `gate_reconcile` returns `answered`): no
  `runDb`/`stage` on any call, no `run_*` call, one background wait,
  `gate_reconcile {id}` on the doorbell.

## RED (system files = `main` at 98fbf05e0, plugin 0.31.15)

The skill sources this lane edits are byte-identical between that commit
and the branch base 1cb4ba5da. No rep hit an API error.

| Scenario | Pass | Deviations seen |
|---|---|---|
| S1 stage end | 0/5 | Every rep: `run_snapshot`, `run_stage done plan`, `run_stage start gates`, Read |
| S2 failure gate Go back | 0/5 | Every rep: hand bracket and `waiting-gate`, two `run_decision`s, four produce clears, `shipTarget` clear, `run_stage start implement`; Part 3 resend makes attempt 3 |
| S2b engine refusal | 0/5 | No `run_resolve`, no `run_hold`; 3 re-ask the failure gate, 2 open an off-script gate |
| S3 compacted resume | 0/5 | `run_list`, a clarify AskUserQuestion, runDb built by hand, `run_snapshot`; 4 restart plan as attempt 2; 2s `rt gate wait` instead of `gate_reconcile` |
| S4 unattended wait | 0/5 | Hand `gate` and `waiting-gate` writes; `gate_ask` without `stage`; no `gate_reconcile`; runErrors reps re-arm the marker by hand |
| S5 occupied ticket branch | 0/5 | All precheck (taken from the scenario); 3 enter the tree without `reuse`; 2 reuse, then hand-write `branch`/`worktree` anyway |
| S5b precheck on an older daemon | 0/5 | Default three-argument provision with no `codes` or `runDb`, hand-written `branch`/`worktree` |
| S6 third blocking round | 0/5 | Count read off `run_snapshot`'s budgets; no `run_budget` call; fails correctly, no fourth round |
| S7 daemon down, unattended | 5/5 | Passes; every rep still hand-writes the `gate` bracket (not a criterion) |
| S8 no run, herdr pane | 0/5 | No-run path clean, one background wait; doorbell re-read is `rt gate wait gt-77b0 --timeout 2s`, never `gate_reconcile` |

Total 5/50. As expected, the failures are the criteria that name new tools
or new options: today's text has no node for them, and reps say so.

### Per rep

- S1 rep 1: "I did not call `run_next`. The orchestrator's graph writes
  `run_stage` `done` and `start` itself and never mentions `run_next`".
- S1 rep 2: same four calls; "I don't use `run_next`: its edges are
  `run_stage done` then `run_stage start`".
- S1 rep 3: same; "it would write stage rows that this file says only the
  orchestrator owns".
- S1 rep 4: same four calls; "The skill's graph names `run_stage` for every
  `done` and `start`, so I follow that."
- S1 rep 5: same; "Using it would be an unshown move."
- S2 rep 1: Part 2 clears `commits`, `review`, `mr`, `ci` and `shipTarget`
  by hand and starts implement; Part 3 resends `run_stage start implement`
  ("It returns `{"ok":true,"attempt":3}`, and the still-running implement
  attempt 2 is ended as superseded").
- S2 rep 2: "The skill file's graph is the authority here, so I use
  `run_stage`, `run_decision` and `run_field_set`, not `run_next`,
  `run_resolve` or `gate_reconcile`"; same clears and double start.
- S2 rep 3: same; Part 3 "Steps 1-6 are idempotent and already done", then
  a second `run_stage start implement` (attempt 3).
- S2 rep 4: same clears; Part 3 attempt 3, "Attempt 3 is now the live one".
- S2 rep 5: "I do not call `run_next` or `run_snapshot`"; same clears and
  double start.
- S2b rep 1: records the board's answer with `run_decision`, opens a
  replacement gate `ship-failed:2-target`; "No `run_hold` is called".
- S2b rep 2: off-script gate `off-script:ship-failed:1` proposing a
  redirect to plan; "I make no `gate_reconcile` call, no `run_resolve`, no
  `run_hold`".
- S2b rep 3: records `to: null`, re-asks `ship-failed:2`; "`run_resolve`
  would be refused for the same reason, so I don't call it".
- S2b rep 4: re-asks the failure gate; lists `run_resolve` and `run_hold`
  under "Not called".
- S2b rep 5: off-script gate; "Picking `plan` myself would be a judgment
  call".
- S3 rep 1: "I take the resume path and do not use `run_enter`";
  `run_stage start plan` (attempt 2), then the 2s wait, `waiting-gate`
  clear, `run_decision`, both produces, `run_snapshot`, done, start gates.
- S3 rep 2: same path; "I follow it rather than `run_enter`, which the
  skill doesn't list".
- S3 rep 3: same, but skips the restart ("I do not call `run_stage start`.
  The plan row is already running"); still no `run_enter` or
  `gate_reconcile`.
- S3 rep 4: restarts plan as attempt 2; "I never open a new gate here".
- S3 rep 5: same as rep 1. No S3 rep re-asks the answered gate.
- S4 rep 1: `run_field_set gate`, `gate_ask` with no run params, hand
  `waiting-gate`; Part 2 "I skip `gate_reconcile` and the 2s `rt gate wait
  --timeout` re-read".
- S4 rep 2: same; "those serve the words and doorbell paths".
- S4 rep 3: `gate_ask {runDb, kind: "plan", ...}` with no `stage`; hand
  marker; no `gate_reconcile`.
- S4 rep 4 (runErrors): "The `runErrors` entry ... means the daemon's own
  marker write failed. I do not rely on it, so I set the marker myself."
- S4 rep 5 (runErrors): "belongs to the daemon's own attempt, so I still arm
  the marker myself".
- S5 rep 1: "The stage file doesn't name `precheck`, so this is my
  addition"; gate, then EnterWorktree and hand-written `branch`/`worktree`.
- S5 rep 2: precheck with `runDb`; under "Not called": "`reuse: true` ...
  isn't on the graph's resume edge".
- S5 rep 3: precheck, gate, `worktree_provision {..., reuse: true, runDb,
  stage: "provision"}`, EnterWorktree, then two `run_field_set` writes for
  `branch` and `worktree`.
- S5 rep 4: "I do not call `worktree_provision` with `reuse: true`, because
  the stage file does not call for it."
- S5 rep 5: reuse ("I add this call because the tree is claimed"), then the
  same hand writes after `recorded: true`.
- S5b reps 1-5: one three-argument `worktree_provision`; rep 2: "The stage
  file doesn't mention `precheck` or `codes`, so I don't send them"; rep 5
  "so I don't send `precheck`, `codes`, `runDb` or `stage`".
- S6 rep 1: reads the budget off `run_snapshot`; "The stage file names no
  tool for charging the budget, so I make no separate charge call."
- S6 rep 2: `run_snapshot`, then fail; no fix.
- S6 rep 3: "The stage file names no tool for charging the budget, so I
  don't invent one."
- S6 rep 4: `run_snapshot`, fail, "No fix or commit: a fourth round would go
  past the limit of 3."
- S6 rep 5: same; "I don't invent one".
- S7 reps 1-5: `run_field_set gate`, `gate_ask` refused, then `run_stage
  {action: "fail", stage: "plan", reason: "rt daemon unreachable at
  /home/dev/.mattstack/rt/rt.sock (connect ENOENT)"}`; rep 3: "Unattended
  panes never get the registry-less form fallback".
- S8 rep 1: "I don't call `gate_reconcile`, because the graph's re-read node
  is `rt gate wait <id> --timeout 2s`."
- S8 rep 2: same; "`gate_reconcile`, which the protocol doesn't have".
- S8 reps 3-5: same 2s re-read; no run params anywhere; one background wait.

## Scenario iterations during RED

| Scenario | Change | Why | RED before, after |
|---|---|---|---|
| S2b | Dropped the scene sentence saying this run's pipeline has no `evidence` stage | It told the rep about the refusal before any call, so no rep tried to apply the Go back | 0/5, 0/5 (first pass: 2 reps held with the hand-written `run_decision hold:ship:2` + `run_field_set hold` pair, 2 re-asked the failure gate, 1 opened an off-script gate) |
| S6 | Dropped "It does not say how many review rounds have run" | It pointed the rep at the scripted counter | 5/5, 5/5 |
| S6 | Described the budget by what it holds instead of keying the result to a `run_budget` call, and added the budgets row a v3 `run_snapshot` carries | With the tool and its exact arguments in the scenario, every RED rep called `run_budget` from the scenario alone, so S6 could not tell the texts apart | 5/5, 0/5 |

The committed S6 keeps the brief's result values verbatim (`{"key":
"review-rounds", "spent": 3, "limit": 3, "remaining": 0, "exhausted":
true}`) as "a call that charges it for this review returns", without naming
the tool.

Probe (scratch only, not committed): S6 with no budget anywhere in the
scene. All 5 RED reps reset the count after compaction and start a fourth
fix round ("I'm in review round 1 of 3"; "this is round 1 of 3 allowed, so
I fix it test-first"). That is the compaction failure the budget exists
for; the committed S6 hands the count over through the snapshot, so its RED
fails on the missing `run_budget` call, not on a fourth round.

Leak noted, kept: S5's scripted precheck result led all 5 RED reps to send
`precheck: true` although today's text has no precheck. They still fail on
`reuse` and the hand writes.

## GREEN

System files come from the working tree, built with `build-system-files.sh
<checkout> <out-dir>`, using the same rep recipe and 5 reps per scenario,
each read by hand. Each row names the rewrite it measures.

### Task 2: gate-protocol on the run-aware gate tools

gate-protocol is rewritten and its structured-context reference moves to
`structured-context.md`. `stage-plan` is still today's text (Task 5 moves
it), so S4 and S7 test the new protocol under the old stage file. Task 5
re-runs them. The three scenarios ran twice: first on the rewrite, then on
the final text, which puts back one mapping rule the first cut had dropped
(on a multi `writeIn` question, "Other" text beside ticks rides as a note).
Both runs scored the same, and the quotes below come from both. No rep hit
an API error, and no refactor round was needed.

| Scenario | RED | GREEN | Notes |
|---|---|---|---|
| S4 unattended wait | 0/5 | 5/5 | Every rep: `gate_ask {kind: "plan", runDb, stage: "plan", ...}`, one background `rt gate wait gt-5b19`, `holding at gate gt-5b19`, then `gate_reconcile {id: "gt-5b19", runDb, stage: "plan"}`. No AskUserQuestion, no hand-written `gate` or `waiting-gate`, no timed re-read. The runErrors reps (4-5) quote `waiting-gate: disk full` in one line and take the same path |
| S7 daemon down, unattended | 5/5 | 5/5 | Regression guard only: RED already passed, so this row shows no regression, not that the rewrite helped. Every rep: `gate_ask` with `runDb` and `stage`, then `run_stage {action: "fail", stage: "plan", reason: "rt daemon unreachable at /home/dev/.mattstack/rt/rt.sock (connect ENOENT)"}`, no form. The hand-written `gate` bracket that every RED rep wrote is gone |
| S8 no run, herdr pane | 0/5 | 5/5 | Every rep: `gate_ask` with no `runDb`, `stage` or `subject`, one background wait, `holding at gate gt-77b0`, then `gate_reconcile {id: "gt-77b0"}` on the doorbell, and acts on the board's answer. No `run_*` call anywhere, and no timed `rt gate wait` |

Per rep:

- S4 reps 1-3: "`gate_ask` arms `waiting-gate` itself on `wait`, so I make
  no `run_field_set` for it" (rep 3); "I don't call `rt gate wait --timeout
  2s`, because `gate_reconcile` is the one re-entry call" (rep 2).
- S4 rep 4 (runErrors): "I quote the run error in one line ... I don't
  re-ask the gate or write `waiting-gate` myself."
- S4 rep 5 (runErrors): same path; "The stop hook may bounce the turn
  because of the missing marker, but I still don't write the field."
- Every S4 rep then acts on Proceed with today's stage-plan nodes
  (`run_decision execution-strategy@1`, then the `approach` and
  `evidence-plan` writes). No rep records a `gate@1` decision by hand: "I
  make no gate@1 `run_decision`, because `gate_reconcile` already recorded
  the plan gate" (second run, rep 3).
- S7 reps 1-5: the same three calls. Rep 2 mistyped the runDb in its
  `run_field_get` and `run_stage` as `/home/dev/.mattstack/rt/runs/...`
  (its `gate_ask` had it right). That is a transcription slip, not a
  protocol deviation, and the S7 criterion does not cover it.
- S8 reps 1-5: "There is no `runDb` or `stage`, since there is no run"
  (rep 1); "a timed wait would also be a second wait on a gate that
  already has one running" (rep 2).
