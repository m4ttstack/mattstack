# Human Todos

A Claude Code plugin that gives an agent a shared to-do list for the
human: steps only the person can do, shown in a pane beside the
transcript, ticked off by the person, with each tick reported back to the
agent.

## Why

In long agentic runs the agent piles up things only the human can do:
commands it cannot run (denied, sudo, a TTY, a login), browser steps,
account actions. Today those asks live in prose and scroll away. There
is no shared contract: the person cannot see one list, and the agent
cannot tell what was done without asking the person to type "done".

## Goals

- One list per session, visible beside the transcript, that the agent
  adds to and the person works through.
- Every action the person takes on an item (done, skip, run, stop)
  reaches the agent as a message without the person typing anything.
- The agent knows the list exists and uses it, with no skill to load,
  in the main loop and in subagents.
- Scripts can run from the list, with their output visible and their
  result reported to the agent.
- Two ways to get it: automatically with mattstack, or on its own
  without the mattstack app, rt or herdr.

## Non-goals

- A combined inbox across sessions or panes. Matt chose per-session
  (one list per Claude Code session). A cross-pane view through the rt
  daemon or flock stays possible later; nothing here should block it,
  and nothing here builds it.
- Decisions and questions. Those stay with AskUserQuestion and rt
  gates; a to-do is an action, not a choice.

## Anti-goals

- A list the agent stops using because it is easier to write prose.
- Run silently doing something the person did not see. The script is
  shown on the item before Run, and its output stays inspectable.
- Noise: no per-failure nudges, no status-line badge (both tried and
  dropped, see Evidence).

## Constraints

- Built as a Claude Code mod (hooks module, `claude-code` API, 2.1.322
  at spike time). The module has no Node or DOM; everything outside it
  goes through `$`.
- A button handler is cut off after 10 seconds, so long work starts in
  the background and the handler returns.
- `$.ui.status` is text only and draws Claude Code's own glyph, colour
  and plugin-name prefix; the pane's own close mark cannot be styled.
- On accounts with managed settings, the built-in security guard may
  skip parts of a user-tier mod. Verified so far: `prompt.context` is
  skipped there; `prompt.compose` is untested. The tool description is
  the fallback carrier of the guidance.
- The repo is public: nothing employer-specific in the plugin or docs.

## Approaches

### Packaging (decided: standalone plugin plus a mattstack dependency)

1. **Inside the mattstack plugin.** Joins `plugins/mattstack/hooks/register.ts`
   beside the Slack and worktree mods. Reaches every mattstack session
   and herd worker on release; cannot be tried without mattstack.
2. **Standalone plugin in the mattstack marketplace.** Opt-in for
   anyone; a second plugin to version and release.
3. **Personal only** through `CLAUDE_CODE_PLUGIN_DIRS`. No process;
   one machine.

Matt picked 1 and 2 together: the code lives once, as its own plugin at
`marketplace/plugins/human-todos/` (beside `chat`), and the mattstack
plugin lists it under `dependencies` in its `plugin.json`. mattstack
users get it automatically; anyone else adds the marketplace and
installs only `human-todos`.

### Running scripts (decided: herdr when present, the mod otherwise)

1. **herdr tab** (chosen when herdr answers). Mirrors `rt runner --herdr`:
   a background workspace named after the pane, one tab per item, the
   script typed into the tab, exit code read back from a marker line.
2. **The mod runs it** (chosen otherwise). `$.process.spawn`, output
   kept in the item and written to a log file.
3. tmux, like `rt runner`'s default. Rejected: a second backend, and
   attaching needs to know the person's terminal app.
4. Copy only, no Run without herdr. Rejected: loses Run for most people.

### UI (decided: button cards, first spike layout)

Two redesigns were tried and rejected (a ruled card layout, then a
keyboard-driven Client list). The shipped look is the first layout with
the adjustments listed below.

## What was decided

### Items

- Fields: `kind` (required), `title` (required), `detail`, `script`,
  `url`, `cwd`.
- `kind` is an enum that decides the buttons:

  | kind | needs | buttons |
  |---|---|---|
  | `task` | nothing | Done, Skip |
  | `run` | `script` | Run, Copy, Done, Skip |
  | `terminal` | `script` | Copy, Done, Skip |
  | `link` | http(s) `url` | Open, Done, Skip |

- `add` refuses a call whose kind and fields do not match, with the
  reason; fields that do not belong to the kind are dropped.
- Statuses: open, confirming, running, done, failed, skipped.

### Agent-facing contract

- Tools, never deferred: `add`, `list`, `withdraw`. Inside the plugin
  they are listed as `mcp__human-todos__<name>`.
- The `add` description carries the when-to-use rules (subagents see
  tool descriptions but not system-prompt sections).
- A `prompt.compose` section repeats the rules for the main loop.
- Every person action is sent back with `$.prompt.submit`, which starts
  a turn once the session is idle and never interrupts a running one:
  done, skipped, stopped, ran (exit code plus the last 30 lines), and
  ended without an exit code.
- Those messages draw in the transcript as one row: the pane name in
  the accent colour, the first line dim, `(+N lines, ctrl+o)` when there
  is more. The model still reads the full text.

### Pane

- A docked pane titled **Human Todos**, opened when an item is added,
  reopened with `/todos`.
