---
node: rewrite_report_rows
---

# Rewrite the receive-review report rows

**Report rows.** Once gate 1 is recorded, rewrite each thread's row of the
verdict report (the saved report file too, when there is one), in
verdict-table order:

```text
- <threadId> · <file>:<line> · <verdict>, recommended <action> · gate-1: <reply|fix|skip|override> · reply: "<text>"
```

After `gate_record`, write one row per entry of its `rows`, in order, from
the entry's `threadId`, `file`, `verdict`, `recommended`, `gate1` and
`reply`. Never work them out yourself: the tool applies the override rule,
the edited replies and the notes.

On a resume there is no `rows` result: join the record to the stored card
for each thread (`extra.gate-source.respond-plan`, the question whose
option values carry that thread id): `file` is the card's label, `verdict`
its context's `verdict.call`, `recommended` its recommended option's verb;
`gate-1` is `override` for every thread under the record's `overrides`,
else that thread's `threads` verb; `reply` is its `texts` entry, else the
card's `reply.text`, else `none`. With no stored card the card's fields
read `unknown`, and a `reply` row whose reply would be `none` is an
override.

**An override** row's reply was never seen word for word (its card showed
a direction or no reply, its answer carried a note, or its context never
reached the gate). It is redrafted (folding in the record's `notes` entry)
and offered at gate 2 beside the finalized fixes, never posted from gate
1.

Every later posting, a resumed pane's included, reads these rows, never
the recommendation: a `gate-1: reply` row posts its row's reply; an
`override` row, and a `fix` row whose Fixed reply was finalized, are
offered at gate 2; a `skip` row, and a `fix` row under `code-changes:
skip`, post nothing.

`code-changes: revise` re-adjudicates with a fresh dispatch and their
note, never in this session (the bias HARD-GATE still applies); a handed
plan is single-use, so the revised verdicts get a new respond-plan open.
`code-changes: skip` implements nothing; the row loop still redrafts
overrides.
