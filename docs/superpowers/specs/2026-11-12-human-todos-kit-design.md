# human-todos on the mod kit

Ticket: RT-565. Builds on the mod kit spec (`2026-11-12-mod-kit-design.md`) and the
kit itself (`packages/mod-kit/README.md`).

## Why

Matt wants one consistent UI across his Claude Code mods, so he never re-rolls
buttons, focus, hover, press or the reopen band for each one. gate-form and
kit-gallery are on the kit. human-todos, the mod Matt uses most, still draws
its own pane with Claude Code's plain elements, so it looks unlike gate-form
and none of the kit's interaction applies to it.

## Goals

- human-todos takes the kit look, as gate-form has it (Matt's pick):
  - a brand bar with Hide
  - filled buttons with hover and press
  - dimming when the pane is unfocused
  - the pink reopen band in place of today's "○ N Human Todos [Open]" band
- What human-todos does stays the same: adding, running, confirming, stopping,
  skipping and reporting to-dos, herdr and local runners, live output, the
  spinner, clearing finished items, saved lists and resume.
- human-todos is authored in `mods/human-todos/` and built into
  `plugins/human-todos/` like the other mods, with its tests kept.
- The build carries everything a real plugin ships (root files, docs, every
  harness file).
- Widths count terminal cells, so emoji and other wide characters line up and
  clicks hit the right row.

## Non-goals

- New human-todos features or changed copy, beyond what the kit look changes.
- Changing the agent-facing tool contract (`mcp__human-todos__*`) or the
  message Claude gets back.
- A light palette.
- Moving any other mod.

## Anti-goals

- A regression in running scripts: a stuck spinner, lost live output, a stop
  that doesn't stop, or a report that never reaches Claude.
- A pane that can't reach its bottom item. Scrolling must keep working.
- Losing a saved list across a version bump (the `todos` atom shape stays
  `todos-1`).

## What exists today

- `plugins/human-todos/hooks/`: `register.tsx` (`export const register`),
  `contract.ts` (tool registration and the agent contract), `actions.ts`
  (`press`, `cleanup`, `release`), `store.ts` (atoms and the saved list),
  `items.ts` (pure helpers: `buttonsFor`, `wrapWords`, `hardWrap`, ...),
  `herdr.ts`, `local.ts`, `runners.ts`, `report.ts`, `spinner.ts` (a 100 ms
  `$.clock.every` that bumps the `frame` atom while something runs), and
  `wiring.ts` (re-exports, because the host follows `$` only into functions of
  the module's own files).
- `pane.tsx` draws everything in the hooks module with engine
  `Box`/`Text`/`Button`:
  - the Pane, where each child is one row the engine scrolls by
  - "↑/↓ N more" hints, laid over the scroll window using
    `e.props.scroll`
  - the AbovePrompt band
  - a `UserMessage` summary row for the plugin's own reports, which works
- Engine `Button.onPress` hands `press` the `surface`. `copy` needs it for
  `$.ui.copy`.
- Harness tests sit beside the code: `*.test.ts(x)` plus the helper
  `test-world.ts`. The plugin root also has `LICENSE`, `README.md` and
  `docs/human-todos.png`.
- CI already has a `plugin-human-todos` job. Its version is `0.1.3`.

## Constraints learned

- A live probe (2026-11-12/13) showed that a Pane scrolls a kit Client with
  the wheel, and clicks land on the right row after scrolling. A video of it
  shows that the engine scrolls the whole pane tree, the Client's rows
  included: a line drawn above the Client scrolled away with them. `ui.scroll`
  reported `offset 0` at the top and `contentRows` 201, which is that line
  plus the Client's 200 rows. So the pane's offset does describe the Client's
  rows, and today's hints may carry over. `ui.scroll` fires on every wheel
  tick, even at an edge, which is expected and not an error.
- The mod API lets a mod own a site's scrolling: a `ui.scroll` hook that
  returns without calling `next` keeps the engine from moving the window, and
  the mod scrolls its own rows (the types' example:
  `on("ui.scroll", { requestId }, ($, e) => (scrollOwnRows(e.by), {}))`).
- The scroll check (2026-11-13, Task 1) settled both:
  - With the engine scrolling, the Pane hook is asked again with each new
    `e.props.scroll`, but the hints drawn from it jitter: the engine moves the
    rows first and the redraw catches up a moment later.
  - With the mod owning scrolling, the window moves smoothly and anything
    drawn at its edges holds still. The Client draws only the rows in view,
    so the tree always fits and the engine clamps `e.offset` to 0. The hook
    must keep its own offset and add `e.by`, not read `e.offset`.
    `ui.scroll` still fires when the tree fits.
- All the kit's engine scan rules apply (kit README, "Rules"):
  - `register` must be a top-level `export function`
  - only one matcherless `on(event)` per event
  - `$` may only be passed to top-of-file functions
  - state is only touched in the mod's own file, through literal atoms
- Bundling inlines every file into one module, which already satisfies the
  `wiring.ts` rule.
- A Client posts plain JSON. Button presses arrive at the mod's single
  `ui.message` hook, not as engine `onPress` closures. Whatever `press` needs
  from the surface has to come from the `ui.message` event.

## Approaches

1. **The pane becomes a kit Client** (picked). The Pane hook draws
   `<Client module="./pane/kit-view.tsx">` with the list as props. The Client draws
   with kit components inside one `<Panel>`, and buttons post
   `{ type: 'press', id, button }` to `ui.message`. The logic files stay
   as they are.
2. **Kit colours on engine buttons, drawn in the hooks module.** Rejected:
   hover and press need a Client, so it wouldn't match gate-form.
3. **Only the build and the band move.** Rejected: it keeps today's look,
   which Matt ruled out.

## Design

### Build (do first)

- `mod.json` gains an optional `files: string[]`: paths relative to the mod
  folder (files or folders) copied unchanged to the plugin root. human-todos
  lists `LICENSE`, `README.md` and `docs`.
- `harness/` is copied whole into `hooks/` (every file, any extension), not
  just `*.test.tsx`. So `test-world.ts` and `*.test.ts` come along.
- Copying `files` follows the same guards as the rest of the build: inside the
  mod folder, no `..`.
- The existing fixture and tests extend to cover both.

### Cell widths

- `widthOf` and every cut, pad and wrap in the kit (`text.ts`, widgets,
  `brandBar`, `tabStrip`, `buttons`) measure terminal cells:
  - wide East Asian characters and emoji take 2 cells
  - combining marks and zero-width joiners take 0
  - surrogate pairs are never split
- Hit-testing (`hitAt`) works in cells.
- The cell measure is one small pure helper (`cellWidth(text)`) with its own
  tests. It does not depend on a library.

### Surfaces (Matt's decision)

Claude Code offers `Client` only on `terminal` and `desktop`; `vscode` and
`mobile` have no `Client` in their element tables. human-todos works on all
four today, so:

- terminal and desktop get the kit look described below
- vscode and mobile keep today's engine-drawn pane and band

Matt asked that this not become duplicated code. So it splits into three parts:

1. **One model.** `src/pane/model.ts` exports a pure
   `paneModel({ list, expanded, spin, width }): PaneModel`. It decides
   everything the pane shows, as plain data:
   - each row's kind, text and tone
   - which buttons each item has: id, label, tone and the action it posts
   - script truncation and "… +N more"
   - the finished list (last 8) and "Clear finished"
   - the end-of-list line
   - each item's row span, for the scroll hints

   `bandModel(list)` does the same for the band. Every rule about what appears
   lives here once, covered by bun tests. Today's `LABELS`, `PRIMARY`,
   `markFor` and the wrapping move here out of `pane.tsx`.
2. **Two thin drawers.**
   - `src/pane/kit-view.tsx` (the Client body) maps a `PaneModel` to kit
     components.
   - `src/pane/plain-view.tsx` maps the same `PaneModel` to engine
     `Box`/`Text`/`Button`, keeping today's look.

   Neither decides what to show. Adding an item kind or a button changes the
   model only.
3. **One action path.** The kit drawer posts `{ type: 'press', id, button }`.
   The plain drawer's `onPress` calls the same function. Both land in `press`,
   unchanged.

The Pane hook picks the drawer by `e.surface`. So does the AbovePrompt band:
the kit's `ReopenBand` on terminal and desktop, today's band on the others.

### The pane (kit drawer)

- `src/pane/kit-view.tsx` holds a `kitClient` body. It draws, in one
  `<Panel>`:
  - `<BrandBar title="Human Todos" onHide>`
  - the actionable items
  - the finished items (the last 8)
  - "Clear finished"
  - "You've reached the end of the list." when the list overflows the pane
- Each actionable item keeps today's content and order:
  - **title:** the spinner frame while running, `○` otherwise
  - **detail:** dim
  - **note:** warning colour
  - **script:** cyan, two rows with "… +N more" and "Show all"/"Show less",
    or every row while confirming
  - **cwd:** for run items
  - **url:** for link items
  - **image names:** for image items
  - **live output tail:** while running, the last 15 lines for local runs
    and 3 for herdr
  - **status line:** "Running" or "Stopping…"
  - **confirm prompt**
  - **buttons:** a `<ButtonRow>` of kit `<Button>`s
- Button tones (revised in the live check, Matt's call: all-filled rows read
  as noisy):
  - each item fills only its main button: the first in `buttonsFor` order
    (Run, Open, Copy for a terminal step, Done for a task, Show for an image,
    Confirm while confirming), or Stop/Force stop while running. It keeps its
    tone: `run`, `open`, `confirm` and `show` are `primary`; `done` is
    `secondary`; `copy` is `neutral`; `stop` and `forceStop` are `caution`
  - every other button, plus "Show all", "Show less" and "Clear finished", is
    the kit's new `quiet` tone: a light label (`#e0e0e0`) on a faint fill
    (`#363636`), `#4a4a4a` under the pointer, `#404040` pressed. Never the
    disabled grey, so it doesn't read as disabled
- The confirm prompt sits under the buttons row, so Confirm lands where Run
  was (Matt's ask). A script longer than two rows still expands while
  confirming, which can push the buttons down.
- Wrapped titles hang: later title rows start under the first row's text, not
  under the mark (Matt's ask). The plain drawer gets the same order and indent.
- Finished items: `✓`, `✗` or `–` in their colours, then the title, dimmed,
  plus " (exit N)" when the exit code isn't 0.
- The Pane hook reads the list, the expanded ids and the spinner frame, as
  `readPane` does today, and passes them as Client props. The `frame` atom
  ticking redraws it as it does today.
- Posts:
  - `{ type: 'press', id, button }` calls `press`
  - `{ type: 'toggle', id }` calls `toggleExpanded`
  - `{ type: 'clear' }` runs the clear-finished path
  - `{ type: 'hide' }` and `{ type: 'reopen' }` go through the kit's
    `paneMessage`
  - `{ type: 'engaged' }` goes to the focus stand-in, as in gate-form
- The `surface` for `press` comes from the `ui.message` event, which always
  carries one (`UiMessageArgument.surface`).
- Focus (Matt's decision): the same rule as gate-form. When the pane is
  unfocused it draws dimmed, and the first click only focuses it; the next
  click acts. human-todos takes gate-form's focus stand-in (a `keysInForm`-style
  atom, cleared on `prompt.edit`, `prompt.submit` and `ui.focus`). Opening the
  pane when Claude adds an item still doesn't take focus from the prompt:
  human-todos keeps its own `openPane` rather than the kit's `showPane`.
- Scrolling (decided by the Task 1 check: the mod owns it):
  - A `ui.scroll` hook on the pane keeps the offset in an atom. It adds
    `e.by`, clamps the result to the list, and returns `{}` without `next`.
  - If `e.contentRows > e.bodyRows`, the drawn tree overflows, which means
    the plain drawer is showing it. The hook then calls `next(e)`, so VS Code
    and mobile keep the engine's scrolling and today's hints.
  - The Pane hook passes the offset and `bodyRows` to the Client. The Client
    draws only the rows in view and clamps the offset again when the list
    shrinks, for example after Clear finished.
  - The brand bar stays pinned and only the body scrolls (my call).
  - No "↑/↓ N more" rows in the kit drawer: the scroll bar shows the
    position (Matt's call in the live check). The end-of-list line stays.
  - Scroll bar (Matt's ask, tuned live):
    - a one-cell track at the right edge, with one blank column on each side
    - track background `#383838`; the thumb, also a background colour,
      `#707070` (muted: `#353535` / `#646464`)
    - thumb height `max(1, round(bodyRows² / total))`, placed in proportion
      to the offset
    - shown only when the list overflows
  - The scroll bar is a kit widget, so other mods can reuse it (my call).
    Its colours live in the kit theme next to the button fills.

### Live-check additions (2026-11-13, Matt's asks)

- Keyboard, while the pane has focus (kit drawer only):
  - ↑/↓ and Tab/Shift+Tab move between items (Clear finished last) and land
    on the item's filled button; they stop at the ends, as gate-form does
  - ←/→ move across the item's buttons; Enter presses through the same post a
    click sends; Esc stays the engine's (back to the prompt)
  - keyboard mode: the marks show only after a handled key and clear on any
    pointer move or click. The first key out of mouse mode only reveals the
    selection (Enter too), so nothing acts on a selection you can't see.
    A click still moves the selection
  - marks: a pink `│` rail down the selected item and a pink `○`, and a pink
    `▎` left edge on the selected button over its own fill, so mouse hover
    and press still show on it. The Clear finished stop gets the edge only
  - Enter shows the button pressed for about 150 ms, then acts; keys are
    ignored meanwhile
  - when the selected item leaves the list, the selection lands on the next
    item's filled button; the scroll follows the selection
  - kit parts (opt-in, so gate-form is unchanged): `keySelected`, a `mark`
    style, `kitClient`'s keyboard mode with `revealKeys`/`onReveal`, and
    `ui.pressFor`
- Brand bar: Hide is bold plum text with a chevron on the pink bar; the darker
  `pinkDeep` chip shows only under the pointer (a new `chip` style). Kit-wide,
  so gate-form changes too.
- Band: its button says Show, the opposite of Hide. Kit-wide.
- Unfocused look: two steps lighter than the gate-form spike (plain text
  `#b8b8b8`, dim `#808080`, every muted colour and fill raised to match).
  Kit-wide.
- herdr runs (a behaviour change, Matt's call to fold it in): runs go to a
  herdr server no one has on screen, so no workspace or tab of a run appears
  in the herdr Matt sees.
  - The server: `mattstack-bg` when `herdr session list` shows it running;
    otherwise the plugin's own `human-todos`, started detached
    (`herdr --session human-todos server`) and waited for, bounded. Neither
    is ever stopped or deleted by the plugin, and `default` is never touched.
  - Every command aimed at a server drops `HERDR_SOCKET_PATH` and sets
    `HERDR_SESSION`: Claude Code runs in a visible herdr pane, and that
    variable outranks `HERDR_SESSION`.
  - `/todos-runner`: `auto` takes the order above, then the local runner;
    `herdr` has no fallback and says so; `local` stays local.
  - On the chosen server every session's runs share one "Human Todos"
    workspace. Lookup order: the stored id (kept with its server's name),
    then a workspace labelled "Human Todos", then create one. Tabs are
    labelled `<repo> #<id> <title>` with the session's repo.
  - Show cannot bring a hidden tab forward: it writes the pane's output to a
    log and opens it, as Open log does. `herdr session attach <name>` watches
    a run live.
- Left as is (Matt's call): each report of a to-do action still starts a
  Claude turn. herdr Force stop only re-sends Ctrl-C (RT-571).

### Band and transcript row

- The AbovePrompt band uses the kit's `bandAbovePrompt` (the `ReopenBand` with
  label "Human Todos waiting" and the count as the title, e.g. "2 to-dos").
  It shows while open or confirming items exist and the pane is not placed.
- The `UserMessage` summary row stays human-todos' own, moved as it is. It
  works today, unlike gate-form's attempt.

### Mod layout

`mods/human-todos/` holds:

- `mod.json`: version `0.2.0`,
  `clients: ["pane/kit-view.tsx", "band.tsx"]`,
  `files: ["LICENSE", "README.md", "docs"]`
- `package.json`, `tsconfig.json`, `types/index.d.ts` (unchanged contract)
- `src/` with the logic files, moved as they are except for imports
- `src/pane/{model.ts,kit-view.tsx,plain-view.tsx}` replacing `pane.tsx`
- `src/register.tsx` with `export function register`
- `harness/`: the harness tests and `test-world.ts`

### Tests

- Pure tests become bun tests under `src/`, run by `bun run mods:test`.
  The built `hooks/` holds only the bundled modules, so a harness test can't
  import a source file. That covers:
  - `items.test.ts`
  - the `addDescription` cases of `contract.test.ts`
  - the `settle` cases of `actions.test.ts`
  - the new `model.test.ts`, the main test of what the pane shows on every
    item kind and status
- Harness tests that press buttons by engine key (`pane.press({ key: 'run-1' })`,
  about 80 calls across `actions`, `herdr`, `local`) switch to posting the
  same message the kit drawer posts (`{ type: 'press', id, button }`, or
  `toggle` and `clear`). A small helper in `test-world.ts` does it. Their
  assertions don't change.
- A few harness tests drive the kit drawer with real pointer events:
  - a pointer down/up on Run posts `press`
  - a first click on a dimmed pane only focuses it
  - Hide closes the pane
  - the band's Open reopens it
- A few harness tests mount the pane and band on `vscode` (or `mobile`) and
  check that the plain drawer draws and its buttons press.
- Narrow pane: at 30 columns no line is wider than the pane, on any item kind.
- The build tests cover `files` and the whole-`harness/` copy.
- `cellWidth` tests cover ASCII, CJK, emoji, a ZWJ family emoji, a flag and
  combining marks.
- A live check with Matt before the PR: add, run (local and herdr), stop,
  confirm, skip, image, link, and a long list that scrolls.

### CI and docs

- The `plugin-human-todos` job stays. Kit and mods routing already covers
  `mods/human-todos`.
- The kit README gains `files` in "Start a new mod", plus the cell-width
  note.
- `plugins/human-todos/README.md` (the user-facing README) gets a fresh
  screenshot after the live check.

## Left to the builder

- How the band words the count ("1 to-do" / "2 to-dos").
- Exact row spacing, as long as the look matches gate-form's density.

## Open risks

- The spinner ticks every 100 ms. Each tick redraws the Client through props,
  so watch for load.
