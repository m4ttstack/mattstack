---
order: 1
---

# Structured findings file

Whenever the draft is written to a report file, write a sibling with the
report path's `.md` swapped for `.json`, machine-readable, mirroring the
draft exactly (never re-judged). It is version 3 of this file:

- Required: `version` (`3`), `summary` ({`readiness`: `yes` | `no` |
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
- Drafted comments, only when the caller asks for drafts (the review verb
  asks; with no such ask, as in self-review, neither key is written):
  `comment` on every finding and `summary.comments`, each the exact text
  that posts, written in the loaded writing-style voice. A finding's
  `comment` is its whole comment. `summary.comments` maps each verdict
  the caller's gate offers (the option values of its `outcome`
  question, which the caller names) to the review's whole summary line
  for that verdict. Both are optional and additive, so the file stays
  version 3 and a file without them reads as before.
- Re-review passes only (the caller framed the review as a re-review):
  `re_review: true`, and `threads`: one entry per earlier thread the
  caller handed in, in the order given, never one the caller did not
  hand in:
  `{discussionId, file, line, round, call, original, authorReply, note,
  reply}`. `discussionId`, `round` and `original` (the reviewer's own
  first note, verbatim) come from the caller unchanged; `file` and `line`
  are the thread's anchor when it has one; `authorReply` is the author's
  latest note in the thread, verbatim, omitted when they wrote none.
  `call` is this pass's verdict on the thread, one of four:
  `fixed` (the code now does what the thread asked), `not-fixed` (it does
  not, and the author gave no reason that holds), `pushback-accepted`
  (the author declined and their reason holds), `pushback-rejected` (the
  author declined and their reason does not hold). `note` is one line
  saying what was checked to reach the call. `reply` is the reply to post
  in that thread, written in the writing style, never empty.
  `prior` is counted from the calls: `addressed` is `fixed` plus
  `pushback-accepted`, `still_open` is the other two.
- On a re-review, `findings` holds only what is new: an issue an earlier
  thread already raises lives on its thread and is never a finding. Each
  finding's `disposition` is `new` or absent.
- `skipped`, when the caller handed in findings the reviewer chose not to
  raise in earlier rounds: every one of them back, in the order given, as
  `{id, round, tier, title, file, line, excerpt, changed}`. `id`, `round`,
  `title`, `file`, `line` and `excerpt` are the caller's, unchanged, and
  `file` and `line` are left out when the caller's entry has none;
  `excerpt` is the finding's recorded text, its body and then, when it
  had a fix, a blank line and `Fix: <fix>`; `tier` is the caller's
  severity capitalised (`Critical` | `Important` | `Minor`). `changed` is
  true when the code the finding pointed at has moved since the round
  that skipped it: `git diff <that round's sha>..HEAD -- <file>` touches
  its line (any hunk in the file, for an entry with a `file` and no
  `line`), or, when a non-empty `snippet` was recorded, that snippet is
  no longer in the file (an empty `snippet` means none was recorded and
  tests nothing). When that round's sha is `unknown` or not in the
  checkout (`git cat-file -e <sha>^{commit}` fails: the MR was rebased or
  force-pushed), the snippet test alone decides, and with no snippet
  `changed` is false. It is false when the entry has no `file`.
- A would-be finding that says what a skipped one says, about the same
  code, is that skipped finding: it stays out of `findings` and is
  reported only under `skipped`. The reviewer already decided not to
  raise it; whether the code changed is what `changed` is for.
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
