Gates get a cleaner kit form everywhere, including herd gates, and console's run pages read better. Board tells you when it can't reach Slack.

### Gates

- the gate form is polished: a context box, a ❯ cursor separate from the pick, and a docked layout (#1172)
- when the kit form draws a gate, a pick-any list stays one question instead of splitting at four options (#1176)
- pick-any gates open with their (Recommended) options already ticked, and sync gates say they were pre-selected that way (#1178)
- herd gates render in the shepherd's kit form (#1177)

### Console

- a run's gate panel shows split questions as one, with findings that fill the pane and read as Markdown
- gate options are one list of Slack-style rows, each with a key that doubles as its check or radio mark, and a borderless note field
- a run's open question shows in the Stages panel as a waiting row
- a run blocked at its shepherd's gate reads waiting on its shepherd, not waiting on you
- the stage doc opens in a modal drawn by the Packs block view, at the version the run used
- agent prose gets subheadings for lead-in lines, code blocks for code-only lists, quoted lists as quotes, and chips that wrap cleanly
- the shared Markdown renderer marks ids as code and drops task-list bullets
- live run cards keep their head row on one line, and lanes show an MR before its state is known
- runs keyed by a legacy repo slug get their MR outcomes again
- stage fields and headers share eyebrow labels, and Team tables match the console lists
- console reads a husk pack's full skill (#1174)

### Board

- a banner says when the board can't use Slack (a rejected or unreadable token), and the board picks up a reconnect without a restart (#1171)
- unticking every review finding posts the agent's no-findings summary (#1170)

### Skills and plugins

- self-review no longer holds on an optional nit (#1181)
- Human Todos: message the agent from an item, and each item gets its own Done label (#1175)
- superpowers is pinned to the fork's v7.0.2-groups.2 (#1180)

### rt and the app

- `rt telemetry clones` reads a teammate's org copy history, and the daemon's ping reports each org copy's health (#1173)
- herdr launches with a prompt file no longer stop on Claude Code's directory trust dialog (#1168)
- `rt skills discard` and the Slack start and request commands no longer crash (#1169)
- the app's History menu has Back (⌘[) and Forward (⌘]) for the showing tab
- the bundled fast-browser is 0.1.21: redirects carry on in the swapped page, and video applies without a restart (#1167)

### Held

- Sparkle stays at 2.10.0 (2.10.1 is out): a Sparkle bump gets its own tested release.

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.32.0...v2.33.0
