# Deck facelift: main page, per-app settings modal, shared tooltip

Approved in conversation with Matt on 2026-10-08. Boards and renders:
`docs/apps/design/deck/` (`deck.pen`, README, `renders/`). Where this spec
and a board disagree on layout or colour, the board wins; where they
disagree on behaviour or on what data exists, this spec wins.

Decisions marked **(overnight)** were settled after Matt went to bed, from
a spec review, choosing whichever option keeps today's behaviour or changes
the least; the PR description lists them for his review.

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

In: deck's board UI (`apps/deck/core/board/**`), deck's DOM tests, capture
baselines and fixtures (`apps/deck/test/**`), tui-kit's Tooltip recipe
(`packages/tui-kit/src/recipes/Tooltip/`), and the board app's local tooltip
CSS (`apps/board/src/style.css`), which moves into the kit.

Out: every server route, request and response shape in `apps/deck/src/**`
(no API change at all, including no new status field); the add-app modal;
the deck settings modal's contents (console owns them); the proxy alerts;
tui-kit's StatusDot; moving deck to Mantine app-kit (deck stays on tui-kit,
like the board app).

## 1. Main page

Board: `FINAL · Main page` (dark and light).

### Header and sections

- Header: Deck mark and title left; right, `reload proxy`, `add app`, and
  the settings gear as a kit `Button` with `iconOnly` (the fix for the
  overflowing glyph) and tooltip "Deck settings". The tunnel badge stays in
  the header and opens the tunnel's reduced modal (section 2).
- Subline: unchanged.
- Sections: `mattstack` (with the dev mode badge) and `your apps`, each a
  card panel, as today. The strays section is unchanged apart from the
  shared row changes below.

### Update strip

When one or more rows in the mattstack section have `newCode` and a
`deploy` command, the top of that panel shows "New code for N apps since
their last deploy" and a `Redeploy all` button (section 3). Hidden when N
is 0. It has no "what changed" control: the dark FINAL render predates that
control's removal from the board (see Open board fixes).

### Columns

Site, Port, Health, Version (dev mode only), Public, actions.

