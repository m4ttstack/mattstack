# RED/GREEN: the typed slug, the pane answer's shape, review's decider

Three follow-ups on one branch, after `../2026-09-23-gate-protocol-note-scope/`:

1. `attachments/pipeline/stage-provision/SKILL.md`: the provision gate's
   `slug` bullet never said that a slug typed in the pane form arrives as
   the answer's note.
2. `attachments/gate-protocol/SKILL.md`, the form branch of "Acting on
   the response": the pane's `rt gate answer` sometimes came back as a
   list of `{"id": ...}` objects instead of an object keyed by question
   id.
3. `attachments/review/review/SKILL.md`: the clarify gate's record used
   `--decided-by review`, a verb name.

## Wording

### 1. stage-provision

Old:

> - `slug`, only on a generic title: the slug as their text

New:

> - `slug`, only on a generic title: the slug as their text. From the
>   in-pane form, a slug they type rides as the note on this question's
>   answer, with the value left as the option the form offered; that note
>   is the slug to use.

### 2. gate-protocol

Old:

> submit the chosen option's `value` verbatim: `rt gate answer <id>
> --answers '<json>' --by pane` (or the `gate_answer` tool).

New:

> submit the chosen option's `value` verbatim, in one object keyed by
> question id:
> `rt gate answer <id> --answers '{"<question id>": "<value>" | ["<value>", ...] | {"value": ..., "note": "..."}}' --by pane`
> (or the `gate_answer` tool).

The shape problem is output shape, not a broken rule, so the fix shows
the shape instead of forbidding a list.

### 3. review

Old: `rt runs decision record --contract gate@1 --scope clarify
--selection '{"target":"<picked>"}' --decided-by review`

New: `rt runs decision record --contract gate@1 --scope clarify
--selection '{"target":"<picked>"}' --decided-by <the answer's by>`

self-review's and checkout's clarify records already use `<the answer's
by>`.

Tree-wide search, `rg -n -U -- '--decided-by\s+\S+'`, then every hit
not followed by a surface name or a `<placeholder>`:

| Hit | Before | After |
|---|---|---|
| `attachments/review/review/SKILL.md:75` | `--decided-by review` (gate@1 clarify) | `--decided-by <the answer's by>` |
| `attachments/pipeline/stage-plan/SKILL.md:102` | `--decided-by stage-plan` (`execution-strategy@1`) | unchanged: a v2 slot decision, not a gate. The parameterized-skills convention records slot decisions `--decided-by <wrapper>`, and an earlier commit set this line back to `stage-plan` on purpose. |
| `attachments/pipeline/work/SKILL.md:64` | `--decided-by <spawning surface>` | unchanged: already a surface |
| `attachments/forge/checkout/SKILL.md:39` | `--decided-by <the answer's by>` | unchanged |
| `docs/superpowers/specs/2026-09-01-pipeline-gates-design.md:200`, `docs/superpowers/specs/2026-09-02-engine-followups-design.md:45` | `--decided-by work`, `--decided-by self-review` | unchanged: dated design specs, not skill text |

No reps: the change is mechanical.

## Method

As in `../2026-09-23-gate-protocol-note-scope/red-green.md`:

- **Reps:** single-shot and tool-less, `claude --model sonnet --tools ""
  --strict-mcp-config --append-system-prompt-file <system-file> -p
  <scenario>`, a fresh empty directory per rep, run in parallel.
- **System file:** the verb compiled with no fills (`rt skills compile
  --pack-dir <copy of the tree whose pack/stubs.jsonc rosters
  stage-provision, stage-plan, receive-review and review> --verb <verb>
  --preview`).
- **Arms:**
  - baseline: `main` at 0.18.0. Its gate-protocol and stage-provision
    text match 0.17.25.
  - slug candidate: the new stage-provision bullet with the old
    gate-protocol.
  - final: both wording changes, which is this branch.
- **Scoring:** a script flags list-shaped answers, `text` in any `rt gate
  answer`, top-level `glab mr note` calls, exact reply strings, slug,
  title and close. I then read every rep by hand.

Scenarios, verbatim copies in `scenarios/`:

- `stage-provision-slug.md`
- `stage-plan-rename.md`
- `post-pane-typed.md`
- `post-act-edited.md`

## Pass criteria (strict)

