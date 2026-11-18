GitHub teams now get the same board, boxscore, review and CI tools as GitLab teams, and every Mac gets mattstack's fork of superpowers.

### GitHub support

- the daemon serves GitHub repos through the forge router, including background jobs (#1087, #1091, #1102)
- board follows the team's forge, so GitHub teams see their PRs, and its writes, identity and auto-doctor follow the forge too (#1103, #1118, #1114)
- board codeowner tabs and the re-review latch work on GitHub, and a review request left pending after a stuck follow-up is renewed (#1137, #1145)
- boxscore works on GitHub (#1124)
- comments, threads and reviews write to GitHub, evidence images attach to PRs through `gh --attach`, and the MCP review tools read GitHub (#1095, #1093, #1115)
- CI watch and triage, the review, respond, doctor and pipeline skills, and watch-ci work on GitHub (#1101, #1100, #1119)
- glance 0.29.0 to 0.33.2 add the GitHub read model, watchMR polling, rebase, merge method and queue, codeowner rules and behind counts (#1082, #1086, #1104, #1117, #1127)
- setup: **Just me** connects GitHub or GitLab, the restore screen offers GitHub sign-in, GitHub tokens are asked for the `workflow` scope, and a joiner is told to accept the GitHub invite (#1125, #1072, #1073, #1070)
- a first-push default branch moves back to `main`, and `creating-a-pack` accepts a GitHub remote (#1074, #1068)

### Credentials

- a forge token goes only to a confirmed host, and a GitLab token is never sent across origins on a redirect (#1063, #1090, #1099, #1121, #1141)
- no forge token reaches git through the environment, and git and the forge CLIs use the token rt holds (#1147, #1136, #1142, #1152)

### Skills and plugins

- every Mac installs mattstack's superpowers fork. On update, rt turns off the stock superpowers copies the fork replaces and records them so `rt uninstall` can turn them back on (#1165)
- team packs can ship husk skills, rendered on each Mac (#1164)
- Human Todos: an agent-to-human to-do list plugin, with an image kind that has an Open button (#1076, #1083, #1085, #1120, #1134)
- the mod kit, gate-form and kit-gallery plugins (#1122, #1154)

### Gates and work runs

- work gate modes: routine work-run gates can answer themselves, and phase 2 lets you see, pause and redo what a mode decided (#1159, #1163)
- gates stop asking "Happy with this, or should something change?", kit forms sit behind `rt.gates.kitForm`, and gate next labels have plain names (#1138, #1144, #1065, #1064)
- self-review leans to fixing (#1161)
- gate audit tool fixes (#1160)

### Worktrees

- a merged PR asks the session to leave its worktree instead of killing it, and an unwitnessed merge asks too (#1148, #1158)
- worktree dispose spares agents that moved to another tree (#1092)

### Setup and team

- setup adds the JetBrainsMonoNL Nerd Font to editor terminals (#1156)
- console confirms new teammates and admin access (#1111)
- team sync resets a clone to origin when its commits ahead add nothing, and nothing publishes while the org copy is on a trial branch (#1109, #1098)
- pack version stamps are quiet, with one lock file per pack (#1112)

### Board

- one sync drawer at a time, one rebase action per MR, and no rebase progress toast (#1157, #1108)
- a parked peer review shows on the board and the reviewer is reminded over Slack (#1080)
- discard a review waiting in the decision queue, and ask the reviewer about a review finding (#1132, #940)
- forge-aware copy in the ask picker, and shell and fixed-name assets revalidate on every load (#1143, #1155)
- answered gates leave the row's status lines, and gates the board raises park for the board with no pane form (#1140)

### Console

- gate rows and the Now card fade in, and a gate's code excerpt draws with CodeLines (#1084)
- usage cost leads with the total and tolerates an older daemon (#1096)
- choice settings explain each option, including the modes of `rt.work.gateMode`

### Chat, deck and tray

- chat groups a shepherd's worker DMs into one herd row (#1128)
- deck forgets a removed app's `deck.apps` entry (#1105)
- the tray opens Sparkle's update window and reports update status in telemetry (#1107)

### Usage

- usage records the Claude Code account and splits cost into metered and on plan (#1094)
- a run's session outside the run stays off MR totals (#1088)

### Settings store versions

- `chat.slackSupport.persona` is now `agent.persona`, store version 1 to 2. Do not run `rt settings migrate --write` until every app is on a build that reads the new name

### Held pins

- Sparkle stays at 2.10.0 (2.10.1 is out) and gets its own release; the standalone fast-browser pin stays at 0.1.19 (0.1.21 is out)

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.31.1...v2.32.0
