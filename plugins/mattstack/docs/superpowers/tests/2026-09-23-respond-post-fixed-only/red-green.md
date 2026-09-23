# RED/GREEN: respond-post asks only about fixed threads

Scope: `attachments/review/receive-review/SKILL.md`.

- **Step 4:** a `reply:` answer may be an object whose `text` is the reply
  to post. The respond-plan record carries it in a sibling `texts` map,
  and `threads` keeps its string values. The edit is written over the
  draft in that thread's row of step 3's report. The pane's gate 1
  answer never carries `text`.
- **Step 6:** a thread is offered only when a fix finalized its reply in
  step 5. A reply-only thread posts its gate 1 reply, unresolved:
  - with no offered thread, right away, with no respond-post gate and no
    respond-post record;
  - with offered threads, after gate 2, together with its picks.
- **Also in step 6:** the respond-post record covers offered threads
  only. A gate opened before this rule that still offers a reply-only
  thread decides that thread, an empty array included, and no reply
  posts twice.
- **Tables:** the red-flag and quick-reference rows match.

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
- `../2026-09-22-respond-post-per-thread/scenarios/post-resume.md`: the
  report rows now name each gate 1 answer. T4 became a fix at c9d0e12,
  T2 stays reply-only with its report reply, and the handed `post` is
  `{"thread-1": ["post:T1", "resolve:T1"], "thread-2": []}`. The
  skipped T3 still sits ahead of the empty answer's thread (T4) in the
  report.
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

## GREEN round 2 (the committed engine)

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

## Noise outside this change

- Several reps name a conditional `waiting-gate` clear, a doorbell
  verify (`rt gate wait --timeout 2s`) or a read-only discussion lookup.
  All are allowed or read-only.
- The unpushed-commit worry (fix-and-reply RED rep 5, GREEN round 2
  rep 3) appears on both engines. RED rep 5 went further and held T1's
  post for a push check.

## Verdict

- plan-replies-only: RED 0/5 -> 5/5 in both GREEN rounds.
- plan-fix-and-reply: RED 0/5 -> 5/5 in both GREEN rounds.
- plan-all-skip: 5/5 throughout (guard).
- legacy-post-act: 4/5 -> 5/5 after the loophole fix.
- Regressions on the committed engine: 5/5 on post-build, post-act,
  post-resume, post-none, post-pane-typed and post-only; 9/10 on
  post-act-edited, the one miss a self-corrected token slip.
- Gate 2 now offers only fixed threads. Reply-only threads post from
  gate 1, with the edit carried in `texts` and in the report row. With
  no fix there is no gate 2.