- **stage-provision-slug:**
  - the typed slug `reject-negative-delay` is the record's `slug` and
    the `--title`;
  - the pane's answer is an object keyed by question id, with `slug` as
    `{"value": "suggested", "note": "reject-negative-delay"}`, never
    `text`, and `--by pane`.
- **stage-plan-rename:**
  - the plan and the `gate@1` record carry the renamed line;
  - the pane's answer is an object keyed by question id, and
    `failing_test` carries the line as `note`, never `text`, with
    `--by pane`;
  - the stage finishes: the `execution-strategy@1` record, `approach`,
    `evidence-plan` and `stage-done`.
- **post-pane-typed:** the criteria in
  `../2026-09-22-respond-post-edited-text/red-green.md` still apply:
  - the pane's answer carries the typed text as T1's `note`, never
    `text`, with `--by pane`;
  - T1 posts its exact draft (with `--` intact) as a thread reply, then
    resolves; T2 resolves only;
  - no top-level note and no approval;
  - the record has T1's note, no `text`, and `--decided-by pane`;
  - the run closes.
  - This record adds one more: the answer is an object keyed by question
    id.
- **post-act-edited:** that record's criteria:
  - T1 posts the answer's `text` exactly and resolves; T2 resolves only;
    T4 posts its draft and stays open;
  - no top-level note;
  - the record is T1 with `text`, T2 and T4 without, and
    `--decided-by board`;
  - the run closes.

## Follow-up 1: stage-provision-slug

| Arm | Strict | Typed slug used | List-shaped | Pane `text` |
|---|---|---|---|---|
| baseline, 10 reps | 6/10 | 6/10 | 0/10 | 0/10 |
| slug candidate, 15 reps | 13/15 | 15/15 | 2/15 | 0/15 |
| final, 10 reps | 10/10 | 10/10 | 0/10 | 0/10 |

Baseline, per rep:

- Reps 1, 2, 3, 4, 6, 9: PASS. They use the typed slug, reading "each
  verb's own act step's call" as leave to take the note.
- Rep 5: FAIL, keeps `fix-delay`: "this stage's contract doesn't wire
  that note into the slug".
- Rep 7: FAIL, keeps `fix-delay`: "The domain rule for this gate doesn't
  say to read notes as overrides".
- Rep 8: FAIL, keeps `fix-delay`: the typed slug "travels only as
  commentary".
- Rep 10: FAIL, keeps `fix-delay`: "this domain's rule doesn't say to
  honor the note as an override".

Every baseline rep sends `{"value":"suggested","note":"reject-negative-delay"}`,
so the note gets through. Each miss is the stage not saying that the
note is the slug.

Slug candidate, per rep:

- Reps 1, 3 and 5 to 15: PASS. Rep 14 quotes the bullet: "a slug they
  type rides as the note on this question's answer... that note is the
  slug to use."
- Reps 2 and 4: FAIL on shape only. The slug, record, title, value and
  note are all right, but the answer is
  `[{"id":"slug","value":"suggested","note":"reject-negative-delay"},{"id":"next","value":"proceed"}]`.

Final, per rep: reps 1 to 10 PASS. Every answer is
`{"slug": {"value": "suggested", "note": "reject-negative-delay"}, "next": "proceed"}`,
the record's `slug` and `--title` are `reject-negative-delay`, and every
rep uses `--decided-by pane`. Reps 2, 5, 6, 7 and 9 also copy
`"next":"proceed"` into the record's `domain` (baseline reps 8 and 10 do
too). This is unscored and has no effect on the slug.

## Follow-up 2: the pane answer's shape

| Scenario | Arm | Strict | List-shaped | Pane `text` |
|---|---|---|---|---|
| stage-plan-rename | baseline, 10 reps | 9/10 | 1/10 | 0/10 |
| stage-plan-rename | final, 10 reps | 10/10 | 0/10 | 0/10 |
| post-pane-typed | baseline, 20 reps | 19/20 | 0/20 | 0/20 |
| post-pane-typed | final, 20 reps | 19/20 | 0/20 | 0/20 |
| stage-provision-slug (from above) | slug candidate / final | 13/15, 10/10 | 2/15, 0/10 | 0 |

