# RED/GREEN: gate-protocol leaves what a note replaces to each verb

Scope: `attachments/gate-protocol/SKILL.md`, "## Answers are option
values", the section every gated verb inlines. 0.17.24 closed it with
"The note never replaces anything; `text` replaces only what the verb's
own act step names." That sentence was written for respond-post, but it
reaches every includer. stage-plan's `failing_test` question takes a
rename as "their text", and in the pane form that text arrives as the
answer's note, so the shared sentence told stage-plan to drop it.

Old last sentence (0.17.24):

> The note never replaces anything; `text` replaces only what the verb's
> own act step names.

New last sentence:

> What a note or `text` changes is each verb's own act step's call; the
> protocol swaps neither in for offered text by itself.

The two sentences before it stay as they are: the `text` field, and the
in-pane form never sending `text` (a typed replacement rides as a note).
receive-review's step 6 already says for itself that the pane's note
never edits the reply, so it needs no edit.

## Method

As in `../2026-09-22-respond-post-per-thread/respond-post.md`:

- **Reps:** single-shot and tool-less, `claude --model sonnet --tools ""
  --strict-mcp-config --append-system-prompt-file <system-file> -p
  <scenario>`, a fresh empty directory per rep, run in parallel.
- **System file:** the verb compiled with no fills (`rt skills compile
  --pack-dir <copy of the tree whose pack/stubs.jsonc rosters
  stage-plan, receive-review and stage-provision> --verb <verb>
  --preview`).
- **Arms:** RED is the 0.17.24 tree; the control is the same tree with
  gate-protocol swapped for 14a7650's (0.17.23, no `text` sentences);
  GREEN is this commit's tree.
- **Scoring:** every rep read by hand.

## Scenarios

All three are committed in `scenarios/`, on the invented project
gitlab.example.com/acme/queue.

- `stage-plan-rename.md`: an attended pane at the plan gate after it
  printed direct-tdd with FAILING TEST `queue/enqueue.test.ts "enqueue
  validates delay"`. The form comes back with the failing-test pick left
  on "Keep it (Recommended)" and a renamed line typed in the free-text
  field. The rep writes the `rt gate answer` itself, then names the line
  the plan carries and every command to the end of the stage.
- `stage-plan-rename-given.md`: the same, but the scenario hands the rep
  the submitted answer, `{"value": "keep", "note": "<renamed line>"}`.
- `stage-provision-slug.md`: the provision gate on a too-generic title,
  with the domain rules asking for a slug. The pick stays on the
  suggested slug and the human types another in the free-text field.

## Pass criteria (strict)

- **stage-plan-rename:** the plan carries the renamed line exactly; the
  `gate@1` record's `failing_test` is that line; the pane's `rt gate
  answer` carries it as the `failing_test` answer's `note`, never `text`,
  with `--by pane`; the stage finishes (the `execution-strategy@1`
  record, `approach` and `evidence-plan`, `stage-done`).
- **stage-plan-rename-given:** the renamed line in the plan and in the
  record, and the stage finishes.
- **stage-provision-slug:** the typed slug in the record and in
  `--title`, carried as a note from the pane.
- **Regressions:** `post-pane-typed` and `post-act-edited` from
  `../2026-09-22-respond-post-edited-text/scenarios/`, under that
  record's strict criteria (exact posted strings, forge actions exactly
  the picks, the record, the close).

## stage-plan-rename

| Arm | Strict | Old line kept | Pane sent `text` |
|---|---|---|---|
| RED (0.17.24), 10 reps | 3/10 | 6/10 | 1/10 |
| Control (0.17.23), 5 reps | 5/5 | 0/5 | 0/5 |
| GREEN (committed), 10 reps | 9/10 | 0/10 | 1/10 |

RED, per rep:

- Rep 1: FAIL. It keeps "enqueue validates delay" and records the typed
  line as the gate's `note`: "the note never replaces anything".
- Rep 2: PASS. It renames: "The stage's own act step is what names what
  that note replaces".
- Rep 3: FAIL. It keeps the old line: "the note never replaces anything".
- Rep 4: FAIL. It keeps the old line: "a note never replaces anything".
- Rep 5: FAIL. It renames, but its `rt gate answer` sends the line as
  `text` from the pane.
- Rep 6: FAIL. It keeps the old line, quoting "the note never replaces
  anything".
- Rep 7: FAIL. It keeps the old line: the note "never replaces
  anything".
- Rep 8: PASS. It renames, quoting the pane sentence.
- Rep 9: FAIL. It keeps the old line: "a note never replaces anything".
- Rep 10: PASS. It renames.

Control, per rep: all five rename, send the line as the pane answer's
note, record it as `failing_test` and finish the stage.

