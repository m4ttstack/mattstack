# Install cleanup: repos page, team pack, dev logins, token scopes, herdr

A member's first install of mattstack.app hit five problems in one sitting.
This design fixes them together as one cleanup PR. The names below
(`acme`, `widgets`, `acme-api`) are placeholders.

Mockups: `docs/apps/design/setup/setup.pen`, boards "R · Your repos" and
"R · Install: Clone your repos with git's progress".

## 1. Your repos: one row per tracked repo

### Why

Setup asks one question, "Repo folder", and clones every tracked repo into
`<folder>/<repo>`. A member picked an existing checkout of one tracked repo
as that folder. `rt setup repo-root set` accepted it, and Install cloned
every tracked repo inside that checkout. Asking for a parent folder is the
confusing part: people answer with the repo they already have.

### What the member sees

A wizard page, "Your repos", with one row per tracked repo (every org, no
team-specific copy). Each row shows the repo's name and host, and a two-way
segmented control:

- **Current checkout**: "I already have this repo; here it is." The path
  field shows the checkout. The button is **Locate…** (a folder picker).
- **New checkout**: "Clone it for me, here." The path field shows the exact
  folder the clone will become (`~/code/acme-api`). The button is
  **Choose location…**, a save-style panel prefilled with the repo's name, so
  the member picks the final folder, never a parent.

A row is always in one of the two states; there is no unanswered state. rt
picks the starting state before the page shows:

- rt finds an existing clone of the repo: **Current checkout**, path filled
  in. The search is `findExistingClone`'s (the repo index, then direct
  children of the configured repo roots), widened to the direct children of
  `CANDIDATE_ROOT_NAMES` under home (`Documents/GitHub`, `GitHub`, `code`,
  `src`) and the repo index's inferred roots. On a new Mac there are no
  configured roots and the index is empty, so without the widening a member
  who already has `~/code/widgets` would be shown New checkout.
- Otherwise: **New checkout**, destination next to the member's other
  checkouts (the common parent of the rows already on Current checkout);
  with nothing to go by, `detectCandidate()`'s folder joined with the repo's
  name.

Copy per row state:

| State | Icon | Note under the path |
|---|---|---|
| Current checkout, valid | green check | Found your widgets checkout |
| New checkout | blue download | rt clones it here when you click Install |
| Current checkout, not a checkout of this repo | red alert | see below |

A **Locate…** pick counts only when it is a clone of that repo, judged by
its own `origin` (the existing `isReusableCloneOf` check). Otherwise the row
stays on Current checkout with the problem in red and the button reads
**Locate again…**:

- a folder that is not a git checkout but holds repos: "~/code holds repos
  but isn't one. Choose the widgets folder inside it."
- a checkout of another repo: "~/code/widgets is your widgets checkout, not
  acme-api."
- any other folder: "~/foo isn't a git checkout."

A **Choose location…** pick that already exists and is non-empty is
refused with "~/code/acme-api already exists. Choose an empty or new
folder."

The page keeps the checklist's generic footer (the mockup's footer copy is
illustrative; a page-specific footer would need a new contract field).

### What rt does with the answers

- **Current checkout**: rt records the path in the repo index
  (`rt repos register` semantics) and never clones.
- **New checkout**: `repos.clone` clones into exactly that path.
- `rt.repoRoots` is no longer asked for in the app. When `repos.clone`
  places a repo (found, located or cloned), it appends that repo's parent
  folder to the machine store's `rt.repoRoots` if absent. Append-only: it
  never removes or reorders an entry, so a root set by hand (or by an
  earlier setup) stays first. `rt cd`, `rt repos locate` and the
  existing-clone scan keep working.
- The single "Repo folder" row (`repos.root`) is retired in favour of the
  new rows and a per-repo verb (name left to the builder, e.g.
  `rt setup repo place <identity> --checkout <path>` / `--clone-to <path>`).
  The app answers rows through that verb, like every other row; no decision
  lives in Swift. `rt setup repo-root set <folder>` stays as a CLI verb:
  `rt dev setup` clones into `rt.repoRoots[0]` and its `dev-no-repo-root`
  error names that verb, and a Mac whose team tracks no repos has no other
  way to set a root.
