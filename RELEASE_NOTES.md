A review and onboarding release. The board's review gate now drafts every comment and the summary for you to edit before anything posts, gate forms open with the recommended answers picked, and a decision banner replaces the small queue button. Joining a team gets steadier: Start services passes on a running daemon, a joiner's Slack and repo rows hold Finish until they are done, herdr starts after Finish, and Claude Code defaults to fullscreen. Org base-pack text can now carry each team's own values and sections, browser evidence asks one privacy question per batch, and the daemon can warn you before a Claude usage limit runs out.

Updating runs one new setup migration: it stops the old background herdr server, renamed from `bg` to `mattstack-bg`, when it has no panes open. If it still holds panes, setup asks you to finish or close them first and then run `herdr session stop bg`.

### Board

- the review drafts every comment and the summary before the post gate; the board shows them in editable boxes and posts what is in the box word for word (#905)
- gates are no longer capped at 8192 bytes: the budget covers only the Claude Code pane's prose, and drafts ride as board-only fields (#905)
- the review summary comes first in the main column, a verdict-only submit works, and the summary names its verdict in a coloured badge
- Cmd+Enter submits a gate sheet, and number keys pick the review verdict (#919)
- a banner above the board names how many decisions are waiting and which opens first, replacing the sidebar's decision queue button (#911)
- answering a form gate on the board dismisses the Claude Code form in the pane, so doorbells no longer queue behind it (#897)
- when a CI doctor would land on a branch a live work run owns, the board rings that worker instead of launching a doctor (#922)
- a peer's finished review on your own mergeable MR offers merge, and a needed rebase leads the row over finished runs and a peer's review; finished runs expire after 2 hours
- a fresh respond no longer reads as interrupted, and resume never opens a second pane on a live session (#901)
- a follow-up review into a pane that is still open no longer flashes "review interrupted" (#904)
- people are named by first name through one shared lookup, with full names on the MR row, the row menu, the redo dialog and the check-in toast
- the full diff opens centred on the finding you came from
- code blocks in the threads drawer wrap instead of scrolling
- Slack marks count on your own thread replies and other teams' emoji
- `board.slack`'s emoji alias lists edit as fields in the console (#902)

### Gates

- gate forms open with every recommended option already picked; consent questions still open empty (#918)

### Setup and onboarding

- Start services passes when the daemon is already running and waits out a cold start (#893)
- the Fast Browser install steps stop at the Chrome Web Store install (#894)
- herdr starts when you press Finish (#895)
- a joiner's Slack and repo rows block Finish instead of waiting for a relaunch (#896)
- Claude Code defaults to fullscreen when `tui` is unset, so its input stays docked to the bottom of the pane (#898)
- a deck register that drops its connection is retried (#899)
- the dev app announces a newer version on every launch, once per version (#900)
- the background herdr server is now `mattstack-bg`, and a setup migration stops the old `bg` server when it is empty (#913, #928)

### Worktrees

- the Worktrees window counts unpushed commits honestly on squash-merged branches, and its cleanup banner fixes or hides itself per repo (#912)
- the banner names worktrees being off and tracking opt-outs, `rt worktree enable` turns worktrees on, and `rt worktree provision`'s await-ready hint names `--repo` (#914)
- the Worktrees window says it is checking until the first counts land, and stops polling the daemon while hidden (#907)
- `rt worktree restore` shows progress, copies without blocking, and sets the tree up in the background (#906)
- the patch-identical check streams `git log` into `git patch-id` and remembers verdicts by commit, so the daemon no longer grows past 1 GB overnight (#908)

### Skills and packs

- org base-pack text can carry `{{team.<key>}}` and `{{team.section:<name>}}` markers that `rt skills compile` fills from each team pack's params and sections (#916)
- the console's Graph tab draws team sections inside their slot's card, and a slot stale from a team value says so (#917)
- browser evidence asks one redaction question per batch, and mock-data boards confirm without asking (#920)
- stage-evidence, ship and stage-ship hand all of a pass's browser cases to the driver at once, so a real-data run gets one redaction question (#921)
- boards a person approved at the redaction gate skip the upload check (#924)
- evidence sections fold each case's screenshots behind a summary, on by default with `rt.evidence.foldScreenshots` (#910)
- the watch-ci and evidence engines read their triage config from settings, and the ci gate's Recommended option follows the triage (#925, #926)

### Chat and notifications

- `chat.autoSignIn` signs new pane sessions in to chat at startup (#903)
- the daemon can notify you before a Claude usage limit runs out, including a monthly cap on an enterprise seat; it is off until you set thresholds in `rt.notify.usageLimits` (#923)

### Fast Browser

- Fast Browser 0.1.18: tool results on an origin with a saved dev login say so, and setup no longer breaks Codex when its `config.toml` already has its own `fast_browser` table; the `logins:has` daemon verb backs the hint (#909, #927)

### Deck and console

- deck's success toasts name the app and reuse the command's icon
- the console's evidence modal has one head, and gate boards page through every board

### Also

- telemetry never pings from a virtual machine
- bundled tools: bun 1.4.4, node 24.22.1, gh 2.103.0, glab 1.124.0, git-lfs 3.8.1, cloudflared 2026.10.3, portless 0.15.9 (#927)

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.25.2...v2.26.0
