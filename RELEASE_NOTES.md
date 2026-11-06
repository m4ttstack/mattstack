mattstack now runs on Intel Macs, and setup no longer needs Homebrew. The board refuses to start a review it can't load the team's skill for, instead of quietly running a generic one, and your own MRs gain a **flock** flyout.

### Install and setup

- one universal mattstack.app for Apple silicon and Intel Macs; the processor row reads ready on Intel (#1032)
- setup no longer installs Homebrew, and a team tool installs from the download its pack pins for your processor (#1032)
- Claude Code installed somewhere other than `~/.local/bin/claude`, such as by Homebrew, now offers **Install** on the Claude row, since that is where the board runs it from (#1046)
- buttons in the setup window show their own loading state, and screens, rows and cards ease in and out instead of popping (#1044)
- the Claude row asks you to paste the code from your browser and press **Sign in**; a sign-in code or a wait on Chrome or Slack shows in place of the row's description (#1044)
- **Create team** says it sets up your org and its first team, and spells out the repo it makes (#1044)
- a long pasted secret no longer widens the setup window (#1044)
- the Team sync row leads with reset and pull when your org clone has a commit ahead of origin, unless that commit is your own edit (#1039)

### Board

- when a lane's skill can't load, the board opens no pane and the row names the reason and the fix; a skill that fails to load inside the pane ends the run the same way (#1047)
- a **flock** flyout on your own MR, when Flock is installed, opens a shell, Claude, the newest work session or a saved `board.flockCommands` command in the MR's worktree (#1042)
- **rebase locally** streams rt sync's output into a popover on the row, retries a paused tree and a push with rt's token, and a synced row stays until you dismiss it (#1031)
- auto-doctor skips an MR whose doctor tab is still open, and **+N more** opens the row's other statuses (#1043)
- a parked decision reads waiting on you, and answering it reads resuming at once (#1040)
- the sync popover wraps its title and hint as one line; the row note band sits lighter

### Chat

- `rt chat rooms` and `rt chat who` answer a caller with no chat name, so Flock's chat peek works again; posting and reading still need a name (#1045)

### Skills

- `rt skills sync` updates a pack whose edits were committed by hand without a version bump (#1041)
- a skill's `allowed-tools` list splits at spaces as well as commas, and base doors carry the copy's safe rules (#1029)

### Held pins

- glab stays at 1.127.0 (1.128.0 is out) and Sparkle at 2.10.0 (2.10.1 is out); Sparkle gets its own release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.29.1...v2.30.0
