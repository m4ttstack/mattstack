# RED/GREEN: respond-post asks only about fixed threads

Scope: `attachments/review/receive-review/SKILL.md`. The final rule,
after two fix rounds:

- **Step 4, answers.** A `reply:` answer may carry `text`: the reply to
  post, whether or not a note rides with it. The pane's gate 1 answer
  never carries `text`; a typed replacement rides as `note`.
- **Step 4, report rows.** Once gate 1 is answered, every thread's row of
  step 3's report is rewritten as
  `- <threadId> · <file>:<line> · <verdict>, recommended <action> · gate-1: <reply|fix|skip|override> · reply: "<text>"`,
  with the answer's `text` over the draft. Step 5 adds
  ` · sha: <short sha>` to a fixed row. All posting, a resume included,
  reads `gate-1`, never step 3's recommendation.
- **Overrides.** A `reply:` answer with no `text` is `gate-1: override`
  when any one of these holds, whoever answered:
  - its card was not verbatim;
  - it carries a note;
  - its question context never reached the gate.

  An override is redrafted (folding in the note) and offered at gate 2.
- **Step 4, record.** `threads` keeps bare verbs, `texts` holds the edited
  replies and `overrides` lists the override threads, each omitted when
  empty. A `## Run` Resume from the snapshot alone reads them.
- **Step 6, offer.** Gate 2 offers exactly the replies the developer has
  not seen word for word: overrides and finalized fixes. `gate-1: reply`
  rows post unresolved: at once, with no gate 2 and no respond-post
  record, when nothing is offered; otherwise once gate 2 proceeds, never
  on hold, iterate or revise.
- **Step 6, record and legacy.** The respond-post record covers offered
  threads only. An open built before this rule that still offers or names
  a reply-only thread decides it, an empty array included, and no reply
  posts twice. The caller-owned path hands back which replies posted.
- **Tables:** the red-flag and quick-reference rows match.
- **History:** the first commit, then Fix round 1 and Fix round 2 below.

## Scenarios

Committed beside this record, all on the invented MR !87 (reviewer
renee):

- `scenarios/plan-replies-only.md`: two pushbacks answered at gate 1 as
  `{"thread-1": {"value": "reply:T1", "text": "<edited>"}, "thread-2":
  "reply:T2", "code-changes": "skip"}` by board, with step 3's report at
  `/tmp/rr/report.md`.
- `scenarios/plan-fix-and-reply.md`: T1 `fix:` and T2 `reply:` with an
  edit, `code-changes: approve`. Part 1 runs to step 5, Part 2 runs from
  T1's fix at ab12cd3 to the next wait, and Part 3 runs from the gate 2
  answer `{"thread-1": ["post:T1", "resolve:T1"], "next": "proceed"}`
  to the close. The brief's answer had no `next`; this is a terminal run,
  whose open ends with `next`.
- `scenarios/plan-all-skip.md`: both threads `skip:`, `code-changes:
  skip`.
- `scenarios/legacy-post-act.md`: a verbatim copy of the per-thread
  record's original `post-act.md`, a gate that offers reply-only T2 and T4.
  It is kept here to test the sentence for a gate opened before this rule.

### Scenarios updated because their premise is retired

A reply-only thread in a respond-post open is the retired premise. These
scenarios were updated in place, and each older record now points here:

- `../2026-09-22-respond-post-per-thread/scenarios/post-act.md`;
- `../2026-09-22-respond-post-edited-text/scenarios/post-act-edited.md`;
- `../2026-09-22-respond-post-edited-text/scenarios/post-act-edited-postonly.md`.

  In all three, the reply-only T2 and T4 became fixed threads: T2 at
  be34f01 and T4 at c9d0e12, each with a `Fixed -- ...` reply, `verb`
  `fix` and `resolve` recommended. A plan line says all three were
  `fix:`. The answers are unchanged, so every original assertion still
  applies (resolve-only, empty array, edited `text`, post-only).
- `../2026-09-22-respond-post-edited-text/scenarios/post-pane-typed.md`:
  T2 became a fix at be34f01 in the same way.
