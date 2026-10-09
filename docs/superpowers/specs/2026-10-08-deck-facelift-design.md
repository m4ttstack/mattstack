# Deck facelift: main page, per-app settings modal, shared tooltip

Approved in conversation with Matt on 2026-10-08. Boards and renders:
`docs/apps/design/deck/` (`deck.pen`, README, `renders/`). Where this spec
and a board disagree on layout or colour, the board wins; where they
disagree on behaviour, this spec wins.

## Goal

Bring deck's board UI up to the standard of the board, boxscore and console
apps without breaking anything deck does today. Deck is critical
infrastructure: it supervises every app on the machine, so the rule for
this work is no regressions, proven by tests written before the code they
guard.

Problems this fixes:

- Four or five solid orange "Redeploy" pills per section are loud, and there
  is no way to redeploy everything that is behind in one action.
- The per-app drawer hides each setting behind its own pushed screen, most
  of them one row long, in lowercase grey micro-type.
- The header's settings gear overflows its button (it is not rendered
  `iconOnly`) and its tooltip is the kit's bordered panel card.

## Scope

In: deck's board UI (`apps/deck/core/board/**`), tui-kit's Tooltip recipe
(`packages/tui-kit/src/recipes/Tooltip/`), and the board app's local tooltip
CSS (`apps/board/src/style.css`), which moves into the kit.

Out: every server route, request and response shape in `apps/deck/src/**`
(no API change at all); the add-app modal; the deck settings modal's
contents (console owns them); the proxy alerts; moving deck to Mantine
app-kit (deck stays on tui-kit, like the board app).

## 1. Main page

Board: `FINAL · Main page` (dark and light).

- Header: Deck mark and title left; right, `reload proxy`, `add app`, and
  the settings gear as a kit `Button` with `iconOnly` (the fix for the
  overflowing glyph), tooltip "Deck settings". The tunnel badge stays in the
  header and opens the tunnel's reduced modal (section 2).
- Subline: unchanged (health dot, healthy fraction, public and protected
  counts).
- Sections: `mattstack` (with the dev mode badge) and `your apps`, each a
  card panel, as today. The strays section is unchanged apart from the
  shared row changes below.
- Update strip: when one or more rows in the mattstack section have
  `newCode` and a `deploy` command, the top of that panel shows "New code
  for N apps since their last deploy" and a `Redeploy all` button
  (section 3). Hidden when N is 0. Board: option A's strip.