The strongest evidence is stage-plan-rename's spread of shapes. The
baseline's ten answers came in three shapes: 5 plain strings, 4
`{"value": ...}` wrappers and 1 list. All ten final answers use one
shape: plain strings, with the note object on `failing_test`. On the
two target scenarios, list-shaped answers went from 1/30 to 0/30. No
rep sent `text` from the pane in either arm. The earlier record saw
`text` only inside list-shaped answers, and none appeared here.

stage-plan-rename baseline, per rep:

- Reps 1 to 9: PASS. They rename, record the line as `failing_test`,
  send it as the note, and finish.
- Rep 10: FAIL on shape only. It sends
  `[{"id":"tier",...},{"id":"failing_test","value":"keep","note":...},{"id":"next",...}]`
  and does everything else right.
- Object shapes vary: reps 2, 3, 5 and 9 wrap single values as
  `{"value": ...}`, and reps 1, 4, 6, 7 and 8 send plain strings.

stage-plan-rename final, per rep: reps 1 to 10 PASS. All ten send
`{"tier": "direct-tdd", "failing_test": {"value": "keep", "note": ...}, "next": "proceed"}`,
so the variance is gone. Rep 3 also copies the line into the record's
`note`, which is harmless.

post-pane-typed baseline, per rep:

- Reps 1 to 11 and 13 to 20: PASS. Each posts the exact draft with `--`
  intact, T1's note is in the record, and the run closes.
- Rep 12: FAIL. It posts T1's draft with `glab mr note 87 --repo
  acme/queue -m "..."`, a top-level MR note rather than a reply on T1's
  discussion.

post-pane-typed final, per rep:

- Reps 1 to 4 and 6 to 20: PASS.
- Rep 5: FAIL. It makes the same slip, `glab mr note 87 --message "..."`,
  and resolves T1's discussion separately.
- `thread-1` is `{"value": [...], "note": ...}` in every rep of both
  arms.
- `next` is the only answer that changed shape: 8/20 baseline reps wrap
  it as `{"value": "proceed"}` (reps 2, 3, 7, 10, 12, 15, 17 and 18),
  and 0/20 final reps do.
- The multi-select `thread-2` is wrapped as `{"value": [...]}` in 10/20
  reps in each arm, which is valid. That did not change.

## Shared-include regressions (final)

- **post-act-edited: final 9/10, control on baseline 10/10.**
  - Final reps 2 to 10 PASS. Each posts T1's `text` exactly, resolves T1
    and T2, posts T4's draft, writes the record T1 with `text` and T2 and
    T4 without, uses `--decided-by board`, and closes.
  - Rep 8 names "`glab mr note` / the forge adapter, targeting thread
    T1", which is a thread reply, so it passes.
  - Final rep 1: FAIL. It posts T1's text with `glab mr note 87 --repo
    acme/queue -m "..."` "(or the equivalent discussion-reply API call)",
    a top-level note. The rest of the rep is right.
  - Baseline reps 1 to 10: PASS.
- **stage-provision-slug: 10/10**, above.

## The top-level-note slip

Three reps improvise `glab mr note <iid> -m` for a thread reply: baseline
pane rep 12, final pane rep 5 and final act-edited rep 1. That is 1 of 30
on the baseline arm and 2 of 30 on the final arm. The compiled verb has
no forge fill, so every rep invents its own posting command, and the
change touches only the pane's answer shape. post-act-edited never
reaches the form branch, because board answered. This is noise from the
harness, not a regression. A filled pack supplies the real
thread-reply mechanics.

## Verdict

- **Follow-up 1:** stage-provision-slug went from 6/10 strict on the
  baseline to 13/15 strict on the slug candidate (15/15 used the slug)
  and 10/10 strict on the final tree. The typed slug now reaches the
  record and `--title` because the stage says the note is the slug.
- **Follow-up 2:**
  - stage-plan-rename's answers went from three shapes to one.
  - `next` wrapping fell from 4/10 to 0/10 on stage-plan-rename and from
    8/20 to 0/20 on post-pane-typed.
  - List-shaped answers went from 1/30 to 0/30 on the two target
    scenarios, and no pane sent `text` in either arm.
  - Scenario criteria hold: stage-plan-rename 10/10, and post-pane-typed
    19/20 on both arms with the same forge slip.
- **Follow-up 3:** review's clarify record names the answering surface.
  No other gate record in skill text names a verb, and stage-plan's
  slot-decision record keeps its wrapper decider on purpose.

## Fix round

The first round's review asked for four more changes. They share one
arm: the tree with all four applied, compiled with no fills. RED is the
first round's committed tree.

### Wording

**review's clarify gate** (`attachments/review/review/SKILL.md`, step 1).
The gate asked through the structured-question tool, so the record's
`<the answer's by>` had no registry answer behind it, and board or
console could never answer it.