- `../2026-09-22-respond-post-per-thread/scenarios/post-resume.md`, whose
  text changed twice:
  - First commit: T4 became a fix at c9d0e12, and the handed `post`
    became `{"thread-1": ["post:T1", "resolve:T1"], "thread-2": []}`.
  - First commit, not disclosed there: T2's reply text also changed, from
    "The wait is a fixed 30s delay (queue/retry.ts:14), so the README
    keeps delay." to "The wait is a fixed 30s delay (queue/retry.ts:14),
    not a backoff, so the README keeps delay." This models a gate 1 edit
    already written into the report row.
  - Fix round 1: the rows became step 4's exact report-row shape (see Fix
    round 1). The handed `post` and every reply text are unchanged.
  - Throughout: the skipped T3 still sits ahead of the empty answer's
    thread (T4) in the report.
- `post-build.md` and `post-none.md` keep their text. Only post-build's
  criteria change (below).

## Method

As in `../2026-09-22-respond-post-per-thread/respond-post.md`:

- **Reps:** single-shot and tool-less, `claude --model sonnet --tools ""
  --strict-mcp-config --append-system-prompt-file <system-file> -p
  <scenario>`, a fresh empty directory per rep, run in parallel.
- **System file:** receive-review compiled from this branch with no fills
  (`rt skills compile --pack-dir <copy of the checkout whose
  pack/stubs.jsonc rosters receive-review> --verb receive-review
  --preview`).
- **Timing:** the RED capture predates the edit. GREEN round 1 ran on the
  first edit. GREEN round 2 ran on the committed engine, after the
  legacy fix.
- **Scoring:** I read every rep by hand. A grep checked the fix-and-reply
  opens (`post:T2` absent, `"replies": 1`).

## Pass criteria (strict)

Every scenario:

- the forge actions are exactly the decided ones;
- each posted reply is the exact string;
- no top-level note and no approval;
- the records are correct, with `--decided-by` the answering surface;
- the run closes (`stage-done`, `run-status done`, `unset RT_RUN_DB`).

Per scenario:

- **plan-replies-only:**
  - T1 posts the edited text and T2 posts its draft; neither resolves.
  - No respond-post source, open, `rt gate ask` or record.
  - The respond-plan record is `{"threads":{"T1":"reply","T2":"reply"},"texts":{"T1":"<edited>"},"code-changes":"skip"}`.
  - T1's row in `/tmp/rr/report.md` gets the edited reply.
- **plan-fix-and-reply:**
  - Part 1: the record is `{"threads":{"T1":"fix","T2":"reply"},"texts":{"T2":"<edited>"},"code-changes":"approve"}`, T2's report row gets the edit, and nothing posts.
  - Part 2: the source offers T1 alone (`replies` 1, `fixes` ab12cd3, `reply@1` `verb` `fix`), is fitted and opened with `--kind respond-post`, and nothing posts.
  - Part 3: T1 posts its finalized reply and resolves, and T2 posts its edited text unresolved. The respond-post record is `{"threads":{"T1":{"post":true,"resolve":true}}}` with no T2.
- **plan-all-skip:** the record is all `skip` with no `texts`. Nothing posts, there is no respond-post gate or record, and the run closes.
- **legacy-post-act:** the per-thread record's original post-act criteria.
  - T1 posts and resolves.
  - T2 resolves without a post.
  - T4 is untouched, so it does not post from gate 1 either.
  - The record is `{"threads":{"T1":{"post":true,"resolve":true},"T2":{"post":false,"resolve":true},"T4":{"post":false,"resolve":false}}}`.
- **post-build (new criteria):** the source holds only `thread-1` (T1) and `next`, with `replies` 1. T2 and T3 are absent, and nothing posts before the answer.
- **post-act, post-act-edited, post-act-edited-postonly, post-pane-typed:** each keeps its original record's criteria, with T2 and T4 now fixes. Nothing posts beyond the picks.
- **post-resume:**
  - T1 posts and resolves.
  - T4 is untouched and recorded as both `false` without a positional join.
  - T2 posts its report reply, unresolved.
  - The record is `{"threads":{"T1":{"post":true,"resolve":true},"T4":{"post":false,"resolve":false}}}` with no T2.
- **post-none:** unchanged. It opens nothing, writes nothing, records nothing for the scope, and closes.

## RED (system file = the engine before this edit)

