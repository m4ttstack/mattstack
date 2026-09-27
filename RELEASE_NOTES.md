One repo now builds the whole suite: the apps, glance and gitq were folded into rt with their history, so mattstack.app ships board, console, chat, boxscore, deck and gitq from the tagged commit. Agents reach rt through MCP tools instead of Bash for MRs, runs, worktrees, herds and chat, with credentials redacted from every result.

### Monorepo

- m4ttstack/apps, m4ttstack/glance and m4ttstack/gitq live in this repo as `apps/*`, `packages/*` and `apps/gitq`, imported as merge commits with full history; the old repos are read-only from here on (#489, #499, #502)
- rt-client, settings-kit and tui-kit are private workspace packages built by the root install; nothing publishes them anymore
- the release builds every bundled app from the tagged commit (`scripts/build-apps.ts`), so an app change merged to main is in the next release by construction; only fast-browser stays a pinned download
- `@mattstack/glance`, `@mattstack/glance-react` and `@mattstack/gitq` still publish to npm on demand from their directories; gitq's release tags `gitq-v<version>` and refuses a workspace dependency whose version is not on npm
- `rt release app <name>` cuts a patch release for one bundled app when the diff stays inside that app, the notes and the website (#464, #469)

### MCP tools (RT-326)

- MR tools cover reads and writes on GitLab: `mr_view`, `mr_list`, `mr_threads`, `mr_pipeline`, `mr_job_trace`, `mr_for_branch`, `mr_create`, `mr_update`, `mr_upload`, `mr_comment`, `mr_comment_inline`, `mr_reply_thread`, `mr_resolve_thread`, `mr_approve`, `mr_ready`, `mr_rebase`, `mr_retry`, `mr_map` and `mr_merge`, so board posting no longer waits on the Bash classifier (#472, #478, #485, #491)
- `run_*` tools start, stage, snapshot and answer decision runs (#488); `worktree_provision`, `worktree_dispose` and `worktree_stop_holders` plus the `herd_*` tools drive worktrees and herds, and `rt_verb` exposes a wider curated verb set (#497)
- guarded git tools `git_push`, `git_pull`, `git_rebase` and `branch_sync`; a push whose upstream targets main, master or the remote default is refused (#492)
- `chat_*` tools mirror every rt chat verb, and a daemon-signed-in session gets a chat session file so its tools answer with its own handle (#501, #504)
- every tool result passes through credential redaction, so a token in an avatar URL or remote never reaches a transcript; enrich also strips userinfo from https remotes (#500, #482)
- the daemon auto-accepts Claude Code's relocation prompt for announced attended panes (#490)
- the mattstack skills for chat, worktrees and herdr-inject run on these tools instead of Bash; `rt skills` lists a pack's MCP tools, `check --strict` lints them with derived rules and a pack script scan, and an advisory audit flags Bash where a tool exists (#493, #505, #507, #513)
- base Claude permissions drop the glab and `rt runs` rules and add the Monitor waits; the gate rule stays (#487)

### Settings

- every key has a schema, writes are validated, `rt settings check` verifies the real stores, and a schema lock guards breaking changes between releases (#474)
- versioned store names with migrations and drift detection, so a key can change shape without stranding an older app (#484)
- `rt.mcp.uploadRoots` widens where `mr_upload` may read from (#479)
- test runs refuse to write the account's real stores (#468)

### Glitter

- opens any repo without registering it (#509)
- the mouse wheel scrolls the view, not the selection (#510)
- a diff line taller than the pane scrolls row by row, and a file-to-symlink typechange parses both diff blocks (#459, #454)
- the master row hides its glyph when there are no changes, and the sidebar's tab pad and gap rows collapse

### Herd

- worker trees are pre-trusted for every account, and rendered briefs drop author-note blocks (#511, #512)
- herd ask option labels are capped at 60 characters so a gate never waits on an overlong form (#495)
- panes keep a real title: `rt agent` no longer passes `--name`, and pane rename drops the `--` herdr keeps in the label (#471)
- a gate can supply its own notification headline and summary (#465)

### Tray

- Discard New Build keeps the build cached instead of wasting it (#483)
- each badged gate counts once in the dock, and badge fetches use their own connection per app host (#467, #466)
- review changes opens in its own window, and rows stay busy until the list refresh lands (#458)

### Worktrees and MRs

- one containment rule for triage and dispose checks every tip, and the panel stops polling when closed (#470)
- dispose accepts a HEAD already in main over a stale `origin/<branch>` (#460)
- an unsynced MR's discussions are stored instead of throwing (#486)

### Docs

- rt.cool, install, onboarding and teams follow the mattstack.app setup flow and state current behaviour only (#461)
- skills tell sessions to run `/reload-plugins` after a sync or init instead of restarting (#496)

### CI

- the unit suite runs as three balanced shards and a PR runs only its changed tests plus the guard tests; a go job runs beside static with runner-measured timings; superseded PR runs are cancelled (#475, #480, #457)
- test hygiene: a test that leaves `process.exitCode` set fails on its own, HOME stays valid across files, daemon-logger and shutdown tests are order-independent, and leftover Go module caches are swept (#473, #462, #463, #453)
- the dev app stage always reconciles the copied deps against deps.lock (#455)

### Board 0.1.8

- approved means GitLab says approved (#160)
- a respond gate's row counts its threads and the status word clamps; an answered gate leaves the decision queue right away (#162)
- notifications link to the MR's row and read in plain words (#163)
- badges report the gate ids they count, so a run gate is never double-counted against console, and a gate settled during a relay gap stops counting (#164)
- board and deck share one decision-gate helper, and deck's own row shows its service (#165)
- doctor's retry and rebase go through rt's MR tools instead of `glab ci retry` (#167)

### Console 0.1.4

- JSON editors for every settings row and explain layer, a per-repo view with a repo picker, and a Needs fixing flow for diverged or unregistered keys, now working across repos with diverged scalars handled (#169, #494, #498)
- the installed-caches chip says to run `/reload-plugins` in running sessions instead of restarting them (#496)
- the gate-count endpoint returns the counted gate ids so the tray can dedupe against board (#164)

### Deck 1.1.2

- removing a route-only row clears its routes, and board shows remove failures (#161)

### gitq

- the bundled CLI moves from the 0.2.1 binary to the tree: cascades record and use a per-node fork point, `continue` keeps the resumed branch's store update and records the fork point against the final target, preflight warns when a child's fork point is unrecoverable, and the rebase engine refuses a doomed sweep instead of conflicting through it
- transient watchman cookies no longer count as a dirty tree
- `gitq abort` falls back to the leased slot when no pause file survives and only aborts a rebase that is in progress there; the board's action endpoint refuses a non-local Origin, a non-JSON body and an untracked stack (#502)
- repos.json keys are forwarded unchanged as identities, matching rt-client's identity-keyed lookups

Boxscore and chat ship unchanged apart from boxscore's settings page taking its composite editors from the schema (#169).

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.13.1...v2.14.0
