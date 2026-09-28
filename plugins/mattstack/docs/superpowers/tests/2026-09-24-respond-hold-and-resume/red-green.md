# RED/GREEN: Hold at Gate 2 posts nothing; a resume never posts twice

Scope: `attachments/review/receive-review/SKILL.md`, two of the cases the
0.18.2 full read found, as one engine revision. The rules:

- **Only `proceed` acts at respond-post.** A `hold` or `iterate` answer
  decides nothing, whatever its thread picks say: nothing pushes, no
  reply posts, no thread resolves, and no respond-post decision is
  recorded, so every offered thread stays pending in the record and the
  `gate-1: reply` rows keep waiting. The ask that follows is a NEW gate,
  its open rebuilt from the report rows minus every thread already
  posted (a record entry with `post: true`, or a forge note that is this
  run's reply). A thread that has posted is never offered twice.
- **Posted already.** On any resume (a caller replaying a parked gate's
  answer, or the snapshot alone), the verb reads each thread on the
  forge before its reply posts or a re-asked respond-post offers it. A
  thread that already carries this run's reply (a note whose text is the
  reply due, or any note by the account the run posts as dated after
  `started_at`) is posted: counted as posted, never offered, never
  posted again, whatever the snapshot or the report says.
- **Tables:** two red-flag rows and the `respond-post answered` quick
  reference row match.

## Scenarios

Committed beside this record, all on the invented MR !87 (reviewer
renee, branch `renee/queue-retry`). T1 is a `gate-1: fix` row committed
as ab12cd3 in step 5, T2 a `gate-1: reply` row, T3 a `gate-1: override`
row.

- `scenarios/hold-at-gate-2.md`: a terminal run. Gate 2 offered T1 and
  T3; the in-pane form ticked post and resolve on T1, post on T3, then
  Hold. Asks for every command, record and forge action until the pane
  stops, then what a re-asked open offers.
- `scenarios/iterate-at-gate-2.md`: the same, but the T3 tick carries
  the typed note "say which retry path this is" and `next` is Iterate
  here. Asks the same, up to the re-ask.
- `scenarios/resume-after-posting.md`: a hand launch that resumes run
  7f3a from the snapshot alone (the earlier pane, its scratch directory
  and its report are gone). The snapshot has `gate: respond-post`, a
  respond-plan record (T2 `reply` with `texts`, T3 an override with a
  note, `code-changes: skip`) and no respond-post record. It never says
  whether the dead pane posted anything.

## Method

As in `../2026-09-23-respond-push-before-fixed/red-green.md`:

- **Reps:** single-shot and tool-less, `claude --model sonnet --tools ""
  --strict-mcp-config --append-system-prompt-file <system-file> -p
  <scenario>`, a fresh empty directory per rep, 5 reps per scenario, run
  in parallel.
- **System file:** receive-review compiled with no fills (`rt skills
  compile --pack-dir <copy of the tree whose pack/stubs.jsonc rosters
  receive-review> --verb receive-review --preview`).
- **Scoring:** I read every rep by hand.

## Pass criteria

- **hold-at-gate-2:** no push, no post, no resolve, no respond-post
  record; T2 does not post; the re-asked open is a new gate that offers
  T1 and T3, and the rep says a thread already posted would not be
  offered.
- **iterate-at-gate-2:** the same holds on `iterate`: no push, no post,
  no resolve, no record; T3 is redrafted with the note; the re-asked open
  offers T1 and T3 and excludes any thread already posted.
- **resume-after-posting:** before any reply posts, the rep reads T2 and
  T3 on the forge for this run's own reply (same text, or its own
  account since `started_at`), and treats a thread that carries one as
  posted: not posted again, not offered, counted as posted.

## RED (0.19.2, the merged main)

| Scenario | Result | Notes |
|---|---|---|
| hold-at-gate-2 | 5/5 on the acts, 0/5 on the exclusion | A guard for the posting half: every rep acts on nothing on Hold. Rep 2: "I take your ticks as a draft, not a decision." No rep says a re-asked gate excludes a thread that already posted. Reps 1, 4 and 5 still submit an `rt gate answer` carrying the ticks plus `next: hold` into the registry; rep 2 refuses, since it "would put a decision in the registry that a board or console could act on". That variance is outside this slice. |
| iterate-at-gate-2 | 3/5 | Reps 1 and 3 push, post T1 and T3, resolve T1 and write the record on `iterate`. Rep 1: "I act on the picks whatever `next` says. `iterate` only holds the `gate-1: reply` row", and "I take the `iterate` answer as authorization for the push." Rep 3: "the per-thread picks act even though the human chose Iterate." Rep 4 acts on nothing but re-asks the stale open with T3 unredrafted (the note-dropped case, outside this slice). |
| resume-after-posting | 1/5 | Only rep 5 reads the threads for the run's own reply and skips one that carries it, and even it "record[s] it as not posted by this gate". Rep 1 checks T2 alone ("the dead pane may have posted it") and still redrafts and offers T3. Reps 2 to 4 read the discussions only to confirm the threads are open, then post both. |

Failure class, Hold and Iterate: the act paragraph listed the per-thread
acts before the proceed condition, and "On `hold` or `iterate` they
wait" attached only to the `gate-1: reply` rows. Failure class, resume:
nothing said to read the forge before posting, and the snapshot cannot
tell a pane that died waiting on Gate 2 from one that died after
posting.

## GREEN (the committed engine)

| Scenario | Result | Notes |
|---|---|---|
| hold-at-gate-2 | 5/5 | Nothing acts, and every rep now reads the forge before the re-ask and drops a thread that carries this run's reply. Rep 1: "A pane can post and die before it records, and a thread that already carries this run's reply counts as posted and is not offered." Reps 2 and 4: "T1 and T3 stay pending in the record." The registry variance persists (reps 3 and 4 submit the hold answer), unchanged by this slice. |
| iterate-at-gate-2 | 5/5 | Converged: no push, post, resolve or record in any rep; T3 redrafted with the note; the forge read before the re-ask; T1 and T3 re-offered, T2 waiting. Rep 3: "Iterate here decides nothing. Only `next: proceed` (or a caller-handed `post`) acts." |
| resume-after-posting | 5/5 | Converged: every rep reads `glab api user` and the discussions before anything posts, applies the two-part test, and spells out the branches. Rep 4: "A posted thread is never posted or offered again." Rep 2, both already posted: "I open no gate. I record T3 as `{"post":true,"resolve":<the forge's resolved flag>}`." |

## Review round (CodeRabbit on d95c616)

One finding, Major: the "Posted already" paragraph counted a posted
thread as posted "in the respond-post record", but a `gate-1: reply`
row never gets a respond-post entry (only offered threads do), so for
T2 the sentence contradicted step 6.

- Before: "count it as posted, in the respond-post record and at the
  close"
- After: "the close no longer waits on it, an offered thread's
  respond-post entry reads `post: true` (a `gate-1: reply` row gets no
  entry, as ever)"

| Scenario | Result | Notes |
|---|---|---|
| resume-after-posting | 5/5 | Every rep still reads the forge first and never posts or offers a posted thread. Four keep T2 out of the record explicitly (rep 3: "T2 gets no entry, only offered threads are recorded here"); rep 4 would still mark a posted T2 `post: true` in the selection, against the paragraph's own parenthetical. |
