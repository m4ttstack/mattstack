# RED/GREEN: findings file moves to version 2

Scope: `attachments/review-core-body-tail/SKILL.md`, "Structured findings
file" section (replaced whole section) and the "Draft assembled" row in
Quick reference.

## Superseded run

The first run of this micro-test used `--allowedTools ""`, which does
not disable tools: it only restricts the auto-approve allowlist, and the
session still had real file tools available. The five reps of a batch
ran in parallel against the same fixed scratch path (`/tmp/rv/report.md`
and its `.json` sibling) and genuinely contended for it, each one
actually reading and writing that shared file. That produced a
"something else is modifying this file between my read and write"
narration in a rep of the RED batch as well as the GREEN batch (not a
GREEN-only artifact as the first version of this record claimed), plus
several byte-identical outputs across reps (RED rep-2 = rep-3 = rep-4;
GREEN rep-1 = rep-6 = rep-7 = rep-8), which likely reflects one rep
reading back another rep's already-written file rather than five
independent runs. That whole run (raw outputs under
`.superpowers/micro-tests/findings-file/superseded-with-tools/`) is
discarded; the tallies below are from a rerun with a verified tool-less
harness in an isolated directory per rep.

Method: single-shot reps with tools verified absent, `claude --model
sonnet --tools "" --strict-mcp-config --append-system-prompt
<system-file> -p <scenario-file>`, run in a fresh empty directory per
rep, 5 reps per side, run in parallel. Verified tool-less before
scoring: asked the same harness to write a real file and confirmed on
disk that nothing was created (the model narrated doing so, but no file
existed afterward), so the "modified elsewhere" narration in the
superseded run cannot recur from genuine file contention here. System
file: the neutral compiled review verb (`rt skills compile --pack-dir
<neutral-pack> --mattstack-dir <mroot> --verb review --preview`),
read-only, no team fills; the RED capture predates this section's edit,
the GREEN capture postdates it. Scenario: a re-review of an open change,
prior review with four findings (p1 to p4), a draft with three findings
(one Critical re-raising p2 as still open, one new Minor, one Minor the
author claims fixed and this pass verified), instructed to print only
the json sibling it would write beside the report.

Pass criteria: `"version": 2`; `summary.readiness` `with-fixes`; three
findings; each with a `body` carrying its full text (the Critical one
containing "goes back on the queue after every failure, so it never
leaves", none cut to a title-length gist); the Critical finding's
`evidence` containing "worker.log: job 41 attempt 57 (retryable: false)"
verbatim; `re_review: true`; `prior` with integer `addressed` and
`still_open` (still_open 1); dispositions `still-open` (Critical), `new`
(ordering), `addressed-check` (README).

## RED (system file = the section before this edit): 0/5 PASS

All five reps distinct (no repeated output), no file-contention
narration in any of them.

- Rep 1: no `version` key; every finding carries `title` only, no
  `body` -- `"title": "permanent failures re-enqueue forever", "file":
  "queue/worker.ts", "fix": "Drop non-retryable jobs in the worker's
  catch block."`. The worker.log text lands in a top-level `checks`
  entry (`"tag": "FAIL", "text": "p2 (permanent failures re-enqueue):
  worker.log shows job 41 attempt 57 (retryable: false), still
  re-enqueuing"`), not as an `evidence` field on the finding. The
  re-review framing produces only prose `notes` ("p1 and p3 confirmed
  addressed, no regression found"), never `re_review` / `prior` /
  `disposition`.
- Rep 2: same shape -- no `version`, `title`-only findings, evidence
  text folded into a `checks` entry (`"text": "worker.log: job 41
  attempt 57 (retryable: false) -- non-retryable job still
  re-enqueuing"`), re-review state spread across three `notes` strings
  instead of structured fields.
- Reps 3, 4, 5: no `version`, `title`-only findings, no `evidence`
  field on any finding (the worker.log text does not appear in reps 3
  or 4 at all; rep 5 places it only inside a `notes` string: "p2 still
  open (this pass's Critical finding, f1)"), and no `re_review` /
  `prior` / `disposition` in any of the three.
- Failure class: exactly the expected omitted-elements shape -- no
  `version`, findings shortened to `title` with no `body`, no `evidence`
  field on any finding, no re-review fields at all despite the scenario
  explicitly framing the review as a re-review with four named prior
  findings. Structural, per writing-skills: the fix is required fields
  in the schema list, not a wording nudge.

## GREEN (system file = the edited section): 5/5 PASS

All five reps distinct (no repeated output), no file-contention
narration in any of them.

- All five printed `"version": 2` and `summary.readiness: "with-fixes"`.
- All five findings arrays carried exactly three entries with full
  `body` text. The Critical finding's body in every rep contains "goes
  back on the queue after every failure, so it never leaves" (rep 3
  trims its Minor findings' bodies to one clause each, e.g. f2's body
  "The test asserts exact call order where the contract only promises
  the set." -- shorter than the other reps but still a full sentence
  describing what and why, not a title-length gist).
- All five carried `evidence: "worker.log: job 41 attempt 57
  (retryable: false)"` verbatim on the Critical finding.
- All five carried `re_review: true` and `prior: {"addressed": 3,
  "still_open": 1}`.
- All five findings carried the correct disposition in order:
  `still-open` (Critical), `new` (ordering), `addressed-check`
  (README).
- Rep 1 narrated calling a Write tool twice (`"Write is being called
  with these parameters" ... "file_path": "/tmp/rv/report.md"`) even
  though none was granted (the tool-less check above confirms no write
  actually lands); it still ended by printing the complete, correct
  json, so it scores PASS on content. No other rep in this batch
  narrated tool use.

Verdict: 5/5 on this run, first pass, no iteration needed. No wording
change made to the section; the earlier apparent stall and the
duplicate-output pattern were both artifacts of the first run's file
contention (real tools plus a shared scratch path), not of the edited
text, and neither recurred once the harness was genuinely tool-less.
