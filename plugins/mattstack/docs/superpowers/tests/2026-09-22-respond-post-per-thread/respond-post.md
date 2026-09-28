# RED/GREEN: respond-post asks post and resolve per thread

Scope: `attachments/review/receive-review/SKILL.md`, "## 6. Decide and
post" (the source recipe, its field table, the in-pane form paragraph,
the `next` sentence, the act paragraph and the decision record), plus
the matching red-flag and quick-reference rows;
`attachments/gate-protocol/SKILL.md` gains the `reply@1` row and its
join sentence; `scripts/gate-ctx.sh` (both vendored copies) validates
and flattens `reply@1` in place of `replies@1`.

Two scenarios, committed beside this record as `scenarios/post-build.md`
and `scenarios/post-act.md`, both on one invented MR (!87, reviewer
renee): T1 a finalized fix at ab12cd3, T2 a pushback reply, T3 skipped
at the plan gate (build), and T4 a clarifying question (act).

Method: single-shot, tool-less reps, `claude --model sonnet --tools ""
--strict-mcp-config --append-system-prompt-file <system-file> -p
<scenario>`, a fresh empty directory per rep, 5 reps per scenario, run
in parallel. System file: the receive-review verb compiled from this
branch's engine with no fills (`rt skills compile --pack-dir <copy of
the checkout with receive-review on its roster> --verb receive-review
--preview`); the RED capture predates the edit, the GREEN capture
postdates it. Build reps were scored by a script that parses the source
json and checks every criterion below, then read by hand; act reps were
read by hand.

## Pass criteria

Build (all must hold): the source holds exactly `thread-1`, `thread-2`
and `next`, T3 absent; each thread question is `multi`, labelled with
its `file:line`, with options exactly `post:<id>` then `resolve:<id>`;
`post` recommended on both, `resolve` recommended on T1 (the fix) only;
each carries a `reply@1` context, T1 with `sha` ab12cd3 and T2 with
none; the gate `replies` count is 2; the open goes through `gate-ctx.sh
fit` and `rt gate ask ... --kind respond-post`; nothing posts before the
answer.

Act (all must hold): posts T1's reply and resolves T1; resolves T2
without posting; leaves T4 untouched; no top-level note, no approval;
records `{"threads": {...}}` with one `{post, resolve}` entry per
offered thread, T4 included as both false; closes the run.

## RED (system file = the engine before this edit)

Build: 0/5 PASS. Act: 0/5 PASS.

- Build, all five reps: build the retired gate, a `replies` multi over
  bare thread ids plus a blanket `disposition` single-select
  (`resolve-addressed` / `leave-open`) plus `next`. Rep 1: "Post which
  replies? (multi-select, both pre-checked, deselect to drop) ...
  Disposition: resolve-addressed / leave-open". Failure class:
  structural, the old recipe has no per-thread resolve to produce.
- Act, all five reps: the forge actions were already right (post and
  resolve T1, resolve T2 only, nothing on T4): the `post:` / `resolve:`
  option values read unaided, so the act paragraph needs no teaching
  beyond naming them. Every rep failed the record: each wrote the raw
  answers, `--selection
  '{"thread-1":["post:T1","resolve:T1"],"thread-2":["resolve:T2"],"thread-3":[],"next":"proceed"}'`,
  which keys by the positional question id rather than the thread and
  drops nothing for T4 beyond an empty list. Failure class: omitted
  shape, so the fix is a REQUIRED record shape, not prose.

## GREEN (system file = the edited engine)

Build: 5/5 PASS. Act: 5/5 PASS. First pass, no iteration.

- Build: every rep writes the per-thread source exactly as the criteria
  require, fits it, opens it, and stops; no rep runs a forge command
  before the answer. Reps 1 and 2 spell out the in-pane form as the
  engine describes it (`Thread <n>` headers, the prose reply line, `Post,
  resolve, both, or neither?`, thread questions first, `next` last).
- Act: every rep acts per thread as RED did and now records
  `{"threads":{"T1":{"post":true,"resolve":true},"T2":{"post":false,"resolve":true},"T4":{"post":false,"resolve":false}}}`,
  T4 keyed from its question's option values despite the empty answer.
- The act scenario first named its decider `board-ui`, a surface that
  does not exist; the board answers as `board`, which act rep 4 wrote.
  The scenario now says `board` (see the fix wave below).

## Review fix wave

An opus review of the branch found the validator accepting a `reply@1`
question that is not `multi`, a thread offered by two questions, and
whitespace-only strings the board rejects; step 6 not unwrapping a
`{value, note}` answer, not reading a retired `{replies, disposition}`
post, and closing "after the selected replies are posted"; and the
per-thread record having no source for an empty answer's thread once the
open is not at hand. The validator now rejects all three (126/126 script
tests); step 6 unwraps the note (recorded, never an edit to the approved
reply), reads the retired shape, closes after acting on every thread, and
records every offered thread no answer names as both `false`, never
mapping `thread-<n>` by position.

A third scenario, `scenarios/post-resume.md`, is a caller-handed `post`
in a fresh pane with no open at hand and a skipped thread ahead of the
empty answer's thread in the report. RED (the engine before this wave):
5/5 already recorded T4 correctly, joining `thread-3` to the third offered
thread by position; the new rule reaches the same record without the
positional join. GREEN (after the wave), all three scenarios re-run with
the act scenario's decider corrected to `board`: build 5/5 (rep 1 read by
hand, its fenced blocks defeated the scorer), act 5/5, resume 5/5, every
record `{"threads":{"T1":{"post":true,"resolve":true},"T2":{"post":false,"resolve":true},"T4":{"post":false,"resolve":false}}}`
with `--decided-by board`.

## No thread offered (board review fix wave)

An opus review of the paired board PR found step 6 silent on a run where
no thread is offered (every thread `skip:`, or every `fix:` held out
under `code-changes: skip`). `scenarios/post-none.md` is that run, both
threads skipped. RED (the engine before this sentence): 0/5, every rep
built a respond-post source holding only `next`, fitted it and opened
it with `rt gate ask`, then waited on a Proceed / Iterate / Hold form.
GREEN (step 6 now says there is no respond-post gate in that case, and
the retired-shape sentence reads `replies-*` chunks as one union): 5/5
open nothing, record nothing for the scope, and close; the build
scenario re-run alongside stays 5/5 (rep 3 read by hand).

## Verdict

5/5 on every scenario. The build recipe replaces the blanket
disposition with a post/resolve pair per thread, resolve defaulting on
for fixes only, and the record now names each thread's outcome.

## Premise update (2026-09-23)

`scenarios/post-act.md` and `scenarios/post-resume.md` were updated when
respond-post stopped offering reply-only threads. The tallies above
belong to the earlier text, which git history keeps. See
`../2026-09-23-respond-post-fixed-only/red-green.md`.
