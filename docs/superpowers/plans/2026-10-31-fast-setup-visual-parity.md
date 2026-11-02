# Fast setup visual parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every fast setup screen in the tray look like its pen.dev mock (setup.pen row P), pixel for pixel where SwiftUI allows.

**Architecture:** One theme file holds the mock's tokens. Shared views (window chrome, header, card, rows, buttons, fields, segments, footer) draw only from it. Each screen is then rebuilt on those views against its mock image and the mock's exported CSS. rt's form, copy and logic do not change, except where this plan names a copy change.

**Tech Stack:** SwiftUI and AppKit in `rt-tray/Sources/Setup/Fast/`, the tray's DEBUG snapshot renderer (`--render-fast-setup-snapshots`), and `swift run mattstack-checks`.

**Spec:** the mocks are the spec for look and feel: `.superpowers/sdd/2026-10-30-fast-setup/mocks/*.png` (2x exports of setup.pen row P) and `.superpowers/sdd/2026-10-30-fast-setup/mocks/css/*.html` (each mock's exact layout and styles, as HTML with inline CSS, one element per pen.dev layer, `data-pencil-name` naming the layer). Behaviour and copy stay as `docs/superpowers/specs/2026-10-29-fast-setup-design.md` set them.

## Global Constraints

- The mocks win on look: font sizes, weights, tracking, colours, spacing, padding, radii, borders, icon tiles, button shapes, field shapes, alignment and window chrome. Read the screen's CSS file for exact numbers; the PNG is the picture to compare against (it is 2x: divide pixel measurements by 2).
- Fonts: the mocks use Inter, which stands in for SF. Use the system font (SF Pro) at the mock's size and weight, with the mock's letter-spacing as `tracking`. Monospaced text in the mock (codes, tokens, paths) uses `.monospaced` system design.
- Icons: the mocks use Lucide icons (`data-icon-name`). Use the nearest SF Symbol at the mock's size, light or regular weight, in the mock's colour. Map: hard-drive→internaldrive, bell→bell, globe→globe, users→person.2, plus→plus, user→person, laptop→laptopcomputer, chevron-right→chevron.right, check→checkmark, info→info.circle, log-in→arrow.right.to.line (or rectangle.portrait.and.arrow.right), puzzle→puzzlepiece.extension, message-square→message, external-link→arrow.up.right.square, link→link, ticket→ticket, list-checks→checklist, loader→ProgressView (small, spinning), sparkles→sparkles.
- The fast setup window is dark only: it forces `NSAppearance(named: .darkAqua)` and draws the mock's dark palette whatever the system appearance is. Light and dark snapshots both render the dark design.
- Tokens (from the mocks; the theme file names them, views never use raw hex):
  - window background `#0e0e14`, with a radial glow `radial-gradient(ellipse 65% 45% at 50% 0%, #e6498026 0%, #e6498000 100%)` over the top of the body
  - window outline `#383846` 1px, radius 12 (snapshots only; the live window keeps macOS's own frame)
  - title bar `#14141b`, height 36, bottom border `#26262f` 1px; "mattstack" 13 semibold `#9d9da6`; step counter 11 regular `#7a7a85`, right-aligned, 14 from the edge; three 12pt dots `#383846` gap 8 from x 14 (snapshots only; the live window leaves that space to macOS's traffic lights)
  - body padding 40 top, 48 sides, 32 bottom; gap 22 between header, sub and content unless the screen's CSS says otherwise
  - heading 26 bold `#f4f4f5` tracking -0.8; sub 14 regular `#9d9da6`
  - card `#21212b`, radius 12, outline `#383846` 1px, row dividers `#26262f` 1px, row padding 16 by 18
  - text primary `#f4f4f5`, secondary `#9d9da6`, tertiary `#7a7a85`; accent `#e64980`; success `#4ade80`; warning `#f5a524`; field fill `#14141b`
  - icon tile 36 square, radius 9, fill = accent at alpha `0x24` (or success at `0x1f` when the row is done), icon 18 in accent (or success)
  - primary button: accent fill, white 15 semibold text, radius 10, glow shadow `#e6498066`; disabled at 40% opacity
  - outline accent button (Connect Slack, Sign in to Claude, Add to Chrome): transparent, 1px accent border, accent text and icon, radius 8
  - secondary button (Create token, Locate…, Hide, Show log): transparent or field fill, 1px `#383846` border, primary text, radius 8 (Hide and Show log radius 10)
  - field: `#14141b` fill, 1px `#383846` border (accent when focused or holding a pasted value the mock shows in accent), radius 8, monospaced value
  - segmented control: `#14141b` track with 1px `#26262f` border, selected segment `#383846` fill with primary text, others secondary text
  - hint line: info.circle icon plus 12 to 13 regular `#7a7a85` text
  - done line: checkmark plus text in success
  - footer: no divider; note left in secondary 13 to 14, primary button right; padding per the screen's CSS
- Exact values a screen's CSS gives override the token list above for that screen.
- rt owns copy and logic: no decision in Swift about which rows show or a row's state. Copy already matches the spec strings; where a mock's words differ from what rt sends, keep rt's and list the difference in the report.
- Rows keep Matt's decisions: a todo row still shows rt's reason (draw it as a hint line under the row's control, in the hint style); a notification row answered no still draws a grey dash.
- Accessibility identifiers (`AXID.*`) stay on the same controls.
- Every task renders snapshots (`cd rt-tray && swift build --product rt-tray`, then under `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin` run `.build/debug/rt-tray --render-fast-setup-snapshots <dir>`), opens the screens it touched with Read next to their mock PNG, and fixes what differs before committing. The report names each remaining difference and why it stays.
- Swift checks: `cd rt-tray && swift run mattstack-checks "<name substring>"`. Snapshot or check tests asserting old styling may be updated; checks asserting behaviour may not.
- Never stage `docs/apps/design/setup/setup.pen` and never open it: the mocks folder is the only source.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; git commands one per Bash call.

## Review Focus

- A long rt detail or error (several lines) in a labelled row: wraps under the control without overlapping the label column or the next row.
- A screen whose content is taller than the window: scrolls inside the body, title bar and footer stay put.
- The disabled primary button (Continue before every row is done): reads as disabled, never as the grey system prominent button.
- The busy state of a row (Installing…, Waiting for Chrome…): the spinner and text sit where the mock's Installing… does.
- The test drive banner sits above the title bar or inside it without hiding the step counter.

---

### Task V1: Theme, window chrome and shared views

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/FastTheme.swift` (tokens, fonts, button styles, field style, segmented control, hint and done lines, icon tile)
- Create: `rt-tray/Sources/Setup/Fast/FastChrome.swift` (title bar with step counter, window background with glow)
- Modify: `FastScreenHeader.swift`, `FastFooter.swift`, `FormCard.swift`, `FastAppearance.swift`, `FastSetupView.swift`, `../SetupWindowController.swift`, `FastSetupSnapshot.swift`

**Interfaces:**
- Produces: `FastTheme` (colours, `heading`, `sub`, fonts), `FastPrimaryButtonStyle`, `FastOutlineButtonStyle`, `FastSecondaryButtonStyle`, `FastField` (text field with mock styling, monospaced option), `FastSegmented<ID>`, `FastHint(text)`, `FastDoneLine(text)`, `FastIconTile(symbol:, done:)`, `FastTitleBar(step: String?)`, `FastStep.counter(for screen:, path:) -> String?`.
- Consumes: `FastSetupFlow.screen`, the form's `path` (`join`, `create`, `solo`, `restore`).

- [ ] **Step 1:** Write `FastTheme.swift` from the token list. Button styles draw their own fills, so snapshots show the accent (never the grey prominent bezel).
- [ ] **Step 2:** Window: `SetupWindowController` gets `.fullSizeContentView`, `titlebarAppearsTransparent = true`, `titleVisibility = .hidden`, dark appearance, background `#0e0e14`. `FastSetupView` draws `FastTitleBar` at the top (36 high, under the traffic lights) and the glow behind the body. The test drive window keeps its banner above the title bar.
- [ ] **Step 3:** Step counter. Each path's screens in order. Join: macos, path, invite, waiting, connect, this-mac, running or paused (7). Create: macos, path, create-team, connect, this-mac, running or paused (6). Just me: macos, path, connect, this-mac, running or paused (5). Move from another Mac: macos, path, restore, running or paused (4). Before a path is known, count as join. Text is "<n> of <total>"; ready shows "Done"; loading shows nothing. Add a check for the counter.
- [ ] **Step 4:** Window height fits the screen: the window keeps width 720 and sizes its height to the current screen's ideal height (as the mocks do), between a floor of 340 and the screen's visible height. Content taller than that scrolls inside the body.
- [ ] **Step 5:** Restyle `FastScreenHeader` (heading, sub; the old uppercase label draws as the mock's P4 team chip only where P4 uses it), `FastFooter` (no divider, mock spacing, primary and secondary button styles) and `FormCard` (card token, row dividers inset 0). Snapshots draw the window outline, radius and title bar dots so a render lines up with its mock.
- [ ] **Step 6:** Render, compare `container-*` snapshots with P1 and P6 mocks for chrome, header and footer. Fix differences.
- [ ] **Step 7:** Commit `tray: fast setup draws the mocks' dark theme, title bar and step counter`.

### Task V2: Form rows in both mock layouts

**Files:**
- Modify: `rt-tray/Sources/Setup/Fast/FormRowView.swift`, `FormCard.swift`, `RepoPlacementRow` (wherever it lives), `FastSetupSnapshot.swift` (rows snapshots)

**Interfaces:**
- Consumes: V1's theme views.
- Produces: `FormRowStyle` with `.tile` (P1: icon tile, title 15 semibold, subtext 14 secondary, trailing control or status) and `.labelled` (P3/P5/P5b/P5s: a label column 135 wide in 15 semibold primary, then the control with its subtext beside it on one line, or a field with a hint line under it). `FormCard(style:)` passes it to every row.

- [ ] **Step 1:** `.tile` per P1's CSS: row padding 16 by 18, gap 14, icon tile by row id (perm.fda hard-drive, notifications bell, fancy-urls globe; done rows use the success tile). Done status: checkmark plus "On"-style word in success 15 semibold, trailing. Action: primary button style at row size (`Allow`, height 30, radius 8).
- [ ] **Step 2:** `.labelled` per P5's CSS: label column, then: done → done line; a button action → outline accent button with its icon (connect: message-square for Slack, log-in for Claude, puzzle for Fast Browser; others no icon) and the subtext beside it in tertiary 13; busy → secondary-bordered pill with spinner and "Installing…" in secondary; a connect action with fields → field plus secondary "Create token" button, subtext as a hint line under the field; a choose action → `FastSegmented`; a place-repo row → P5b's repo block (repo name 15 semibold, segmented Current checkout / New checkout right, path field with Locate…/Choose…, done or hint line under).
- [ ] **Step 3:** rt's reason on a todo row and an error both draw as a hint line under the control (error in warning colour). A long one wraps inside the control column.
- [ ] **Step 4:** Render `rows-*` snapshots, compare with P1, P5 and P5b mocks row by row. Fix differences.
- [ ] **Step 5:** Commit `tray: fast setup rows draw the mocks' tile and labelled layouts`.

### Task V3: P1 and P2

**Files:** `MacOSScreen.swift`, `PathScreen.swift`, snapshots.

- [ ] **Step 1:** P1 per `P1-permissions` mock: heading, sub "mattstack can't do these itself. It notices the moment you do", tile card, and the bottom note (accent 8pt dot plus "mattstack reopens itself after Full Disk Access, then carries on" in tertiary 13) where rt's form says a reopen follows. If rt sends no such copy, draw the sub and note from the screen's own constants and list it in the report.
- [ ] **Step 2:** P2 per `P2-path` mock: four choice cards (card token, radius 12, padding per CSS, icon tile in accent, title 15 semibold, sub 14 secondary, chevron right in tertiary). The hovered or first card draws the accent border and the accent-tinted fill `#e649801a` as in the mock; keyboard focus does the same.
- [ ] **Step 3:** Render `macos-*`, `path*`, `container-macos`, `container-path`; compare; fix.
- [ ] **Step 4:** Commit `tray: P1 and P2 match their mocks`.

### Task V4: P3 Join, P3c Create, P3r Restore

**Files:** `InviteScreen.swift`, `CreateTeamScreen.swift`, `RestoreScreen.swift`, snapshots.

- [ ] **Step 1:** P3 per mock: invite field (monospaced 15, accent border once a code is in), Join primary beside it, verdict as a done line, forge token card in `.labelled` style, link note (link icon plus tertiary text).
- [ ] **Step 2:** P3c per mock: label-above fields (label 13 semibold secondary, field below, height per CSS), forge as `FastSegmented`, token field with Create token, footer note "Next: the same short form" and Create team primary.
- [ ] **Step 3:** P3r per mock: Backup repo and Recovery key fields (monospaced, key masked), hint line, footer note "Then straight to the progress bar" and Restore primary.
- [ ] **Step 4:** Render `invite-*`, `create-*`, `restore-*`, containers; compare; fix.
- [ ] **Step 5:** Commit `tray: P3, P3c and P3r match their mocks`.

### Task V5: P4 Waiting

**Files:** `WaitingScreen.swift`, snapshots.

- [ ] **Step 1:** P4 per mock: centred column; 56pt icon tile (card fill, outline, radius 14) with the ticket symbol in accent; team chip (person.2 icon plus team name uppercased, 13 semibold tracking per CSS, outline pill); heading 26 bold centred; sub centred; two hint items in a row (checklist, bell) in tertiary; Hide secondary button bottom right.
- [ ] **Step 2:** Render `waiting*`, `container-waiting`; compare; fix.
- [ ] **Step 3:** Commit `tray: P4 matches its mock`.

### Task V6: P5 Connect and P5s Just me

**Files:** `ConnectScreen.swift`, snapshots.

- [ ] **Step 1:** P5 per mock using V2's `.labelled` card; footer note and Continue primary. The Just me path (P5s) uses the same card with its own heading and sub from rt.
- [ ] **Step 2:** Render `connect-*`, `card-connect`, `container-connect`; compare with P5 and P5s; fix.
- [ ] **Step 3:** Commit `tray: P5 matches its mock`.

### Task V7: P5b This Mac

**Files:** `ThisMacScreen.swift`, snapshots.

- [ ] **Step 1:** P5b per mock: one card, a "Your repos" section (label column, repo blocks) and a "Your settings" section (segmented, hint line wrapping to two lines), divider between sections; footer note and Set up this Mac primary. Leftover rows after a run (this-mac-leftover) draw in the same card style.
- [ ] **Step 2:** Render `this-mac*`, `container-this-mac`; compare; fix.
- [ ] **Step 3:** Commit `tray: P5b matches its mock`.

### Task V8: P6 Run, P6b Paused, P7 Ready, test drive chrome

**Files:** `RunScreen.swift`, `ReadyScreen.swift`, `TestDrive*` views, `FastSetupView.swift` (`FastLoadingBody`, `FastFailureLine`), snapshots.

- [ ] **Step 1:** P6 per mock: step title 16 semibold left, percent right in secondary, 10pt bar (track `#26262f`, radius 5, fill a left-to-right gradient `#be96f0` to accent), time left under it in tertiary, bell hint line, Hide bottom right.
- [ ] **Step 2:** P6b per mock: same layout, bar fill and detail in warning colour, Show log secondary and Retry primary bottom right. Paused rows rt sends (login items, a needs-you action) draw in V2's `.labelled` style under the detail.
- [ ] **Step 3:** P7 per mock: centred icon tile with checkmark in success, heading, sub, Open the board primary centred.
- [ ] **Step 4:** Loading and failure lines, sheets (steps, choose) and the test drive banner and picker take the theme (dark fill, theme text, buttons).
- [ ] **Step 5:** Render `run-*`, `paused*`, `ready*`, `container-*`, `sheet-*`, `test-drive-*`; compare; fix.
- [ ] **Step 6:** Commit `tray: P6, P6b, P7 and the test drive match the mocks`.
