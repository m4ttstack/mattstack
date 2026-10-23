---
node: revise_board
---

# Revise a board (browser-evidence)

Take `evidence` and `mr` from the shipped run's `run_snapshot` fields,
find the case's board in the record (the image's `annotated` path in `value`), and run
browser-evidence's Revise a board steps 1 to 7, with `stage: ship` on
every write and `mrUrl` = `mr`. Step 6 is `Record the evidence
(evidence-record)` and step 7 is `Attach the evidence (evidence-record)`;
the operator's ask is the attach consent, and step 7's Gate
evidence-boards shows every file to show (evidence-record, Any file to
show?), the revised board included unless its revision cleared it, before
anything uploads. The first `evidence_attach`
carries no `linkRefused`; this is the last attach, so only a Take at its
upload off-script gate resends with `linkRefused: true`.

`Revise outcome (ship)?`: revised is Recorded, then Attached. Held is a
Hold at Gate evidence-redaction (step 5, nothing recorded), Record held
or Attach held; the run is already closed, so no `run_hold`. A board with
no spec beside it is the no-spec exit. A compose error, a re-render that
still reads wrong after its two tries, a refused confirm, a recapture that
is not drawn, Record failed or Attach failed is a failure, quoted.

This path starts no run and closes none: no `run_enter`, no `run_stage`,
no `run_close`. A shipped run stays `done`.
