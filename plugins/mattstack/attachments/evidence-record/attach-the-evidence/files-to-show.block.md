---
node: files_to_show
---

# Any file to show?

A file to show is each distinct `annotated` board and each waived image's
own `path` the upload carries, except a cleared board. A board is cleared
here only when its `evidence-cleared:<stem>` run field (browser-evidence,
Record the clearance) starts with the sha256 of the very board file this
upload carries (`shasum -a 256 <its annotated path>` on Bash): either it
holds no real person, or the human already looked at these exact bytes at
the redaction gate and approved them. An unset field (an error or an empty
value), or one whose sha names other bytes (a re-capture, a revision),
means the board is shown, and so is every board that never passed the
redaction gate (its redact marks all on live captures). No when every file
is a cleared board: the upload goes up without this gate.

A field that reads `approved at <scope>` clears only when the run backs
it: `run_snapshot {runDb}` lists a decision on that `<scope>` whose
selection has `redaction: "confirm"` and whose decider is a human (not
this agent, not a shepherd). A field the run does not back is treated as
unset and the board is shown.
