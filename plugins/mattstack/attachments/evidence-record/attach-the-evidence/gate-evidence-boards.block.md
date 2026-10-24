---
node: gate_evidence_boards
kind: gate
label: Evidence boards
---

# Gate evidence-boards (below)

Scope `evidence-boards:<stage>:<n>`, `<n>` counting this gate's openings
in this stage pass from 1. Open it with `gate_open` (gate-protocol,
Structured context): the source's `context` is a `boards@1` object.

- `summary`: one sentence naming the MR and how many files go up.
- `boards`: this opening's 12 files (Files left to show in this attach?).
  `case` and `slot` are
  the image's (a pair board's slot is `after`); `theme` when the image has
  one; `path` the absolute path in `value`; `caption` the image's caption,
  or `Waived: <its waiver>` for a waived capture, which goes up as shot.

`gate_open` refuses a `boards@1` source with more than 12 boards, or
one whose boards do not fit the pane prose budget. Each
opening's budget is keyed by its first file's name, so a long upload's
later openings are not charged to the first.

| Question | Options | Shown when |
|---|---|---|
| `boards` (write-in) | **Nothing here should stay private** / **Hide something first**, with free text naming the board and what shows | always |
| `next` | **Proceed** / **Hold** | always |

No option is recommended: whether a file may go public is the human's
call, made by looking at it. Selection: `{"boards":"clear|hide|<their words>","next":"proceed|hold","note":"<their words or null>"}`.
