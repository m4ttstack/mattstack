---
order: 4
---

# Summary comment

A review is the inline threads for the selected findings plus ONE
summary, identical regardless of which disposition was chosen. The
summary carries Strengths and the Assessment, and its issue list is
scoped to what was actually selected, restored findings included: a
deselected Minor does not resurface in the summary either. A selected
finding with no `file` anchor, or a restored one missing its `file` or
`line` or with `changed` true, lives in that issue list, and only there;
a restored one keeps its recorded text there too, plus its recorded
`file:line` when it has one.

Empty selection (`findings`, or legacy `levels`, is empty, and nothing
restored): no inline threads, post only the summary. Under Approve with nothing selected: skip
the issue list and just approve with a brief note; on GitLab that note is
the `summary` of the one submitted review, with the approve outcome.

**Drafted reviews.** When the report json carries drafts (`summary` has
`comments`, one line per verdict, which a gate's `editable: true`
requires), nothing is composed here. The summary is exactly the caller's
joined summary: the summary line (the human's edit, else the line drafted
for the chosen disposition), then each selected finding with no diff
line, its text (the human's edit, else its draft), each preceded by one
blank line. Write no Strengths, Assessment or issue list around it.
Every comment posts the human's edit, else its draft, word for word. The
json is the test, never the extras: a board's posting pane never sees
the extras. A restored finding that lives in the summary follows the
joined summary, with its recorded `file:line` and text; with nothing
selected, the note is the summary line alone.
