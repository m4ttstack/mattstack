---
order: 10
---

# Record the board

A review never takes this step: it keeps no evidence record and cites the
board where the driver drew it. Any other caller's board ready goes into
the record through evidence-record's `evidence_record` call, which copies
its whole bundle from
`~/.fast-browser/screenshots/` into the run's evidence folder:

- `annotated` is the board, `~/.fast-browser/screenshots/<stem>.png`, on
  every image the board shows, and `caption` is the brief's `claim` on each
  of them. A pair board covers both the before and the after image of its
  case, unless the before's board is an import board (its
  `<stem>.c1.capture.json` says `"source": "import"`): that board stays the
  before's cover, so the pair covers the after alone and the before stays
  out of the call.
- Each image's `path` is its own capture: `<stem>.c1.png` for a single
  board, each panel's own capture for a pair, the last step's capture for a
  steps board, and for an import the image the brief imported (its `value`
  path when the record already holds it).
- An import's link goes on the record as run-level `url`.
- The domain's own preview, if any, is never a record path.

Draw on, brief and revise from the paths in the returned `value`, never
the screenshots folder, once a board is recorded.
