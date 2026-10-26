---
node: record_evidence
---

# Record the evidence (evidence-record)

`images` are the AFTERs just captured (`slot: after`, a new case's
`label`), `tree` is `<root>`. A browser board's images carry it as
`annotated` (`~/.fast-browser/screenshots/<stem>.png`) with the brief's
claim as `caption`, as browser-evidence's Record the board says; a pair
board also covers the case's BEFORE, named by its `value` path, unless that
BEFORE's board is an import board (its `<stem>.c1.capture.json` in the
record's folder says `"source": "import"`): the BEFORE keeps that board and
stays out of this call, so the pair covers the AFTER alone. Recorded
goes straight to the attach: this verb writes no `evidence` of its own.