- A row's answer is its placement, recorded only when the member uses the
  row. An untouched row has no placement, and `repos.clone` computes the
  same default the row showed (one shared function produces both), so what
  the member saw is what happens.
- Answers given before Install are staged the way the repo root is today
  (`~/.mattstack/rt/repo-root.json`): the machine store lives inside the
  home repo, which does not exist until `home.init` clones it. The clone
  step promotes the staged answers.
- A CLI install (`rt setup apply`) with no answers falls back to the
  defaults above; it never blocks.

### A joiner does not know the tracked repos before Install

A member joining by invite has no team clone until Install's `team.join`
runs, so the tracked list (and the rows) cannot render before Install.
Today's `repos.root` row covers this by asking for a folder up front.

Design call (made without the operator; flagged in the PR): the rows render
whenever the tracked list is known. For a joiner that is after `team.join`.

`repos.clone`, per tracked repo:

1. A recorded placement: honour it.
2. No placement, but an existing clone found (the widened search above):
   use it.
3. No placement, no clone, a joiner's run (the setup intent's mode is
   `join`, so the rows could not have been shown) that streams to the app
   (`rt setup apply --json`, the app's NDJSON channel; `setupApply` passes
   that into the context as a new `appDriven` flag): clone nothing for that
   repo and report `needs-you` ("Choose where your repos go"). The rest of
   Install carries on; the "Your repos" rows show on the post-Install
   summary, finish-gated, with the same controls. The deferral is recorded
   in rt's placements file, so it outlives the setup intent. Answering a
   deferred row records the placement and then the app runs the row's
   follow-up verb (`rt setup apply --only repos.clone`), which rt names in
   the row; the row stays finish-gated until the repo is in the index.
   That retry clones only answered repos: an unanswered deferred repo stays
   deferred. A deferred row offers "Clone here" to accept the shown
   location in one click, and "Retry" with the reason after a failed
   clone. After Install, switching the segment only flips the view; a
   clone starts only from an explicit pick or button, so a set-up Mac
   never starts a large clone from one segment click. rt sets which
   buttons show; Swift only renders them. Any answer given after Install carries the same
   follow-up, so a re-located checkout is indexed right away.
4. No placement, no clone, any other run (a member who saw the rows, a
   terminal `rt setup apply`, a `--non-interactive` run, CI): clone to the
   default destination. A terminal run never stops on this.

The engine already lets steps after a `needs-you` run (only `failed` stops
a run). `repos.clone` has `feedsIntercepts`, so a retry re-queues
`intercepts.install`; `board.keys` is update-safe and writes on the next
launch.

`ctx.need` (asking the app mid-Install) was considered and not used: it
would need a new need type and a new mid-Install screen, while the summary
already renders setup rows.

### Clone progress

The big clone looked hung: nothing moves until each clone finishes.

- `repos.clone` runs `git clone --progress` and parses git's phase lines
  ("Receiving objects: 42% (…), 1.21 GiB | 18.4 MiB/s", "Resolving deltas",
  "Updating files").
- Setup's NDJSON stream gains one event:
  `{ "event": "progress", "id": "repos.clone", "label": "Receiving objects", "percent": 42, "note": "1.21 GiB · 18.4 MiB/s" }`.
  Older apps decode an unknown event as `.unknown` and ignore it
  (`ApplyEvents.swift`), so this is additive.
- The app's Install screen shows, under the running step: the step detail
  ("Cloning acme-api (2 of 2) · widgets was already on this Mac"), a linear
  progress bar, and a label line (phase and percent left, size and speed
  right). The bar refills for each git phase.
- `rt setup apply` at a terminal shows the same as a sub-line under the
  running step; the step emitter throttles updates (a builder's call, e.g.
  no more than a few per second).
- The stall guard (`CLONE_STALL_ARGS`) and the one-hour backstop stay.

## 3. A member's team pack is turned on

### Why

Setup installs a team-authored pack and then deliberately turns it off
(`settlePack` in `lib/setup/pack-cache.ts`), waiting for the member to run
`claude plugin enable`. The pack row still reads `ready`; the only signal is
a log line. The board then could not resolve the pack's review skill and
launched the agent without it.

