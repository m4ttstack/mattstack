# Console settings rows: one disclosure, two tabs

Approved by Matt on 2026-10-01 ("build B4, keep the scope names"). The boards
are the visual truth: `docs/apps/design/console/settings.pen`, boards
`B · Expand in place` (rest and hover), `B4 · Tabs back, calmer` (the open
row) and `R · Run detail keeps a thin modal`. Renders sit in
`docs/apps/design/console/renders/`.

## Problem

A settings row on `/settings` has three trailing controls that do unrelated
things: the summary toggle ("2 fields ⌄") opens an inline editor with no
hover feedback, `⋯` opens Edit as JSON / Move / Remove, and `›` opens the
explain modal. The modal repeats the whole row, prints every layer with its
file path and "not allowed" notes, and its header sets small terminal text
against a large close button, so it reads off-centre and busy.

## Decisions

- Every row is one disclosure. Clicking anywhere on the row header opens the
  row under itself; the header tints on hover; one chevron (down, up when
  open) replaces `⋯` and `›`.
- The open row holds a two-tab panel, **Value | Where it's set**. It replaces
  the explain modal on `/settings`.
- **Where it's set** is one plain line per layer: scope badge, value, and
  "✓ in effect" on the winner only. Actions show on hover.
- Scope names stay `default / team / user / machine`. `default` gets a grey
  badge like the others so it never reads as a column heading.
- Run detail keeps a modal, now a thin shell around the same panel.

## The row (`SettingRow`)

- The header is a clickable `Box` with a CSS-module `.row` class, `:hover`
  and `:focus-within` painted per `docs/apps/ui-authoring.md` "Hover and
  motion" (no hover state in React). A click toggles open unless it starts
  inside an interactive control (`input, textarea, select, button, a,
  [role=switch], [role=combobox], [role=option], [contenteditable]`).
- The chevron is a kit `ActionIcon` with `aria-expanded` and
  `aria-label="open <key>"` / `"close <key>"`: the keyboard and screen-reader
  door, since the row itself is not a button (it contains inputs).
- The control column is unchanged for scalars, enums, short inline string
  lists, `set per repo`, external and read-only rows. A composite row's
  control becomes the plain summary text (`rowSummary`, or `unset`), no
  longer a toggle. Shape locks (`unexpected shape` + Clear) stay.
- Open, the row draws as the B4 card (border, radius 8) with the panel under
  the header. One row is open at a time on the page.
- `RowMenu.tsx`, `ExpandToggle.tsx` and the `›` explain button are deleted;
  `onExplain` leaves `SettingRow` and `SettingsSection`.

## The panel (`KeyPanel`, new)

Tabs are a kit `SegmentedControl` at the panel's top-left. Default tab:
**Value** for a row with an editor body (composite keys, except a short
string list edited inline in the header), **Where it's set** for every
other row (its value is already editable in the header). A Fix or an `?explain=` link opens
**Where it's set**.

### Value tab

- Composite keys: the body today's `compositeParts` returns (string list,
  string map, leaves, form/JSON draft). The editors' existing header row
  ("Editing the <layer> layer" + Form | JSON) shares one line with the tabs:
  the tabs render at its left, the hint and toggle at its right, as on B4.
  Save / Cancel stay where `DraftEditor` draws them.
- Scalar keys: the full description and the same control the header shows
  (it is the only control inside the run-detail modal).
- "Edit as JSON" from the old row menu is the Form | JSON toggle.

### Where it's set tab

- Caption: "Weakest first. The last layer set wins." for a replace key,
  "Merged key by key. Lists replace whole." for a deep-merge key.
- One 38px line per layer, weakest first: scope badge (fixed column), value
  in mono (a composite shows its summary, never a JSON block), status at the
  right. Overridden and inert values are muted. The winner says
  "✓ in effect"; every layer feeding a merge says "✓ merged". Today's
  `ignored, teamLocked` and `refused` states stay as small amber / red text
  in the status slot, only when true.
- Layers whose store is not in `def.scopes` are not drawn, unless they hold
  a stray value (then they draw with a muted "not allowed here" and, as
  today, no edit, move or remove).
- Hover actions (kit `ActionIcon` + `Tooltip`, shown on `:hover` /
  `:focus-within` of the line): open file (tooltip `Open <path>`, href from
  `useEditorHref`; hidden for the registry default), edit at this layer,
  move (a `Menu` of target layers, only where `RowMenu` offered moves today),
  remove (`Remove from <layer>`). Writes keep today's semantics and
  `useRowSave` paths.
