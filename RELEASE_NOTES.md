The mattstack Claude plugin and herdr-chat now live in this repo, rt drops the commands it no longer needs, and the agents rt launches keep their prompts out of `ps`.

### Monorepo

- the `mattstack` Claude plugin moves into this repo (`plugins/mattstack`, now 0.28.4); the marketplace catalog serves it in-tree instead of pinning `m4ttstack/skills` (#538, #539)
- the herdr chat plugin moves into this repo (`plugins/herdr-chat`) (#537)
- the Sparkle feed, release constants, scripts and docs name `m4ttstack/mattstack` (#534)
- mattstack.app ships gitq's five agent skills (absorb, publish, restructure, sync, track) alongside deck's and board's (#535, #536)
- CI certifies the plugin's skills, dry-runs its compile, and fails on process-digraph warnings (#542, #544, #547)

### Commands

- `rt update`, `rt commit`, `rt git commit` and `rt mr map` are removed
- `rt version` folds into `rt --version`
- `rt chat` and `rt uninstall` are hidden by default, and the verbs the apps, skills and daemon run no longer appear in the picker or help; one `rt.picker.hidden` setting lists what is hidden and replaces `rt.picker.show` and `rt.picker.hide` (#545, #549)
- `rt settings` shows only its store verbs in the picker
- command descriptions use plain language
- `rt hooks` shows one checklist where ticked means the hook runs, marks hooks that are off `[disabled]`, and says when a hook is skipped
- `rt ci lease` (claim, heartbeat, release, show) and a CI watch loop give each MR one CI attendant at a time, run over MCP tools with no Bash call (RT-331, #525)
- `rt skills expand` pastes mattstack attachments into hand-written skills; board's skills now carry the gate protocol this way (RT-358, #546)

### Agents and herds

- rt keeps agent prompts out of process argv: pane launches read the prompt from an owner-only file, and headless launches take it on stdin (#528)
- herd briefs name the shepherd by its chat handle and id, and the watchdog's background-work exemption expires after 60 minutes (RT-356, RT-359, #556)
- the herd watchdog stops nagging "done, not closed" while a follow-up round is live, and gate pushes no longer interrupt herd workers with an Escape (RT-355, RT-357, #543)
- a `herd-progress` skill renders a shepherd's `/progress` as one table (#553)
- shepherdr's fence check counts a job's committed work (#557)
- ship and stage-ship budget every loop, stage-ship's rebase aborts, and receive-review executes a handed plan (#552)
- the rt, gitq, deck and board skills gain process digraphs with bounded loops and gates (RT-341, #531, #532, #533, #541, #548)

### Board

- MR cards link their `!iid` (GitLab) or `#iid` (GitHub) to the forge page
- review findings cap body and fix lines at 100 characters, set their folders back, and lead each fix with an arrow
- review and respond escalations park and resume like doctor's, a resumed review never posts twice, and a resumed doctor waits out its own old CI lease (#554)

### Deck and console

- in mattstack-dev, a row's deploy button becomes an amber Redeploy pill when its checkout has new code for that app (#559)
- deck's command runs use your own bun ahead of the bundle's, so dev builds and Redeploy work inside mattstack.app (RT-352, #530)
- every expanded setting in the console switches between its editor and JSON with one Form | JSON toggle (#555)

### Setup, worktrees and chat

- `repos.clone` recognizes an existing clone by its normalized origin, not a substring (RT-360, #558)
- worktree pool names are handed out in order, so a freed name waits its turn (RT-345, #526)
- a new chat session's sign-in releases its pane from earlier sessions' rows (#529)
- a solo install's Done screen stays solo after the Full Disk Access relaunch, instead of offering Open the board and Invite teammates (RT-328, #527)

### Release and build

- `rt release update-machine` retries its #rt announce while the relaunched daemon comes back (#540)
- the dev-app rebuild's turbo cache works outside a git checkout, which clears mattstack-dev's "build failed" badge (#560)
- the clean-room VM gains a solo leg (RT-328, #527)

### Bundled

- fast-browser 0.1.7: browser-driver fills flow arg placeholders, and the flow runner treats an in-flight mutating step as possibly landed; the catalog's fast-browser plugin moves to match (#562)

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.15.0...v2.16.0
