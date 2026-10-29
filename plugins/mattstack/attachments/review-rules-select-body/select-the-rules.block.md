---
order: 2
---

# Select the rules

Resolve the fill first (the text between the italic line at the top of Rule
selector and The contract). An empty fill, or the line `selector: none`,
skips every rule step in this skill: no selector run, no rule text in the
dispatch, no verdict request, no verdict file, and no setup observation.
Everything else runs as it would without this section. A fill that is not
empty and resolves to neither shape is a failure (When the selector fails).

**No selection** means any of: an unbound slot (an empty fill), the line
`selector: none`, or a selector that failed (When the selector fails). With
no selection, no later rule step runs and no verdict file is saved.

**The empty selection** is a selection whose `rules` list is empty. It
sends no rule text and no verdict request, skips the check and the repair,
adds no findings, and saves `{"verdicts": []}` as the verdict file.

With a selector:

1. Run its `selector` command on Bash twice, `{format}` replaced by `json`
   and then by `text`. Each run gets the change's unified diff on stdin,
   the diff this run reviews (a run with no reviewer dispatch uses the
   branch against its target), and its stdout is captured.
2. Make the review scratch dir here when none exists yet: one new directory
   in this session's scratchpad, never `mktemp -d`, its path written out
   literally from then on. Every later step that writes a file for the
   review writes it there. Write the `json` run's stdout to `selection.json`
   in it.
3. Unless the selection is empty, hand the `text` run's stdout to the
   dispatch as the rule selection (Review dispatch's Standard blocks), as
   it came, with a verdict request naming the `fence` value. When the
   dispatch is a thread adjudicator, the text goes to it as reference for
   judging the threads, with no verdict request, and no later rule step
   runs.