- Columns: Site, Port, Health, Version, Public, actions.
  - Site keeps the brand mark or letter tile, name and suffix, the
    `this board` chip, the published globe, the external link when
    `publicUrl` differs, the off badge, and the issue badge.
  - Port keeps the override dev chip with the base port in its tooltip.
  - Version: `deployed → head` with the head in the warn text role when
    `newCode` is set; the deployed short SHA alone when the row is linked
    and current; "not tracked" for user apps and rows without a link.
  - Public keeps the publish switch and the Railway marker for a remote row.
  - Actions: icon-only subtle buttons with tooltips, in this order: one per
    manifest command (build: hammer; deploy: rocket, in the warn text role
    when `newCode` is set; any other command: its name as a subtle text
    button), restart, then the row's settings gear. `Link source` / `fix
    link` keep their current place and behaviour in this cell.
- Row settings gear: the only way into the modal. It is visible while the
  row is hovered or anything in it has focus (CSS module, `:hover` inside
  `@media (hover: hover)` plus `:focus-within`, per
  `docs/apps/ui-authoring.md`), and stays in the tab order at all times.
  Clicking anywhere else on the row does nothing.

### Deliberate changes to today's main page

Each of these changes an existing DOM test on purpose. The plan updates
those tests in the same commit as the change, red first, and the PR lists
them. Nothing else on the page may change.

| today | after | test that changes |
| --- | --- | --- |
| leading health dot before the site name | removed (the Health badge carries it) | `board.spec.ts` "leading health dot..." |
| Service column (`pid N` / `exit N`) | removed from the table; pid and exit code move to the modal's status pill | `board.spec.ts` "service column shows..." |
| row click opens the drawer | only the row's gear opens the modal | `drawer.spec.ts` "row click opens...", "switch, restart, and site-link clicks do not open..." |
| chevron with a details aria-label | settings gear with `aria-label="settings for <name>"` | `board.spec.ts` "every row carries a focusable chevron..." |
| solid warn `Redeploy` pill per behind row | warn-tinted rocket icon button; one `Redeploy all` in the strip | `commands.spec.ts` (pill assertions) |
| `selected` class on the open row | removed (a modal, not a side panel) | `drawer.spec.ts` "the open row carries a selected class" |

## 2. Per-app settings modal

Boards: `FINAL · App settings modal`, `M2 · Other states each block carries`.

Built on the kit `Modal`, about 1000px wide, from small block components,
one file each under `apps/deck/core/board/settings/`. Each block takes the
row, the status data and the board state, and renders nothing when its gates
say so. The existing mutations in `useBoardState.ts` are reused unchanged;
the modal adds no request of its own.

### Opening, closing, focus

- Opens from a row's gear (and from the header tunnel badge for the tunnel
  row). One app per modal: no arrow-key stepping between apps.
- Closes on Esc, the close button, or the backdrop. Focus returns to the
  gear that opened it (or the tunnel badge).
- If the row's data vanishes while open (a removed app, a stray that
  stopped), the modal closes and focus lands on the page's stable fallback,
  as the drawer does today.
- A confirm dialog opened from the modal (unlink, remove) stacks above it;
  Esc closes the confirm first.

### Header

Mark, name, a `mattstack` or `your app` badge, the URL (opens in a new tab
when healthy), the status pill, Restart, close.

Status pill states, from the same logic as today's `RootStatusStrip`:
Healthy (status and ms, pid), Down (unreachable or exit code), Restarting…
(warn), Off, No route. Sync issues (`row.issues`) render as bad alerts
under the header, one per issue, with today's copy.

### Left column: what runs

- Code (managed rows, not `self`, `devLink` defined): source path; Deployed
  `deployed → head` with "new code in source" when they differ; the
  manifest command buttons (Redeploy as the warn-tinted primary when
  `newCode`, Build, any other command); `relink` (inline path input, today's
  `SourceLinkInput` behaviour and errors) and `unlink` (today's
  `UnlinkConfirm`). Unlinked or broken rows show the link input and the
  existing footer copy instead of the path.
- App (user rows, replaces Code): name, base port, and for `kind:
  'service'` command and directory, prefilled; `Save changes` with today's
  validation (`NAME_PATTERN`, required fields) and the API error inline on
  name.
- Port: assigned port. No override: a dev port input and `Route to it`
  (today's `startEdit` / `submitPort`). Override set: the override port in
  the warn text role, `revert to <base>` (today's `clearPort`), and the
  `Public follows dev` switch (today's `onPublicFollows`). `self`: the port
  and "overrides don't apply to deck itself", no input.
- Recent errors: the stderr tail (newest last, live with each poll) and
  `Copy`; empty state "No errors. Recent stderr shows here when a health
  check fails."

### Right column: who reaches it

- Who can reach it: This Mac (always); Public, through the tunnel (today's
  publish switch and copy); Railway (today's remote switch, disabled with
  the existing tooltip when the row has a password but sign-in is off and
  is not already remote; when on, status deploying, verifying, live or
  error, and `Push to Railway`, disabled while deploying or verifying).
- Who gets in: Password (not set: input and Save; set: `replace` and
  `remove`; errors inline). Google sign-in (switch; when on, `These people`
  or `Anyone at these domains` via the kit `Segmented`, entries as removable
  chips, an add input, `Apply`, errors inline). When every gate is off, the
  warn note "<name> is open: anyone who can reach the tunnel gets in."
- Google sign-in keeps today's timing exactly: turning it on is local
  intent until Apply; turning it off calls the API immediately; a teardown
  failure on turn-off stays visible after the switch reads off; an apply
  error does not survive closing the modal.

### Footer

`Remove app…` (not `self`, today's `RemoveConfirm` copy and flow) on the
left; "Switches save as you flip them" on the right.

### Read-only and reduced forms

- `canManage` false (a public host): every control that writes is absent,
  exactly the set the drawer hides today.
- Off app (`enabled === false`): the off status, and only what the drawer
  shows for an off row today.
- Tunnel row: status, the domain it carries, recent errors, restart tunnel.
- Service without a route: status with "no route", recent errors, restart,
  and `give it a route…` (opens the add modal prefilled, as today).

### Tooltips

Help icons (lucide `circle-question-mark`) next to Deployed, Assigned, Dev
override, Public follows dev, Public through the tunnel, Railway, Password
and Google sign-in; action buttons carry their own tooltips. Copy is on the
`FINAL · Tooltips` board and is the source of truth.

### Drawer feature parity

Every drawer behaviour maps to a modal block and a test that exists before
the drawer is deleted. The plan's first modal task writes or ports each row
of this table; the drawer is deleted only after all of them pass against the
modal.

| drawer behaviour (today's test) | modal block |
| --- | --- |
| root per row kind: app, service, tunnel (`drawer.spec` root screens) | header + forms by kind |
| broken app shows error banner and bad logs hint (`drawer.spec`) | header issue alert + Recent errors |
| service root keeps "no route" (`drawer.spec`) | header status pill |
| restarting shows spinner (`drawer.spec`) | header status pill + Restart busy |
| give it a route opens add modal prefilled (`drawer.spec`) | service form |
| Esc / ✕ close; focus returns; data vanishes closes (`drawer.spec`) | modal open/close |
| dev port: override facts, public-follows toggle, revert, self has no override, set and save, draft cleared on leave (`drawer.spec` dev port x6) | Port |
| edit app: fields by kind, name validation, save PATCH, API error inline, managed rows have none, draft cleared on close (`drawer.spec` edit x7) | App |
| source: facts, relink, unlink PATCH dev:null (`drawer.spec`) | Code |
| remove: confirm copy, cancel, confirm DELETE, self has none, ok:false and no-answer errors, keys do not retarget (`drawer.spec` remove x7) | footer |
| access: password set/change/remove/error, who mode/entries/save/error, teardown error (`access.spec` x10) | Who gets in |
| logs: tail, live update, empty state, copy all (`logs.spec` x4) | Recent errors |
| remote: toggle off/on POST, status and Push, password-only disabled, already-remote stays enabled (`remote.spec` x5) | Who can reach it |
| publish switch PUT + refresh, optimistic flip and revert (`board.spec`) | Who can reach it (and the table switch, unchanged) |

## 3. Redeploy all

- Targets: rows in the mattstack section with `newCode` and a `deploy`
  command, in table order, with the `self` row moved last; a row whose
  deploy is already running is skipped. A pure function in `logic.ts`
  computes the list.
- Runs one deploy at a time through today's `onRunCommand(row, 'deploy')`
  path, awaiting each to settle. `onRunCommand` gains a returned outcome
  (`ok`, `failed`, `timeout`, `busy`, `restarted`) without changing anything
  it already does.
- While running: the strip reads "Redeploying i of N · <app>" and the
  button is a disabled "Redeploying…"; per-row buttons keep working, but a
  second Redeploy all cannot start.
- Stops at the first failure, timeout or refusal, with a toast naming the
  app and `deck logs <app>`; apps already redeployed stay redeployed and the
  strip recounts from the next poll.
- Deck's own deploy, last, follows today's path: wait for deck to answer,
  then reload the page.
- Closing the tab stops the remaining deploys (accepted trade-off: no server
  change).

## 4. Shared tooltip and icon buttons

- tui-kit's Tooltip card takes the board app's recipe (today in
  `apps/board/src/style.css`, "Tooltips read as an inverted label"):
  inverted surface built from the kit's `--fg` mixed into `--card`, text in
  `--card`, no border, small shadow, an arrow aimed at the trigger using the
  kit's existing `--tooltip-arrow-x`, 8px gap, 12px medium text, max width
  280px, a 140ms pop-in with no animation under reduced motion. It lives in
  `Tooltip.module.css`; both kit consumers of the card (Tooltip and
  StatusDot) get it.
- The board app's local tooltip block is deleted in the same PR; the board
  must look unchanged (Fast Browser before/after screenshots of its
  tooltips in both schemes).
- The kit's Tooltip and StatusDot visual baselines are regenerated
  deliberately; the ramps contrast matrix covers the new text-on-tooltip
  pair in both schemes.
- Deck's header gear and every row icon button use the kit `Button` with
  `iconOnly` and an `aria-label`.

## 5. No regressions: how this is proven

### Baselines (main at f54729aaf, 2026-10-08)

- `apps/deck` unit suite (`bun run test`): 1047 pass, 0 fail.
- `apps/deck` DOM suite (`bun run test:dom`): 82 pass, 11 fail. The 11
  failures are pre-existing and named in the plan; each is either fixed or
  explained in the PR that touches its file, never left silently.

The bar for every PR: the unit suite has 0 failures; the DOM suite has no
failure outside that list of 11 and at least 82 passes plus the new tests;
`bun run check` (turbo gates, tui-kit visual and contrast tests), the board
app's suite (run from `apps/board`), `generated-fresh.test.ts` (rebuild with
`bun run build:board` after every `core/board` change), and the e2e smoke
(`LOCAL_E2E=1 bun run test:e2e`) are green.

### Test-first order

1. No request changes: a DOM test pins the exact set of method + path pairs
   the board page calls across its flows, so a dropped or altered call
   fails loudly. Written first, against today's drawer, and kept.
2. Pure logic first, red then green: Redeploy all targets and order, the
   strip text, the Version cell states, the modal's form-by-kind and every
   block's visibility gates (`canManage`, `self`, `managedBy`, `devLink`,
   override, remote, access state, `enabled`).
3. The parity table above: each drawer behaviour's test is ported from the
   drawer's selectors to the modal's before the modal code exists (red),
   then the modal makes it pass (green). The drawer code and its tests are
   deleted only when every row passes.
4. At-risk behaviours with their own named tests: Google sign-in timing
   (on is local until Apply; off calls at once; teardown error persists);
   password save, replace and remove; dev override set, revert, public
   follows dev, and no override offered on `self`; the Railway gate and
   Push; relink, unlink confirm, remove confirm and its failure modes;
   deck's own deploy waiting then reloading; the command in-flight guard;
   optimistic switches reverting on failure; every write control hidden on
   a public host.
5. Redeploy all in the DOM with a fake deploy that succeeds twice and fails
   on the third app: the run stops, the toast names the app, apps one and
   two are not redeployed again.

### Delivery: a stack of four branches, reviewed as one PR

Built as four stacked branches, each on the one before, each green on its
own gates and screenshotted before the next starts:

1. `deck-facelift/1-tooltip`: tui-kit tooltip lift (kit recipe, board CSS
   removed, baselines).
2. `deck-facelift/2-main-page`: version column, icon actions, row gear,
   header gear, and the update strip showing its count with no button yet.
   The row gear opens the existing drawer until step 3.
3. `deck-facelift/3-modal`: the settings modal replaces the drawer (parity
   table complete first).
4. `deck-facelift/4-redeploy-all`: Redeploy all, the strip's button.

Each step is its own commit range, so any one can be reverted alone. At the
end the stack is opened as a single PR to main for Matt's review; nothing
merges or deploys without him.

Every step ends with Fast Browser screenshots of deck in dark and light
compared against the FINAL boards; any difference is a failure to fix.
Screenshots come from the fixture server (`DECK_FIXTURE`, the server
`test/capture.ts` boots, with temp fixture and state dirs) driven by Fast
Browser, never by redeploying the live deck. The capture baselines in
`test/baselines/` are regenerated deliberately (`bun run capture:baseline`)
in the step that changes each surface, and the drawer baselines are
replaced by modal ones in step 3.

### Deploying (after Matt merges)

Deck runs from main through the dev shim. After the merge: read
`#mattstack` and the checkout log for holds, confirm the shared checkout is
on main, pull, deploy deck, then check `api.json`'s `runMode` is `source`
and every app reads healthy on the page. If anything is off, revert the PR
and redeploy before any other work.

## Open board fixes

- The FINAL boards draw a chevron per row; the row gear replaces it.
- `renders/02-app-settings-modal.dark.png` shows the older page behind the
  modal.
