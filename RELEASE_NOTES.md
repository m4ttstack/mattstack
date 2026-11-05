A release for teams and agents. An org can now require tools for every team, and a Mac that already finished setup hears about a new one on a short tools screen. Chat is rebuilt to Slack's layout with one home for messages to you, Console shows what each MR cost, and `mr_merge` merges GitHub PRs through the merge queue.

Also in this release: `.mattstack` addresses work again on portless 0.16.0, deck apps are private by default, and the board's **rebase locally** tries `rt sync` before it starts an agent.

### Setup and teams

- an org can require tools for every team in `org/requirements.jsonc`; a team's own entry wins, and a pack can leave an org tool out with `excludeOrg` (#992)
- on a finished Mac, a newly required tool sends one notification once it reads missing on two pulls in a row, and setup opens a short tools screen to install it (#992)
- a broken org requirements file never blocks setup; it shows as a row under **Setup status** (#992)
- `rt team announce` lets org owners and admins send a notification to every teammate's Mac (#1000)
- `board.agent.model`, `board.agent.effort` and `board.triage` take org and team values, which each developer can still override (#954)
- herdr and claude install with their own install scripts, never Homebrew, and herdr's own copy wins over an older Homebrew one (#952)

### Local proxy and deck

- `.mattstack` addresses work on portless 0.16.0: the proxy service now names both the `.localhost` and `.mattstack` TLDs (#1004)
- `deck override <app> off` puts every one of the app's addresses back on its port, not only `.localhost` (#1004)
- apps you never switched on are private, publishing needs a connected domain, and mattstack's own apps are never public (#1005)

### Chat

- chat is rebuilt to Slack's layout, with a resizable sidebar, and shows real Slack pictures in chat, board and boxscore (#1008)
- **Messages to you** collects every DM you are part of in one list, with an unread count in the sidebar (#1015)
- an agent's post into its DM with you notifies you without a mention; your own posts and rooms with a Slack participant never do (#1017)
- rt:chat and the viewer read your handle from `chat.humanHandle`, so agents no longer DM a handle you no longer use (#1018)
- `rt chat avatar` gives an app a handle's chat face as a file (#1019)
- `/slack-support <person> <problem>` lets Claude help a teammate over your real Slack DM until it's sorted, then close and report (#995)

### Console

- the **Usage** page adds up each MR's tokens across its work run, reviews, responses and doctor sessions, with a sortable MR list, weekly trends and estimated costs (#1014, #1021)
- a run's estimated cost shows in its header and links to its MR's cost (#1021)
- click a Usage step to read what its session was doing (#1025)
- the **Surface** tab can switch on a reference skill from the org's base pack, and lists only what a switch can change (#1024)

### Board

- **rebase locally** tries `rt sync` first, so a clean rebase needs no agent; on a conflict, the doctor finishes the paused rebase (#1027)
- thread cards show the agent's verdict, and **Post reply** sits beside **Resolve thread** (#1023)
- a teammate's lost review shows its retry and dismiss only on your own MR (#1010)
- a reload during live mode no longer drops the board to read-only

### Agents and merging

- `mr_merge` merges GitHub PRs, through the merge queue when the repo has one, and `wait: true` holds until the PR lands or is dropped (#1012, #1013)
- `rt pr enqueue` adds a PR to the merge queue (#1011)
- `rt check` runs a repo's own pre-push check, and `git_push` refuses a red push and posts the result on the commit (#991, #994, #997)
- `rt skills` picks one plugin install per name, preferring your user install over a stale project one (#941)
- the herd watchdog stops sending notifications about unread DMs on a herd whose jobs are all closed (#1006)
- a failed cron command logs the tail of its stderr (#956)
- a bare `Bearer` token is masked anywhere in logs, not only after `Authorization:` (#993)
- the mattstack plugin is 0.32.45 and asks for this release's engine, so a Mac on an older app keeps its current plugin until it updates

### Menu bar app and dev

- `rt dev update --release` swaps a dev app built on this Mac for the release's dev app (#989)
- the telemetry page shows local times and leads with the Macs not on the latest release (#1002, #1003)
- fast-browser's plugin pin is refreshed (#998)

### Existing installs

- after updating, **Setup status** shows **Update proxy** until you press it; it takes one admin password, and `.mattstack` keeps working on the old proxy meanwhile
- if you connected Slack before this release, **Setup status** asks you to reconnect it once to grant `users:read`

### Held pins

- glab stays at 1.127.0 (1.128.0 is out) and Sparkle at 2.10.0 (2.10.1 is out); Sparkle gets its own release

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.28.0...v2.29.0