### Fix

This reverses, for one plugin, the earlier rule that a joined team does
not get to grant itself execution (`2026-09-07-pack-cache-sync-design.md`,
the org-and-teams design's "installed, never auto-enabled"). The operator
ruled it on 2026-10-16: joining a team is the consent. Both earlier docs
get a one-line note pointing here.

Scope is the **active team's own marketplace pack** only. Org- or
team-listed `claude.plugins` entries stay as today (installed, off). The
previous team's pack, which `rt team use` turns off, stays off.

- Setup turns the active team's pack on when it installs it, through the
  same single enable site trusted plugins use. `enableTrusted` is a closure
  inside `pluginsInstallRun` today; it moves out to a module function so
  the migration and the daemon path can share it.
- The daemon's pack sync (`convergePackCache`, called from
  `lib/daemon/team-snapshots.ts`) does the same for the active team's pack
  it newly installs, so a pack first served after the member joined lands
  on too.
- `rt setup update` (the unattended run at app launch) keeps today's rule:
  a pack the member turned off themselves stays off.
- A dated `MigrationDef` turns on, once per Mac, the active team's pack
  when it is installed and off. It is the one-time correction for members
  who joined before this change, whose pack rt itself left off; the update
  run would otherwise read that as the member's choice forever.
- The "awaiting your approval to enable" log line and step-detail note go
  away for that pack.

## 4. The dev-login sheet

### Why

The Add sheet asks for the site, then "Type <host> to confirm". Typing the
full URL there left Save disabled with no hint.

### Fix

Fields, top to bottom:

- **Site** (only on Add; a link or Edit shows the site as a heading, as
  today)
- **Email**
- **Password**
- **Confirm password**

"Type <host> to confirm" is removed, with `DevLoginConfirm`'s host check.
The operator ruled this on 2026-10-16. `2026-09-28-dev-logins-design.md`
listed the typed host as the defence against a crafted `mattstack://` link
or a lookalike page getting a site approved in one click; the remaining
defences are the site shown as the sheet's heading, the lookalike-name and
plain-http warnings, and typing the password twice (no one-click save).
That doc's threat model gets a note pointing here.
Save is enabled when the site is valid, the email is not blank and the two
passwords match. While they differ (and the confirm field is not empty), a
line under it reads "Passwords don't match". Confirm password is asked on
every save, Add and Edit, because an Edit replaces the saved password. The
lookalike-name and plain-http warnings and the replace caption stay.

## 6. GitLab token link scopes

The GitLab new-token link (`tokenCreateLink`) pre-checks only `api`. It
pre-checks six: `api`, `read_api`, `read_user`, `read_repository`,
`write_repository`, `ai_features`.

The scope check after a paste (`missingScopes`) and the field hint still
require only `api`, so no working token turns red. `lib/setup/token-create.ts`
therefore keeps two lists for GitLab: the scopes rt requires, and the
scopes the link pre-checks. `api` already grants git over HTTPS, so the
repository scopes are extras; no copy may say git needs them.

## 7. Making sure herdr is running

### Why

Board reviews launch agents in herdr. When the herdr server is not running
the launch fails, and nothing starts it.

### One launcher

A shared routine in `lib/herdr/` and a hidden verb, `rt herdr start`
(`hidden: true`, `omitBehavior: { exempt: "why" }`, `--json`), that:

1. Pings herdr's API socket (`~/.config/herdr/herdr.sock`, or
   `HERDR_SOCKET_PATH` / `XDG_CONFIG_HOME` when set). A reply means running:
   done. A socket file that refuses connections is a leftover, not a server.
2. Resolves the herdr binary with rt's existing resolver (`resolveHerdrBin`).
   Absent: returns "herdr isn't installed" with a pointer to Setup; starts
   nothing.