- Padding 2 columns and 1 row; a header row with the title and a
  `Close` button (Claude Code's own close mark is too small to use).
- Each item: `○` and a bold title; indented beneath it the detail, a
  warning-coloured note when there is one (`Stopped`, `Ended without an
  exit code.`), the script in cyan clipped to 2 rows with `… +N more`
  and `Show all` / `Show less`, the URL in cyan as plain text, then a
  blank row and the buttons.
- Running: a braille spinner in the title and beside `Running`, the last
  3 output lines dim above it, `Show` and `Stop`. After Stop: red
  `Stopping…`, Stop hidden, a `Stopping #N` toast.
- Finished items at the bottom: a green ✓ (red ✗ failed, grey – skipped)
  and the title dimmed, the exit code only when non-zero, a blank row,
  then `Clear finished`.
- While the pane is closed and items are waiting, a band above the
  prompt: `○ N Human Todos  [ Open ]` (singular for one).
- No status-line entry.

### Run

- Run always asks first (Matt's call). Pressing Run puts the item in
  `confirming`: the buttons become `Confirm` (primary) and `Cancel`, and
  nothing starts until Confirm. Cancel returns the item to open and sends
  the agent nothing. Both runners honour it; the confirm lives in the
  pane, not a dialog.
- Chooses herdr when `HERDR_SOCKET_PATH` is set and `herdr workspace
  list` succeeds; otherwise the mod runs the script.
- `/todos-runner auto|herdr|local` overrides the choice (kept for
  testing and for people who prefer one).
- herdr: the script runs inside a wrapper, `zsh -c 'trap : INT; zsh -lc
  "$1"; printf "\n__todo_exit_<token> %s\n" $?'`, so ctrl+c still prints
  the exit marker. The mod polls the tab each second for the last lines
  and the marker. If the tab's shell is idle for 2 polls with no marker,
  the run counts as over. `Show` brings the tab forward; `Stop` sends
  ctrl+c. The tab stays open until the item is cleared or withdrawn.
- Local: up to 15 output lines always shown inline, `Open log` opens the
  log file, `Stop` signals the script and its children. No Show button.
- A reload resumes watching herdr runs; local runs end with the module.

## Fixes before shipping

- Item numbers keep counting up across clears (today a clear can reuse
  a number, and two items then share one).
- A resumed session (`--resume`, `--continue`) finds its list again; a
  brand-new session starts empty (Matt's call). The list is mirrored to
  `$.store` keyed by session id and read back at `session.start`. Entries
  for sessions untouched for 30 days are dropped (my call).
- `Show` works without rt: `herdr workspace focus` and `herdr tab focus`
  directly, `rt pane focus` only as a nicety when rt is present (it also
  raises the terminal window).
- Plugin name `human-todos` everywhere: state keys, the origin check on
  transcript rows, tool prefixes, `/todos` stays as the command.
- Log files under a per-user cache folder, not `/tmp`, removed when the
  item is cleared.

## Evidence from the spike

- Pressing Run, Done, Skip, Stop and Open each reached the agent as a
  new turn in a live session.
- Test sessions (`claude -p`, the plugin loaded, user settings off), 3
  tasks that need the human: a local Xcode tools and Postgres setup, a
  Fly.io login and deploy, a Stripe key rotation.
  - Without the plugin: 0 of 3 used a list.
  - With it: 18 of 18 runs added 2 to 5 items with fitting kinds
    (`link` for the dashboard, `terminal` for logins and secrets,
    `task` for a question).
  - A failed-command nudge reached the agent but did not change when the
    first item arrived; dropped.
- A subagent check: with the rules in the tool description, a subagent
  quoted them and chose a `terminal` item for a sudo command.
- `disableAllHooks` also switches off mod code; tests that need the
  plugin isolate with `--setting-sources project` instead.

The spike source is at
`~/.claude/dev-mods/0870298e-6352-41e8-bc2e-c1874fb062dd/human-todo/`
(`hooks/register.tsx`, `types/index.d.ts`). The test harness and
transcripts are in that session's scratchpad (`todo-eval/`).

## Calls made in writing this (check these)

- **Dependency install:** the plan's first task checks whether Claude
  Code installs a plugin's `dependencies` from the marketplace. If it
  does not, mattstack's setup installs `human-todos`.
- **Versioning:** `human-todos` has its own `.claude-plugin/plugin.json`
  with a version and ships through the marketplace like `chat`. The
  mattstack plugin depends on it without pinning an exact version.
- **No permission prompt for the plugin's own tools:** the mod answers
  `tool.check` with allow for `add`, `list` and `withdraw`. They only
  change the list, and a prompt on `add` (fatal for headless herd
  workers) would undo adoption.
- **Tool names:** the guidance text uses the full name `$.tool.register`
  returns, not a hard-coded prefix.
- **Managed-settings accounts:** the tool description is the accepted
  fallback if `prompt.compose` is skipped there; the tests showed it
  carries the rules alone. Checking it on such an account is a
  verification step, not a design change.
- **Store expiry** of 30 days, and log files under a per-user cache
  folder removed with their item.

## Left to the builder

- Module layout inside the plugin, tests (`claude plugin test`), the
  plugin's CI job and README.
- How the herdr and local runners share code.
- Exact wording of the tool description and system-prompt section,
  within the rules above.
