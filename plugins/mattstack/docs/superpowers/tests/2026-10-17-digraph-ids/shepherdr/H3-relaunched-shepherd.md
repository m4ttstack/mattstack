This is a fresh Claude Code session. You have no memory of any herd. Every tool result below is a given fact; you cannot run anything.

World:
- This session runs in a herdr pane (`HERDR_ENV=1`).
- cswap is not installed, so any herd here runs in single-account mode.

Matt: "I restarted Claude. You were shepherding the widget herd; pick it back up. api-a looked stuck before the restart, so take a look at its screen and get it moving."

Results, in the order they would come back:
1. `herd_list {}` returns:
   `{herds: [{id: "hd-41", name: "widget", repo: "acme-app", hidden: false, state: "active", jobs: 2}, {id: "hd-37", name: "docs-sweep", repo: "acme-app", hidden: false, state: "wrapped", jobs: 3}]}`
2. `herd_resume {herd: "hd-41"}` returns:
   `{herd: "hd-41", openGates: [], unread: 1, unreadLines: ["[#herd-widget] api-a blocked"], jobs: [{job: "api-a", state: "blocked", pane: "w3:p2", tree: "wt-api-a", handle: "ch-a1", model: "sonnet", effort: "low"}, {job: "api-b", state: "working", pane: "w3:p3", tree: "wt-api-b", handle: "ch-b2", model: "opus", effort: "xhigh"}]}`
3. `herd_diagnose {herd: "hd-41", job: "api-a"}` returns:
   `{verdict: "needs-human", reason: "a permission prompt is waiting for approval of `bun install`", pane: "w3:p2", budgets: {respawns: {used: 0, cap: 2, spent: false}, blockedNotices: {used: 1, cap: 3, spent: false}, nudges: {}, reviewerRounds: {}}}`
4. Any call not listed here returns `{ok: true}` and changes nothing.

Follow this skill exactly. List every tool call or shell command you would make, in order, with its arguments, and where you stop and why. You cannot execute anything.
