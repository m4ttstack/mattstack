# RED/GREEN: respond-post posts an answer's edited text

Scope: `attachments/review/receive-review/SKILL.md`, "## 6. Decide and
post":

- the act paragraph: an answer object's `text` replaces the `reply@1`
  draft for a `post:` thread;
- the decision record paragraph: an entry carries `text` only for such a
  thread, and its `resolve` follows the answer;
- the in-pane form bullet: the pane's answer never carries `text`;
- the `reply@1` fill: the context's `text` is the drafted reply.

`attachments/gate-protocol/SKILL.md`, "## Answers are option values",
names `text` beside `note` on the answer object and says the in-pane
form is not a surface that sends it.

Scenarios committed beside this record, all on the invented MR !87
(reviewer renee):

- `scenarios/post-act-edited.md`: a verbatim copy of
  `../2026-09-22-respond-post-per-thread/scenarios/post-act.md` with the
  answer line replaced by

  ```
  {"thread-1": {"value": ["post:T1", "resolve:T1"], "text": "Fixed in ab12cd3: enqueue() now drops non-retryable jobs before the retry loop, with a test."}, "thread-2": ["resolve:T2"], "thread-3": ["post:T4"], "next": "proceed"}
  ```

- `scenarios/post-act-edited-postonly.md` (fix round): the same, with
  thread-1 `{"value": ["post:T1"], "text": "..."}` and thread-2
  `{"value": ["resolve:T2"], "text": "ignored edit"}`.
- `scenarios/post-pane-typed.md` (fix round): an attended pane whose
  in-pane form came back with T1's post and resolve ticked and a full
  replacement reply typed in the free-text "Other" field.

Method: as in `../2026-09-22-respond-post-per-thread/respond-post.md`.

- **Reps:** single-shot and tool-less, `claude --model sonnet --tools ""
  --strict-mcp-config --append-system-prompt-file <system-file> -p
  <scenario>`, a fresh empty directory per rep, run in parallel.
- **System file:** the receive-review verb compiled from this branch
  with no fills (`rt skills compile --pack-dir <copy of the checkout
  whose pack/stubs.jsonc rosters receive-review> --verb receive-review
  --preview`).
- **Timing:** each RED capture predates its edit; each GREEN capture
  postdates its wording.
- **Scoring:** a script flags the exact reply strings, the record
  selection and the close, and I read every scored rep by hand.

## Pass criteria (strict)

Every scenario that acts must meet all of these:

- the forge actions are exactly the picks;
- a posted reply is the exact string, so a `--` rewritten to `-` or
  `...` fails;
- no top-level note and no approval;
- the record is correct, with `--decided-by` the answering surface;
- the run closes (`stage-done`, `run-status done`, `unset RT_RUN_DB`).

Per scenario:

- **post-act-edited:** T1 posts the answer's `text` exactly and resolves.
  T2 resolves without a post. T4 posts its draft exactly. The record is
  T1 `{"post":true,"resolve":true,"text":"Fixed in ab12cd3: ..."}`, T2
  `{"post":false,"resolve":true}` and T4 `{"post":true,"resolve":false}`,
  with no `text` on T2 or T4.
- **post-act-edited-postonly:** T1 posts the `text` exactly and does not
  resolve. T2 resolves and posts nothing. T4 posts its draft. The record
  is T1 `{"post":true,"resolve":false,"text":...}`, T2
  `{"post":false,"resolve":true}` with no `text`, and T4
  `{"post":true,"resolve":false}`.
- **post-pane-typed:** the pane's `rt gate answer` carries the typed text
  as `note`, never `text`, with `--by pane`. T1 posts its DRAFT exactly
  and resolves. T2 resolves only. The record has no `text` and
  `--decided-by pane`.
- **Regressions:** the four scenarios in
  `../2026-09-22-respond-post-per-thread/scenarios/`, scored by that
  record's criteria plus the close. For act and resume, no answer
  carries `text`, so every entry is `{post, resolve}` alone.

## RED (system file = the engine before this edit)

post-act-edited: 0/5. Every rep read `text` as a note, posted the draft
on T1, and recorded T1 without `text`. T2 and T4 were right in all five.

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

## GREEN, first commit (strict re-score)

### Round 1: the planned wording

Record sentence: "An entry whose posted reply came from the answer's
`text` adds it: `{"post":true,"resolve":true,"text":"<the text that
posted>"}`."

- post-act-edited 5/5.
- build 5/5, none 5/5.
- act 1/5:
  - reps 2 to 5 recorded the draft as T1's `text`, reading "the text
    that posted" as any posted reply;
  - rep 4 also posted T1 as "Fixed... queue/..." (`--` rewritten).
- resume 0/5:
  - all five recorded the draft as T1's `text`;
  - rep 5 also closed nothing (the inherited-run reading, see Noise).

### Round 2: keyed to the answer

Record sentence: "When a thread's answer carries `text` and `post:`,
its entry adds that text: `{...,"text":"<the answer's text>"}`; every
other entry is `{post, resolve}` alone."

- post-act-edited 5/5.
- act 3/5:
  - rep 2 recorded the draft as `text`;
  - rep 3 posted T1 as "Fixed - queue/..." (`--` rewritten).
- resume 4/5: rep 4 recorded the draft as `text`.

### Round 3: the first commit's wording

Record sentence: "An entry carries `text` only when its thread's answer
was an object with `text` and `post:`, and then it is the answer's:
`{"post":true,"resolve":true,"text":"<the answer's text>"}`. A reply
posted from the `reply@1` context records `{post, resolve}` alone."

