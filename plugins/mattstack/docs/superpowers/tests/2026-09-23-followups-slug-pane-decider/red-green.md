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

List-shaped pane answers across these runs: 3/45 before (the two
baseline scenarios and the slug candidate) and 0/40 after. No rep sent
`text` from the pane in any arm. The earlier record saw `text` only
inside list-shaped answers, and none appeared here.

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
- Multi-select answers stay arrays, single-select answers are strings,
  and `thread-1` is `{"value": [...], "note": ...}` in every rep.

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

- **Follow-up 1:** stage-provision-slug baseline 6/10 strict; 10/10 on
  the final tree, and 15/15 on the slug itself with the old
  gate-protocol. The typed slug now reaches the record and `--title`
  because the stage says the note is the slug.
- **Follow-up 2:** 0 list-shaped answers and 0 pane `text` across 10
  stage-plan-rename and 20 post-pane-typed reps, down from 1/30
  list-shaped (3/45 counting the slug candidate). Scenario criteria hold:
  stage-plan-rename 10/10, and post-pane-typed 19/20 on both arms with
  the same forge slip.
- **Follow-up 3:** review's clarify record names the answering surface.
  No other gate record in skill text names a verb, and stage-plan's
  slot-decision record keeps its wrapper decider on purpose.
