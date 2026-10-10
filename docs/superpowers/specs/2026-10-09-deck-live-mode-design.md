# Deck live mode

Status: design approved in brainstorming, 2026-10-09. Next step: implementation plan.

## Problem

In the dev app, deck runs each mattstack app from the shared checkout, but as a
built production server: `dev.start` is a plain `bun src/server/index.ts` that
serves a prebuilt `dist/`. Nothing reloads. Every change needs the row's deploy
button (build, then `deck restart`). Running your own dev server beside it does
not work well either, because deck holds the app's port and address.

There is also no way to try a branch in the real dev app without merging it.

## Outcome

- Turn on live mode for one app from the deck board or the CLI.
- Pick the code it runs: the shared checkout (main) or one of your worktrees.
- Edit a file there and see it in the app at its normal `<name>.mattstack`
  address within seconds, with no deploy step.
- Turn live mode off and the app is back exactly as it was.

## Scope

- Dev app only. In prod deck the controls do not render and the manifest's
  `live` entry is ignored.
- Mattstack's own apps only (`managedBy: rt`): board, console, chat, boxscore.
  Deck itself never goes live (it is the control panel, the same reason it
  cannot take a port override). User apps never go live.
- Live mode is per app. There is no global "run every app from this worktree"
  switch.
- Live from a worktree uses your real app data. Accepted risk; the form says so.
- The rt daemon always runs main. A branch that needs new daemon behaviour will
  not fully work live. Known limit, not handled.

## Manifest: the `live` list

Each app declares its live setup in `mattstack.deck.json` as a list of
processes. Deck does not care what tool each one runs.

```json
"live": [
  { "kind": "server", "start": "bun --watch src/server/index.ts" },
  { "kind": "ui",     "start": "vite --port $PORT --strictPort" }
]
```

| kind     | count        | port                              | what deck does                                   |
| -------- | ------------ | --------------------------------- | ------------------------------------------------ |
| `server` | exactly one  | the app's normal port, as `$PORT` | runs it; health is its port answering            |
| `ui`     | at most one  | a spare port deck picks, as `$PORT` | runs it and points `<name>.mattstack` at it; health is its port answering |
| `worker` | any number   | none                              | keeps it running; health is the process running  |