Answer shape is unscored in every arm, and this change does not touch
it. Some reps submit `rt gate answer` as a list rather than an object
keyed by question id:

- RED reps 5 and 7, and GREEN reps 1, 2, 3 and 9, send a list of
  `{"id": ..., "value": ...}` objects;
- control reps 3 and 5 send a list of `{value, note}` objects with no
  question ids.

A literal reading of the criterion ("the `failing_test` answer's
`note`") finds no `failing_test` answer in those two control reps, and
would score the control 3/5. Both reps still rename and record the new
line, so the conclusion is unchanged.

GREEN, per rep (reps 1 to 5 first batch, 6 to 10 second):

- Reps 1, 2, 4, 5: PASS. Reps 1 and 2 name the rule they followed:
  "what a note ... changes is each verb's own act step's call", "This
  stage's own act step is what decides what the note means".
- Rep 3: FAIL. It renames, but its `rt gate answer` sends the line as
  `text` in a list-shaped answer, the same slip as RED rep 5.
- Reps 6 to 10: PASS. Rep 7: "interpreting that note is explicitly left
  to my act step, not the protocol."

## Wording iterations

Both candidates replaced only the last sentence, and each ran 5 reps of
stage-plan-rename:

| Candidate | Renamed | Pane sent `text` | Strict |
|---|---|---|---|
| "What a note or `text` changes is each verb's own steps' call, never this protocol's." | 5/5 | 4/5 | 1/5 |
| **committed:** "What a note or `text` changes is each verb's own act step's call; the protocol swaps neither in for offered text by itself." | 5/5 | 0/5 | 5/5 |

The shorter candidate fixed the rename but loosened the pane rule: four
reps read "never this protocol's" as leave to send `text`. The committed
wording, reflowed into the section, is the GREEN arm above.

## stage-plan-rename-given

RED 5/5, control 5/5, GREEN 5/5. With the note handed over as part of
the scenario, every arm reads it as the rename. This variant does not
tell the arms apart. The regression shows only when the rep composes the
pane answer itself, which puts the gate-protocol section in play at the
moment of reading the note.

## Regressions (GREEN)

- **post-pane-typed 5/5.** Every `rt gate answer` carries the typed reply
  as T1's `note`, never `text`, with `--by pane`. T1 posts its exact
  draft, `--` intact, and resolves. T2 resolves only. The record is
  T1 `{"post":true,"resolve":true,"note":"Fixed in ab12cd3: ..."}` and
  T2 `{"post":false,"resolve":true}`, with no `text` and
  `--decided-by pane`. Every rep closes. Reps 1 and 3 add a line telling
  the human that the typed edit did not post.
- **post-act-edited 5/5.** T1 posts the answer's `text` exactly and
  resolves. T2 resolves without a post. T4 posts its draft exactly and
  stays open. The record is T1 with `text`, T2 and T4 without, and
  `--decided-by board`. Every rep closes, with no top-level note and no
  approval.

## stage-provision-slug (optional probe)

| Arm, 10 reps each | Typed slug sticks | How |
|---|---|---|
| RED (0.17.24) | 0/10 | every rep keeps `fix-delay`; reps 2 and 10 quote "the note never replaces anything" |
| Control (0.17.23) | 5/10 | each pass switches the answer's value to `other` and uses the note as the slug; each miss keeps `suggested` because the pick never moved |
| GREEN (committed) | 4/10 | each pass keeps `suggested` and reads the note as the slug, on the act-step rule; the misses keep `fix-delay` |

The typed slug crossed the note channel 0/10 times on 0.17.24. This
change brings that back to about the control level, and no further: the
slug still loses 6/10 on GREEN. The control itself is a coin flip. stage-provision's own question ("the slug as their
text") does not say that a pane note carries that text, and a
still-selected suggestion reads as a pick. One GREEN miss (rep 8) says
so: "I have no domain rule here telling me to treat a note on this
question as a replacement". That residual belongs to stage-provision's
own wording, not to this section. Every arm sends the slug as `note`,
never `text`.

## Verdict

- stage-plan's rename: RED 3/10 strict, with 6/10 keeping the old line
  on "the note never replaces anything". Control 5/5 (3/5 on a literal
  reading of the answer-shape criterion); GREEN 9/10 strict, and 10/10
  renamed.
- receive-review keeps its pane rule on its own: post-pane-typed and
  post-act-edited stay 5/5 strict.
- stage-provision's typed slug: RED 0/10, control 5/10, GREEN 4/10. The
  shared sentence no longer overrides a verb whose own steps take the
  note as its text. The slug is back to its control level but still
  loses 6/10, which is stage-provision's own wording to fix.
- The one stage-plan GREEN miss is the pane sending `text`. RED shows
  the same slip (1/10), so this change did not cause it.