3. Starts `herdr server` the way herdr's own client does:
   - fully detached in its own session (setsid), stdin/stdout/stderr on
     `/dev/null`, cwd = home;
   - environment, built from scratch, never the caller's whole env (the
     callers are the daemon under launchd, the app, and a terminal, and
     whatever the server gets becomes every pane shell's env):
     - the keys `bg-service.ts`'s `seededEnv()` takes from a login shell
       (PATH, HOME, SHELL, TMPDIR, LANG), plus USER and LOGNAME;
     - every `HERDR_*` in the caller's env except `HERDR_SOCKET_PATH` and
       `HERDR_PANE_ID`;
     - `HERDR_MACOS_SERVER_CONTEXT=user`, set last.

     `RT_BATCH` and every other rt, daemon or app variable are left out by
     construction. Without the `user` context, a server started from an app
     or daemon is killed when that process goes away.
4. Polls the ping until a reply, up to about 10 seconds.

Concurrency: one start in flight per process (callers share it), plus a
short cooldown after a failed start. A race across processes is safe:
herdr refuses a second server ("herdr server is already running", exit 1);
the routine treats that as running and re-pings.

Never: a launchd agent or KeepAlive owning herdr (a live `herdr update
--handoff` exits the old server, and launchd would start a duplicate);
`herdr server stop` as a recovery (it kills every pane); running the server
in the foreground and waiting on it. Tests never start a real herdr; the
launcher takes the usual exec/probe seams.

Reference: flock's `HerdrServerLauncher.swift` (about 50 lines) does exactly
this; success shows in `~/.config/herdr/herdr-server.log` as "server using
persistent user service context".

### Who calls it

Only paths that start agents or panes:

- the daemon's `agent:start` / `agent:resume` (covers `rt agent`, board
  reviews, herds, and `rt agent`'s in-process fallback);
- the daemon's herd spawn;
- the board's and gitq's direct herdr launches (legacy resume, doctor,
  respond, gitq launches), through a new daemon verb (e.g. `herdr:start`)
  in rt-client, since the apps do not import rt's `lib/`;
- mattstack.app at launch: once services settle, the app runs
  `rt herdr start --json`, the same way it runs `rt setup update`. It skips
  while setup is not finished. herdr not installed: nothing new is shown;
  setup's required `tool.herdr` row already says it is missing.

Read-only and typing paths never start herdr: pane lists, chat's roster,
the app's pane list, status pollers, and typing into a pane. They keep
reporting "not running" as they do today.

### Side fixes found while mapping

- The board and gitq resolve herdr only at `HERDR_BIN` or `~/.local/bin`,
  so a Homebrew herdr makes their launches throw ENOENT. They take the
  binary path rt resolves (through the daemon verb's answer, or the same
  lookup order).
- The app's `HerdrBridge.checkAvailable` treats a leftover socket file as
  running. It pings instead.
- rt's background herdr server (`lib/daemon/bg-service.ts`) starts through
  `nohup` without the `user` server context, so it can die with its parent.
  It moves onto the shared launcher (keeping its own `bg` socket and
  session), keeping its spawn cooldown, in-flight dedupe and ready poll.

## Calls made without the operator

The operator handed this over to run unattended. These were settled from
the builder check and are listed in the PR for review:

- A joiner's unanswered repos: `needs-you` plus summary rows in app runs,
  defaults in terminal runs (section 1).
- An untouched row means "the default it showed"; only a joiner's app run
  defers an unplaced repo.
- The existing-clone search widens to the candidate root folders.
- `rt.repoRoots` is appended to, never rewritten; `rt setup repo-root set`
  stays as a CLI verb.
- Turning the pack on covers only the active team's marketplace pack, the
  daemon's pack sync included; the migration targets only that pack.
- herdr's environment is built from scratch, not inherited.

## Dropped

- `board.cwds` going stale: the repos page prevents the bad path that
  caused it.
- Cloning the org's own repo: it was on the tracked list by a config
  mistake, already corrected; rt never adds it there itself.

## Constraints

- Public repo: placeholders only in code, tests, fixtures and the PR body.
- Setup row contract changes need the Swift side (`PlanModels.swift`,
  `ApplyEvents.swift`); NDJSON shape changes are additive only.
- Everything rt prints goes through the output layer; copy follows the
  command-description style (`.claude/rules/output-layer.md`,
  `.claude/rules/output-setup-and-services.md`).
- A migration changes only this Mac (`.claude/rules/setup.md`).
- Targeted tests only locally; UI changes are checked in Fast Browser or by
  rendering the app in both schemes before they count as done.