- Edit at a layer: a scalar swaps the value for `ScalarControl` in the line;
  a composite opens `DraftEditor` under the line, as the modal does today.
- Only when present, under the affected line: invalid text, nonconforming
  issues, "Use the older value". Below the list: diverged panels with prune,
  the secret-key rotate note, and the Repos list for a repo-scoped key with
  no repo picked.
- Dropped: the verdict sentence (the check carries it), the repeated row,
  the `>_ rt settings explain` title and its "as of" time.

## Settings page wiring

- `SettingsPage` owns `{ key, tab, fix }` for the one open row. Clicking a
  row sets it locally and mirrors it to the URL with `replace` (no history
  entry per click).
- `?explain=<key>` keeps its name so existing links (`explainHref`, the
  palette, `/config/:key` redirects) still work: it opens that row on
  **Where it's set** and scrolls it into view. `?fix=<scope>` opens that
  layer's editor too. A Fix that switches repo still writes `repo`.
- Escape inside the panel closes the row unless a field, menu or listbox
  owns it (today's `ESCAPE_OWNERS` rule).
- The page no longer mounts `ExplainModal`.

## Run detail (`EffectiveInputs`)

`ExplainModal` becomes a shell: header with the key (namespace muted, name
semibold), its scope badge and the close button on one centre line, the
description under it, then `KeyPanel` (opening on **Where it's set**) with
its own store, as `OwnStore` loads it today. Board `R`.

## UI authoring (strict)

Every piece follows `docs/apps/ui-authoring.md` to the letter:

- Kit components first: `SegmentedControl` (tabs), `ActionIcon` +
  `Tooltip` (layer actions, chevron, close), `Menu` (move targets),
  `Badge` via `ScopeBadge` (scope badges, `default` included), `Collapse`
  (the open panel), `Modal` (run detail). Nothing hand-drawn that one of
  these does.
- The styling ladder: rung 1 props (`size` `sm` or larger, `compact-sm`
  only for the hover action row), then a CSS module through `classNames`
  for layout only, then stop and ask. No new inline `style` or `styles`
  objects, no `.mantine-*` selectors, no colour set as a value on a kit
  component (colour through `color` / `variant` only).
- Row and layer-line hover is the guide's `.row` pattern: `--row-hover`
  per scheme, `:hover` inside `@media (hover: hover)`, `:focus-within`
  outside it, hover actions revealed from the same selectors. No React
  hover state.
- Tokens by role only: muted text `--tk-text-3` / `--tk-text-4`, "in
  effect" `--tk-text-ok-small` with a `-vivid` glyph, borders
  `--tk-border` / `--tk-border-soft`. No `c="dimmed"`, no stock gray, no
  raw values.
- Weights 400 / 500 / 700 only; every `Text` states its size.

## Visual parity (strict)

- Stories render the boards' exact content: `SettingRow.stories.tsx` and
  `KeyPanel.stories.tsx` with fixtures copied from B, B4 and R (same keys,
  values, layers, invented paths), at the boards' widths.
- Fast Browser screenshots each story in light and dark and compares it
  with the board export at the same scale, side by side, plus a numeric
  check of layout (element boxes, gaps, paddings, font sizes and weights
  from the DOM against the board's node bounds). Any difference in page
  content is a failure to fix in code.
- Where a kit control's shipped geometry differs from the board (the
  guide says board numbers for a control's height, padding and font size
  are not targets), the board is corrected to the kit's geometry and the
  change is listed for Matt, so board and build end identical.
- Then the live `/settings` page and a run detail's modal, both schemes,
  for the real-data pass.

## Verification

- Unit (vitest, `bun run console:test`): `SettingRow` disclosure (row click
  toggles, clicks in controls do not, chevron aria), no `⋯` or `›`;
  `KeyPanel` tabs and defaults, layer lines (winner, merged, muted, hidden
  not-allowed layers, stray values), hover actions and their writes, issues
  and diverged under the right layer; `SettingsPage` `?explain` / `?fix`
  open and scroll; run-detail modal shell. Existing `ExplainModal`,
  `FixFlow`, `Diverged`, `SpecialRows` suites move to the panel's DOM, not
  dropped.
- `bun run console:typecheck`, `console:lint`, `bun run check` for the
  repo gates.
- The parity pass above, before any milestone is called done.

## Out of scope

Scope renames, a confirm on Remove (today has none), the settings page's
filters and sidebar, and settings-kit wire changes.
