A setup release. Setting up a Mac is now a few fast screens: your repos first, then one question about where your settings live, with a GitHub sign-in that makes a private backup repo for you. Team packs now install from git.

Also in this release: the board says "follow-up review" everywhere and lets you reply to MR comments from the threads drawer, you can choose which pack skills Claude may invoke on its own, and `EnterWorktree` into an rt worktree no longer asks first.

### Setup

- setup is a few fast screens: your repos first, then this Mac's settings, then one progress bar (#961)
- "Your settings" asks where your settings live: on this Mac, or in a private GitHub repo that a new Mac restores from (#961)
- with no GitHub token, **Sign in to GitHub** opens your browser once, and rt makes the private repo for you (#961)
- a settings folder that already has a remote is backed up there; rt never creates a second repo, and a remote rt can't restore from asks for a new URL (#972)
- a Mac set up before this release counts its existing remote as its answer, so it is not asked again (#972)
- after a run with a step left to fix, the footer reads **Finish setup**, and fixing that row finishes setup on its own (#972)
- opened from **Setup status…** on a finished Mac, the last screen is titled **Setup status**, and the window shows no step counter (#972)
- the progress bar shows a playful word for each step, never what the step is doing; a paused step still says plainly what broke (#972)
- the editor row is **Editor extensions** (skill blocks and rt context), and a missing extension no longer holds Finish (#972)
- creating a team from Settings on a Just me Mac no longer stalls **Set up this Mac** (#969)
- declining notifications no longer pauses the run (#965)
- setup finds a Homebrew-installed Claude Code under launchd's minimal PATH (#963)

### Skills and packs

- team packs install from git; on update, setup migration `2026-11-02-team-packs-from-git` reinstalls the packs you already have (#968)
- `rt skills disable-model-invocation` chooses which pack skills Claude may invoke on its own, per user (#968)
- the mattstack plugin is 0.32.38 and asks for this release's engine, so a pack that starts using `rt deps resolve --path` waits for this app (#970)
- `rt deps resolve --path` prints the resolved path alone (#967)
- the review engines take an optional rule selector, off unless `review.ruleSelector` is on (#948, #951, #957)
- self-review's diff takes in untracked files (#949)
- review panes no longer stall at the domain skill's hand-back (#962)
- `EnterWorktree` into a worktree rt's registry holds no longer asks; the daemon's dialog auto-accept and `panes.relocationAutoAccept` are gone (#953, #955)
- `EnterWorktree` never waits on a person: a path that no longer exists, or a folder that isn't an rt worktree, is refused at once with what to do instead (#977)

### Board

- "re-review" is "follow-up review" in the row menu, asks to a teammate, the ask cards and the Needs me group
- follow-up review is offered on someone else's MR only when you reviewed it (approved, left a review or opened a thread)
- reply to MR comments from the threads drawer
- the posting question shows the re-review ask as its own card, ticked by default
- a reviewer's approval answers their earlier Overview comments, so a response skips them
- an errored peer review offers a retry of that teammate's agent review
- your own roster entry remembers its own Show picks
- review gate comments edit on click, one card per finding, and every gate header shows the review loop's timeline (#947, #950)
- animated latch states with queue, retry and landing, and a full-width latch banner (#958, #960, #971)
- a sunny empty state on a review with no findings
- the Slack marks tooltip says whether you or someone else marked it
- WebKit fixes for the gate sheet's head, round bar and avatars

### Menu bar app

- a downloaded update installs once mattstack's windows are closed and setup isn't running, trying again every minute; a notification says when it is waiting and when it has landed, and **Update Available** installs it at once (#978)
- **Settings > Notifications** has a sound **Preset**: Calm (Sober 2, Sober 3, Sosumi), now the default, or Lively, the built-in tones

### Bundled tools

- gh 2.103.3, glab 1.127.0, node 26.13.0 (LTS) and cloudflared 2026.10.7 (#966, #974)
- held: Sparkle stays at 2.10.0; 2.10.1 ships in a release of its own, since it changes the updater (#975)
- held: portless stays at 0.15.9; 0.15.13 stops answering for the apps' `.mattstack` addresses (#976)

### Upgrading

- a Mac that waived the Fast Browser extension row before sees that row ask again after updating, since Finish now honors a waiver on only three rows (#961)
- a Mac that never picked notification sounds now hears the Calm preset; choose Lively in **Settings > Notifications** for the earlier tones

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.27.0...v2.28.0