- Old: "one sentence naming the candidates, then the structured-question
  tool with one option per candidate and **Hold** (`rt runs field set
  gate clarify ...` before, ... `--decided-by <the answer's by>` after)."
- New: "one sentence naming the candidates, then run gate-protocol's
  Runs integration with kind `clarify` and these questions: one option
  per candidate, and **Hold** (the same before and after)."
- This matches checkout and self-review.

**stage-provision's slug bullet.** The wording now covers every surface
and names the option they picked.

- Old: "From the in-pane form, a slug they type rides as the note on
  this question's answer, with the value left as the option the form
  offered; that note is the slug to use."
- New: "A slug they type arrives as this answer's note (or its `text`,
  from a surface that edits offered text), with the value left as the
  option they had picked; that typed slug is the one to use."

**gate-protocol, the decider rule's scope.**

- The CAS paragraph now says "A `gate@1` record's `--decided-by` always
  names the WINNER" (was "A decision record's").
- The Runs integration parenthetical now reads "(a `gate@1` record's
  `--decided-by` is `pane`, `board`, `console`, or `shepherd`, never a
  verb name.)" (was "(`--decided-by` is ...)").
- stage-plan's `execution-strategy@1` record, a slot decision, no longer
  reads as a contradiction.

**gate-protocol, questions with no options.** The form branch gains "A
question with no options takes what the human typed as its value." The
daemon's validator (`validateGateAnswers` in `@mattstack/rt-client`)
checks membership only when `question.options.length > 0`.

### New scenarios

- `scenarios/review-clarify.md`: a hand-run review of "issue 7", where
  `glab mr list --search 7` finds !87 and !91. The human picks !87.
- `scenarios/evidence-intake-open.md`: the evidence gate is open with
  `case_id`, `"options": []`, and the human types "job 4411, queued with
  delay -5" in the form.

### Tallies

| Scenario | RED | GREEN | Strict pass |
|---|---|---|---|
| review-clarify, 5 reps | 1/5 open a registry gate | 3/5 strict (5/5 route through `rt gate ask --kind clarify`; 2 payloads the daemon refuses) | the gate is bracketed, `rt gate ask --kind clarify` with a daemon-valid array, `--by pane`, and `--decided-by pane` |
| evidence-intake-open, 3 reps | 1/3 clean (reps 1 and 3 send `{"value": ..., "text": ...}` from the pane) | 3/3 | the typed text is the value, with no note and no `text` |
| stage-provision-slug, 5 reps | (first round) | 5/5 | first-round criteria, and no pane `text` despite the new mention of `text` |
| stage-plan-rename, 5 reps | (first round) | 5/5 | first-round criteria; one shape in every rep |
| post-pane-typed, 5 reps | (first round) | 5/5 | first-round criteria; no top-level note in this batch |

review-clarify RED, per rep:

- Reps 1, 2, 4 and 5 ask with AskUserQuestion directly, then record
  `--decided-by pane` with no registry gate behind it.
- Rep 3 opens `rt gate ask --kind clarify` on its own.

review-clarify GREEN, per rep:

- Every rep runs `rt runs field set gate clarify --stage review`, then
  `rt gate ask ... --kind clarify` with !87, !91 and Hold, then presents
  the form.
- Every rep then runs `rt gate answer <id> --answers '{"target": "!87"}'
  --by pane` and `rt runs decision record --contract gate@1 --scope
  clarify --selection '{"target":"!87"}' --decided-by pane`, and records
  `mr`, `branch` and `ticket`.
- Reps 1 and 3 pass `--questions '{"questions":[...]}'`, an object
  rather than the array `rt gate ask` takes. The daemon refuses a
  non-array with `invalid questions` (`lib/daemon/handlers/gate.ts` in
  repo-tools), and gate-protocol's refusal rule has the rep fix the
  call. The shape comes from gate-protocol's `--questions '<questions
  json>'` placeholder. Strictly, 3/5 would open on the first try. The
  gaps below close this.