Every process also gets `$SERVER_PORT` (the server's port), so a `ui` process
can reach the API without assuming a number.

Validation joins `readDeckManifest` (`apps/deck/src/registry/deck-manifest.ts`):
no `server`, more than one `server` or `ui`, an unknown `kind`, or an empty
`start` makes the entry broken. A broken entry disables the row's go-live
button with a tooltip naming the problem; the rest of the manifest still loads.

### Per-app entries

- chat, console, boxscore: a `server` (`bun --watch src/server/index.ts`) and
  a `ui` (`vite --port $PORT --strictPort`).
- board: one `server`, `caffeinate -s bun --watch src/server.ts`. Board's server
  already rebuilds its client bundle on every client edit and tells open pages
  to reload (`watchClientAssets` in `apps/board/src/client-assets.ts`), so it
  needs no `ui` process.

### Shared Vite preset

`mattstackVite` (`packages/ui/presets/vite.js`) changes in two ways:

- the `/api` and `/ws` proxy target reads `$SERVER_PORT` when set, falling back
  to `apiPort`;
- `server.allowedHosts` accepts `.mattstack` and `.localhost`, so Vite answers
  requests routed in by portless.

## Going live and back

**On.** For an app with a valid `live` entry and a chosen source folder:

1. If the source is a worktree that needs setup, prepare it (see below). The
   app keeps running its normal process the whole time.
2. Stop the app's normal service.
3. Start one launchd service per `live` entry, with the working directory set
   to `<source>/apps/<name>`.
4. If there is a `ui` entry, point the route at its port through the existing
   port override path (`setRoutePort` and `setOverride` in deck), owned by live
   mode.
5. Record the live state on the app's settings entry, beside `override`:
   `{ source, startedAt }`.

**Off.** Stop the live services, restore the route through the override's
captured `basePort`, clear the live state, and start the normal service again.
Nothing about the normal service (its dev link, its installed plist) is touched
while live, so off is a clean return.

**Switch code.** Stop the live services and start them again from the new
source. The route move stays in place.

**Persistence.** Live state survives a deck restart and a reboot. The boot
sweep (`reresolveManagedApps`) re-creates live services for any app whose
live state is set, rather than its normal serve unit.

**Interplay with existing features.**

- While live, the manual dev-port override is unavailable for that app; live
  mode owns the route.
- The "new code" offer and the redeploy and build buttons hide for a live app;
  its version cell reads "current".
- `rt release update-machine` re-registers the normal dev link only. It does not
  touch live state, so a release cannot knock an app out of live mode.

## Choosing the code

The source list is main (the shared checkout, always first) and then rt's
worktrees for this repo, ordered by last use. Deck reads them from rt (the same
data `rt worktree list --json` prints: `path`, `branch`, `kind`, `readyAt`,
`lastActiveAt`). It leaves out the golden tree and the spare trees rt keeps
ready to hand out (non-claimed `kind`s), since rt could hand one away mid-session.

A worktree **needs setup** when rt has not marked it ready (no `readyAt`). Setup runs in that worktree: install
packages (the root `postinstall` builds the shared workspace packages too).
No app build is needed, since live mode runs source. Setup output streams to
the row and is kept for the failure modal.

A worktree that **disappears** while an app is live from it (disposed after a
merge, say) moves that app to live from main on the next reconcile tick. The
row's source button shows a warning with the tooltip
"<branch> was deleted. Now live from main."

## Board UI

Design boards: `deck new.pen`, rows L1 to L6 (light), with dark copies below.

- **L1 · A · Live column.** A LIVE column to the right of PUBLIC. A non-live
  mattstack app shows a "go live" button. A live app shows a source button: the
  live icon, then `main` or the branch name, then a chevron. Deck's own row and
  user apps show nothing. The subline adds "N live". The redeploy strip counts
  only non-live apps.
- **L2 · Go-live form.** "go live" opens a modal: "Run <app> live", a
  "Code to run" select (main picked by default), help lines under it
  ("Needs setup first." when that applies, "Worktrees use your real data." for
  any worktree), and Cancel / Go Live.
- **L2b · Worktree list open.** The select opens a searchable list: a search
  box, main pinned, then worktrees one per line by last use, marking only the
  exceptions ("needs setup", "<app> is live here"). Choosing a row fills the
  select; Go Live submits.
- **L3 · Live app's modal.** A live app's source button opens "<app> is live":
  the same select on the current source, "Running since <time>", Stop Live on
  the left, Cancel and Switch on the right (Switch disabled until the pick
  changes).
- **L4 · Row states.** Setting up (amber badge with spinner, normal app still
  running); starting; setup failed (red badge that opens L6); live with a
  process down (health badge names it, "server down" or "ui down"); worktree
  deleted (moved to main, warning on the source button); broken `live` entry
  (go live disabled, tooltip names the problem).
- **L5 · App settings while live.** The Code block shows the live source with
  Change code and Stop Live, in place of deployed, redeploy, build, relink and
  unlink. A new "Live processes" block lists each process: kind, command, port,
  status and a logs button. The Port block shows Assigned plus "Live UI <port>"
  when there is a `ui`, in place of the dev override input.
- **L6 · Setup failed modal.** "Couldn't set up <branch>", a line saying the app
  is still running its normal code, the last lines of setup output, then Full
  log, Dismiss and Try Again.

The searchable select in L2 and L2b is a new tui-kit recipe (the kit has
TextField, TextArea and RadioGroup, no select), composed from Popover,
TextField and ScrollPane.

## CLI and API

```
deck live                                  list live apps and their sources
deck live <app> on [--worktree <branch|path>]
deck live <app> off
```

Each takes `--json`. `on` without `--worktree` runs main. `on` while already
live switches the source. The board and the CLI share the API routes
(`GET /api/v1/live`, `PUT /api/v1/apps/:name/live` with `{ source }`,
`DELETE /api/v1/apps/:name/live`), gated by `canManage` and dev mode like the
other mutating routes.

## Known gaps

- **Reload through the address.** Vite's reload socket has to pass through
  portless for `<name>.mattstack`. This is proven first, before any other
  work; if it fails, live mode for the Vite apps does not work as designed.
- **Front-door behaviour.** While live with a `ui`, page loads go to Vite, so
  the app server's `.localhost` to `.mattstack` redirect and the hand-off into
  the app window do not run for them. Accepted while editing.
- **Public traffic.** The tunnel keeps sending public visitors to the app's
  server port, never to the live UI.

## Testing

- Unit: manifest `live` parsing and its errors; the on, off and switch state
  changes against deck's fake service manager; the route move and its restore;
  the disposed-worktree fallback; boot re-creating live services.
- Board: `core/board` tests for the LIVE cell states and both modals; the
  `core/generated` bundle regenerated.
- In the dev app: chat live from main and from a worktree, edit a client file
  and a server file and see each update; board live; stop live and confirm the
  normal service is back on its port. Screenshot the board in light and dark.

## Not yet decided

- "Running since" in L3 needs `startedAt` recorded; kept in the design above,
  drop it if it is not worth the field.
- Board `L1 · B` (live as a row action) was the rejected option; delete it from
  the canvas once this spec is approved.