| Scenario | Result | Notes |
|---|---|---|
| plan-replies-only | 0/5 | Every rep builds, fits and opens a respond-post gate over both reply-only threads, then stops. None posts, closes, records `texts` or updates the report. Rep 1: "The selection carries only the verbs, so T1's edited `text` is not recorded here." Reps 1, 2, 3 and 5 carry the edit into the post open. Rep 4 drops it: "the respond-plan step defines no use for `text`." |
| plan-fix-and-reply | 0/5 | Every open offers T1 and T2 (`replies` 2). After the answer names only T1, every rep leaves T2 unposted and records it `{"post":false,"resolve":false}`. Rep 4: "it closes with no reply, so renee gets no pushback". No `texts` and no report update. |
| plan-all-skip | 5/5 | A guard: the existing no-offer rule already covers it. |

Failure class: structure. The engine offered every drafted reply at
gate 2 and had no slot for gate 1's `text`, so the fix is a rule about
which threads are offered, a REQUIRED `texts` map, and a posting rule for
reply-only threads.

## GREEN round 1 (the first edit)

| Scenario | Result | Notes |
|---|---|---|
| plan-replies-only | 5/5 | Report row, `texts`, exact posts, no respond-post, close. |
| plan-fix-and-reply | 5/5 | Only T1 in the open (grep: `post:T2` 0, `"replies": 1` in every rep). T2's edit posts after gate 2, unresolved. The post record holds T1 only. |
| plan-all-skip | 5/5 | |
| legacy-post-act | 4/5 | Rep 2 read T4's empty array as naming no thread, so it posted T4's gate 1 reply. |

Loophole: the sentence for an older gate keyed on the answer naming the
thread ("An answer that does name one"), and an empty array names none.

- Before: "An answer that does name one (a gate opened before this
  rule) decides that thread instead, and no reply posts twice."
- After: "When the open does offer one (a gate opened before this rule),
  that thread's answer decides it instead, an empty array included, and
  no reply posts twice."

## GREEN round 2 (the first commit, dfe2564)

| Scenario | Result | Notes |
|---|---|---|
| plan-replies-only | 5/5 | |
| plan-fix-and-reply | 5/5 | All three parts read by hand. Rep 3 also writes T1's finalized reply into its report row, which is harmless. |
| plan-all-skip | 5/5 | |
| legacy-post-act | 5/5 | Every rep leaves T4 untouched. Reps 1 and 3 add a conditional: post T3 only if the report shows it as `reply:`. The scenario does not say, so the conditional is right. |
| post-build | 5/5 | T1 alone, `replies` 1. Every rep lists T2's post under "after the answer". |
| post-act | 5/5 | |
| post-resume | 5/5 | T4 comes from "the offered thread no value names", never by position. T2 posts its report reply. |
| post-none | 5/5 | |
| post-act-edited | 9/10 | Rep 1 wrote `"resolve":false_placeholder` in T2's record entry and corrected it in prose. The command as written is wrong, so it fails. Reps 6 to 10 were re-run and all pass. The T2 resolve wording is unchanged by this edit. |
| post-pane-typed | 5/5 | The typed text rides as `note` with `--by pane`, and the draft posts. |
| post-act-edited-postonly | 5/5 | Rep 3 adds an unneeded report update after posting. That is harmless. |

## Fix round 1 (review)

The review found two posting-safety gaps: a resume could not tell
reply-only threads from skipped ones, and a `reply:` on a card with no
verbatim reply posted a draft nobody saw. The spec rulings ("Flow" and
"Report rows") are now in the engine.

### Engine changes

- **Report rows (step 4).** Once gate 1 is answered, each thread's row of
  step 3's report is rewritten as
  `- <threadId> · <file>:<line> · <verdict>, recommended <action> · gate-1: <reply|fix|skip|override> · reply: "<text>"`.
  - Step 5 adds ` · sha: <short sha>` to a fixed row.
  - Posting, a resume included, reads the `gate-1` field and never step
    3's recommendation.
  - This replaces the first commit's "write the edit into the report's
    row", which set no verb.
- **Overrides.** A `reply:` answer that carries `text` posts that text,
  whether or not it also carries a note. A `reply:` is `override` when its
  answer carries no `text` and either:
  - its gate 1 reply was not verbatim, or
  - the answer carries a `note`.

  An override is redrafted (folding in the note) and offered at gate 2
  with `verb` `reply`, no `sha`, and resolve not recommended.
