A team directory release: each team's Linear key and Slack channels move into one org source, which is a new org layout (3). The console gets a redesigned runs view, deck a facelift, the board one Slack post across its channels, and `rt cd`'s restore rows are grouped by cleanup date.

When your org's admin moves the org onto layout 3, a Mac still on v2.22 holds its org pull and shows one row asking you to update; after the update it moves itself onto the new layout.

### Organizations and teams

- the team directory: one org source for each team's Linear key and Slack channels, and the org layout moves to 3 (#763, #772)
- an org marker with no layout field reads as layout 2, never the newest layout (#768)
- a setup migration never writes the org or team stores (#772)
- `rt setup update` moves the org folder even when the org repo has a working checkout (#764)

### Setup

- the shims and PATH rows are judged from your login shell, so they match what your terminal runs (#756)
- an older rt block in your shell profile with no end marker can be repaired from setup (#766)

### Console

- a redesigned runs view: a run page, answering a run's gates in place, the run's record and a runs page (#770, #777)
- a held run whose pane is gone can be resumed, and runs register their Claude session as an agent (#760)
- gate steps advance on the first click in the app's viewer (#761)
- the palette shows results once you type, at most ten
- a run row keeps the full ticket id and truncates the title instead
- structured settings open in the JSON editor (#769)

### Deck

- a settings modal, a version column, Redeploy all and shared tooltips (#773)
- tooltips wait 750ms on hover and read as short plain sentences

### Board

- one post to Slack item across the team channel and the code owners channel (#758)
- the agent menu offers focus, resume, redo and follow-up review (#755)

### Worktrees

- `rt cd`'s restore rows are grouped by cleanup date, with days left and the repo in the breadcrumb (#749)
- a restored worktree sets its submodules up again and keeps its relative symlinks (#752, #754)

### glitter

- a push the remote rejects opens Newer Commits on Remote, as in GitHub Desktop (#778)

### Gates

- the gate log records what the pane showed when a form gate gets no Escape (#762)

### Skills

- the pipeline gate Stop hook lets a turn end while a background task is pending, and CI watches run in the background (#779)
- rt:settings, rt:ui-copy and other maintainer skills stay out of user installs, and an installer guard fails on a skill header it cannot read (#780)

### Docs

- one page per app for board and flock, grounded in the code, with docs conventions and a lint gate (#750, #753)
- the team directory, the board's Slack item and agent menu are documented (#757, #759, #765)
- the console runs view, deck's dev mode, `rt worktree restore`, glitter's rejected push, the PATH row and moving an org onto layout 3 are documented

### Release

- CI skips the suites a change cannot affect (#751)
- held: glab stays at 1.121.0 (1.122.0 is out); it rides the next release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.22.0...v2.23.0
