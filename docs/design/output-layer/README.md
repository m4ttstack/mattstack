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
| `sync-dark.png`, `sync-light.png` | `rt sync` at 100 columns: the stack warning, a reset and a rebase with a resolved conflict, a paused conflict with its files listed once under a caption, then the manual report, the conflict failure, the stack refusal, an agent that timed out, and `sync all` with four branches (two refused and one failed push, which shows only its ending, each under its heading) and its summary |
| `sdm-dark.png`, `sdm-light.png` | `rt sdm` at 100 columns: the production banner, a verified and an unconfirmed connect, a declined one, a failed connect with what StrongDM printed, a tunnel that did not come up, an access failure, the manual-login failure, the production refusal, status, the connections table, refresh and enrichment |
| `port-runs-dark.png`, `port-runs-light.png` | `rt port` (the no-daemon note, repos, branches, ports, kill results) and `rt runs` (the list, one run's detail, two failures) |
| `home-dark.png`, `home-light.png` | `rt home` at 100 columns: the init plan, each stage's ending line with the refresh guidance under it and the mr-board command as a `next` callout, the key lines, snapshot status, a claim and a refused claim, and two failures (a key mismatch with its rotation note, a failed clone with what git said) |
| `home-steps-dark.png`, `home-steps-light.png` | `rt home init`'s live stages as `rt-ui steps` paints them through a pty: skipped, needs-you, warn, and a failed stage that keeps its sub-line (termwright's own dark ground in both; at the time of these renders the steps verb picked the same colors whatever `COLORFGBG` said, so the two are identical; it now follows the shared background resolver) |
| `release-dark.png`, `release-light.png` | `rt release` at 100 columns: preflight rows (with a verify row still propagating) and summary, update-machine legs stopped by a refused leg and by a failed checksum, and `apps` progress (a step, the notes, a no at the notes prompt, the watch, the approval stop, a fast path refusal, nothing to release, a dry run that only checks a publish again) |
| `repos-dark.png`, `repos-light.png` | `rt repos` at 100 columns: the status tree, register, prune (a gone folder, a duplicate, a kept row), a locate plan, three refused locates (a second copy, the wrong repo, a repo with no remote and its register command), nothing missing, a locate with no terminal and the folders it could be, an unknown repo, a reidentify report and a refused one, a usage failure and a setting warning |
| `6a-hook-dark.png`, `6a-hook-light.png` | `rt worktree hook install`, `uninstall` and `status` at 100 columns, the missing-binary and not-on-PATH failures, and the two hook-offer warnings. The agent-only verbs (`gate`, `events`, `ci`, `runs`, `mcp`, `claude-hook`) print exactly what they printed before |
| `6b-herd-pane-agent-dark.png`, `6b-herd-pane-agent-light.png` | `rt herd list`, `status` (a healthy job and every problem line) and `gates`, `rt pane list` with a background pane, and `rt agent list`. Off a terminal these verbs print exactly what they printed before |
| `6d-services-dark.png`, `6d-services-light.png` | the hidden service verbs at 100 columns: services and apps tables, a flavor takeover, bg and reconciler status, the bg stop refusal, two endpoint lookups, a cron install, the post-install notes, the apps refusal and an endpoint setting warning |
| `6h-copy-dark.png`, `6h-copy-light.png` | phase 6 copy polish: settings list labels, an unset get, the extension failure, the logins header, an unreadable tool version, members remove, a prune duplicate and a kept repo, a port row with no pid, a refused bundled link, and intercept's left-alone line |
| `6g-git-skills-dark.png`, `6g-git-skills-light.png` | phase 6 git and skills fixes: a kept stash, a credentialed remote, skills init's failures and refusals, a link conflict, an expand usage failure, the missing-Claude note, a surface apply, a rebase conflict with its files, an escalation timeout |
| `6g-diagnostics-dark.png`, `6g-diagnostics-light.png` | phase 6 review fixes: written files after an init remedy, failed push output, expand drift and lint diagnostics, and a single lint diagnostic |
| `6j-chat-dark.png`, `6j-chat-light.png` | `rt chat read` with local times and gaps, the three daemon refusals drawn as refused, and a daemon failure. Off a terminal chat prints what it printed before |