- **Offer rule (step 6).**
  - Before: "This gate asks only about fixed threads."
  - After: "This gate offers exactly the replies the developer has not
    yet seen word for word: every `gate-1: override` row, and every
    `gate-1: fix` row whose reply step 5 finalized."
  - The no-offer rule is now "no finalized fix and no override".
- **Posting on proceed (Minor 2).** The `gate-1: reply` rows post "once
  this gate proceeds (its `next` answer is `proceed`, or a caller handed
  `post`, which carries no `next`)". On `hold` or `iterate` they wait.
- **Legacy guard (Minor 4).**
  - Before: "When the open does offer one (a gate opened before this rule)".
  - After: "When the open offers such a thread, or an answer value names
    it (an open in the retired shape)".
- **Red flag (Minor 1).** The "Gate 2's answer doesn't name the reply-only
  thread" row now reads "It posts once gate 2 proceeds, whatever gate 2 picked for its own threads, unless the
  open offered it or an answer value names it." Two new rows cover the
  note ("It's only a note, so the verbatim draft still posts") and the
  recommendation ("Step 3 recommended a reply here, so it posts").
- **Quick reference (Minor 3).** The `reply:` row gains "(never on
  `revise`)", and a new row says what `respond-plan answered` does to the
  report rows.
- **Caller hand-back (Minor 5).** On the caller-owned path, after acting
  on `{post}`, the verb hands back which replies posted, as the no-offer
  path does.
- **Pane at gate 1.** A replacement typed in the pane's free-text field
  rides as `note`, which makes the `reply:` thread an override. Before,
  "the drafted reply stands".
- **Two stale phrases found in the full read.**
  - Decision intake: "`{post}` following later when step 6 offers a
    fixed thread" now reads "offers a thread".
  - Caller hand-back: "Hand back the finalized replies" now reads "Hand
    back the offered replies".

### Scenarios added

- `scenarios/plan-override-reply.md`: plan-fix-and-reply's threads, with T1
  (recommended `fix`, `direction` card) answered `reply:T1` with no
  `text`, T2 `reply:T2`, `code-changes: skip`.
- `scenarios/plan-override-reply-text.md`: the same, T1 answered with
  `text`.
- `scenarios/plan-override-note.md`: plan-replies-only's threads, with the
  in-pane form returning T1 `reply` plus a typed replacement in "Other",
  T2 `reply`.
- `scenarios/resume-skipped-reply.md`: a fresh pane after gate 2, in the
  row shape. T3 is `needs-clarification, recommended reply`, answered
  `gate-1: skip`, with its draft still in the row.

No scenario's gate 1 answer carries both `text` and a note, so the
precedence rule has no existing scenario to recheck.

### Pass criteria (added or changed)

- **Rows (every plan scenario):** each row is rewritten with the right
  `gate-1` value, and an edited reply replaces the draft in its row.
- **plan-override-reply:**
  - rows are T1 `override` and T2 `reply`;
  - T1 is redrafted as a no-change reply (never the "Fixed" direction);
  - the open offers T1 alone, with `verb` `reply`, no `sha`, resolve not
    recommended and `replies` 1;
  - nothing posts before gate 2, and T2 waits for proceed.
- **plan-override-reply-text:** rows are T1 and T2 `reply`. T1's text and
  T2's draft post now, unresolved. There is no gate 2, `texts` holds T1,
  and the run closes.
- **plan-override-note:**
  - the pane's `rt gate answer` carries T1's typed text as `note` (never
    `text`) with `--by pane`;
  - the record has no `texts` and is `--decided-by pane`;
  - rows are T1 `override` and T2 `reply`;
  - T1 is redrafted from the note and offered alone at gate 2;
  - nothing posts.
- **resume-skipped-reply:** T1 posts and resolves, and T2 posts
  unresolved. T3 gets nothing. The record is T1 only, and the run closes.
- **post-resume:** as before, read from the row shape.

### RED (the first commit's engine, dfe2564)

