---
node: record_evidence
---

# Record the evidence (evidence-record)

`images` are the AFTERs just captured (`slot: after`, a new case's
`label`), `tree` is `<root>`. A browser AFTER carries its board as
`annotated` and the brief's claim as `caption` (browser-evidence, Record
the board); a pair board covers the case's before image too, named by its
`value` path, unless that before's board is an import board (its
`<stem>.c1.capture.json` in the record's folder says `"source": "import"`):
the before keeps that board and stays out of this call, so the pair covers
the after alone. Recorded goes straight to the attach: this stage writes no
`evidence` of its own.