- Site: brand mark or letter tile, name and suffix, the `this board` chip,
  the issue badge, and today's two trailing markers kept as they are: the
  `a.public-link` globe (external link, shown when `publicUrl` differs) and
  the Railway globe (`RAILWAY_GLOBE`, tooltip "served from Railway
  (status)", shown when `row.remote` is set).
- Port: unchanged, including the override dev chip with the base port in
  its tooltip.
- Health: unchanged, including the off badge for an off app and today's
  badge text ("200 34ms"); the boards' "200 · 1ms" is not adopted.
- Version **(overnight)**: the API only reports `newCode` (`deployed` and
  `head`, null when they match or the diff does not touch the app) and
  carries no deployed SHA otherwise. So the cell shows `deployed → head`
  with the head in the warn text role when `newCode` is set; "current"
  when the row is `devLink: 'linked'` and has no `newCode`; "not tracked"
  for every other row. The column renders only when `data.devMode` is true,
  since `devLink` and `newCode` are dev-mode only.
- Public: unchanged (publish switch and the `public: railway` chip driven
  by `publicOrigin`).
- Actions: in this order, one button per manifest command, then restart,
  then the row's settings gear.
  - `build` is an icon-only subtle button (hammer); `deploy` is an
    icon-only subtle button (rocket), in the warn text role when `newCode`
    is set; any other command keeps today's subtle text button.
  - Every command button keeps today's aria-label (`<command> <app>`), its
    in-flight guard, and today's phase handling. A running or restarting
    command shows the kit Button's `busy` state, and its tooltip reads the
    phase text today's label shows (`commandButtonLabel`).
  - Tooltips: hammer uses the Build copy from the Tooltips board; rocket
    uses the Redeploy copy, plus today's `deployPill` tip ("New code since
    last deploy: X to Y") when `newCode` is set; restart keeps today's
    behaviour and label, tooltip "Restart service".
  - Restart keeps today's gate (`canRestart`, a service, not off).
  - `Link source` / `fix link` keep their current place and behaviour.
- Row settings gear: the only way into the modal, `aria-label="settings
  for <name>"`. It is visible while the row is hovered or anything in it
  has focus (CSS module, `:hover` inside `@media (hover: hover)` plus
  `:focus-within`, per `docs/apps/ui-authoring.md`), and stays in the tab
  order at all times. Clicking anywhere else on the row does nothing.

### Icons

The kit's `ICONS` has no hammer, rocket, help or copy glyph. Deck draws
them with the kit `Icon` and local path data, the existing `RAILWAY_GLOBE`
pattern in `AppsTable.tsx`, in one deck module (`core/board/icons.ts`).
The kit's icon set is not changed.

### Deliberate changes to today's main page

Each of these changes an existing test on purpose. The plan updates each
test in the same commit as the change, red first, and the PR lists them.
Nothing else on the page may change.

| today | after | test that changes |
| --- | --- | --- |
| leading health dot before the site name | removed (the Health badge carries it) | `board.spec.ts` "leading health dot..." |
| Service column (`pid N` / `exit N`) | removed from the table; pid and exit code move to the modal's status pill | `board.spec.ts` "service column shows..."; "an off app: muted off badge..." (cell indices, chevron, drawer selectors) |
| row click opens the drawer | only the row's gear opens the modal | `drawer.spec.ts` "row click opens...", "switch, restart, and site-link clicks do not open..." |
| chevron with a details aria-label | settings gear | `board.spec.ts` "every row carries a focusable chevron..." |
| solid warn `Redeploy` pill per behind row | warn-tinted rocket icon button; one `Redeploy all` in the strip | `core/board/logic.test.ts` `deployPill` and `commandButtonLabel` tests (unit suite) |
| `selected` class on the open row | removed (a modal, not a side panel) | `drawer.spec.ts` "the open row carries a selected class" |
| ↑/↓ step the drawer between rows | removed: one app per modal (Matt's choice) | `drawer.spec.ts` "↑/↓ move the drawer..." (deleted) |
| on a public host, relink, Unlink and "give it a route…" still render | hidden when `canManage` is false (the server refuses them there) | new tests in section 5 |

## 2. Per-app settings modal

Boards: `FINAL · App settings modal`, `M2 · Other states each block carries`.

Built on the kit `Modal` (with a deck `className` for its ~1000px width;
the kit default is 420px), from small block components, one file each
under `apps/deck/core/board/settings/`. Each block takes the row, the
status data and the board state, and renders nothing when its gates say so.
The existing mutations in `useBoardState.ts` are reused unchanged; the modal
adds no request of its own.

### Opening, closing, focus

- Opens from a row's gear (and from the header tunnel badge for the tunnel
  row). One app per modal.
- The kit Modal has no focus management, so deck adds it: initial focus on
  the close button; Esc, the close button or the backdrop closes; focus
  returns to the gear (or tunnel badge) that opened it. No focus trap,
  matching deck's other modals.
- If the row's data vanishes while open, the modal closes and focus lands
  on the page's stable fallback, as the drawer does today.
- A confirm dialog opened from the modal (unlink, remove) stacks above it;
  Esc closes the confirm first; arrow keys never retarget anything.

### Header

Mark, name, a `mattstack` or `your app` badge, the URL (opens in a new tab
when healthy), the status pill, Restart (today's gate), close.

Status pill states, from the same logic as today's `RootStatusStrip`:
Healthy (status and ms, pid), Down (unreachable or exit code), Restarting…
(warn), Off, No route. Sync issues (`row.issues`) render as bad alerts
under the header, one per issue, with today's copy.

### Left column: what runs

- Code (managed rows, not `self`, `devLink` defined): source path; Deployed
  `deployed → head` with "new code in source" when `newCode` is set, else
  "current" when linked; the manifest command buttons (Redeploy as the
  warn-tinted primary when `newCode`, Build, any other command), with the
  same guards and phases as the table; `relink` (inline path input, today's
  `SourceLinkInput` behaviour and errors) and `unlink` (today's
  `UnlinkConfirm`). Unlinked or broken rows show the link input and today's
  footer copy instead of the path. Command buttons follow the table's
  gates; relink and unlink need `canManage`.
- App (user rows, `canManage`, replaces Code): name, base port, and for
  `kind: 'service'` command and directory, prefilled; `Save changes` with
  today's validation (`NAME_PATTERN`, required fields) and the API error
  inline on name. Closing the modal discards the draft (today's
  `closeEdit`).
- Port: assigned port. No override and `canManage`: a dev port input and
  `Route to it`. Override set: the override port in the warn text role,
  `revert to <base>` (today's `clearPort`), and the `Public follows dev`
  switch (today's `onPublicFollows`). `self`: the port and "overrides don't
  apply to deck itself", no input.
- Port draft lifetime **(overnight)**: `board.editing` pauses polling
  (`refresh()` returns early while it is set), so the draft starts only on
  the input's first keystroke (`startEdit`), and ends on `Route to it` or
  Enter (`submitPort`), on Esc in the input, on blur while empty, and on
  modal close (`cancelEdit` for all but submit). Blurring with text still
  in the input keeps the draft, so polling stays paused until submit, Esc
  or close, as today's setting screen does. With the input empty and
  untouched, polling never pauses.
- Recent errors: the stderr tail (newest last, live with each poll) and
  `Copy`; empty state "No errors. Recent stderr shows here when a health
  check fails."

### Right column: who reaches it (`canManage` only)

- Who can reach it: This Mac (always); Public, through the tunnel (today's
  publish switch and copy); Railway (today's remote switch and its existing
  disabled tooltip, when the row has a password but sign-in is off and is
  not already remote; when on, status deploying, verifying, live or error,
  and `Push to Railway`, disabled while deploying or verifying).
- Who gets in: Password (not set: input and Save; set: `replace` and
  `remove`; errors inline). Google sign-in (switch; when on, `These people`
  or `Anyone at these domains` via the kit `Segmented`, entries as removable
  chips, an add input, `Apply`, errors inline). When every gate is off, the
  warn note "<name> is open: anyone who can reach the tunnel gets in."
- Google sign-in keeps today's timing exactly: turning it on is local
  intent until Apply; turning it off calls the API immediately; a teardown
  failure on turn-off stays visible after the switch reads off; an apply
  error does not survive closing the modal. Opening the modal calls
  today's `openAccess(row)` so the access state loads as it does when the
  drawer's access screen opens.

### Footer

`Remove app…` (`canManage`, not `self`, today's `RemoveConfirm` copy and
flow) on the left; "Switches save as you flip them" on the right.

### Read-only and reduced forms

- `canManage` false (a public host) **(overnight)**: every control that
  writes is hidden: the right column, the App block, the Port input and
  override controls, relink, Unlink, Remove, and "give it a route…".
  Restart and the command buttons keep exactly today's gates (Restart:
  `canRestart`; commands: as the table renders them today). Hiding relink,
  Unlink and "give it a route…" on a public host is a deliberate change
  (the server already refuses them there).
- Off app (`enabled === false`): the off status, and only what the drawer
  shows for an off row today.
- Tunnel row: status, the domain it carries, recent errors, restart tunnel.
- Service without a route: status with "no route", recent errors, restart,
  and `give it a route…` (opens the add modal prefilled, as today).

### Tooltips

Help icons next to Deployed, Assigned, Dev override, Public follows dev,
Public through the tunnel, Railway, Password and Google sign-in; action
buttons carry their own tooltips. Copy is on the `FINAL · Tooltips` board
and is the source of truth for those, except Railway's disabled tooltip,
which keeps today's copy.

### Drawer feature parity

Every drawer behaviour maps to a modal block and a test that exists before
the drawer is deleted. Four of the source tests fail on main today (marked
†); their ports assert the intended behaviour, not the broken assertion.
The drawer is deleted only after every row passes against the modal.

| drawer behaviour (today's test) | modal block |
| --- | --- |
| forms per row kind: app, service, tunnel (`drawer.spec` "root screens render per row kind" †) | header + forms by kind |
| broken app shows error banner and bad logs hint (`drawer.spec`) | header issue alert + Recent errors |
| service root keeps "no route" (`drawer.spec`) | header status pill |
| restarting shows spinner (`drawer.spec`) | header status pill + Restart busy |
| give it a route opens add modal prefilled (`drawer.spec`) | service form |
| Esc / ✕ close; focus returns; data vanishes closes (`drawer.spec` x4) | modal open/close |
| dev port: override facts, public-follows toggle, revert, self has no override, set and save, draft cleared on leave, no override offers the input (`drawer.spec` dev port x7) | Port |
| edit app: fields by kind (external †), name validation, save PATCH, API error inline, managed rows have none, draft cleared on close x2 (`drawer.spec` edit x8) | App |
| source: facts, relink, unlink PATCH dev:null (`drawer.spec`) | Code |
| remove: confirm copy, cancel, confirm DELETE, self has none, ok:false and no-answer errors, keys do not retarget (`drawer.spec` remove x7) | footer |
| access: password set/change/remove/error, who mode/entries/save/error/not surviving close, teardown error (`access.spec` x10) | Who gets in |
| logs: tail, live update, empty state, copy all (`logs.spec` x4) | Recent errors |
| remote: live marker and Push (†), toggle POST, status, password-only disabled, already-remote stays enabled (`remote.spec` x6) | Who can reach it (and the table's markers) |
| publish switch PUT + refresh, optimistic flip and revert (`board.spec`) | Who can reach it (and the table switch, unchanged) |

## 3. Redeploy all

- Targets: rows in the mattstack section with `newCode` and a `deploy`
  command, in table order, with the `self` row moved last; a row whose
  deploy is already in flight is skipped. A pure function in `logic.ts`
  computes the list.
- Runs one deploy at a time through today's `onRunCommand(row, 'deploy')`,
  awaiting each to settle. `onRunCommand` gains a returned outcome without
  changing anything it already does (toasts, phases, refresh, reload):
  `ok`, `failed` (non-zero exit), `timeout`, `busy` (server said busy),
  `not-started` (any other start failure), `skipped` (the in-flight guard
  returned early), `reloading` (deck's own restart, page about to reload),
  `no-return` (deck did not come back within 60s).
- While running: the strip reads "Redeploying i of N · <app>" and the
  button is a disabled "Redeploying…"; per-row buttons keep working, but a
  second Redeploy all cannot start.
- `ok` and `skipped` continue to the next app. Any other outcome stops the
  run. `onRunCommand` already toasts each failure; Redeploy all adds one
  more toast, "Redeploy all stopped at <app>", and nothing else. Apps
  already redeployed stay redeployed and the strip recounts from the next
  poll.
- Deck's own deploy, last, follows today's path: wait for deck to answer,
  then reload the page (`reloading`).
- Closing the tab stops the remaining deploys (accepted trade-off: no server
  change).

## 4. Shared tooltip and icon buttons

- tui-kit's Tooltip card (`[data-part='tooltip-card']`) takes the board
  app's recipe (today in `apps/board/src/style.css`, "Tooltips read as an
  inverted label"): inverted surface built from the kit's `--fg` mixed into
  `--card`, text in `--card`, no border, small shadow, an arrow aimed at the
  trigger using the kit's existing `--tooltip-arrow-x`, 8px gap, 12px medium
  text, max width 280px, a 140ms pop-in with no animation under reduced
  motion.
- It must pass tui-kit's gates: `no-hardcoded-values.test.ts` forbids raw
  lengths and colours in a recipe's `.module.css` and forbids keyframes and
  `animation` there. So every length goes through the kit's spacing,
  radius and font-size tokens or a recipe scalar set (the `MODAL_SCALARS`
  pattern), colours through tokens, and the keyframes and animation live in
  `Tooltip.keyframes.css`, as the gate requires.
- StatusDot's card (`statusdot-card`, styled by `StatusDot.module.css`) is
  not changed **(overnight)**, so the board app's StatusDot tooltips look
  exactly as they do now.
- The board app's local `[data-part='tooltip-card']` block and its keyframes
  are deleted in the same step; the board app's Tooltip tooltips must look
  unchanged (Fast Browser before/after screenshots of them in both schemes).
- Kit Tooltip visual baselines are regenerated deliberately with
  `bun run tui-kit:oracles` (visual tests are not part of `check`); the ramps
  contrast matrix covers the new text-on-tooltip pair in both schemes.
- Deck's header gear and every row icon button use the kit `Button` with
  `iconOnly` and an `aria-label`.

## 5. No regressions: how this is proven

### Baselines (main at f54729aaf, 2026-10-08)

- `apps/deck` unit suite (`bun run test`): 1047 pass, 0 fail.
- `apps/deck` DOM suite (`bun run test:dom`): 82 pass, 11 fail. The 11
  failures are pre-existing and named in the plan; each is either fixed or
  explained in the PR, never left silently.

The bar for every step: the unit suite has 0 failures; the DOM suite has no
failure outside that list of 11 and at least 82 passes plus the new tests
(less the deliberately deleted ↑/↓ test); `bun run check` (turbo gates);
`bun run tui-kit:oracles` when a step touches tui-kit; the board app's suite
(run from `apps/board`); `generated-fresh.test.ts` (rebuild with `bun run
build:board` after every `core/board` change); and the e2e smoke
(`LOCAL_E2E=1 bun run test:e2e`) are green.

### Fixtures

A new fixture, `test/fixture/status-newcode.json`, sets the top-level
`devMode: true` and gives at least three mattstack-section rows (one of
them `self`) `devLink: 'linked'`, a `deploy` command and `newCode`, plus one linked row without
`newCode`, so the strip, the Version cell's three states and Redeploy all
are testable and capturable. Existing fixtures are not edited.

### Test-first order

1. No request changes: a DOM test pins the exact set of method + path pairs
   the board page calls across its flows, so a dropped or altered call
   fails loudly. Written first, against today's drawer, and kept.
2. Pure logic first, red then green: Redeploy all targets and order, the
   strip text, the Version cell states, the modal's form-by-kind and every
   block's visibility gates (`canManage`, `canRestart`, `self`,
   `managedBy`, `devLink`, `devMode`, override, remote, access state,
   `enabled`).
3. The parity table above: each drawer behaviour's test is ported from the
   drawer's selectors to the modal's before the modal code exists (red),
   then the modal makes it pass (green). The drawer code and its tests are
   deleted only when every row passes.
4. At-risk behaviours with their own named tests: Google sign-in timing;
   password save, replace and remove; dev override set, revert, public
   follows dev, no override offered on `self`, and polling continuing
   while the modal is open with the dev port input empty and untouched;
   the Railway gate and Push; relink, unlink confirm, remove confirm and
   its failure modes; deck's own deploy waiting then reloading; the command
   in-flight guard and its busy state on icon buttons; optimistic switches
   reverting on failure; every write control hidden on a public host.
5. Redeploy all in the DOM, on the newcode fixture, with deploys
   intercepted to succeed twice and fail on the third app: the run stops,
   one stop toast names the app, apps one and two are not deployed again.

### Delivery: a stack of four branches, reviewed as one PR

Built as four stacked branches, each on the one before, each green on its
own gates and screenshotted before the next starts:

1. `deck-facelift/1-tooltip`: tui-kit tooltip lift (kit recipe, board CSS
   removed, baselines).
2. `deck-facelift/2-main-page`: version column, icon actions, row gear,
   header gear, newcode fixture, and the update strip showing its count with
   no button yet. The row gear opens the existing drawer until step 3.
3. `deck-facelift/3-modal`: the settings modal replaces the drawer (parity
   table complete first).
4. `deck-facelift/4-redeploy-all`: Redeploy all, the strip's button.

Each step is its own commit range, so any one can be reverted alone. At the
end the stack is opened as a single PR to main for Matt's review; nothing
merges or deploys without him.

### Visual verification

Every step ends with Fast Browser screenshots of deck in dark and light,
from the fixture server (`DECK_FIXTURE`, the server `test/capture.ts` boots,
with temp fixture and state dirs), never by redeploying the live deck. The
fixtures use different app names and data from the boards, so the
comparison covers layout, spacing, type, colour roles and which states
show, not the data itself; a difference in any of those is a failure to
fix. The capture baselines in `test/baselines/` are regenerated deliberately
(`bun run capture:baseline`) in the step that changes each surface, and the
drawer baselines are replaced by modal ones in step 3.

### Deploying (after Matt merges)

Deck runs from main through the dev shim. After the merge: read
`#mattstack` and the checkout log for holds, confirm the shared checkout is
on main, pull, deploy deck, then check `api.json`'s `runMode` is `source`
and every app reads healthy on the page. If anything is off, revert the PR
and redeploy before any other work.

## Open board fixes

- The FINAL boards draw a chevron per row; the row gear replaces it.
- `renders/01-main-page.dark.png` predates removing the strip's "what
  changed" control (the light render and the `.pen` board are current).
- `renders/02-app-settings-modal.dark.png` shows the older page behind the
  modal.
- The FINAL boards show a Version value on every mattstack row; with no API
  change, a linked row without new code reads "current".
