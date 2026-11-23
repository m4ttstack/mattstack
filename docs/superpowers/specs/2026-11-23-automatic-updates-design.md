# Automatic updates, prod and dev

## Intent

Every mattstack Mac, prod and dev, ends up on the release Matt ships
without anyone being asked in Slack to update. Today most releases need
that message. An update must never leave running agents unable to reach
the rt daemon, and the same protection must cover a daemon restart done
by hand during development.

## How it works today

- **Prod.** `rt-tray/Info.plist` sets `SUAutomaticallyUpdate` to false
  (since #1107) and `SUScheduledCheckInterval` to 21600 (6 hours). A
  scheduled check that finds an update opens Sparkle's window; nothing
  installs until the person clicks Install. Before #1107 the install was
  silent but `UpdatePolicy.hold` held it while any mattstack window was
  open, so it rarely ran.
- **Dev.** `UpdatePolicy.shouldStartUpdater` turns Sparkle off. Only a
  manual `rt dev update` (`lib/dev/update.ts`) installs a newer
  release-built dev app. The "newer dev app" notice (`lib/dev/notice.ts`)
  is read only by `rt setup`. Nothing pulls the person's clone, which is
  the code rt and the daemon run.
- **Daemon restart.** After an update the relaunched app runs
  `launchctl kickstart -k` on the daemon. launchd stops the old process,
  then starts the new one. The old daemon force-closes in-flight requests
  (`server.stop(true)`). The new daemon binds `rt.sock` last, after the
  databases open and migrate and every subsystem starts, and behind the
  API port bind, which backs off 3s to 60s when port 9401 is still held.
  `rtCommand` (`packages/rt-client/src/transport.ts`) never retries, so
  MCP tools and chat calls made in that gap fail. `rt events wait` fails;
  `rt gate wait` already reconnects.
- **What already survives a restart.** Chat messages, read cursors,
  gates and presence are on disk. A chat delivery cut off by a restart
  is redelivered by the delivery sweep.

## Goals

1. A prod Mac installs a downloaded update at once, with no prompt.
2. A dev Mac updates its dev app and its clone together, automatically,
   when that is safe.
3. A daemon restart, from an update or by hand, does not fail agents'
   calls.
4. Matt can see on the telemetry page which Macs are held and why.

## Non-goals

- Rolling back a bad release. The answer is a fix release, which now
  lands within about an hour.
- Staged or percentage rollouts.
- Zero-gap restarts through a socket held by launchd (see Approaches).
- Changing how a dev app built on this Mac behaves: it is still left
  alone.

## Anti-goals

- An automatic dev update that touches a clone someone is working in.
- A dev Mac whose app and clone are at different versions because one
  half updated.
- A retry that sends a request twice to a daemon that already acted on
  it.
- A retry that hides a dead daemon: a daemon that never comes back still
  fails loudly.

## Approaches

For the daemon restart, three were considered.

- **A. Retry, early bind, drain (picked).** Clients retry while the
  daemon is unreachable, the new daemon binds `rt.sock` first and holds
  requests until boot finishes, and the old daemon finishes in-flight
  requests before it exits. A gap of about a process start remains and
  the retry covers it. No launchd changes. Picked because the retry is
  needed under any option (crashes happen) and, once it exists, the rest
  of the gap costs a caller about a second.
- **B. A, plus a socket launchd holds.** No gap at all. Needs a spike
  (unverified that Bun can take a launchd-activated socket) and changes
  the daemon's launchd plist on every Mac. Not worth it on top of A.
- **C. herdr-style: the old daemon starts the new one.** herdr does this
  for its server. Dropped: launchd tracks one process per label, so the
  handed-off daemon would run outside launchd and the next kickstart
  would start a duplicate.

Prod and dev each had one sensible way once the behavior was decided,
described below.

## Design

Three parts, built in this order. Part 1 stands alone and ships first.

### Part 1: a daemon restart agents ride through

Decided by Matt: approach A, and it must cover manual restarts.

**Client retry.** Both daemon clients retry: `rtCommand`
(`packages/rt-client/src/transport.ts`, used by MCP tools and chat) and
`daemonQuery` (`lib/daemon-client.ts`, used by most `rt` verbs). The
retry lives in each client's transport, not at its call sites (my call).
A request is retried in two cases, both of which mean the daemon has not
acted on it:

- the connection could not be made (the socket file is missing, or the
  connect is refused);
- the daemon answered "starting" (see Early bind).

It retries with short backoff for up to about 20 seconds in total, then
returns what it returns today (`rtCommand`'s "daemon unreachable"
result, `daemonQuery`'s null). It does not retry a request whose
connection was made and then dropped or timed out, because the daemon
may already have acted on it. `daemonQuery` keeps asking the tray to
start a daemon whose socket is gone.

**`rt events wait` reconnects** the way `rt gate wait` does
(`commands/gate.ts`): a missing daemon mid-wait is retried with backoff,
not a failure.

**Early bind.** The new daemon binds `rt.sock` as early in boot as it
can: after the park gate and after `evictStaleDaemon` (which must run
first, so a new daemon never unlinks a live daemon's socket), and before
the databases open. A request that arrives before boot finishes gets an
immediate "starting" reply, which clients retry (my call: holding the
request instead would outlast `daemonQuery`'s 2s timeout, and a timeout
is not safe to retry). The socket bind no longer waits behind the API
port bind.

**Drain.** On SIGTERM the old daemon stops accepting connections,
settles its long-poll waiters (`events:wait`, `gate:wait`) with their
normal empty reply so those clients reconnect, lets other in-flight
requests finish for a few seconds at most, then exits. launchd's
`ExitTimeOut` is 30s, so the drain cap stays well under it. The stale
"5s" comment in `lib/daemon/shutdown.ts` is corrected.

Sessions already running keep their old client code until
`/reload-plugins` or a new session, so the first restart after this
ships is not covered for them.

**Busy check.** Decided by Matt: an automatic update waits while the
daemon is doing work a restart would cut off. The daemon gains a verb
that says whether it is busy: a worktree provision or install in
progress, or a long request in flight (job traces,
`worktree:stop-holders`). Parts 2 and 3 ask it before they install.
While it is busy the update holds with the reason "daemon busy", shown
in telemetry, and is retried each minute. There is no time limit. A
daemon that does not answer counts as not busy, so a dead daemon never
blocks the update that would fix it (my call). A restart done by hand
does not ask.

### Part 2: prod installs at once, silently

Decided by Matt: install and relaunch as soon as the download finishes,
with no prompt, no countdown and no snooze, with windows open.

- `SUAutomaticallyUpdate` becomes true, in `Info.plist` and wherever
  `build.sh`, `check-bundle.sh` and the generated plists assert it.
- `UpdatePolicy.hold` no longer holds for open windows. Two things hold
  an update: a running setup (my call: a relaunch would kill a setup run
  partway) and a busy daemon (part 1's busy check). `HeldUpdateInstaller`
  keeps retrying each minute until both clear.
- Decided by Matt: the "Check for updates automatically" switch in
  Settings (`rt-tray/Sources/Settings/GeneralPane.swift`) is removed. A
  Mac that had turned it off is switched back on at the next launch.
  There is no opt-out, in prod or dev.
- Sparkle's update window no longer opens for a scheduled check. The
  "Update Available" menu item and the `app_update` notification after
  the relaunch stay.
- `SUScheduledCheckInterval` becomes 3600 (my call: with silent installs
  the interval is the rollout speed).
- The app reopens the windows that were open before the relaunch (my
  call). Nothing does this today, so the tray records which windows are
  open when the install starts and reopens them on the next launch.
- `app-update.json` and the telemetry page keep reporting the last
  check, the offered version, and a held version with its reason.

### Part 3: dev Macs update themselves, with guardrails

Decided by Matt: the dev update is automatic, guarded, and all or
nothing; a held update notifies the person.

The daemon checks once an hour for a newer release with a dev app, the
same lookup `rt dev update` uses. A dev app built on this Mac is skipped,
as today. When a newer one exists, it checks the clone:

1. The clone's current branch is `main`.
2. `main` has no commits that `origin/main` lacks, so a pull can only
   fast-forward.
3. No uncommitted or staged changes, and no merge or rebase in progress.

Work in other worktrees does not count (my call: rt and the daemon run
from the main clone only).

4. The daemon is not busy (part 1's busy check).

- **All pass:** fast-forward the clone to `origin/main` (my call: main,
  not the release tag, since dev Macs follow main). Then make the pulled
  tree runnable: rerun every step of `rt dev setup` whose result depends
  on the tree's contents, which `rt dev update` does not all do today.
  `bun install` (whose postinstall builds the rt-client, settings-kit
  and tui-kit `dist/` folders) is one; the builder lists the rest from
  `lib/dev/setup.ts` (my call). Then run the stages `rt dev update`
  runs. The dev app relaunches and the daemon restarts last, protected
  by part 1, so the old daemon is not left running over a half-built
  tree for longer than those steps take.
- **Any fails:** nothing changes. The person gets one notification per
  waiting version, saying an update is waiting and which check held it.
  The next hourly check tries again.
- A failure partway (the pull worked, a stage failed) is reported the
  same way, with the failed stage named.

The held reason reaches the telemetry page the way prod's does, so a
dev Mac that is behind shows why.

`rt dev update` stays as the manual path and gains the same guardrails'
wording when it reports a clone it will not pull. It still installs the
app when run by hand (my call: a person who types it has decided).

## Left to the builder

- Backoff values, the exact retry budget, and which error codes count as
  "connection not made".
- How held requests are queued during early bind.
- The drain cap, within the limits above.
- How the tray records and reopens windows.
- Where the hourly dev check lives in the daemon and how it avoids
  running while a previous one is still going.
- Tests. `AGENTS.md` names the suites; the e2e and pty gates cover the
  daemon socket and must stay green.
- Docs: `docs/release-and-distribution.md` (Sparkle / updates) and the
  dev setup docs describe the old behavior and need rewriting.
