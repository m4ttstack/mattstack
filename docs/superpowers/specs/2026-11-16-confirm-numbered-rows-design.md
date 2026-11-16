# Confirm as numbered rows (gate-form + mod-kit)

Matt picked frame **D · Numbered rows** in `mod kit confirm.pen` for the
plugin confirm (`kind: 'confirm'` on `$.gateForm.ask`), whose only caller is
the merged-PR leave question (`plugins/mattstack/hooks/worktree-leave.ts`).

## Problem

The confirm draws its options as a row of buttons in the WIP `solid` /
`solidMuted` tones. Those tones map to the engine's theme keys, which are too
coarse for hover and press steps, and Matt rejected each look they produced.

## Fix

Draw the options as numbered rows, the way Claude Code's own permission
prompt lists `1. Yes / 2. No`, built only from mod-kit pieces the kit already
has: the `QUIET` fills, the `keySelected` ▎ edge and `keyPressing`.

### Layout

```
▤  mattstack                                   Hide ⌄
                                          (blank)
┌  MR !267 merged
│  rt is cleaning up this worktree. No answer in
│  2 minutes moves this session out.
└
                                          (blank)
   ▎1  Exit worktree and continue
    2  Close session
```

- Rows start at column 3, as `buttonRow`'s roomy indent does.
- A row is: edge cell, number (DIM), two spaces, label, padded to the widest
  label plus two, so every row is the same width.
- Order: the finishing option (option 0) is row 1, the others follow in
  option order. Up to 9 rows.
- No hint line: numbered rows explain themselves.

### States

| State | Keyed row | Other rows |
|---|---|---|
| Opens | Keys on row 1: `QUIET.rest` fill, ▎ edge, `QUIET.label` | No fill, default text |
| Hover | Row under the pointer: `QUIET.hover` fill, white label. The keyed row keeps its edge | |
| Mouse down | `QUIET.press` fill, white label | |
| Enter or a digit | That row draws pressed (`keyPressing`), then answers | |
| Pane unfocused | No edge, keeps `QUIET.rest`, label `QUIET.muted` | Labels via `muted()` |
| Disabled | Not needed: a confirm row is never disabled | |

### Keys and pointer

- ↑↓ and Tab / Shift-Tab move the keys between rows, stopping at the ends
  (as the confirm's ←→ clamps today).
- `1`-`9` answer that row at once, with the pressed flash.
- Enter answers the keyed row. A click answers the clicked row.

### Colours and contrast

The kit holds dark values only today. Light values are proposed.

| | Dark (kit today) | Light (proposed) |
|---|---|---|
| Rest fill / label | `#363636` / `#e0e0e0` (9.2:1) | `#e6e6e6` / `#2a2a2a` (11.5:1) |
| Hover fill / label | `#4a4a4a` / `#ffffff` (8.9:1) | `#d6d6d6` / `#000000` (14.4:1) |
| Press fill / label | `#404040` / `#ffffff` (10.4:1) | `#dcdcdc` / `#000000` (15.3:1) |
| ▎ edge on rest / hover / press | `#FF6B9D`: 4.5 / 3.3 / 3.9 | `#c2185b`: 4.7 / 4.0 / 4.3 |
| Unfocused label on rest | `#999999`: 4.2:1 | `#6e6e6e`: 4.1:1 |

Every edge holds 3:1 (the non-text minimum). The unfocused labels sit just
under 4.5:1. That matches what `QUIET.muted` gives every quiet button today,
so changing it is a kit-wide question, not this change's.

## Kit changes (`packages/mod-kit`)

- A new widget, `numberedRows` (working name), in `src/widgets/`. It is not
  the kit's `menu` (whose rows are cyan bold text on tree connectors, no
  fill) or `selectList` (clack radio marks). The mock's note that called D
  "menu rows" is wrong and gets corrected.
- Remove the WIP `solid` / `solidMuted` tones: their `FILL` entries,
  `PRESS_THEMED`, their `MUTED_FILL` rows, the `ButtonTone` members, the
  README lines and the theme tests.
- README entry for the widget.
- Rebuild gate-form, human-todos and kit-gallery; bump human-todos and
  kit-gallery one patch each.

## gate-form changes (`mods/gate-form`)

- `confirmFoot` draws `numberedRows` instead of `buttonRow`.
- `confirmOrder` becomes plain option order (the finishing option is first,
  no longer moved to the right edge).
- `confirmKey`: ↑↓ / Tab move, digits answer, Enter answers.
- The confirm draws no hint (`hint()` returns nothing for a confirm).
- Decisions 1, 2, 5 and 7 from the handoff stand (one page, no empty band,
  the copy, the one-colour rail). Decision 6 (one button group, finishing on
  the right, `←→ choose`) is replaced by this layout.

## Decision: light scheme

The kit has no notion of light or dark: every fill is a dark hex. On a light
terminal the dark quiet fill still reads (label 9.2:1, fill vs a `#fafafa`
background 11.6:1); it just looks heavy.

1. **Ship D on today's dark values; light values in a kit-wide follow-up.**
   (Recommended: no new plumbing in this change, and every kit surface
   gains light mode at once later.)
2. Add the scheme to the kit now: read the `theme` row from
   `$.config.list()`, follow the `config.set` hook for `theme`, and pick the
   light hex. Open: what that row holds for a theme that follows the
   terminal.

## Out of scope

- The gate's submit page. It already uses ↑↓ for the More actions rows
  (Pause run, Go back to stage), so D rows there would put two up/down lists
  on one page. A possible follow-up once the confirm has been lived with.

## Acceptance

- The leave question shows two numbered rows, Exit worktree first and keyed.
- Hover, mouse down, Enter flash, digit answer and unfocused all look as in
  frame D, in your own pane via `/leave-demo`.
- Nothing in gate-form sets a fill or colour itself; it all comes from the
  kit.
- Once Matt calls the design final: `confirm.test.ts` and `theme.test.ts`
  updated, `bun run mods:test`, `bun run mods:build --no-validate` with
  `git status --porcelain -- plugins/` empty, `claude plugin test` for each
  rebuilt plugin, `bunx tsc --noEmit -p .`.

Source: `.superpowers/handoff-gate-form-confirm.md`; mock `mod kit confirm.pen`, frame D.
