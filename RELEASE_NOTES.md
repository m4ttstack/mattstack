Setup now installs mattstack's own herdr build and the Flock app on every Mac, and an app update brings set-up Macs onto both. Teammates can ask the org's support host for help from the board or the app, and text people write on the switchboard is now sealed so the relay cannot read it.

### Setup

- setup installs the patched herdr from the m4ttstack/herdr fork's build list for every user, instead of stock herdr from herdr.dev; it checks the download's SHA-256, removes Homebrew's herdr, and moves each running server onto the new build by live handoff (#1262)
- the herdr row reads below the minimum build (`0.9.5-ms.1`), outdated, shadowed by another herdr on PATH, or waiting on a restart; the update-safe "Set up herdr" step installs the fork build on each app update when needed (#1262)
- setup downloads the notarized Flock app from m4ttstack/flock's latest release, checks its signature and notarization, and puts it in `/Applications`, or `~/Applications` on a non-admin account; Sparkle keeps it current after that (#1263)
- Flock is a required row on macOS 15 or newer and optional below it; an app update installs it once, and a Flock the member removed is left alone (#1263)
- `rt tools install flock-app` installs Flock by hand (#1263)

### Support

- a teammate asks the org's support host for help from the board (**Need help?**, or **need help with this MR?** in a row's menu) or from **Ask Maude…** in the app's Help menu and menu bar item, and the host's Mac opens a Slack chat with them (#1272, #1276)
- `rt team support on|off|status`, the console's `support.enabled` switch and Settings > Team turn support on and pick the host; turning it on makes the org's support key, and removing a member rotates it (#1272, #1274)
- a host can stop a chat, which holds that person's next request for 24 hours (#1272, #1276)
- the **Support host** setup row says what the host's Mac still needs, and the **Support key** row offers a Fix to an admin whose org has support on with no key (#1272, #1274)
- the switchboard queues support requests apart from the board inbox (#1267)

### Switchboard

- asks (title, branch and note), decline notes, free-text reasons, announcements and support requests are sealed to the recipients' roster keys with the bundled `age`, so only their Macs open them (#1279)
- a sender is told when someone cannot receive notes yet, and an announcement says how many people could not read it (#1279)
- version pings carry counts, kinds and times instead of the org clone's file, branch and commit names, and the relay clears the names it already held (#1280)

### rt

- `rt servers` lists the dev servers rt intercepted in this repo's worktrees, grouped by ticket, and stops the ones you pick; piped or with `--json` it only lists (#1283)
- `rt tools stale herdr` and `rt tools restart herdr` find and restart herdr servers still running an older build (#1264)
- `load_skill` accepts skill folders reached through a `CLAUDE_CONFIG_DIR` profile's plugins link (#1269)
- `load_skill` leaves compile's part markers out of the text it serves (#1284)

### Gate forms

- a pane waiting on a gate form reads as blocked in herdr, and stays blocked after a herdr handoff or `/clear` (#1261, #1264)
- a one-question gate submits from its question, with run controls under **More** (#1273)
- an answered form is a two-line message, and large gate, ledger and to-do calls show a short row in the transcript; ctrl+o shows the full call (#1268, #1271)

### Skills and pipelines

- a run that needs the developer opens a gate instead of holding (#1281)
- the evidence stage starts unclaimed dev servers itself instead of asking the developer to (#1275)
- a board review can't skip building its full review gate (#1266)
- the pipeline stop hook counts an agent resumed with `SendMessage` as running (#1278)
- the compact-before-plan rule takes the pane route where a managed account's guard skips the fresh-context hooks, and holds the run while it compacts (#1277)

### Board

- `g` opens the decision queue, shown as a key beside Open queue
- the MR card's branches get their own line

### Chat

- code blocks wrap, with copy and wrap buttons that show on hover (#1265)

### Console

- the paused banner says who paused a run, and why
- provision shows its branch and worktree
- a clean retry stays in a run's stage list
- an agent working under its own hold reads as running
- gate rows get hover padding, a visible hover and aligned text

### Tray

- **Restart herdr…** shows in the menu bar menu while herdr runs an older build (#1264)
- Cmd-H hides the app, and a hidden window still counts as open

### Mods

- fresh-context's `then` can name only a plugin skill, and human-todos refuses hidden and direction-changing characters in what it shows and runs (#1270)

### Existing installs

- someone with no key in the org's roster gets asks and announcements without their text; an org admin runs `rt team members sync` on this release after a new person joins, and `rt settings get mattstack.roster` shows who has a key

### Held pins

- zstd stays at 1.5.7 (1.6.0 is out), glab at 1.131.0 (1.133.0 is out), bun at 1.4.4 (1.4.5 is out), cloudflared at 2026.11.1 (2026.11.2 is out), and Sparkle at 2.10.0 (2.10.1 is out): a Sparkle bump gets its own tested release.

### Known issues

- this is the first release Macs install silently; on update they move to herdr `0.9.5-ms.3` and get Flock. A live herdr handoff was tested from 0.9.5 builds only, and running servers keep the old build until someone uses **Restart herdr…**
- a board on v2.37.0 shows a sealed ask without its title, branch and note, a sealed decline without its typed note, and a sealed announcement as "Update mattstack to read this"; the text comes back for new messages once that Mac updates
- support requests and sealed text have not yet run between two Macs; the live test follows this release
- on a Mac where Claude Code has never run, Flock's own herdr install shows a "Claude integration didn't install" card with the command to run
- a pack author whose app is older than this release but whose mattstack plugin is 0.32.101 or newer sees `rt skills check` report a team pack's review skill as too large; update the app before checking or syncing a pack

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.37.0...v2.38.0
