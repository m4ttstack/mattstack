# Output layer renders

Reference renders of the output layer (spec:
`docs/superpowers/specs/2026-09-30-rt-output-layer-design.md`), taken from the
real helper with `rt-ui render --width 80` under `COLORTERM=truecolor` and shown
on a dark and a light terminal background.

| File | What it shows |
|---|---|
| `fixture-dark.png`, `fixture-light.png` | `ui/fixtures/render-document.json`: one block of every type, back to back |
| `statuses-dark.png`, `statuses-light.png` | the seven statuses the fixture does not use (pending, off, refused, stale, skipped, warn, running) |

Known at the time of these renders: the diff tints blend toward the dark theme
background, so on a light terminal the two diff lines are dark blocks (owned by
the phase that first prints a diff); the table rule and tree branches use the
`Rule` tone and are faint on dark.

To regenerate: write the hello line and the fixture blocks as NDJSON, pipe them
through `ui/dist/rt-ui render --width 80` with `COLORTERM=truecolor`, and view
the ANSI output on each background.
