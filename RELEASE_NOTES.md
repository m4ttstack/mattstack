The board shows a review that stops on purpose as held instead of failed, and the PR usher clears its own context between ticks with fresh-context. rt chat's welcome lands without starting a turn, and a run waiting at a board gate ends its turn cleanly.

### Board

- a review that stops on purpose, for example because the author is closing the MR, shows as **review held** instead of failed; it stays out of Needs me and groups as not reviewed again once the MR moves (#1247)
- abandoning a run settles its gates (#1241)

### Chat

- rt chat's welcome, and the note that a session was signed out from its pane, arrive without starting a turn (#1248)

### Skills

- the PR usher clears its own context with fresh-context after each tick, carrying a ledger of its PRs at `~/.mattstack/pr-usher/<repo>.md`; it keeps its context while it waits on a PR author's answer or a background review runs (#1249)

### Herd and gates

- a run waiting at a board gate ends its turn cleanly: the Stop hook counts any open or parked gate filed against the run as waiting, and `rt gate list` gains `--run` (#1245)
- the herd watchdog backs off its reminders about a human gate nobody has answered yet (#1240)

### Setup

- a git that fails on the remote check no longer reads as having no remote: the home backup row says it could not tell instead of **Local only**, and the daemon retries the push next cycle (#1242)

### Human Todos

- paste works in the message card (#1243)

### Tests and tooling

- gitq's unit tests stop mocking node builtins (#1244)
- the release skill treats a locked Mac's unreadable notary profile as expected in an unattended run, not as a missing profile

### Held pins

- bun stays at 1.4.4 (1.4.5 is out), and Sparkle at 2.10.0 (2.10.1 is out): a Sparkle bump gets its own tested release, and bun moves only with the artifacts it regenerates.

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.36.0...v2.36.1
