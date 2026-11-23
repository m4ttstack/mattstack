# herdr fork, flock in setup, and gate panes shown as blocked

Date: 2026-11-23. Status: draft for approval.

## Intent

Mattstack and flock are meant to be used together, but a new teammate installs
flock by hand after `rt setup`, and mattstack features keep needing changes to
herdr that upstream does not take. Today those changes live in flock as one
patch file per herdr version, published from flock's releases and listed in a
table compiled into flock.

This work gives herdr patches one home, installs flock and the patched herdr
for every mattstack user, and lands the first new patch: a pane whose agent is
waiting on a mattstack gate form shows as **blocked** in herdr, the same way a
pane stopped at Claude's own AskUserQuestion does.

## Why the gate needs a herdr patch

Checked on 2026-11-23 against herdr 0.9.5:

- herdr decides a Claude pane's state only from screen rules
  (`~/.local/state/herdr/agent-detection/remote/claude.toml`). The Claude hook
  herdr installs reports session identity on `SessionStart` and nothing else.
- `herdr pane report-agent --state blocked` is ignored for a Claude pane, from
  source `mattstack:gate` and from `herdr:claude` alike, whether the screen
  reads idle or working.
- With a gate form open, Claude's turn has ended and the screen shows the
  prompt box, so herdr reads idle. The gate form is responsive: a narrow pane
  shows only a band (`mattstack gate waiting  Questions [ Show ]`), a wide one
  the full form. No text is common to both, so a screen rule has nothing
  stable to match.

## Goals

1. One fork, `m4ttstack/herdr`, holds every mattstack herdr change as its own
   commit on top of an upstream herdr release.
2. The fork controls herdr updates: mattstack users get a new herdr only when
   the fork publishes one. They never run stock herdr.
3. `rt setup` installs the fork's herdr for every user, and installs flock as
   a required row.
4. Flock downloaded on its own still gets the fork's herdr.
5. A pane with an open mattstack gate form shows as blocked in herdr, in every
   form layout, for rt gates, plugin asks and the `ask` tool alike.

## Non-goals

- Upstreaming the patches. Offer one upstream when it is cheap; never wait on it.
- Bundling herdr or flock inside mattstack.app.
- Changing what the existing patches do (mouse, theme, kitty images).
- Linux or Windows builds.

## Anti-goals

- A teammate silently running stock herdr, losing gate state, mouse, theme
  or images, because some update path bypassed the fork.
- A pane stuck on blocked after its gate closed or its form crashed.
- A herdr catch-up that blocks or delays an unrelated mattstack release.
- A new herdr build that needs a flock release to reach flock users.

## Approaches

**Where the patches live.**

- **A fork repo, `m4ttstack/herdr` (picked).** One commit per feature, so a
  rebase onto a new upstream release fails per feature and names the feature
  that broke. Its CI builds and publishes.
- Patch files moved into the mattstack repo. No new repo, but it repeats
  flock's single growing diff (1,498 lines at 0.9.5 r4, up from 99 at 0.9.4)
  and puts a Rust build in mattstack CI.
- Upstream only. Ruled out: no herdr release since 0.9.5 (2026-10-14), 540
  open issues, outside patches wait.

**Who controls herdr updates.** The fork (picked), over following upstream and
re-patching after each release, which leaves gaps where teammates run unpatched.

**Where herdr lives on a Mac.** Downloaded to `~/.local/bin/herdr` (picked),
where herdr lives today and where flock's installer already writes. Bundling
it in mattstack.app would tie herdr catch-ups to mattstack releases and still
need a download path for flock alone.

**How installers learn about builds.** A list file the fork publishes (picked),
read at run time by `rt setup` and flock. Flock gives up its compiled-in
SHA-256 pins and trusts the fork's releases; in exchange a new herdr build
reaches flock users with no flock release.

## Design

### 1. The fork, `m4ttstack/herdr`

- Branch `mattstack` = an upstream release tag plus these commits, in order:
  1. mouse: flock's `terminal.mouse` shape and mouse-capture reporting
  2. host theme: `terminal.host_theme` on terminal session control
  3. theme timing and live-handoff server restart fixes (0.9.5 r3)
  4. kitty images in session-control frames (0.9.5 r4)
  5. gate blocked state (below)
  Commits 1 to 4 are flock's `patches/herdr/0.9.5.patch` (r4) split by feature.
- Builds: arm64 and x86_64, from a tag named `<upstream version>-ms.<n>`
  (e.g. `0.9.5-ms.1`). The binary reports a version that shows it is a
  mattstack build, so an installer can tell it from stock herdr without
  hashing.