The light pages above the phase 5g section were rendered with
`COLORFGBG=0;15`, which is how a light terminal that reports its background
gets the pale diff tints. Since phase 5g `rt-ui render` also reads Ghostty's
config and, failing both, asks the terminal (see below). A `copy` block has no rail: its text
prints at column 0. The rail beside a `verbatim` block takes the `StaticRule`
tone.

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
`StaticRule` tone, and show the older drawing. Phase 5g fixed the last column and the callout command; see
`5g-narrow-*.png` and `5g-callouts-*.png`.

In the sync renders, the conflicted files under the paused line sit under a
dim `files` caption on a rail, listed once (the manual report no longer
repeats them), so they read as part of the line above. The conflict
failure's `details` (the files and the backup ref) still follow a blank row
in dim with no rail and read as separate output, and the `verbatim` rail
and caption for the end of the pane are faint on dark. Under `sync all`, a
failed push now shows no step line, only the ending `Could not push
feature/billing`, but git's own `! [rejected]` line sits after a blank row,
dim and detached from that ending, and starts with `!`, which reads as the
warn glyph. A backup ref in the hint column hard-breaks mid-word when a
longer title above sets the column, so it cannot be copied whole. `Rebasing`
and `Running a follow-up step` keep a mint dot after they finish. In the
`sync all` summary the status words `refused` and `failed` are dim, not
tinted, and on a light terminal the lavender branch names are weak. A
section heading draws its branch in bold body text, while the summary below
draws the same branch in lavender.

To regenerate: write the hello line and the fixture blocks as NDJSON, pipe them
through `ui/dist/rt-ui render --width 80` with `COLORTERM=truecolor`, and view
the ANSI output on each background.

## Phase 5c: worktree and navigation

- `worktree-dark.png`, `worktree-light.png`: `rt worktree` provision, list, triage, dispose with its refusals, a busy lock, ready-approve, adopt, the restore list, each, two failures and a not-ready warning.
- `code-dark.png`, `code-light.png`: `rt code`, `rt settings extension`, the worktree config warning and the one-at-a-time fallback.

`rt cd` and `rt nav` have no render: 5c does not change them.

## Phase 5f2: chat

- `chat-dark.png`, `chat-light.png`: what a person sees from `rt chat`: rooms, read, who, buddies, sign-in, help, a failure, the two policy refusals and the sign-out warning. Off a terminal these verbs print their older plain text, unchanged.

What reads wrong: there is no blank line between one message and the next author, so a long thread reads dense. A wrapped body line now hangs under its own indent, so it cannot land at the author column. `read` times are UTC with no zone, as the plain text always printed them.

## Phase 5g: renderer

Two accent tones, chosen by the terminal's background: static output takes `theme.StaticDark` (the app's own mint, peach, lavender, coral `#FF7979` and cyan `#5AAAFF`, with quiet `#9590B3` and rule `#6E6992`) on a background that resolves dark and `theme.StaticLight` on one that resolves light or cannot be determined. Body text keeps the terminal's foreground in both. On `auto` the background comes from `COLORFGBG`, then Ghostty's configured background, then the terminal's answer to an OSC 11 query. The dark pages here render with `RT_UI_BACKGROUND=dark` and the light pages with `RT_UI_BACKGROUND=light`, so the setting is what decides. `fixture-*.png`, `statuses-*.png` and every `5g-*.png` were rendered the same way; every other page above this section predates the two tones.

