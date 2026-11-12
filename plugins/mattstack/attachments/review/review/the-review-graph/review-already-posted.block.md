---
node: review_already_posted
---

# This review already on the MR?

Asked after Compose, before anything posts. A first pass
(`started` or `inherited`) answers no without a read. A resumed run with no
post decision reads the MR before any submit, whatever its holds say,
since a submit can land after the run's last record.

**On GitLab:**

`mr_posted_since {mrUrl, since: <the snapshot's run.started_at>, items}`

`items`: `{id: "summary", contains: <the first line of the summary Compose
built>}`, then per comment `{id: <finding id>, contains: <the first line
of the body Compose built for it>, path, line}`: the text this submit
sends, edit or draft, never the json's other fields. All `posted` is yes, some is partly, none is no; never judge it
from a thread read, and a read error holds, quoting it.

**On GitHub:**

`mr_threads {mrUrl, refresh: true}`, read by text, since the read carries
no posted flag. The summary is posted when a `gh-review-<n>` entry's note
contains the first line of the summary Compose built. Each comment is
posted when a `gh-review-thread-<n>` note at its `path` and `line` (the
note's `position.newPath` and `newLine`) contains the first line of the
body Compose built for it. All posted is yes, some is partly, none is no;
a read error holds, quoting it. The read checks no approval state.

**On both forges:** the latest hold's
reason adds what the read cannot show: a review it names as posted by the
human is posted, and on an approve, an approval it does not name as landed
is outstanding. Yes with the approval outstanding is the approval gate
(iterate runs `mr_approve` alone, never a second submit); yes with nothing
outstanding is the post record; partly is the refused-review gate, where
the human finishes the review in the forge UI; no is submit.
