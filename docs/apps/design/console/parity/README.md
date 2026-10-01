# Parity: settings rows build vs boards B, B4 and R

The build (Storybook stories `console-settings-rows--expand-in-place`,
`--where-its-set` and `--run-detail-modal`, which reproduce the boards'
content) was compared with `settings.pen` by eye and by number. The numbers
come from `getBoundingClientRect()` in Fast Browser at 1280x1000 and pen's
node bounds, in CSS px at 1x.

| folder | what it holds |
| --- | --- |
| `boards/` | B list, B4 list and the R modal exported from pen at 1x, after the board corrections below |
| `build/` | the matching story captures, light and dark, each with one hover state (B: a row; B4: a layer line's actions and tooltip; R: a layer line) |

## Layout, board vs build

All rows measure equal after the code fixes listed in the last column.

| element | board | build | fixed in code |
| --- | --- | --- | --- |
| closed row height (with its 1px rule) | 61 | 61 | was 62.5: source word line height, bottom padding |
| gap around an open row | 8 | 8 | |
| key in a closed / open row (x, y) | 12, 12 / 12, 12 | 12, 12 / 12, 12 | open was 13, 13: the card border pushed content |
| description top, below the title top | 22 | 22 | was 23 |
| control x / chevron x (closed and open) | 716 / 1000 | 716 / 1000 | open was 715 / 999 |
| tabs: x, top below row top | 12, 61 | 12, 61 | |
| caption: text x, height, top to first line | tabs x, 15, 23 | tabs x, 15, 23 | was tabs x + 8, 25, 25 |
| layer line height / pitch / padding | 38 / 40 / 8 | 38 / 40 / 8 | pitch was 38 |
| value x inside the line | 108 (88 column + gaps) | 108 | was 152 (132 column) |
| badge and value centre in the line | 19 | 19 | the value sat about 3px high |
| string values | `info` | `info` | were JSON-quoted |
| modal header padding, key x / y, close x / y, description y | 16 16 14 20, 20 / 20, 716 / 16, 48 | same | was 11 / 15 throughout |
| modal tabs x, layer lines x range | 20, 20 to 740 | 20, 20 to 740 | were 11, 11 to 749 |
| modal height | 295 | 295.4 | board was 289 before the kit tab correction |
| `rt.worktreeApp` summary | `3 of 3 set` | `3 of 3 set` | story fixture lacked `authored` |

## Board corrections

These are where the kit, the theme or a decision decides, so the board moved
to the build:

- **Matt's decisions (2026-10-01)**: the badge column stays the board's 88px
  (a long rung label truncates and shows a tooltip); a composite summary
  stays `2 fields`; gitq.board's Value tab is today's JSON editor (its
  schema has no form), so the boards now draw that editor, with no Form |
  JSON toggle and a disabled Save while the draft is unchanged (`Save`,
  not `Save to machine`).
- **Spec, control column unchanged**: `rt.daemonPath` is a text input with
  the placeholder `unset`, `rt.runsPruneDays` a number input with `days`,
  and the enum Select is 120px wide.
- **Kit geometry**: SegmentedControl `sm` is 156x31 with 11.2px labels at
  weight 600 (the board drew 158x25 at 12px); layer actions are 28px
  ActionIcons, 2px apart; Tooltip is 31px tall, sans 11.2px, radius 6,
  below its target; Buttons are 26px tall at 11.2px; inputs, Select and
  Buttons have radius 6; the Modal's radius is 6 (the board drew 12).
- **Theme colours**: `--tk-text-2/3/4` all resolve to one muted grey
  (`#60646c` light), so the board's lighter `#80838d` became that grey (the
  caption, overridden values, `unset`); the soft border is `#d9d9e0`;
  "in effect" text is the small ok token (`#0d3d38`, glyph `#008573`); badge
  labels use their hue's small text token at weight 500 with a 6px dot;
  chevrons are always the primary text colour; primary text (key names, the
  winning value, active tab, input text) renders `#000`, Mantine's body
  text, where the board used `--tk-text-1` `#1c2024`.
- **Board B's open row** now copies B4's open row, so the open panel has one
  geometry on both boards.

The board's sans font is Inter; the app's is the system font
(`-apple-system`), so text widths differ by a pixel or two at most. Layout
does not depend on it.

## Dark scheme

Every surface, border, badge and status reads. Three things look heavier
than the rest, all kit or theme:

- The grey `default` badge is a near-black chip with white text in dark,
  where the other badges are tinted washes.
- The unset Switch's track is very pale in light.
- A disabled Save's label is faint in dark.

The R captures show the close button's focus ring: Mantine focuses the
first control when a modal opens without a pointer. Opened by a click, as in
run detail, the ring does not show.

## Live data

`/settings` and a run detail's configuration modal were checked against real
settings in both schemes (captures kept out of the repo: they hold real
paths). The open row, its tabs, the reveal scroll on `?explain=`, hover and
the gitq.board JSON editor all read as the stories do. One thing reads
wrong: in run detail, a repo-scoped key with no repo picked (`rt.worktrees`)
lists every repo section as a full JSON block. That Repos list moved over
from the old modal unchanged, and it is the busiest thing left in the panel.