post-act-edited: 4/5.

- **Rep 1:** it first ran `rt runs field set waiting-gate - --stage
  receive-review` to clear a marker, which is harmless. Then:
  - T1 body "Fixed in ab12cd3: enqueue() now drops non-retryable jobs
    before the retry loop, with a test.", then resolve;
  - T2 resolve;
  - T4 posts "Which caller do you mean: the cron path or the API
    path?";
  - record T1 `{"post":true,"resolve":true,"text":"Fixed in ab12cd3:
    ..."}`, T2 `{"post":false,"resolve":true}`, T4
    `{"post":true,"resolve":false}`;
  - closes.
- **Rep 2:** same actions and record, but it closed nothing (the
  inherited-run reading). **FAIL.**
- **Reps 3, 4, 5:** same actions and record; close.

Regressions:

- build 5/5.
- act 10/10.
- resume 8/10:
  - rep 6 posted T1 as "Fixed - queue/..." (`--` rewritten);
  - rep 7 closed nothing (the inherited-run reading);
  - every record was correct.
- none 5/5.

## Fix round

### RED (system file = the first commit's engine)

- **post-pane-typed 0/5.** Every rep's `rt gate answer` carried the
  typed reply as `text`, then posted it on T1. The reps read
  gate-protocol's "a surface that lets the human replace text" as
  covering the pane's free-text field.
- **post-act-edited-postonly 5/5.** Every record was T1
  `resolve:false`. Two more 10-rep controls on the same engine also held
  (25/25). The hard-coded `"resolve":true` in the record example showed
  no behavioral failure; changing it is a contract correction.
- **Drafted-reply wording:** no behavioral test. The build scenario
  covers the recipe it touches.

### Iterations on the record example (post-only, T1 record)

| Wording | post-only T1 `resolve:false` | Notes |
|---|---|---|
| first commit, concrete `"resolve":true` (control) | 25/25 | |
| `"resolve":<as picked>` | 11/15 | Drifting reps counted the recommended `resolve:T1` as picked. One (fix1 rep 2) also resolved T1 on the forge. |
| `"resolve":<bool>` | 17/20 | Rep 6 of the second batch quoted `["post:T1"]` and still resolved. |
| no `resolve` in the example | 19/20 | |
| concrete `"resolve":true` kept, no clause (isolation) | 10/10 | |
| **committed:** concrete example, then "`"resolve":false` when it does not" | **10/10** | Edited 5/5 still records `resolve:true`. |

A placeholder in the example invites the rep to fill `resolve` from the
open's recommendation. A concrete example with a condition keyed on the
answer does not.

### Pane clause

The first clause went in the in-pane form bullet only ("an edit typed in
a free-text field is a note"). It scored 1/5: reps still followed
gate-protocol's surface sentence. Adding "The in-pane form is not such a
surface: what a human types in its free-text field is a note." to
gate-protocol, and "a full replacement reply included" to the pane
clause, scored 5/5.

### GREEN (the committed engine), strict

- **post-act-edited-postonly 10/10:**
  - T1 posts the `text` exactly and does not resolve;
  - T2 resolves only, and "ignored edit" is neither posted nor recorded;
  - T4 posts its draft;
  - records are correct and every rep closes.
- **post-act-edited 5/5:** T1 `text` exact, T1 resolves, record
  `resolve:true` with `text`, T2 and T4 without; every rep closes.
- **post-pane-typed 5/5:**
  - every `rt gate answer` carries the typed reply as `note`, with
    `--by pane`;
  - T1 posts its exact draft and resolves; T2 resolves only;
  - no record has `text`, and every rep uses `--decided-by pane` and
    closes;
  - reps 2, 4 and 5 also copied the `note` into T1's record entry. This
    is not scored, because step 6 says the note rides the record.
- **post-build 5/5:** every source uses exact reply texts, is fitted, is
  opened with `rt gate ask --kind respond-post`, and waits for the
  answer.
- **post-act 5/5** and **post-resume 5/5:** exact texts, correct records,
  every rep closes.

## Noise outside this change

- **The inherited-run reading.** A rep reads the scenario's set
  `RT_RUN_DB` as an inherited run and skips the close. The cause is
  `## Run` meeting the scenarios' framing, not step 6.
  - Control on the pre-edit engine: 1/10 on resume (rep 4).
  - After the edit: 1/5 post-act-edited and 1/10 resume in round 3, 1/5
    resume in round 1, and 1/5 resume on an intermediate fix-round
    engine. None in the committed engine's GREEN.
- **The `--` rewrite.** A rep posts T1's draft with `--` rewritten to `-`
  or `...`.
  - Control on the pre-edit engine: 1/5 on post-act (rep 4) and 0/10 on
    resume, so 1/15.
  - After the edit: 3 in the first commit's 40 act and resume reps
    (round 1 act rep 4, round 2 act rep 3, round 3 resume rep 6).
  - None in the fix round's 30 act and resume reps.

## Verdict

- post-act-edited: RED 0/5; first commit 4/5 strict (one close miss that
  also appears in the control); committed engine 5/5.
- The committed engine is 5/5 or better on every scenario, read strictly:
  build, act, resume, edited, post-only (10/10) and pane.
- The act step posts an answer's `text` for a `post:` thread and the
  draft otherwise, and the pane never sends `text`.
- The record carries `text` only when the answer supplied it, and its
  `resolve` follows the answer.