| File | What it shows |
|---|---|
| `5g-palette-dark.png`, `5g-palette-light.png` | every status, every callout label, chat's listening, idle and offline rows, sdm's connection words, a kv key, a tree, a link, the summary, the banner, a failure with its excerpt, and a changes block, at 100 columns |
| `5g-palette-unknown.png` | the same set with `RT_UI_BACKGROUND=auto` and nothing answering: the light set, shown on the dark page |
| `5g-wrap-dark.png`, `5g-wrap-light.png` | 60 columns: backup refs in a hint column a longer title narrowed (whole on the row below), an excerpt that wraps at its words, a stack line that hangs under its indent and breaks its path at a slash, and a token with no separator, cut inside the pane |
| `5g-narrow-dark.png`, `5g-narrow-light.png` | 48 columns: a settings table whose values wrap in their column, a branch table whose long name is clipped so the state keeps its room, a tree whose last column wraps under its branch, a diff whose long added line wraps inside its band, and a CJK cell wrapped by display width |
| `5g-callouts-dark.png`, `5g-callouts-light.png` | 60 columns: a `next` whose command ends its sentence (the command on its own row), a three-row `note` doing the same, two-command rows that wrap without splitting a command, a backup ref too wide for the label column moved out to the bar, and a failure's command-only `next` |
| `5g-failures-dark.png`, `5g-failures-light.png` | 100 columns: failures whose details (a file list, a backup ref, git's rejected line) sit under the title with no blank row, back to back with a refusal and with the excerpts printed under them |
| `5g-kv-dark.png`, `5g-kv-light.png` | 100 columns: the `rt deps resolve` rows, a link's From and To, intercept's `Rules` after its lines, and a setting under a section whose long value still fits one row at 100 columns |
| `5g-breadcrumb-dark.png`, `5g-breadcrumb-light.png` | the breadcrumb header with its `blank` row, then two sections, the second after `sync all`'s branch gap |
| `5g-copy-dark.png`, `5g-copy-light.png` | `rt team invite`'s link and message and `rt git pull`'s dry-run command as `copy` blocks: caption at the body column, text at column 0 with no rail, so a drag-select pastes clean, and one blank row after each |
| `6c-daemon-dark.png`, `6c-daemon-light.png` | `rt daemon` at 100 columns: every status state (running with health reasons, degraded, parked, not answering, not running, not installed, and the two failures), the version row and a flavor warning, the stop mismatch, still shutting down, the tracking table, a log level, the login-items approval and the uninstall refusal |

What reads wrong in the palette pages: on dark, the app's coral makes the `✗` glyph and the `PRODUCTION` banner a bright salmon red that holds its own beside mint, peach and lavender, though it reads softer than an alarm red; the link is a clear blue. Hints, captions and the `why` label in the dark quiet tone read clearly and stay a step below body text; the rails and tree branches in the dark rule tone sit dimmer still. The dark peach `#FFB77A` still reads apricot, so `next`, `fix` and the `◆` glyph carry less urgency than the light set's orange. On light, mint words (`listening`, `connected`, `standing access`) sit at 3:1 and read lighter than the body text, though still clearly. The unknown page (the light set on dark) is sober but reads fine. In `5g-callouts-*.png` the backup ref moved out to the bar breaks the note's text column mid-note, so for a moment it reads like the start of another callout.

## Phase 6g: git and skills fixes

The two pages render at 100 columns with `COLORTERM=truecolor`,
`TERM=xterm-256color`, `NO_COLOR` unset, and `RT_UI_BACKGROUND` explicitly
set to dark or light. The credentialed remote prints as `REMOTE`. The
compile excerpt and conflicted files sit under their captions on thin
rails. Claude Code missing and the link conflict use the peach or orange
`needs-you` mark, while failures alone use coral. No title names a path or
a flag. The not-a-repo and invalid-namespace outcomes draw as failures,
as the command does, because they are outside its policy-refusal set.

What reads wrong: the compile remedy wraps after "then", leaving the second
command on the next row; it remains whole and readable. On dark, the file
lists and their rails are quieter than body text but still readable. The
conflict backup ref in the `why` callout wraps onto its own row without
splitting. No source change was needed for these renders.

The diagnostic pages show the review fixes at the same 100-column width.
Each file or diagnostic list follows its failure and remedy under a caption,
including a single lint hit. Dark and light captions and rails stay readable.
The expand command exceeds its callout column and moves intact to column 0;
the long lint message wraps at spaces. No text is clipped.

## Phase 6j: chat refusal codes and read

The two pages render real chat builders at 100 columns with
`COLORTERM=truecolor`, `TERM=xterm-256color`, `NO_COLOR` unset, and
`RT_UI_BACKGROUND` explicitly set to dark or light. The machine's local
clock shows `12:04 CDT`, `12:05 CDT` and `12:06 CDT` beside the authors.

What reads wrong: the release refusal's explanation wraps onto a second
row at this width, but stays readable under its `why` label. On both
backgrounds the three refusals use quiet neutral marks and visibly differ
from the coral failure. The times and zones remain quieter than the names.
Blank rows separate messages, while each header stays with its body; the
first message also retains its own paragraph gap. No source change was
needed for these renders.
