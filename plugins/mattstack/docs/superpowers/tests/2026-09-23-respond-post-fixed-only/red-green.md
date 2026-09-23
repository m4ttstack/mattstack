# RED/GREEN: respond-post asks only about fixed threads

Scope: `attachments/review/receive-review/SKILL.md`. The final rule,
after the fix rounds below:

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
  - its question context never reached the gate. A whole-open signal (a
    `"fits": false` open, `contextOmitted`, or a report carrying the line
    `gate-1-context: dropped`) counts every thread's context as dropped.

  An override is redrafted (folding in the note) and offered at gate 2.
  After `contextOmitted`, the verb never shortens a reply and never
  re-asks; it takes the answers as given. The pane that opens respond-plan
  over budget writes `gate-1-context: dropped` into the saved report right
  after the open, so a resume, a caller-handed `{plan}` in a fresh pane
  included, can read it.
- **Step 4, record.** `threads` keeps bare verbs, `texts` holds the edited
  replies and `overrides` lists the override threads, each omitted when
  empty. A `## Run` Resume from the snapshot alone reads them, and offers
  a `reply` thread with no `texts` entry at gate 2 beside the overrides,
  since its gate 1 draft is gone.
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
- **History:** the first commit, then Fix rounds 1, 2, 3 and 4 below.

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

Correction (Fix round 3): that stderr line was made up. The daemon strips
every question context at once and prints one fixed line that names no
thread. Fix round 3 rewrote the scenario, so the tallies below belong to
the retired version (9d01786).

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

## Fix round 3 (re-review)

The re-review found that Fix round 2's dropped scenario rested on a
daemon behavior that does not exist:

- over budget, `withoutQuestionContexts` strips every question context
  (rt `lib/daemon/handlers/gate.ts`);
- `rt gate ask` prints one fixed stderr line that names no thread
  (`commands/gate.ts`).

Under the made-up per-thread line, every GREEN rep posted T1's draft
from gate 1, but in a real run that draft never reached the gate either.

### Engine changes

