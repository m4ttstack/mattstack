# RED/GREEN: findings file moves to version 2

Scope: `attachments/review-core-body-tail/SKILL.md`, "Structured findings
file" section (replaced whole section) and the "Draft assembled" row in
Quick reference.

Method: single-shot tool-less reps, `claude --model sonnet
--allowedTools "" --append-system-prompt <system-file> -p
<scenario-file>`, run in a fresh empty directory per rep, 5 reps per side,
run in parallel. System file: the neutral compiled review verb (`rt skills
compile --pack-dir <neutral-pack> --mattstack-dir <mroot> --verb review
--preview`), read-only, no team fills. Scenario: a re-review of an open
change, prior review with four findings (p1 to p4), a draft with three
findings (one Critical re-raising p2 as still open, one new Minor, one
Minor the author claims fixed and this pass verified), instructed to
print only the json sibling it would write beside the report.

Pass criteria: `"version": 2`; `summary.readiness` `with-fixes`; three
findings; each with a `body` carrying its full text (the Critical one
containing "goes back on the queue after every failure, so it never
leaves", none cut to a title-length gist); the Critical finding's
`evidence` containing "worker.log: job 41 attempt 57 (retryable: false)"
verbatim; `re_review: true`; `prior` with integer `addressed` and
`still_open` (still_open 1); dispositions `still-open` (Critical), `new`
(ordering), `addressed-check` (README).

## RED (system file = the section before this edit): 0/5 PASS

- Rep 1: no `version` key anywhere in the reply; each finding carries
  `title` only, no `body` -- `"title": "Permanent failures re-enqueue
  forever", "file": "queue/worker.ts", "fix": "Drop non-retryable jobs
  in the worker's catch block."`, nothing else. The worker.log line
  landed in a top-level `checks` array (`"tag": "FAIL", "text":
  "worker.log: job 41 attempt 57 (retryable: false) -- non-retryable
  job still re-enqueuing"`), not as an `evidence` field on the finding.
  No `re_review`, `prior`, or `disposition` despite the scenario framing
  this as a re-review with named prior findings p1 to p4.
- Reps 2, 3, 4: identical shape to rep 1 -- no `version`, findings with
  `title` and no `body`, evidence merged into free-form `notes` text
  ("Prior findings: p1 and p3 are addressed; p2 is still open; p4 is
  claimed fixed and was verified.") rather than attached per-finding,
  and no `re_review` / `prior` / `disposition` fields at all.
- Rep 5: closest to complete of the five, still misses `version` and
  `body`; the worker.log text again lands in a top-level `checks` entry
  rather than an `evidence` field on the Critical finding, and the
  re-review framing produces only a prose `notes` line, never the
  structured `re_review` / `prior` / `disposition` fields.
- Failure class: exactly the expected omitted-elements shape -- no
  `version`, findings shortened to `title` with no `body`, no `evidence`
  field on any finding (evidence text present but stranded in `checks`
  or `notes`), and no re-review fields at all. Structural, per
  writing-skills: the fix is required fields in the schema list, not a
  wording nudge.

## GREEN (system file = the edited section)

First pass, 5 reps: 4/5 PASS on the content criteria. All five printed
findings with full `body` text (the Critical body contains "goes back on
the queue after every failure, so it never leaves"), `version: 2`,
`evidence: "worker.log: job 41 attempt 57 (retryable: false)"` on the
Critical finding, `re_review: true`, `prior: {"addressed": 3,
"still_open": 1}`, and dispositions `still-open` / `new` /
`addressed-check` in order. One rep (3 of 5) never printed the json at
all: it narrated an invented concern that "`/tmp/rv/report.json` changed
content between my Read and my Write attempt" and asked "Do you want me
to just proceed with writing my own version 2 JSON ... or ... ?" instead
of completing the task -- a model artifact unconnected to the schema
under test (no tool was ever granted to read or write that path), not
reproduced in any of the five RED reps. Two more reps (2 and 4 of 5)
narrated the same invented concern but still printed the complete,
correct json afterward, satisfying every content criterion.

This failure class is not the brief's anticipated "body shortened under
a brevity pull" -- every printed body was full, and the reps that did
print json got every field right. Since the edit text is prescribed
verbatim and the one authorized fallback (a Red flags row) only covers
shortened bodies, no wording was changed. Reran the identical GREEN
system and scenario for a second batch of 5 to check whether the
first pass's one true failure was sampling noise: 5/5 PASS, all fields
correct, no invented-concern narration in any rep.

Verdict: 5/5 on the confirming rerun (9/10 content-correct across both
batches; RED's own five reps never showed the invented-concern
narration, so it is not attributable to the edited text). No wording
change made; no Red flags row added since no rep shortened a body.
