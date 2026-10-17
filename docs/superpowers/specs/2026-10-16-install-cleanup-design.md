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

- rt finds an existing clone of the repo (the repo index, then direct
  children of the configured repo roots, the same search `repos.clone` runs
  today in `findExistingClone`): **Current checkout**, path filled in.
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

The page's footer counts what is left ("Every repo has a place. Install
clones acme-api.").

### What rt does with the answers

- **Current checkout**: rt records the path in the repo index
  (`rt repos register` semantics) and never clones.
- **New checkout**: `repos.clone` clones into exactly that path.
- `rt.repoRoots` is no longer asked for. rt derives it from the parent
  folders of the placed repos (deduplicated), so `rt cd`, `rt repos locate`
  and the clone step's existing-clone scan keep working. A root the member
  set by hand is kept.
- The single "Repo folder" row (`repos.root`) and `rt setup repo-root set`
  are retired in favour of the new rows and a per-repo verb (name left to
  the builder, e.g. `rt setup repo place <repo> --checkout <path>` /
  `--clone-to <path>`). The app answers a row through that verb, like every
  other row; no decision lives in Swift.
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
In an interactive run, `repos.clone` clones nothing for a repo the member
has not answered and has no existing clone of; it reports `needs-you`
("Choose where your repos go"), the rest of Install carries on, and the
"Your repos" rows show on the post-Install summary, finish-gated, with the
same controls. Answering a row and retrying runs `repos.clone` again. A
repo rt finds an existing clone of is placed without asking. A
non-interactive run uses the defaults and never stops. The builder confirms
the engine lets the steps after a `needs-you` outcome run (`intercepts.install`
and `board.keys` read the repo index `repos.clone` fills) and adjusts the
ordering note in `lib/setup/steps/index.ts` if it does not.

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

- Setup turns on the active team's own pack for a member when it installs
  it, through the same single enable site trusted plugins use
  (`enableTrusted`).
- `rt setup update` (the unattended run at app launch) keeps today's rule:
  a pack the member turned off themselves stays off.
- A dated `MigrationDef` turns on, once per Mac, every team pack rt itself
  installed (it is in setup-state's `plugins` record) that is currently
  turned off. Without it, every member who joined before this change stays
  off forever, because the update run reads rt's own disable as the
  member's choice.
- The "awaiting your approval to enable" log line and step-detail note go
  away.

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
   - environment = the member's login-shell environment (rt's existing
     login-shell PATH probe), with `RT_BATCH`, `HERDR_SOCKET_PATH` and
     `HERDR_PANE_ID` removed and `HERDR_MACOS_SERVER_CONTEXT=user` set.
     Any other `HERDR_*` the member set stays. That env becomes every pane
     shell's env, which is why the PATH and `RT_BATCH` matter. Without the
     `user` context, a server started from an app or daemon is killed when
     that process goes away.
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