- Each published build is a GitHub release on the fork with both binaries.
- **README:** a bare one, the shape of `m4ttstack/superpowers`'s README. It
  describes only what the fork changes and links back to upstream for the
  rest. Sections: a title naming it the mattstack fork, one line naming
  the upstream version it is built on; "What's different" (one bullet per
  fork commit); "Installation" (mattstack and flock install it; the by-hand
  command); the version scheme `<upstream version>-ms.<n>`; "Everything
  else" linking the upstream README at the base tag and the latest upstream
  README; "License" (Apache-2.0, same as upstream). The upstream README is
  replaced, not kept beside it. The README is updated in the same commit as
  each feature commit.

### 2. The build list

A JSON file at a fixed URL on the fork (e.g. the `herdr-builds.json` asset of
a `latest` release, or a file on a `builds` branch; builder's call). Per build:

- herdr upstream version and fork revision (`ms.<n>`)
- per CPU: download URL and SHA-256
- `changesServer`: the running server needs a handoff to the new binary
- `supersedes`: SHA-256 of earlier builds, so an installer can tell an
  outdated mattstack herdr from a current one
- the flock patch SHA-256s it replaces (flock's 0.9.5 r1 to r4), so flock
  users on a flock-built patch are offered the fork build as an update

Installers verify the SHA-256 from the list before swapping the binary in.

### 3. Keeping up with upstream

- **Nightly job in the fork:** detects a new `herdrdev/herdr` release tag,
  rebases `mattstack` onto it, builds, runs herdr's tests and the patch tests.
  Clean: opens a PR with a draft release. Conflict or red tests: opens an
  issue naming the commit that broke.
- Merging that PR publishes the release and updates the build list.
- **`rt:release`:** one check before shipping, that the build mattstack
  expects is the list's newest. No rebasing in the release.

### 4. Mattstack setup

- **herdr row** (`lib/setup/validators/tools.ts`, `lib/setup/tools-install.ts`):
  installs from the build list instead of `herdr.dev/install.sh`. Ready means
  a mattstack herdr build that is the list's newest for this herdr, with the
  Claude integration installed. Stock herdr, or an outdated fork build, reads
  as needing an upgrade. Installing a `changesServer` build restarts the
  server by herdr's live handoff, so panes stay open.
- **herdr's own updates:** `herdr update` and herdr's update notice must not
  replace a mattstack build with stock herdr. How (a patch in the fork that
  points `herdr update` at the build list, or one that disables it with a
  message) is the builder's call; the outcome is fixed.
- **flock row (new, required):** downloads the latest notarized flock release
  from `m4ttstack/flock` into `/Applications`. Ready when flock is installed;
  flock keeps itself current through Sparkle after that.

### 5. Flock

- The patch catalog reads the build list instead of its compiled table.
- The install confirmation stays as it is: flock still asks every time before
  replacing herdr. Flock's live-handoff server restart stays.
- Flock's stock herdr update notice (`herdr.dev/latest.json`, `herdr update`)
  points at the build list instead.
- `patches/herdr/` and `Scripts/build-herdr-patch.sh`,
  `Scripts/publish-herdr-patch.sh` leave flock. Old `herdr-patch-*` releases
  stay up for anyone on an older flock.

### 6. Gate panes shown as blocked

**herdr (fork commit 5).** A source other than the agent's integration can
raise a blocker on a pane, e.g.
`herdr pane report-blocker <pane> --source mattstack:gate --message "<title>"`
and `herdr pane clear-blocker <pane> --source mattstack:gate` (names and the
socket method are the builder's call). Behavior:

- While a blocker is raised and the screen reads idle or done, the pane's
  state is **blocked**, with the message, everywhere herdr shows state:
  sidebar, rollups, `agent wait`, `pane.agent_status_changed` events.
- When the screen reads working, working wins. If the agent goes idle again
  with the blocker still raised, the pane is blocked again.
- A blocker ends when its source clears it, when the agent is released or
  exits, or when the pane closes.

**gate-form mod** (`mods/gate-form/src/register.tsx`):

- Raise the blocker when any form opens and the session runs in herdr
  (`HERDR_ENV=1`, `HERDR_PANE_ID` set), next to `ringBell`.
- Keep it raised while any form is open, including a gate set aside to the
  band, since that gate still waits on the person.
- Clear it when the last open form ends (`openCount === 0`), and on session
  end.
- Covers every form source: rt gates under `rt.gates.kitForm`, plugin asks
  through `$.gateForm.ask`, and the `mcp__gate-form__ask` tool.
- On a herdr without the blocker verb, the call fails quietly and the gate
  works as before.

## Order

1. The fork with commits 1 to 4, CI builds, and the build list.
2. Mattstack setup's herdr row on the build list, plus herdr's own update path.
3. Flock reading the build list; patch scripts out of flock.
4. The flock row in setup.
5. Gate blocked state: fork commit 5, then the gate-form change.

## Left to the builder

- Blocker verb and socket method names; where the build list file lives.
- How `herdr update` is redirected or disabled in a mattstack build.
- The version string a mattstack build reports.
- CI details for the nightly job and release publishing.
