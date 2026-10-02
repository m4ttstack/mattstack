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
| `skills-dark.png`, `skills-light.png` | `rt skills` at 100 columns: a check with stale, never-compiled and behind-the-source rows, a compile with a warning, a compile failure and a misplaced skill, the packs and surface tables with a palette delta, a bind, a link report with a conflict, a refused sync, and the refused `skills init` and `writing-style new` lines |
| `git-dark.png`, `git-light.png` | the git verbs at 100 columns: `status` dirty and clean, `log`, `branches`, `stash list`, `tag list`, the result lines of undo, backup, restore, push and pull, three refusals (an undo of a pushed commit, the ownership guard, uncommitted changes) and four failures (detached HEAD, a usage failure, a git error, a diverged push) |
| `diff-dark.png`, `diff-light.png` | `rt git diff` at 80 columns: two hunks with a long deleted line, and a binary file. The light page is rendered with `COLORFGBG=0;15` |
| `plugins-hooks-dark.png`, `plugins-hooks-light.png` | `rt plugin`, `tools`, `deps`, `hooks` and `intercept` at 100 columns: a scaffold with a failed install, the plugin list and a failed validate, two load warnings, tool results, a failure and a refusal, hooks on and off, and intercept status with a current, a stale and a not-yet-installed shim |
| `5e1-team-dark.png`, `5e1-team-light.png` | `rt team` at 100 columns: create, status, an invite with manual steps, two joins, members sync and remove, a switchboard warning, a refusal, a daemon failure and a usage failure |
| `sync-dark.png`, `sync-light.png` | `rt sync` at 100 columns: the stack warning, a reset and a rebase with a resolved conflict, a paused conflict with the manual report, the conflict failure, the stack refusal, an agent that timed out, and `sync all` with four branches (two refused and one failed, each ending under its heading) and its summary |

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
under a failed step sit on a rail that is faint on dark. In the plugin and hooks renders, the five `kv` rows of `rt deps resolve` (and
`Rules` under `rt intercept install`) do not share a key column, because the
helper aligns runs of `line` blocks and draws each `kv` on its own, so the
values start at five different columns. At 100 columns the intercept title
column is as wide as its longest title ("The saved rules are behind your
settings"), so the stale doppler hint and the settings-file reason wrap to a
second line. On light, the `pending` and `off` glyphs (the dotted and hollow
circles) and the purple `kv` keys are faint. The settings, errors
and setup pages predate the hint wrap, the words-only wrap and the
`StaticRule` tone, and show the older drawing.

In the sync renders, a list of conflicted files (under the paused line and
inside the manual report) is a one-column table with no header, so it sits
flush with the status glyphs and reads as stray output rather than part of
the line above it. A failure's `details` follow a blank row in dim with no
rail, so the files and backup under the conflict failure, and git's own
`! [rejected]` line under a failed push, read as separate output; that git
line also starts with `!`, which reads as the warn glyph. A branch whose push
fails under `sync all` shows two coral lines that say nearly the same thing
(the step's `Could not push` and the ending's `Could not push <branch>`). A
backup ref in the hint column hard-breaks mid-word when a longer title above
sets the column, so it cannot be copied whole. In the `sync all` summary the
status words `refused` and `failed` are dim, not tinted, and on a light
terminal the lavender branch names are weak. A section heading draws its
branch in bold body text, while the summary below draws the same branch in
lavender.

To regenerate: write the hello line and the fixture blocks as NDJSON, pipe them
through `ui/dist/rt-ui render --width 80` with `COLORTERM=truecolor`, and view
the ANSI output on each background.

## Phase 5c: worktree and navigation

- `worktree-dark.png`, `worktree-light.png`: `rt worktree` provision, list, triage, dispose with its refusals, a busy lock, ready-approve, adopt, the restore list, each, two failures and a not-ready warning.
- `code-dark.png`, `code-light.png`: `rt code`, `rt settings extension`, the worktree config warning and the one-at-a-time fallback.

`rt cd` and `rt nav` have no render: 5c does not change them.