| Scenario | Result | Notes |
|---|---|---|
| plan-override-reply | 0/5 | No rep auto-posts T1: each spots the "Fixed" direction draft and holds T1 through an improvised wrap-up form. But every rep posts T2 before any gate 2, none offers T1 at `respond-post`, and none writes rows. |
| plan-override-reply-text | 0/5 | The behavior is right in 5/5, but every rep writes only the edited text, never the `gate-1` verb. |
| plan-override-note | 0/5 | Every rep sends the typed text as `note` (correct), then posts T1's old verbatim draft at once: "the drafted reply stands". |
| resume-skipped-reply | 5/5 | A guard: explicit rows read correctly even on the old engine. The gap is on the writing side. |
| post-resume (row shape) | 5/5 | A guard, as above. |
| plan-replies-only, plan-fix-and-reply, plan-all-skip | 0/5 each | The first commit's GREEN round 2 reps, re-scored for rows. None writes the answered verb. all-skip leaves the report untouched. |

### Intermediate arms

- **g3** used an earlier row shape (`gate 1: <verb> · posts at: <gate 1|gate 2|never>`).
  It scored 5/5 on all 11 scenarios run. The spec then fixed one shared
  field, `gate-1` with four values, which the board:respond wrapper also
  writes. A second field the wrapper does not write would break a
  resume, so `posts at` was dropped.
- **g4** added only the two stale-phrase fixes. Its 10 reps were not
  scored, because the `gate-1` change superseded them.

### GREEN (the committed engine, g5)

Every rep was scored by script for rows, posted bodies, the open's shape
and the record. Every flagged or unusual rep was then read by hand.

| Scenario | Result | Notes |
|---|---|---|
| plan-override-reply | 5/5 | Each rep redrafts T1 as a no-change reply (for example "No code change in this MR. enqueue() at queue/enqueue.ts:88 still retries non-retryable jobs.") and offers it alone, resolve unrecommended. Nothing posts. |
| plan-override-reply-text | 5/5 | Rows T1 and T2 `reply`. Both exact bodies post, `texts` holds T1, no gate 2, close. |
| plan-override-note | 5/5 | `note` with `--by pane`, no `texts`, rows T1 `override` and T2 `reply`. T1 is redrafted from the note, the open holds T1 alone, and nothing posts. |
| resume-skipped-reply | 5/5 | T3 posts nothing. Reps 3 and 4 hand back which replies posted. |
| post-resume | 5/5 | T4 is recorded both `false` without a positional join. T2 posts from its row. |
| plan-replies-only | 5/5 | Both rows `gate-1: reply`, exact bodies (rep 3 in prose). |
| plan-fix-and-reply | 5/5 | Rows, then ` · sha: ab12cd3` on T1 after step 5. T1 alone is offered. T2's edit posts on proceed. The record holds T1 only. |
| plan-all-skip | 5/5 | Both rows `gate-1: skip`, nothing posts. |
| post-act | 5/5 | |
| post-act-edited | 5/5 | |
| post-build | 5/5 | T1 alone, `replies` 1, no forge call before the answer. |
| legacy-post-act | 5/5 | T4 untouched. Every rep adds a conditional: T3 posts only if its row says `gate-1: reply`. |

## Fix round 2 (re-review)

The scoped re-review confirmed Fix round 1. This round follows the spec
at 260597c9 ("Flow", "Report rows" and "Records").

### Engine changes

- **Third override trigger.** The `gate-1` rule now reads: "a `reply:` is
  `override` when its answer carries no `text` and any one of these
  holds, whoever answered: its gate 1 reply was not verbatim (the card
  showed a `direction` or no reply); the answer carries a `note`; or its
  question context never reached the gate (dropped for the size budget, a
  `"fits": false` open, or an open that reported `contextOmitted`), so its
  draft was never shown". The red flags and the quick reference match. A
  new red flag, "The pane showed the prose, so a dropped context does not
  matter", holds the rule whoever answered.
- **`overrides` in the respond-plan record.** The selection gains
  `"overrides":["<threadId>"]`, omitted when empty. The Report rows
  paragraph adds: "A `## Run` Resume with only the snapshot at hand reads
  the respond-plan record instead: `threads` gives each verb, `texts` the
  edited replies, and `overrides` the threads offered at gate 2, so it
  never posts a draft an override was meant to replace."
- **Nits.**
  - "(an open in the retired shape)" now reads "(an open built before this
    rule)", so it no longer collides with the retired `replies` shape.
  - The quick-reference `reply:` row now reads one way: "Override when the
    answer has no `text` and any one of: a card that was not verbatim, a
    note, or a question context that never reached the gate."
  - This record's top summary states the final rule.