- Every rep puts Hold as a third option of the candidate question,
  though gate-protocol says navigation is its own `next` question.

evidence-intake-open GREEN, per rep:

- Reps 2 and 3 send `"case_id": "job 4411, queued with delay -5"`.
- Rep 1 sends `{"value": "job 4411, queued with delay -5"}`, which is
  valid and carries no note or `text`.
- Every rep records `"intake":{"case_id":"job 4411, queued with delay
  -5"}` with `--decided-by pane`.

## Gaps closed

The fix round's reps turned up three gaps, and Matt approved closing
them in the same round. The fix round's GREEN tree, commit `806ec23`,
is RED here. GREEN is the tree with all three applied, compiled with no
fills.

### Wording

**1. The questions shape** (gate-protocol).

- The Publish block's `rt gate ask --questions '<questions json>'`
  becomes `--questions '[{"id": ..., "label": ..., "options": [...]},
  ...]'`.
- Runs integration step 2's `'<questions json>'` becomes `'<questions
  json array>'`.

**2. Hold placement** (review's and checkout's clarify gates).

- review, old: "these questions: one option per candidate, and **Hold**".
- review, new: "these questions: `target`, one option per candidate,
  and `next`: **Proceed** (recommended) / **Hold**".
- checkout, old: "these questions: one option per candidate, their
  text, and **Hold**".
- checkout, new: "these questions: `branch`, one option per candidate
  or their text, and `next`: **Proceed** (recommended) / **Hold**".
- Each question id matches its record's selection key. The `next`
  wording follows self-review's `next` without **Iterate here**, since
  a pick-one gate has nothing to iterate on.

**3. The option-values rule** (gate-protocol, "Answers are option
values").

- Old: "Every answer value must exactly match one of the question's
  option VALUES".
- New: "For a question with options, every answer value must exactly
  match one of its option VALUES".
- This agrees with the form branch's "A question with no options takes
  what the human typed as its value."

### Tallies

| Scenario | RED (`806ec23`) | GREEN | Strict pass |
|---|---|---|---|
| review-clarify, 5 reps | 3/5 daemon-valid array; 0/5 Hold in `next` | 5/5 | a bare questions array on the first try, Hold in a `next` question, `--by pane`, `--decided-by pane` |
| evidence-intake-open, 3 reps | 3/3 | 3/3 | the typed text is the value, with no note and no `text` |
| stage-plan-rename, 5 reps | 5/5 | 5/5 | first-round criteria |
| post-pane-typed, 5 reps | 5/5 | 5/5 | first-round criteria |

review-clarify GREEN, per rep:

- Every rep runs `rt runs field set gate clarify --stage review`, then
  `rt gate ask --questions '[{"id":"target",...,"options":[!87, !91]},{"id":"next",...,"options":[proceed, hold]}]'
  --kind clarify`. That is a bare array, with Hold only in `next`.
- Every rep then runs `rt gate answer <id> --answers
  '{"target":"!87","next":"proceed"}' --by pane` and `rt runs decision
  record --contract gate@1 --scope clarify --selection
  '{"target":"!87"}' --decided-by pane`.
- Rep 4 records `mr` as `!87` rather than the MR URL and skips `glab mr
  view`. That is identity recording, outside this scenario's criteria.

evidence-intake-open GREEN: all three reps send `"case_id": {"value":
"job 4411, queued with delay -5"}`, which is valid and carries no note
and no `text`. Each rep records `"intake":{"case_id":"job 4411, queued
with delay -5"}` with `--decided-by pane`.

stage-plan-rename GREEN: all five rename, send
`{"tier":"direct-tdd","failing_test":{"value":"keep","note":...},"next":"proceed"}`,
record the line as `failing_test` and finish the stage.

post-pane-typed GREEN:

- All five send thread-1 as `{"value":[...],"note":...}` with `--by
  pane`.
- Each posts T1's exact draft with `--` intact as a thread reply, then
  resolves T1. T2 is resolved only.
- Each records T1's note with no `text`, uses `--decided-by pane`, and
  closes.

checkout had no reps. Its clarify wording now matches review's shape,
which review-clarify tested.
