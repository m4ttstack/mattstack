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
| `dispatcher-dark.png`, `dispatcher-light.png` | the dispatcher at 100 columns: the breadcrumb header, branch and leaf `--help`, an unknown command, the terminal guard, a missing repo, a usage failure, and the notes for a stopped daemon, a first run, split rt data and an unreadable setting |
| `wrap-narrow-dark.png`, `wrap-narrow-light.png` | 48 columns: a hint wrapping in its own column, a long title taking its hint below, a flag kept whole, and the rule and tree tone |

The light pages are rendered with `COLORFGBG=0;15`, which is how a light
terminal that reports its background gets the pale diff tints. A light
terminal that does not set `COLORFGBG` still gets the dark diff bands:
`rt-ui render` writes to a pipe and never opens the terminal, so it cannot ask.
The rail beside a `copy` or `verbatim` block keeps the `Panel` tone and is
faint on dark.

Still wrong at the time of these renders: the last column of a table or a
tree, and a callout that holds a command, never wrap, so at 48 columns those
rows run past the pane and the terminal wraps them flush left (the settings
`list` values show the same). The issue lines under a `check` finding are
plain text in the file column, so they read as part of the path. On a light
terminal the peach `next` and `fix` rail and label, the warn glyph and the
green `done` mark are low contrast, and peach is shared by `next` and warn,
so a `next` rail reads like a warning. On a dark terminal the tree branches
are faint. In the setup renders, `rt verify` draws each row as `rt setup status` does,
and its summary counts rows by what they drew, while `--json` keeps counting
checks; `rt logins` prints its table with no header, and the streamed lines
under a failed step sit on a rail that is faint on dark. The settings, errors
and setup pages predate the hint wrap, the words-only wrap and the
`StaticRule` tone, and show the older drawing.

To regenerate: write the hello line and the fixture blocks as NDJSON, pipe them
through `ui/dist/rt-ui render --width 80` with `COLORTERM=truecolor`, and view
the ANSI output on each background.

## Phase 5c: worktree and navigation

- `worktree-dark.png`, `worktree-light.png`: `rt worktree` provision, list, triage, dispose with its refusals, a busy lock, ready-approve, adopt, the restore list, each, two failures and a not-ready warning.
- `code-dark.png`, `code-light.png`: `rt code`, `rt settings extension`, the worktree config warning and the one-at-a-time fallback.

`rt cd` and `rt nav` have no render: 5c does not change them.