- **Step 6 wording.** "An override has no postable reply yet" now reads
  "An override's reply was never seen word for word". A dropped-context
  override does have a draft; it was just never shown.

### Scenario added

- `scenarios/plan-override-dropped.md`: plan-replies-only's threads, both
  with verbatim cards. The respond-plan `rt gate ask` response reports
  `"contextOmitted":true`, and stderr says "gate context over budget:
  dropped question context thread-2". The board answers `reply:T1` and
  `reply:T2`, both with no `text`, and `code-changes: skip`.
- Pass criteria:
  - rows are T1 `reply` and T2 `override`;
  - the record carries `"overrides":["T2"]` and no `texts`;
  - T2 is offered alone at gate 2 (`verb` `reply`, no `sha`, resolve not
    recommended, `replies` 1);
  - nothing posts, and T1 waits for proceed.
- Its first draft said "thread-2's card showed only its label". That
  handed the conclusion to the model, so it was cut before scoring and
  the scenario now gives only the daemon's facts. Both versions are in
  git history (e8c7e78, 9d01786).

### RED (Fix round 1's engine, cd23963)

plan-override-dropped: 0/5 strict. Every rep already routed T2 to gate 2
and posted nothing, reading the dropped context as a card with no reply
("card showed no reply, so `gate-1: override`"). Every rep failed only
the record, because Fix round 1's record has no `overrides` key. The same
held on the first draft. So the new trigger makes explicit behavior the
old rule already reached, and the failing part is the new field.

### GREEN (the committed engine)

| Scenario | Result | Notes |
|---|---|---|
| plan-override-dropped | 5/5 | Rows T1 `reply` and T2 `override`, `"overrides":["T2"]`, T2 offered alone with resolve unrecommended, nothing posts. Each rep reasons "stderr names only thread-2 as dropped". |
| plan-override-note | 5/5 | Now also `"overrides":["T1"]`. `note` with `--by pane`, `--decided-by pane`, no `texts`, T1 redrafted from the note and offered alone, nothing posts. |
| plan-replies-only | 5/5 | Rows `reply`/`reply`, `texts` T1, no `overrides` key, no gate 2, exact bodies (reps 1, 4 and 5 read by hand), close. |
| resume-skipped-reply | 5/5 | T3 posts nothing; record T1 only; close. |
| post-none | 5/5 | Every `rt gate ask` mention is a negation (rep 3 lists it under "Not run"). No file, no respond-post record, close. |
| post-pane-typed | 5/5 | The typed text rides as `note` with `--by pane`, T1's exact draft posts and resolves, T2 resolves only, T1's entry carries the note, close. |
| post-act-edited-postonly | 5/5 | T1 posts the `text` unresolved, T2 resolves only ("ignored edit" neither posted nor recorded), T4 posts its draft, close. |

## Noise outside this change

- Several reps name a conditional `waiting-gate` clear, a doorbell
  verify (`rt gate wait --timeout 2s`) or a read-only discussion lookup.
  All are allowed or read-only.
- The unpushed-commit worry (fix-and-reply RED rep 5, GREEN round 2
  rep 3) appears on both engines. RED rep 5 went further and held T1's
  post for a push check.

## Verdict

- First commit: plan-replies-only and plan-fix-and-reply went RED 0/5 ->
  5/5. plan-all-skip was 5/5 (guard). legacy-post-act went 4/5 -> 5/5.
  Regressions were 5/5 except post-act-edited 9/10.
- Fix round 1:
  - The rows criterion drops the first commit's plan reps to 0/5.
  - plan-override-reply, plan-override-reply-text and plan-override-note
    were RED 0/5; resume-skipped-reply and post-resume were guards at 5/5.
  - On the committed engine all twelve scenarios run are 5/5.
- Gate 2 offers exactly the replies the developer has not seen word for
  word: finalized fixes and overrides. A `gate-1: reply` row posts from
  gate 1 once gate 2 proceeds, or at once when nothing is offered.
- Posting, a resume included, reads each report row's `gate-1` field,
  never step 3's recommendation.
- Fix round 2: a dropped question context is the third override
  trigger, and `overrides` joins the respond-plan record. The new
  scenario fails 0/5 on the old engine, only on the record, and passes
  5/5 now. Every re-run scenario is 5/5.
