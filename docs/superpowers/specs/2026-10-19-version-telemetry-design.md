# Version telemetry

## Why

When Matt ships a breaking change, or wants to delete compatibility code,
there is no way to know who is still on an old version except asking. The
code already guesses in places: `SHARED_STORE_MIGRATIONS` in
`lib/setup/migrations/index.ts` keeps a migration because it is "recorded
done on most Macs". This replaces the guessing with a readout.

The question the readout answers: **who is on what, and am I okay to retire
the code that protects an old version?**

## Goals

- Every Mac running the rt daemon reports what it runs, hourly.
- One plain page on the switchboard relay shows who is on what and when each
  Mac was last seen.
- Matt can tell from the page whether a Mac is running right now.

## Non-goals

- No styling or charts. A plain HTML table is the whole UI.
- No usage tracking: no commands run, apps opened, repos, hostnames or file
  paths. Only the fields listed below.
- No alerts or notifications.

## Anti-goals

- Anyone other than the switchboard admin can see the page.
- Telemetry failing (relay down, offline Mac) produces a warning, a log
  line the user sees, or a retry storm. It fails silently and tries again
  at the next tick.

## What the daemon sends

A ping on daemon start and then every hour while it runs.

| Field | Source |
|---|---|
| Install id | A random id generated once per daemon flavor and stored on the Mac. Always sent. |
| Usernames | The forge usernames this Mac recorded at `rt team join` / `rt team create`, one per team (`forgeUsername` is stored per team). Empty for a Mac in no team. |
| App version | The mattstack.app bundle version |
| rt version | rt's own version |
| Plugin version | The installed mattstack plugin version |
| Flavor | prod or dev |
| macOS version | |
| Setup migrations | The ids recorded in `setup-state.json`'s migration ledger (`SetupState.migrations`, a plain list; done and skipped are indistinguishable and that is fine) |
| Known migrations | The ids this rt ships in `MIGRATIONS`, so the relay can tell "not run yet" from "rt too old to know it" |
| Legacy folders | The result of `legacyDirsPresent()` (`lib/rt-paths.ts`): which of `~/.rt` / `~/.shepherdr` still exist |
| Org layouts | For each org this Mac reads (`discoverOrgs()`), its name and `layout` (`lib/team/org-marker.ts`); empty for a Mac in no team |
| Pack versions | Each synced team pack and its version |

The first ping after an update must arrive within minutes of the update.
The daemon-start ping covers this if an app update restarts the daemon on the
new version; the builder confirms that against `rt-tray/Sources/DaemonLifecycle.swift`
and `Updates/UpdaterController.swift`, and if it does not, the daemon also
pings when it sees its own version change.

**Auth:** a Mac that holds a board token sends it, read the way the board
reads it (`readBoardSwitchboardToken`, `lib/team/board-token.ts`: the board's
`.env` first, then rt's `switchboardToken` secret). The relay marks the
username that token belongs to as verified. A Mac without a token still sends
its self-reported usernames; the page shows them as unverified. The ping
endpoint accepts unauthenticated pings.

## Opting out

- A new user-scope setting `telemetry.enabled`, default `true`, registered
  through the settings resolver (see the `rt:settings` skill).
- When it is `false` the daemon sends nothing.
- On the first daemon start that would send, rt shows a one-line notice once
  saying version telemetry is on and how to turn it off.

## What the relay keeps

Lives in the relay at `apps/board/switchboard/`, in its existing sqlite
database (`SWITCHBOARD_DB`), as a new table beside `store.ts` and
`team-invites.ts`.

- One row per install id holding the latest ping and its time. Prod and dev
  daemons on one Mac are separate rows; one person with two Macs is two rows.
- An update history: each time a Mac's app or rt version changes, append the
  old version, new version and when.
- A Mac that has not pinged for 90 days is dropped, history included.

## The page

`GET /telemetry` on the relay, authorised by `SWITCHBOARD_ADMIN_TOKEN`
(the same token the admin routes use). Plain HTML, no JS needed.

1. **Macs:** one row per install id, labelled by username (verified or
   not) or by install id when there is none. App, rt, plugin, flavor, macOS,
   org layouts, packs, last seen. A row seen in the last hour is marked
   running.
2. **Versions:** one row per app version and per rt version: how many Macs
   are on it, and when it was last seen.
3. **Retirement checks:** for each setup migration id, which Macs have not
   recorded it, split into "knows it, not run" and "rt too old to know it"; which Macs still have legacy folders; which Macs read each
   org layout; for each pack, the oldest version still in use.
4. **Recent updates:** the update history, newest first.

How Matt opens it with the token (a browser URL with the token, a header
via an `rt` verb that opens it, etc.) is the builder's call; keep it simple.

## Calls made in drafting (not Matt's; flagged for review)

- Rows key on install id, with username as the label, so two Macs or two
  flavors never overwrite each other.
- Self-reported usernames are shown, marked unverified, rather than dropped.
- 90-day expiry, plain-table page, and silent failure on a missed ping.
- Pings on daemon start as well as hourly.

## Left to the builder

- The ping endpoint's path and payload shape.
- Where in the daemon the hourly timer lives.
- How the install id is stored.
- Exact page markup.
