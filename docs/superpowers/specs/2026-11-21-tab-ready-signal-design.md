# Tab ready signal: a window tab is loaded only when its app says so

## Intent

On 2026-11-21 the board tab in the mattstack window drew with no styles after
`rt release update-machine` replaced the dev app, and stayed that way until a
manual reload. PR #1200 was meant to fix this and did run: it reloaded the tab
after 2, 5 and 10 seconds, then gave up. The board stayed broken for 2m40s.

The fix was a guess about duration. The window infers a tab's health from
negative evidence (WebKit said "finished", so look for empty stylesheets, so
retry for a while). This design removes the guessing: the app states that it
is ready, the server is honest about whether it can serve, and the window
waits on those conditions.

## What happened, as evidence

- 19:42:55 update-machine's dev-bundle leg swapped `/Applications/mattstack-dev.app`
  and relaunched the tray. The version read "unchanged", so the tray did not
  restart served apps.
- The running board process had been started from the old bundle's
  `Helpers/bun`. With that bundle deleted it lost its privacy grants and got
  `EPERM` reading `apps/board/src/style.css` under `~/Documents`
  (`~/.mattstack/deck/logs/board.err.log`). The cause is already written down
  at `lib/release/update-machine.ts`, in `runDevAppRebuild`.
- The board serves `/` and `/app.css` from memory but reads `/style.css` from
  disk on every request in dev (`apps/board/src/server.ts`, the `/style.css`
  case). So the page loaded and its stylesheet failed.
- 19:43:13 the tray logged "window stylesheet still failing; leaving the tab
  as it is" (`~/.mattstack/rt/logs/tray.2026-11-21.log`).
- 19:45:36 update-machine's served-suite leg restarted the board. Nothing
  reloaded the tab.

## Goals

1. A tab counts as loaded only after its page reports ready.
2. A tab that is not ready reloads when its app is healthy, with no retry
   budget and no fixed delays.
3. A served app answers a page completely or not at all, the same way in dev
   and packaged, and its health check says which.
4. Replacing the dev bundle restarts what ran from the old bundle at once.
5. #1200's stylesheet probe and timed retries are deleted.

## Non-goals

- Reloading a ready tab automatically because its app moved to a new build.
  The window shows a notice with a Reload button instead (section 5).
- A deck event stream. The window's health check sits behind one seam so a
  stream can replace the check loop later. Follow-up ticket.
- New window UI beyond the new-version notice. The existing loading and
  failure overlays are reused.

## Anti-goals

- A tab that reloads in a loop.
- A working tab that reloads under the user.
- An app that is not a mattstack app (a user's own app registered with deck,
  the docs site) showing as broken because it never sends the signal.
- Any new fixed delay that stands in for "it is probably back by now".

## Approaches

**A. Ready signal from the page, health from the app (picked).** The page
tells the native window it is ready. While a tab is not ready, the window
asks that app's health endpoint and reloads when it answers healthy. Matt
picked this: no deck changes, works when deck is down, and the check waits on
a real condition.

**B. Deck event stream.** Deck publishes "app X, instance N, healthy" and the
window subscribes. No check loop, and other clients could use it, but it is a
new deck API and a long-lived connection in the tray, and tabs stay stuck when
deck is down. Kept as a follow-up behind the seam in A.

**C. Keep the probe, widen the retries.** Cheapest, and still a guess. It
would have failed again on any outage longer than the new budget. Rejected.

