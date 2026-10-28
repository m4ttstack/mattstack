---
node: write_report
---

# Write the review report and its json sibling

The review flow's "Structured findings file", written after verification
and any demotion so the json mirrors the verified draft. This verb asks
for drafts: the json also carries every comment that will post, drafted
here, before any gate opens.

1. Load the writing style (Writing style, below) first, unless this run
   already loaded it.
2. Each finding's `comment`: its whole comment as it will post, in that
   voice, saying what is wrong, why it matters and what to change. A
   demoted finding's comment says it is unverified, as its `body` does.
3. `summary.comments`: one summary line per verdict the gate will offer,
   keyed by the option values of the extras' `outcome` question:
   `{"comment": "...", "approve": "..."}`, plus `request_changes` only
   when this verb runs the gate on GitHub. Exactly those keys, never one
   more or one fewer. Each value is the whole summary line for that
   verdict, in that voice, with the strengths and the assessment said as
   the reviewer wants them. None holds an issue list: each ticked finding
   with no diff line joins it at post time (Compose).
4. Write each line for its own verdict, whatever readiness says, so
   review-posting's tacit-approval rule shapes every line now. The
   `approve` line is the only one that may say the MR is ready to merge,
   good to merge, LGTM or nothing blocking. The `comment` line leaves the merge
   call to the author, or says approval is withheld pending the notes.
   The `request_changes` line says what must change before it merges.

When a selector ran, write `review-verdicts.json` (The verdict file) next to
the report json.

These drafts are the text that posts. Once a gate is built from the json,
nothing rewrites it; an iterate drafts again only for the new gate.
