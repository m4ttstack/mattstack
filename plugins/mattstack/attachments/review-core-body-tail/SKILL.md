---
name: review-core-body-tail
description: "Review flow tail after the reviewer dispatch, inlined by the review verbs. Not for direct invocation."
disable-model-invocation: true
---

## Assemble the draft

Fold your observations in; present exactly this shape:

- **Strengths** -- specific.
- **Issues** -- **Critical** (must fix) / **Important** (should fix) /
  **Minor** (nice to have). Every finding lands in one bucket, with
  `file:line`, what is wrong, why it matters, and the fix.
- **Assessment** -- Ready to merge: yes | no | with fixes, plus reasoning.

Those names and those three words are fixed vocabulary: downstream callers
read the draft by them. Return the draft; never post it, approve, or ship.

## Structured findings file

Whenever the draft is written to a report file, write a sibling with the
report path's `.md` swapped for `.json`, machine-readable, mirroring the
draft exactly (never re-judged). It is version 2 of this file:

- Required: `version` (`2`), `summary` ({`readiness`: `yes` | `no` |
  `with-fixes`, `reasoning`: the assessment's qualifier in one or two
  sentences; the draft's spaced "Ready to merge: with fixes" maps to
  readiness `with-fixes`, hyphenated, never the spaced form) and
  `findings`: one entry per finding, in report order, `id` stable
  (`f1, f2, ...`), with `tier` (`Critical` | `Important` | `Minor`,
  exactly the draft's buckets), `kind` (nitpick / suggestion / thought /
  confirmation / question, or the closest word), `title`, `body` (the
  finding in full as the draft states it, what is wrong and why it
  matters; the posting gate shows it verbatim, so never shorten it),
  `file` and `line` when the finding anchors to the diff (else
  `fileLabel` with the anchor text, e.g. "not inline-anchorable"), and
  `fix` (one line).
- `evidence` on a finding whenever the run produced output that backs it
  (a failing test's lines, a command's result): that output verbatim,
  never paraphrased.
- Re-review passes only (the caller framed the review as a re-review):
  `re_review: true`; `prior` ({`addressed`, `still_open`}: how many of
  the prior review's findings this pass found addressed, and how many
  still open) when the prior review was in hand; and on every finding a
  `disposition`: `new` (not in the prior review), `still-open` (re-raises
  a prior finding), or `addressed-check` (a prior finding the author says
  is fixed and this pass verified; the human confirms it).
- From the run, not just the draft: `depth` (one line -- the REVIEW DEPTH
  line and what that setup found), `checks` (`[{tag, text}]`, tag `PASS` |
  `N/A` | `FAIL` -- the EVIDENCE CHECK line and each thing the setup
  observed, one entry apiece), `notes` (observations that are neither
  strengths nor findings, including post-merge follow-ups), `strengths`
  (`[{lead, detail}]`, the claim split from its receipts). A run that
  printed the depth and evidence lines has the material for `depth` and
  `checks`; omit a block only when the run produced nothing for it.
- The markdown report stays the human artifact and does not change; the
  json is the only machine-read path. Its readers are the review verb's
  Deliver (it builds the posting gate from the file), review-posting on a
  parked resume, and the board's report view; a field whose meaning
  changes bumps `version`, and those readers change with it. No terminal
  run without a report path writes either file.

## Red flags

| Thought | Reality |
|---|---|
| "It's ~20 lines, or it's my own code" | The bias the fresh context removes. Dispatch it (the review dispatch step). |
| "I understand it from sizing it" | The understanding IS the bias. Dispatch it. |
| "I'll decide the depth as I go" | Print the block first (the review-depth step). |
| "Tests first, depth after" | Running them IS the depth decision, unprinted. Print, then set up. |
| "This writes up better its own way" | The five headings ARE the write-up; anything outside them is unreadable downstream. |
| "I'll post the findings myself" | Return the draft; the caller owns what follows. |

## Quick reference

| Signal | Action |
|---|---|
| Inputs in hand | Print REVIEW DEPTH / EVIDENCE CHECK and provider lines. |
| Criteria bound | Its triage lines into the block, its addendum into the dispatch. |
| About to judge the diff | Don't. The review dispatch flow (the dispatch step), reviewer shape, full payload. |
| Draft assembled | Buckets, `file:line`-what-why-fix, assessment word; return it; write the json sibling (version 2, every body in full) when a report path exists. |