Shipping: one PR for all four parts (Matt's pick).

## Design

### 1. The ready signal (page to window)

Two messages, posted to a WebKit script message handler named
`mattstackHost` (`window.webkit.messageHandlers.mattstackHost`). Outside the
mattstack window the handler does not exist and both calls do nothing.

- `{ type: "booting" }`: sent by a small inline script in the page's HTML
  head, before any bundle loads. It tells the window that this page speaks
  the protocol, so a ready message is expected. A page that never sends
  `booting` is treated as today: WebKit's "finished" means loaded. That is
  what keeps user apps and the docs site working.
- `{ type: "ready", buildId }`: sent once the app has mounted and every
  same-origin `link[rel~="stylesheet"]` that is not disabled has a sheet with
  at least one rule. If a stylesheet failed, the page sends
  `{ type: "failed", reason }` instead, so the window does not wait for the
  backstop below. `buildId` may be absent (a page served by vite under
  `deck live` has none).
- `{ type: "fatal" }`: sent when the kit's `SimpleAlerts` fatal panel is
  shown (the app threw while booting). The page is showing its own error and
  reload button, so the window uncovers the page as it is and treats the tab
  as `notReady` without covering it.

One implementation of the page side, used by both the kit boot
(`mountMattstackApp` in `packages/ui/src/app/mount.tsx`, which covers chat,
console and boxscore) and the board (`apps/board/src/client/main.tsx`, which
does not use the kit boot). Where that shared code lives is the builder's
call: `@mattstack/app-kit/boot` if the board can import it without breaking
the Mantine import walls, else a small module both can reach. The inline
`booting` script goes in each app's HTML shell (the kit apps' `index.html`,
the board's inline shell in `server.ts`).

### 2. The window (tray)

Each tab has one state: `loading`, `ready`, or `notReady`.

- A navigation starts: `loading`.
- `ready` arrives: `ready`. The loading overlay lifts here, not at WebKit's
  "finished", for a page that sent `booting`.
- `failed` arrives, or the main frame fails (the existing `MainFrameResponse`
  verdict and load errors): `notReady`.
- Backstop: a page that sent `booting` and then sends neither `ready` nor
  `failed` (its JavaScript never ran) becomes `notReady` after one deadline.
  This is the only clock in the design. It classifies a silent page; it does
  not guess when the app recovers. Builder picks the value (my call: 15
  seconds after WebKit's "finished").

While any tab is `notReady`, the window checks that app's health through one
seam, `AppHealthSource`, at a short fixed interval. A check gives
`answering` or `notAnswering`, plus an instance token when the app has one.
Every tab gets an answer, whatever it runs:

- A mattstack app with the new health route (section 3): `ok` and `bootId`.
- Deck's own tab: `/healthz` answering, with the `x-deck-pid` header as the
  token. No deck change.
- Anything else (a user's app, an older app build, the board's unconfigured
  server, a page that answers `/api/health` with HTML): `answering` means its
  home URL gives a response that is not a 5xx. No token.

The reload rule is the same for all of them, and is driven only by observed
changes:

- A tab that becomes `notReady` by itself (not after a reload this rule
  made) gets one reload, used as soon as the app is `answering`.
- After that, the tab reloads again only when the window sees the app go
  from `notAnswering` to `answering`, or sees its token change.
- Otherwise it stays `notReady` with the failure overlay and its Retry
  button.

So an app that is up but keeps serving a broken page gets one reload, not a
loop, and a tab that failed during an outage reloads each time the app
actually comes back, however many blips there were.

What the user sees: for a page that sent `booting`, the loading overlay
covers the tab until `ready`. When such a tab is `notReady`, the failure
overlay sits on an opaque cover, so half-loaded content never shows around
it. That cover is a small change to the existing `FailureOverlay`; `fatal`
(section 1) is the one case that shows the page instead.

Deleted: `StylesheetProbe`, `StylesheetRetry`, `noteStylesheetProbe`,
`reloadFailedTabs` on deck-ready, and `FailedTabRetry`, with their checks.
The rule above covers every case they did. The checks that described those
cases are rewritten against the new rule, not dropped.

Tray logging: one line per transition to `notReady` (with the reason) and one
per reload (with the `bootId`), through `TrayLog`.

### 3. Honest servers

Health: every served mattstack app answers `GET /api/health` with
`{ ok, name, version, bootId, buildId }`.

- `bootId`: made once per process start.
- `buildId`: identifies the client bundle being served (builder's call how:
  a hash of the bundle, or the build's commit).
- `ok` is false, with a non-200 status, when the server cannot serve its page
  and assets.
- Kit apps already have `/api/health` in `packages/server/src/app.ts`; it
  gains the two ids. The board gains `/api/health` with the same shape,
  beside its existing `/healthz`, ahead of the board-secret check like
  `/healthz` is.

Serving: a server reads everything a page needs into memory and serves from
that copy.

- Board: `/style.css` is served from memory in dev, like `/` and `/app.css`.
  Dev keeps "edit CSS, refresh, see it": a file watch refreshes the copy, and
  a failed read keeps the last good copy.
- Kit apps in disk mode (`mountStatic` in `packages/server/src/static.ts`,
  used when running from source): `dist/` is read into memory at boot and
  served from there. Their deploy builds and then restarts the server, so the
  copy is fresh without a watcher. Embedded mode is already in memory.
- If reading the files fails at boot (an error such as `EPERM`), the server
  still starts, and health answers not ok, so the window shows the tab as not
  ready instead of half a page.
- A kit app with no `dist/` at all is not broken: under `deck live` vite
  serves the page and the server only answers `/api`. Health stays ok and
  `buildId` is null. The new-version check (section 5) is skipped whenever
  the page's or the server's `buildId` is missing.

### 4. The bundle swap

The tray owns this, because it is what launches from the new bundle. Today
it restarts its agents and the served apps at launch only when the app
*version* changed (`LaunchRecording.restartsServedApps`,
`rt-tray/Sources-core/Services/LaunchRecording.swift`). A bundle replaced at
the same version, which is what happened here, restarts nothing.

The tray records an identity for the bundle it launched from and treats a
changed identity like a changed version: kickstart the agents, then restart
the served apps. `Info.plist` carries no commit, so the identity is the
builder's call (for example the main executable's Mach-O UUID). This covers
every way a bundle gets replaced, not only `update-machine`.

`update-machine` itself does not change. Its later served-suite leg still
restarts the apps onto the synced checkout. `runDevAppRebuild`'s own
kickstart and `deck restart --managed` become redundant with this; removing
them is out of scope here and noted in the PR.

### 5. New-version notice

Matt asked for this: when a ready tab's app is serving a newer build than the
page in the tab, the window shows a notice saying a new version is available,
with a Reload button. The tab never reloads by itself.

- The tab remembers the `buildId` from its `ready` message. The window reads
  the app's current `buildId` from `/api/health` through the same
  `AppHealthSource` seam. When they differ, the tab is `stale`.
- When to check a ready tab is the builder's call, from events the window
  already has (the tab becoming active, the window becoming key, the existing
  badge poll). No new fast loop.
- Reload clears the notice. So does a later check that finds the ids equal
  again.
- The board's own dev live reload stays as it is (`watchClientAssets` in
  `apps/board/src/server.ts` tells the page to reload on a client rebuild).
  So on a dev machine the board mostly refreshes itself and the notice shows
  for the cases live reload misses. "Never reloads by itself" is a rule for
  the window, not for an app's own dev tooling.
- The notice is SwiftUI in the window chrome. Its look and exact words are
  settled live with Matt at the end, after the rest is built, and are not
  part of the subagent-driven work. The plan builds the `stale` state and a
  plain placeholder notice; the polish is a separate last step.

## Constraints

- The tray is tested through `rt-tray/Tests/MattstackCoreChecks`; pure logic
  (tab state transitions, the reload rule) lives in `Sources-core` so it is
  checkable there. `WindowModel` only wires it.
- A tray change reaches Matt's Mac only through a dev app rebuild
  (`.claude/rules/dev-app.md`). Never rebuild in the shared checkout.
- Old and new must mix: a new tray with an app build that sends no `booting`
  behaves as today; an old tray ignores the messages (no handler, no-op).
- UI is not done until seen: the window is checked in the running dev app in
  both colour schemes, with a stylesheet failure forced.
- Kit rules for `packages/ui` and `packages/server` apply
  (`.claude/rules/apps/`).

## Acceptance

- With the board's stylesheet failing, the board tab never shows unstyled
  content: the loading overlay stays, then the failure overlay.
- When the board becomes healthy on a new process, the tab reloads by itself
  and shows styled, with no manual reload, however long the outage lasted.
- A tab whose app is healthy but whose page still fails reloads once, then
  waits for the app to come back, a new process, or the Retry button.
- A registered app that sends no `booting` loads as it does today, and its
  tab still recovers by itself after the app was down.
- Deck's own tab recovers by itself after deck restarts.
- The board answers `/style.css` when its source folder is unreadable after
  boot.
- A dev app relaunched from a replaced bundle at the same version restarts
  its agents and the served apps.
- `StylesheetProbe`, `StylesheetRetry` and `FailedTabRetry` no longer exist.
- After a board deploy, an open board tab shows the new-version notice, and
  its Reload button loads the new build and clears the notice.

## Left to the builder

- Where the shared page-side code lives, and the `buildId` source.
- The health check interval and the backstop deadline.
- The bundle identity the tray records.
- Test shape for the kit apps' in-memory disk mode.

## Source

Tray, board and CLI logs for 2026-11-21 19:42 to 19:46 local; PR #1200;
`runDevAppRebuild` in `lib/release/update-machine.ts`.
