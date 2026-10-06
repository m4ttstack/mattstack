A board and teams release: the board gets sub-groups, distinct member looks and settings in a console modal, a team creator connects their own board with `rt team peer`, and the daemon boots without waiting on a slow fseventsd.

### Teams

- `rt team peer` connects a team creator's own board to the switchboard, and `rt team create` runs it when this Mac holds the switchboard admin token (#707)
- `rt team members remove` also disconnects the member's board, and says plainly when only the switchboard owner can (#707)
- `rt team status` counts the members with a connected board, and its `--json` marks each member as peered or not (#707)
- the board's roster is read-only: inviting, re-inviting, removing and joining live in the CLI, and the Board peering row's steps name `rt team peer` or a fresh invite (#707)

### Daemon

- the daemon no longer waits on its repo watches at boot, so a slow fseventsd cannot stall it for a minute (#712)
- the home and team snapshot watchers retry a git check that timed out, instead of staying off until the next daemon restart (#712)

### Board

- sort splits each group into labelled sub-groups by a second grouping, with rows always oldest first (#707)
- a fresh board groups by status, and leaving Needs me brings back the grouping you had before it (#700, #707)
- every author gets a distinct avatar colour and creature, so neighbours in a list never share a hue (#707)
- a selection replaces the tab band with its own bar (#707)
- whose turn, a Show menu of checkbox chips with explaining tooltips, and card surfaces (#702)
- settings open console's board group in a modal; Whose turn has checkboxes and Settings opens at the top (#706, #710)
- tabs dock into the header card, group labels become tinted bands in the status hue, and a polish round on cards, tooltips and focus rings

### Settings

- board, chat, boxscore and deck show their own settings group from console in a modal instead of a settings page of their own (#706)

### Deck

- a deck self-deploy no longer kills other apps' redeploys (#709)
- inside a run, deck never resends its own restart (#711)

### Chat

- a pane signed in to chat keeps its identity when its session id changes, so a forked session no longer posts as a new phantom name (#708)

### Also

- `rt sync all` exits 1 when any branch failed or was refused (#704)
- the rt-ui background probe answers Ctrl-C live, ignores late replies and leaves no lock files (#703)
- RT-369 closes: the output-layer migration is complete, with no change to output, envelopes or exit codes (#701)
- boxscore card scrollbars fade in on hover, clear of the values

### Settings store versions

- `board.tabs` moves to `board.tabs@2`: a tab board would refuse to start with is dropped on migration (#706)

### Held pins

- glab stays at 1.120.0 (1.121.0 is out), cloudflared at 2026.9.3 (2026.10.0 is out) and portless at 0.15.6 (0.15.7 is out); they move in a later release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.20.1...v2.21.0
