### Tray

- the team pane's join button reads Rejoin this team (MAT-424) (#637)
- one readable daemon status line, fuller app menu and a Help menu (#635)

### Board

- one toast per MR row action, pending then done (#669)
- format RowView.tsx
- drop hover note and copy-for-slack tools from rows (right-click menu keeps them)
- peer asks start in seconds (daemon waker, triage --peer, board.peerAsks) (#664)
- show what happened to an ask you sent a teammate's agent (#653)
- post to slack names its channel; post to code owners ends in an ellipsis
- post an MR to its code owners' Slack channels (#645)
- author-only actions stay on your own MR (#620)
- onboarding fixes for launch errors, herdr lookup, switchboard token and ask hints (#610)
- retry the switchboard token read until the daemon answers (#601)

### Boxscore

- drop the raw metric notes line under the leaderboard (#603)

### Chat

- members dropdown truncates long lines instead of scrolling sideways (#636)
- kit Menu.Sub dropdown, docked cards, quieter sidebar (#632)
- herdr-aware agent card, members pill and docked cards (#629)

### Ci Watch

- make the watch budget a team setting (ci.watch.budgetMinutes) (#617)
- fail fast on blocking failures, child pipelines included (#612)

### Console

- verbs with no slots list as Standalone; Unwired keeps only real loose ends
- a board skill's slot row highlights the line that declares the slot
- a board skill's slot row opens the skill's installed file
- a board skill shows the slots its pack fills instead of an anatomy error
- the skill-failed alert's Retry is an outline button, which holds against the alert's tint
- the skill-failed alert lifts off the canvas, its Retry takes the alert's tint, rt's next command on its own line
- a stale build's own text and every compiled file's header get drawer bands
- Graph tab starts centred with room under the header; drags keep 88% of the graph in view; wider drawer
- frosted Graph tab header the canvas scrolls under; drags stop with 160px of the graph in view
- Graph tab header in a translucent card, drag room on the canvas, no fit button
- the drawer bands the skill's own text and its header, so the top of a file is labelled too
- wrap long lines in the skill drawer on request, remembering the choice
- pop the skill drawer out to a full-screen modal and back, remembering the choice
- Graph tab for skills pack wiring (template view, skill drawer, unsynced banner) (#670)
- gate context beside the form, stacking when narrow; one-line ticket id (#605)

### Cron

- refuse duplicate trigger names; say changes arm without a restart (#666)

### Mr Upload

- trust rt's evidence folder ~/.mattstack/evidence (#618)

### Other

- chat, pane: read a pane's session from its Claude process when herdr has none (#674)
- One built-in switchboard URL (#671)
- RT-369: output layer phase 5g, renderer (#672)
- tui-kit: failed toasts get a coral edge and a cross (#673)
- Worktrees panel: free herd-held trees, replace the bogus Stop process (#668)
- boxscore design
- BOARD-51: shorter board row menu with flyouts, no hidden actions (#665)
- RT-369: output layer phase 5e3, repos (#663)
- RT-369: output layer phase 5e2, home and release (#661)
- RT-369: certification rows for the output layer skill edits (#662)
- RT-369: output layer phase 5f1, sdm, port and runs (#660)
- RT-369: output layer phase 5f2, chat (#659)
- RT-369: output layer phase 5b, git and sync (part 2) (#655)
- console settings: rows open in one smooth animation; square hover (#658)
- RT-369: output layer phase 5e1, team (#657)
- Tray watches deck and restarts it; deck exits 143 on SIGTERM (#656)
- console settings: each row is one disclosure with a Value | Where it's set panel (#650)
- RT-369: output layer phase 5d2, plugins, tools, deps, hooks and intercept (#654)
- Board reviews land as GitLab reviews, round after round (#652)
- RT-369: output layer phase 5b, git and sync (part 1) (#649)
- RT-369: output layer phase 5d1, skills (#651)
- RT-369: output layer phase 5c, worktree and navigation (#648)
- mr_comment_inline resolves its anchor against the diff; add mr_update_note (#647)
- RT-369: output layer phase 5a, layer additions (#646)
- RT-369: output layer phase 5 scoping and slice plans (#642)
- RT-369: output layer phase 3, setup (#643)
- hooks-guard: reclaim core.hooksPath from husky and other tools again
- mattstack hooks: SessionStart note to read saved tool results with the Read tool (#644)
- RT-369: output layer phase 4, settings (#641)
- RT-369: output layer phase 2, errors (#639)
- board skills: send the done write alone and last (#638)
- RT-369: output layer phase 1, the foundation (#630)
- live forge reads: MCP GitLab reads go to GitLab, gitlab_get passthrough, skills stop dead-ending on a cache miss (#628)
- Setup checklist loading state and menu bar menu reorganisation (#625)
- setup update: run only where setup has finished (#626)
- tray rebuild: use the user's node; the bundle's node only when there is none (#619)
- setup update: one run at a time behind a pid lock (RT-367) (#616)
- setup update: honest enable note and summary wording (#615)
- Onboarding fixes: neutral not-yet states, share tips, Wiring pack name, sync against an installed engine (#611)
- team join and invite: a board that did not peer is never silent (#608)
- stack-guard: the default branch is never a stack member (#600)

### Rt

- release: audit each release for what set-up Macs miss (#621)

### Setup

- Slack row waits for the team owner to accept a new member (#640)
- Finish starts an update run, and uninstall clears Finish (#627)
- report an unpeered joined board at read time, drop the peeringPending stamp (#623)
- no proxy action on a build without the proxy installer (#624)
- the app reopens setup until Finish is on record (#609)
- rt setup update re-applies safe steps and runs migrations (RT-366) (#613)
- --only runs its prerequisites; terminal apply talks to the app directly (#607)
- seed crossSessionInbound accept in Claude settings (#606)
- plugins skip the team marketplace until the team is cloned (#604)
- bare rt setup shows its subcommand picker (#602)

### Ship

- record the consented MR target, reopen the gate on resume only when it changed (#631)

### Skills

- review resolves a ticket id by search, checkout ticket guard, clear-node stage wording (#633)
- per-pack binding follow-ups (base marker, stale files, resume pack, tab pack) (#622)
- per-pack binding scope for shared repos (#614)

### Team

- one team per machine, and console names the team (MAT-424 phase 1) (#634)

### Ui

- CodeLines wash reads its code in body text, only marker lines muted
- CodeLines band labels stick to the top with CSS, as tags

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.19.0...HEAD
