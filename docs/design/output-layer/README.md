# Output layer renders

Reference renders of the output layer (spec:
`docs/superpowers/specs/2026-09-30-rt-output-layer-design.md`), taken from the
real helper with `rt-ui render --width 80` under `COLORTERM=truecolor` and shown
on a dark and a light terminal background.

| File | What it shows |
|---|---|
| `fixture-dark.png`, `fixture-light.png` | `ui/fixtures/render-document.json`: one block of every type, back to back |
| `statuses-dark.png`, `statuses-light.png` | the seven statuses the fixture does not use (pending, off, refused, stale, skipped, warn, running) |
| `errors-dark.png`, `errors-light.png` | the error seam at 100 columns: an expected failure with a reason and a next step, one with only a message, a title longer than the pane, an unexpected error with and without its stack, and `rt --grant-fda` |
| `errors-narrow-light.png` | the same at 60 columns: titles, callout bodies and stack lines wrap under their own text and keep the bar or rail |
| `settings-dark.png`, `settings-light.png` | the settings verbs at 100 columns, blocks captured from the real verbs: `set` (tip and next), `get` (the human half; the value is the stdout payload), `list` (an excerpt with an invalid and an unregistered caveat), `explain`, `check` (one failing), `unset` twice, and the two refusals |
| `setup-dark.png`, `setup-light.png` | setup at 80 columns, blocks built by the real code: `rt setup status` from a composed plan on a bare Mac, a setup run in its off-a-TTY form (every final state, a `fix` callout, a failed step keeping its streamed lines, the summary), `rt setup update`, the not-ready failure, an unknown `--from` step, and `waive` |
| `setup-verify-dark.png`, `setup-verify-light.png` | `rt verify` for the same plan: sections by group, rows by title, a `next` callout where a row names a command, the summary |
| `setup-verbs-dark.png`, `setup-verbs-light.png` | `rt accounts` (table, empty, a failed recheck), `rt logins`, `rt secrets` (list, the usage failure, a team re-encrypt), and `rt uninstall` (the dry run, the kept list) |

Known at the time of these renders: the diff tints blend toward the dark theme
background, so on a light terminal the two diff lines are dark blocks (owned by
the phase that first prints a diff); the table rule and tree branches use the
`Rule` tone and are faint on dark, as is the rail beside a stack. A status
line with a hint does not wrap yet, and a wrapped `--flag` can break at its
hyphens. In the settings renders, long `list` values (`rt.homeSnapshot`) wrap flush left
with no indent under the value column, and the issue lines under a `check` finding are plain text in
the file column, so they read as part of the path. On a light terminal the peach `next` label and warn
caveats and the bright green on `done` marks and `explain` rungs are low contrast, and peach is shared
by `next` and warn, so a `next` rail reads like a warning. On a dark terminal the `explain` branches are
close to invisible. In the setup renders, the "Install is waiting on" line runs off the pane when many
rows block it (a status line with a hint does not wrap yet). `rt verify` draws each row as `rt setup status` does, so its summary can count more failed checks than
the rows drawn coral (a required row that is not set up yet is a failed check but a pending row). `rt logins` prints its table with
no header, and the streamed lines under a failed step sit on a rail that is faint on dark.

To regenerate: write the hello line and the fixture blocks as NDJSON, pipe them
through `ui/dist/rt-ui render --width 80` with `COLORTERM=truecolor`, and view
the ANSI output on each background.
