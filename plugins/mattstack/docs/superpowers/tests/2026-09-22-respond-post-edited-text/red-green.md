# RED/GREEN: respond-post posts an answer's edited text

Scope: `attachments/review/receive-review/SKILL.md`, "## 6. Decide and
post", the act paragraph (an answer object's `text` replaces the
`reply@1` draft for a `post:` thread) and the decision record paragraph
(an entry carries `text` only for such a thread);
`attachments/gate-protocol/SKILL.md`, "## Answers are option values",
names `text` beside `note` on the answer object. The in-pane form never
sends `text` and its recipe is unchanged.

One new scenario, committed beside this record as
`scenarios/post-act-edited.md`: a verbatim copy of
`../2026-09-22-respond-post-per-thread/scenarios/post-act.md` (the same
invented MR !87, reviewer renee) with the answer line replaced by

```
{"thread-1": {"value": ["post:T1", "resolve:T1"], "text": "Fixed in ab12cd3: enqueue() now drops non-retryable jobs before the retry loop, with a test."}, "thread-2": ["resolve:T2"], "thread-3": ["post:T4"], "next": "proceed"}
```

Method: as in `../2026-09-22-respond-post-per-thread/respond-post.md`.
Single-shot, tool-less reps, `claude --model sonnet --tools ""
--strict-mcp-config --append-system-prompt-file <system-file> -p
<scenario>`, a fresh empty directory per rep, run in parallel. System
file: the receive-review verb compiled from this branch with no fills
(`rt skills compile --pack-dir <copy of the checkout whose
pack/stubs.jsonc rosters receive-review> --verb receive-review
--preview`); the RED capture predates the edit, each GREEN capture
postdates its wording. Every rep was read by hand.

## Pass criteria

post-act-edited (all must hold): T1's posted reply is exactly the
answer's `text`, not the drafted `reply@1` text, and T1 resolves; T2
resolves without a post; T4 posts its drafted text; the record carries
`"T1": {"post": true, "resolve": true, "text": "Fixed in ab12cd3: ..."}`
and no `text` on T2 or T4.

Regressions: the four scenarios in
`../2026-09-22-respond-post-per-thread/scenarios/` against the new
system file, scored by that record's criteria. Act and resume add one
more: no answer there carries `text`, so every entry is `{post,
resolve}` alone.

## RED (system file = the engine before this edit)

post-act-edited: 0/5 PASS. Every rep read `text` as a note, posted the
draft on T1, and recorded T1 without `text`. T2 and T4 were right in
all five.

- Rep 1: T1 body "Fixed -- queue/enqueue.ts:88 / enqueue() now drops
  non-retryable jobs; added the check and a test."; record
  `"T1":{"post":true,"resolve":true}`. "ignoring the stray `text`
  override on thread-1's answer, since a note never edits the approved
  reply".
- Rep 2: T1 body the draft; record `{post, resolve}`. "any such
  annotation rides the decision record and never edits the approved
  reply".
- Rep 3: T1 body the draft; record `{post, resolve}`. "that extra
  field is a note and never edits the approved reply".
- Rep 4: T1 body the draft; record `{post, resolve}`. "a note, not a
  reply override".
- Rep 5: T1 body the draft; record `{post, resolve}`. "not the
  answer's note".

Failure class: the answer shape was unknown, and the note rule absorbed
it. The fix names `text` in gate-protocol and gives the act step its
source.

## GREEN

### Round 1: the planned wording

Record sentence: "An entry whose posted reply came from the answer's
`text` adds it: `{"post":true,"resolve":true,"text":"<the text that
posted>"}`."

- post-act-edited 5/5: T1 posts the answer's `text` and resolves, T2
  resolves only, T4 posts its draft, T1 alone records `text`.
- build 5/5, none 5/5.
- act 1/5, resume 0/5: the loophole. Reps 2 to 5 of act and all five
  of resume recorded T1 as `{"post":true,"resolve":true,"text":"Fixed
  -- queue/enqueue.ts:88 / ..."}`, the draft, reading "the text that
  posted" as any posted reply. Forge actions stayed right.

### Round 2: keyed to the answer

Record sentence: "When a thread's answer carries `text` and `post:`,
its entry adds that text: `{...,"text":"<the answer's text>"}`; every
other entry is `{post, resolve}` alone."

- post-act-edited 5/5.
- act 4/5, resume 4/5: act rep 2 and resume rep 4 still recorded the
  draft as `text`, each while stating that no answer carried one.

### Round 3: the committed wording

Record sentence: "An entry carries `text` only when its thread's answer
was an object with `text` and `post:`, and then it is the answer's:
`{"post":true,"resolve":true,"text":"<the answer's text>"}`. A reply
posted from the `reply@1` context records `{post, resolve}` alone."

post-act-edited 5/5 PASS:

- Rep 1: T1 body "Fixed in ab12cd3: enqueue() now drops non-retryable
  jobs before the retry loop, with a test.", resolve; T2 resolve; T4
  posts "Which caller do you mean: the cron path or the API path?";
  record T1 `{"post":true,"resolve":true,"text":"Fixed in ab12cd3:
  ..."}`, T2 `{"post":false,"resolve":true}`, T4
  `{"post":true,"resolve":false}`; closes.
- Rep 2: same actions and record; closes nothing (reads the set
  `RT_RUN_DB` as an inherited run, see below).
- Reps 3, 4, 5: same actions and record; close.

Regressions on the same system file:

- build 5/5: every source exactly per the criteria, fitted, opened with
  `rt gate ask ... --kind respond-post`, nothing posted before the
  answer; no rep puts `text` on a pane answer.
- act 10/10: every record
  `{"threads":{"T1":{"post":true,"resolve":true},"T2":{"post":false,"resolve":true},"T4":{"post":false,"resolve":false}}}`
  with `--decided-by board`, no `text`; every rep closes.
- resume 10/10 on the forge actions and the record, same selection as
  act. Rep 7 closes nothing, reading the set `RT_RUN_DB` as an inherited
  run.
- none 5/5: open nothing, record nothing for the scope, close.

## Noise outside this change

- The inherited-run reading (post-act-edited round 3 rep 2, resume rep
  7) comes from `## Run` and the scenario's "fresh pane" framing, not
  step 6: 10 resume reps on the pre-edit engine showed it once (rep 4).
- Two reps across all rounds (round 2 act rep 3, round 3 resume rep 6)
  posted T1's draft with its `--` shortened to `-`. Neither touched the
  edited sentences.

## Verdict

post-act-edited RED 0/5 -> GREEN 5/5. Regressions build 5/5, act 10/10,
resume 10/10 on the record, none 5/5. The act step posts an answer's
`text` for a `post:` thread and the draft otherwise. The record carries
`text` only when the answer supplied it.
