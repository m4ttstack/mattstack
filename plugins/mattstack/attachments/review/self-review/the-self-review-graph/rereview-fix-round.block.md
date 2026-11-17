---
node: rereview_fix_round
---

# Re-review the fix round

The review flow's Dispatch the review again, on every change since the
last full review, never only the latest commit. Read `self-review-head`
with `run_field_get`; the **fix-round diff** is `git diff
<self-review-head>` (the commits since then and the uncommitted changes)
plus each untracked file, built read-only the way the self-review diff is.
Write it to `fix-round.diff` in the review scratch dir and hand it over as
the diff file. The brief lists the findings this round fixed, so the
reviewer checks that each fix holds and judges every line the fixes wrote,
tests included. The re-review leaves `self-review-head` where it is, so a
second re-review covers the first round's fixes too.

When `self-review-head` is unset or not a commit in this checkout (a
rebase moved it), the fix-round diff is the whole self-review diff.