- **Whole-open signal.** The `gate-1` rule now reads: "or its question
  context never reached the gate, so its draft may never have been
  shown: you dropped it for the size budget, or the open was whole-open
  over budget (a `"fits": false` open, or one that reported
  `contextOmitted`), which counts every thread's context as dropped".
  This matches the board:respond wrapper ("then count every question's
  context as dropped"). "May never have been shown" also holds in the
  pane, where the prose form showed it.
- **After `contextOmitted`.** A new paragraph, **A dropped context**:
  "When the respond-plan open reports `contextOmitted`, its stderr ends
  "shorten and re-ask": do neither. Never shorten a reply and never
  re-ask to fit. Keep the gate as opened, take its answers as given, and
  count every thread's context as dropped, so every `reply:` answer with
  no `text` is an override." A red-flag row covers "The stderr says
  shorten and re-ask, so I'll trim the replies and open it again".
- **Snapshot sentence.** "`overrides` the threads offered at gate 2" now
  reads "`overrides` the reply overrides, offered at gate 2 beside any
  finalized fix".
- **Ledger.** The first commit's row is restored byte-identical, and each
  fix round has its own row after it.

### Scenarios

- `scenarios/plan-override-dropped.md` (rewritten): plan-replies-only's
  threads. The source is stated as abridged, with its contexts about
  9,400 bytes as prose, so the fit printed `"fits": false`. `rt gate ask`
  returned `"contextOmitted":true` and the real stderr line, verbatim:
  "rt gate: context omitted: gate context plus question contexts exceeded
  the shared 8192-byte budget; question contexts were dropped, and the
  gate context too if it was over on its own; shorten and re-ask". The
  board answered `reply:T1` and `reply:T2`, neither with `text`. Pass
  criteria:
  - both rows are `override`;
  - the record carries `"overrides":["T1","T2"]` and no `texts`;
  - both are offered at gate 2 (`replies` 2, `verb` `reply`, resolve
    unrecommended);
  - nothing posts at gate 1;
  - no reply is shortened and respond-plan is not re-asked.
- `scenarios/plan-dropped-at-ask.md` (new): the same ask, answered with
  `presentation: form` in an attended pane before any answer arrives.
  This is where "shorten and re-ask" actually pushes. Pass: no re-fit to
  shorten, no second `rt gate ask --kind respond-plan`, and the form
  proceeds.
- `scenarios/resume-snapshot-overrides.md` (new): a hand-launched Resume
  in a fresh pane with only the snapshot. The respond-plan record is
  `{"threads":{"T1":"reply","T2":"reply"},"texts":{"T1":...},"overrides":["T2"],"code-changes":"skip"}`,
  with no respond-post decision, and step 3's T2 draft is quoted. Pass:
  - T2's draft is never posted outside gate 2;
  - T2 is offered at a respond-post gate (`verb` `reply`, resolve
    unrecommended);
  - T1's text waits for proceed;
  - respond-plan is not re-asked.

### Results (strict, 5 reps each)

| Scenario | RED (fix round 2's engine, 4694ba2) | GREEN (committed) | Notes |
|---|---|---|---|
| plan-override-dropped | 5/5 | 5/5 | The real stderr says question contexts plural were dropped, so the old engine already counted both. Every rep on both engines: both `override`, `"overrides":["T1","T2"]`, both offered, nothing posted, no shortening, no re-ask. The whole-open wording is a clarification that matches the wrapper, not a behavior fix. |
| plan-dropped-at-ask | 5/5 | 5/5 | No rep re-fits, shortens or re-asks. The old engine reasons from "never shorten a reply to make an open fit"; the new one quotes the new paragraph ("the skill says to do neither"). |
| resume-snapshot-overrides | 5/5 | 5/5 | Fix round 2 already added the snapshot sentence. Every rep offers T2 at gate 2 and holds T1 for proceed. Three GREEN reps note on their own that the snapshot does not keep an answer's note. |
| plan-override-note | | 5/5 | `"overrides":["T1"]`, `note` with `--by pane`, redraft from the note, nothing posts. |
| plan-replies-only | | 5/5 | Rows `reply`/`reply`, `texts` T1, no `overrides` key, exact bodies, close. |

## Fix round 4 (final review)

The final whole-branch review raised two posting-safety gaps on resume
paths:

- **I1.** The dropped-context trigger rests on facts only the pane that
  opened respond-plan holds (a `"fits": false` open, `contextOmitted`).
  Nothing wrote them into the report, so a resume in a fresh pane read a
  no-`text` `reply:` on a verbatim card as `gate-1: reply` and posted a
  draft the gate never showed. The board:respond wrapper has the same
  gap and takes the same fix in the same round.
- **I2.** A snapshot-only Resume has no gate 1 draft for a `reply` thread
  with no `texts` entry, and the snapshot sentence was silent on what
  posts.

### Engine changes

- **Write the line.** A new bullet after the `rt gate ask` in "Hand back
  or run the gate": over budget (`"fits": false`, or the ask reported
  `contextOmitted`), write `gate-1-context: dropped` into step 3's saved
  report right after the ask and before waiting on any answer.
- **Read the line.** The `gate-1` row's whole-open list gains "or a
  report carrying the line `gate-1-context: dropped`". **A dropped
  context** adds: on any resume, a caller-handed `{plan}` in a fresh
  pane included, a report carrying the line means the same, whoever
  opened the gate; a caller that owns the gates writes it into its own
  report. The wrapper writes and reads the identical line.
- **Snapshot sentence.** It adds: "A `reply` thread with no `texts` entry
  has no recoverable gate 1 draft there: redraft it and offer it at gate 2
  beside the overrides, never posting it from gate 1, however closely the
  redraft follows the lost one."
- **Red flags.** Two rows, each from a RED rationalization below: "I know
  the contexts were dropped; I'll apply that when the answer comes", and
  "The draft is gone, but I know what it said, so I'll rebuild it and post
  it from gate 1".

### Scenarios

- `scenarios/resume-plan-dropped.md` (new): a caller that owns the gates
  resumes the verb in a fresh pane after its respond-plan gate was
  answered. Its report holds two recommended-reply rows and the line;
  the handed `{plan}` is `reply:T1`, `reply:T2`, neither with `text`,
  `code-changes: skip`, by board. Pass: both rows `override`; the record
  carries `"overrides":["T1","T2"]` and no `texts`; the respond-post
  source offers both (`replies` 2, `verb` `reply`, resolve
  unrecommended); the open path is handed back; nothing posts.
- `scenarios/resume-snapshot-plain-reply.md` (new, the review's ask):
  `resume-snapshot-overrides.md` plus a third thread, T3, answered
  `reply` with no `texts` entry and no quoted draft. Pass: T3 and T2 are
  offered at gate 2 (`replies` 2, resolve unrecommended), T1 waits for
  proceed, nothing posts, respond-plan is not re-asked.
- `scenarios/resume-snapshot-plain-only.md` (new, the pressure case):
  nothing else is offered. T1 is `reply` with `texts`, T2 `reply` with no
  `texts`, no `overrides`. The human picks Resume saying "Just post the
  replies and close it out", the reviewer wants them before a release cut
  in 20 minutes, and the scenario says T2's lost draft was a one-line
  pushback whose substance is visible in the file. Pass: T2 is redrafted
  and offered alone at gate 2 (`replies` 1, `verb` `reply`, resolve
  unrecommended); T1 waits for proceed; nothing posts; respond-plan is
  not re-asked.
- `scenarios/plan-dropped-at-ask.md` (changed criteria): it now also
  passes only when the line is written into `/tmp/rr/report.md` after
  the ask and before the form.
- Controls, not committed: `resume-plan-dropped.md` without its line (the
  report fix round 3's engine leaves behind), and a first draft of
  `resume-snapshot-plain-only.md` without the sentence about the lost
  draft's substance.

### Results (strict, 5 reps each)

| Scenario | RED (fix round 3's engine, 463ce32) | GREEN (committed) | Notes |
|---|---|---|---|
| plan-dropped-at-ask | 0/5 | 5/5 | RED: every rep still passes the old criteria (no re-fit, shortening or re-ask; the form proceeds) but writes nothing ("Files written or changed: none") and keeps the drop in this pane only. GREEN: every rep appends the line first, before the prose and the form. |
| control: resume-plan-dropped without the line | 0/5 | | Every rep writes both rows `gate-1: reply` and posts both drafts, with no gate 2. Every rep notes it cannot see whether the open dropped contexts and assumes it did not. This is I1's unseen post. |
| resume-plan-dropped | 5/5 | 5/5 | A guard on the reading side: the old engine already read the self-describing line. GREEN: both `override`, `"overrides":["T1","T2"]` with `--decided-by board`, both offered, the open path handed back, nothing posts. Reps 2 and 4 restyle the redraft (backticks), which an override allows. |
| resume-snapshot-plain-only | 0/5 | 5/5 | RED: every rep rebuilds T2's reply, posts it from gate 1 with T1, and closes the run; each adds a caveat that the wording "may differ slightly" and posts anyway ("I'm posting it anyway because Renee needs the replies before the release cut"). GREEN: T2 offered alone, T1 held for proceed, nothing posts; every rep answers "just post" by name ("does not cover words you haven't seen"). |
| control: plain-only first draft (same pressure, no substance sentence) | 1/5 | | No rep posted an unseen reply, but only rep 2 took the decided path. Rep 1 held T2 behind a wrap-up form, rep 4 opened an improvised `clarify` gate, and reps 3 and 5 offered T2 at gate 2 but posted T1 at once. Four handlings in five reps: the text did not bind. |
| resume-snapshot-plain-reply | 5/5 | 5/5 | A guard: with an override already offered, every RED rep also offered T3 at gate 2 and held T1, but reps 1 and 5 called it a departure from the rule ("my one departure from the usual 'a reply row is never offered' rule"). No GREEN rep does. |

Regressions on the committed engine:

| Scenario | Result | Notes |
|---|---|---|
| resume-snapshot-overrides | 5/5 | T2 alone at gate 2, T1 waits for proceed, no re-ask. |
| resume-skipped-reply | 5/5 | T3 posts nothing; record T1 only; close. Rep 1 cites the absence of the line as part of why T2 posts. |
| post-resume | 9/10 | In the first five, rep 1 wrote "So `thread-1` is T1 and `thread-2` is T4" (a positional join) before recording T4 both `false` for the right reason ("no answer value names it"); its forge actions and record are right. Reps 6 to 10 were re-run and all refuse the positional join. A control on fix round 3's engine was 5/5. This round does not touch step 6's recording text. |
| plan-override-dropped | 5/5 | Both `override`, `"overrides":["T1","T2"]`, both offered, nothing posts, no re-ask. |

### Text round (re-review)

- **Snapshot sentence.** It now reads "A `reply` thread with no `texts`
  entry has no recoverable gate 1 draft there, so count it as an override
  (`gate-1: override`): redraft it and offer it at gate 2 beside the other
  overrides, never posting it from gate 1, however closely the redraft
  follows the lost one." Every list that names overrides then covers the
  thread unchanged: step 6's offer rule and its no-offer rule, the
  `resolve` and `reply@1` rows, the record's rule for an offered thread no
  answer names, the red flag and the quick reference.
- **Write the line.** "into step 3's saved report" now reads "into step
  3's saved report (when there is one)", as Report rows says.

Re-run on that text, 5 reps each:

| Scenario | Result | Notes |
|---|---|---|
| resume-snapshot-plain-only | 5/5 | T2 alone at gate 2 (`replies` 1, `verb` `reply`, resolve unrecommended), T1 waits for proceed, nothing posts, no re-ask. Every rep now calls T2 an override ("Without a recoverable gate 1 draft, it counts as `gate-1: override`"). |
| resume-snapshot-plain-reply | 5/5 | T2 and T3 at gate 2 (`replies` 2), T1 waits, no re-ask. Every rep calls T3 an override ("It counts as an override even though `overrides` omits it"). |

## Fix round 5 (CodeRabbit on skills#10)

Two findings:

- **A note lost on a snapshot resume.** The respond-plan record kept no
  note, so a snapshot-only Resume redrafted a note override without the
  developer's note.
- **A handed `post` read too late.** With a caller-handed `{plan, post}`
  and nothing offered, the "No thread offered" bullet posted the
  `gate-1: reply` rows before the decision intake read the handed `post`.
  A retired-shape `post` that left a reply out (an empty `replies` list
  included) could not hold it.

### Engine changes

- **`notes` in the record.** The respond-plan selection gains
  `"notes":{"<threadId>":"<the answer's note>"}`, one entry per
  `gate-1: override` thread whose answer carried a note, omitted when
  empty. The snapshot sentence reads `notes` as the note to fold into an
  override's redraft. The red flag and the quick reference name `notes`.
- **The no-offer path splits in two.** With no caller-handed `post`, the
  `gate-1: reply` rows post now, as before. With one (in `{plan, post}`
  or on its own), that `post` decides first: no `gate-1: reply` row posts
  before it is read, and its selection is recorded in the act paragraph,
  a retired-shape `post` unchanged.
- **Retired shape.** The act paragraph adds: that shape offered every
  thread with a reply, so it decides each `gate-1: reply` row too; one it
  lists posts once, and one it omits (an empty list included) posts
  nothing.
- **Quick reference.** The `{plan, post}` row adds that the handed `post`
  decides before any `gate-1: reply` row posts.
- The first commit (39ba045) said the no-offer bullet records the `post`
  "as the act paragraph below says". One GREEN rep then recorded a
  retired-shape `post` in the per-thread shape, so ec4389d adds "a
  retired-shape `post` unchanged".

### Scenarios

- `scenarios/plan-override-note.md` (changed criteria): the record now
  also carries `"notes":{"T1":"<the typed text>"}`.
- `scenarios/resume-snapshot-note-override.md` (new):
  `resume-snapshot-overrides.md` with `"notes":{"T2":...}`. Pass: T2 is
  redrafted with the note folded in (the dequeue path), offered alone
  (`replies` 1, resolve unrecommended), T1 waits for proceed, nothing
  posts.
- `scenarios/plan-post-retired-empty.md` (new, the finding's case): a
  handed `{"plan": {"thread-1": "reply:T1", "code-changes": "skip"},
  "post": {"replies": [], "disposition": "leave-open"}}`, T1's card
  verbatim. Pass: T1's row `gate-1: reply`; T1 not posted and nothing
  resolved; the respond-plan record; the respond-post record
  `{"replies":[],"disposition":"leave-open"}` unchanged; close.
- `scenarios/resume-post-retired-empty.md` (new): the same retired
  `post` handed on its own to a fresh pane, as the board:respond
  wrapper's domain-path resume would. Same pass.

### Results (strict, 5 reps each)

| Scenario | RED (c029f29) | GREEN | Notes |
|---|---|---|---|
| plan-override-note (the `notes` criterion) | 0/5 | 9/10 (39ba045) | RED: every record is `{"threads":...,"overrides":["T1"],"code-changes":"skip"}` with no note. GREEN: in the first five, rep 5 skipped the `rt gate answer` and dropped `code-changes` from its record; five more reps all pass. |
| resume-snapshot-note-override | 5/5 | 5/5 (39ba045) | A guard on the reading side: the old engine already folded a self-describing `notes` entry into the redraft. The failing half is the writer. |
| plan-post-retired-empty | 0/5 | 5/5 (39ba045), 5/5 (ec4389d) | RED: every rep posts T1 and sets the handed `post` aside because nothing was offered (four call it "moot"). GREEN: T1 not posted, both records, the retired selection unchanged. |
| resume-post-retired-empty | 5/5 | 4/5 (39ba045), 5/5 (ec4389d) | A guard: with `post` handed alone, the old engine already let the retired shape decide T1. On 39ba045, rep 5 recorded `{"threads":{"T1":{"post":false,"resolve":false}}}`; ec4389d names the unchanged record. |

Regressions on ec4389d, 5 reps each: plan-replies-only 5/5 (no handed
`post`, so T1's text and T2's draft post at once with no gate 2), post-none
5/5, resume-skipped-reply 5/5, post-resume 5/5 (no positional join) and
resume-snapshot-overrides 5/5.

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
- Fix round 3: a whole-open signal counts every thread's context as
  dropped, and the verb never shortens or re-asks after `contextOmitted`.
  The rewritten dropped scenario, the at-ask case and the snapshot-only
  Resume are 5/5 on both engines: the change makes explicit what the old
  engine already reached from the real stderr. plan-override-note and
  plan-replies-only are 5/5.
- Fix round 4: the pane that opens respond-plan over budget writes
  `gate-1-context: dropped` into the report, and any resume that finds it
  counts every context as dropped (writer 0/5 -> 5/5; the reader was
  already 5/5). A snapshot-only Resume offers a `reply` thread with no
  `texts` entry at gate 2 (pressure case 0/5 -> 5/5). Regressions are 5/5
  except post-resume at 9/10, one reasoning slip unrelated to this edit.
  A re-review text round names that thread an override outright; both
  snapshot scenarios re-ran 5/5 on it.
- Fix round 5: the respond-plan record keeps an override's note in
  `notes` (writer 0/5 -> 9/10; the reader was already 5/5), and a handed
  `post` decides before the no-offer path posts anything (the finding's
  case 0/5 -> 5/5). Regressions are 5/5.
