# Console pipeline viewer boards

The design for console's Wiring Graph tab: skills drawn as templates, with
the files that fill each placeholder on one side and the steps it links to on
the other, a drawer for reading and rebinding, and the unsynced banner and
confirm. The spec is
`docs/superpowers/specs/2026-10-01-console-pipeline-viewer-design.md`; the
`.pen` and the exports here are the reference every UI task is compared with.

Every pack, skill, file and contract name on the canvas is invented (`acme`
is the pack). The line counts and title lengths keep realistic shapes so the
layouts are proofed against real volumes.

## What lives here

| file | what it is |
| --- | --- |
| `console.pen` | the design source, a pen.dev document. Open it in Pen; the MCP reads and edits it. Never edit the exports by hand. |
| `parity/<slug>.<light\|dark>.html` | html-css export of each board with layer names, the design side of `scripts/parity/compare.ts` |
| `renders/<slug>.<light\|dark>.png` | 1x PNG export of each board, 1680 x 1040 |

The file also holds exploration boards (window chrome, tray options, React
Flow focus studies, anatomy sheets). Only the 18 boards below are the
reference; nothing else is exported or compared.

## Boards

Each slug is drawn in a light and a dark frame. Routes are on the Wiring page
(`/wiring?tab=graph`); `scenario` is the fixture scenario the harness loads.

| slug | frame (light) | light id | dark id | route | extra |
| --- | --- | --- | --- | --- | --- |
| `template-work` | `Template · work · light` | `lC5eZ` | `T2xm1n` | `/wiring?tab=graph&focus=pipeline:feature` | |
| `template-plan` | `Template · plan · light` | `I4dEtA` | `E3EwS` | `/wiring?tab=graph&focus=stage-plan` | |
| `drawer-text-range` | `Template · work · drawer · light` | `BdTVo` | `kDP83` | `/wiring?tab=graph&focus=pipeline:feature&select=row:1` | |
| `drawer-include-row` | `Drawer · include row · rendered · light` | `dXMWN` | `Z5jhtb` | `/wiring?tab=graph&focus=stage-plan&select=row:140` | |
| `drawer-input-card` | `Drawer · input card · used by · light` | `JG4X2` | `S30e79` | `/wiring?tab=graph&focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by` | |
| `drawer-history` | `Drawer · output · history · light` | `vS78O` | `MlMLL` | `/wiring?tab=graph&focus=stage-plan&select=output&drawerTab=history` | |
| `drawer-rebind` | `Drawer · slot row · rebind · light` | `arHq7` | `yyN81` | `/wiring?tab=graph&focus=stage-plan&select=row:136&rebind=1` | open the picker, pick `plan-policy-strict` |
| `unsynced-banner` | `Unsynced · banner after rebind · light` | `S9Mvq` | `sNfzF` | `/wiring?tab=graph&focus=stage-plan` | scenario `unsynced` |
| `unsynced-confirm` | `Unsynced · sync confirm · light` | `dkOZg` | `V9BST` | `/wiring?tab=graph&focus=stage-plan` | scenario `unsynced`, click "Sync changes" |

The dark frame of each pair carries the same name with `dark` in place of
`light`. To re-export a board, open `console.pen` in Pen and run Pencil's
`Export` on its id: `html-css` with `includeLayerNames: true` into `parity/`,
and `png` at `scale: 1` into `renders/`, renamed to the slug pattern.

## Kit chrome is not compared

The rail, app bar, PageShell tab bar, Drawer frame and Modal frame are the
kit's and Mantine's own, so a parity run compares the content inside them
and never the frame around it. The boards draw that chrome only so each
content layer sits where it will in the app. The rebind picker is not chrome:
its list of files sits inside the panel, as drawer-rebind draws it, so the
list and its rows are compared with the rest of the drawer.

## Board-fix list

Where a kit piece and a board disagree, the kit wins (`docs/apps/ui-authoring.md`).
Each difference below is expected in a parity run and is not fixed in the
app. A kit-versus-board difference found in a later task is added here by that
task, never left silent.

- Drawer shadow and border: Mantine `Drawer`. Its 1px border sits inside the drawer's 600, so the drawer's content is 599 wide where the boards draw it 599.5 to 600. Text set against the right edge of drawer-rebind's options (each row's `s`) sits 1px left.
- Modal frame and button sizes: the kit's `modals.confirm`. Its frame draws no rule, and in dark it sits on the panel surface where unsynced-confirm draws the card surface inside the kit border.
- Badge and Alert padding: Mantine defaults.
- SegmentedControl active label: Mantine draws the active segment as an indicator beside the labels rather than around its own, so the app names the indicator `seg · <label>` and the active label has no layer to pair with the board's `seg · <label>/l`.
- Focus list box: the list root sits inside `PageShell.Sidebar`, which paints the panel surface (`bg="var(--tk-panel)"`, which the Tokyo theme keeps because an explicit sidebar `bg` marks the rail `data-own-surface`) and the right border. The root itself paints neither, so it compares with no fill or stroke and is 215 wide inside the sidebar's 216. Its height follows console's one page-row height (`PAGE_ROW_HEIGHT`, 40px on every page) rather than the board's 44px Wiring bar, so the list is 4px taller and the bottom-pinned Unwired row sits 4px lower.
- Unwired row rule: a Mantine `Divider` above the row, so the rule is its own element rather than the row's top border.
- Needs attention switch: in the spec, missing from the boards. It sits above the Unwired rule, where it moves nothing the boards draw.
- Stage height: the same 40px page row leaves the stage 952 tall against the board's 948, so the dotted background is 4px taller and the zoom controls, pinned to the bottom, sit 4px lower.
- Edge layers: the board exports each edge's line as its own svg box, the line's box plus a pixel all round. The app draws the line as a React Flow SVG path, whose measured box is the line itself (no height when it runs straight). Both run between the same points, so only each edge layer's width and height differ.
- Output share bar: the board sizes the segments by eye (8% drawn 23px wide, 58% drawn 181px); the app sizes each by its share of the rendered lines. The darker tone marks the selected part (drawer-include-row selects L140, gate-protocol; drawer-input-card its card), but template-plan and the two unsynced boards draw gate-protocol darker with nothing selected, drawer-history with only the whole output selected, and drawer-rebind with the domain slot (plan-policy) selected. The app darkens only the part the selection names: its row, its card or the part itself.
- Drawer text past the board's last line: the text-range and include-row boards stop drawing at L44 and L330 with room left for about four more lines, and drawer-rebind stops at L232 with half the drawer left. The app fills the drawer's height, so the rows under them (L45-48, L331-335 and L233-247) have no layer to pair with.
- Drawer code row width: every row of the drawer's text is as wide as the file's longest line, so a highlight still covers a line scrolled into view sideways. The boards' rows stop at the drawer's edge, so each highlighted row (`line N`) compares wider: 681.59 against 599.5 on text-range, 1292.39 on include-row and drawer-rebind.
- Rebind chip arrow: drawer-rebind's chip reads `L136 -> L223-302`; the app writes `→`, as the other boards do. The chip is 6.6px narrower and the sentence after it starts 6.6px left. The unsynced boards' change line (the banner's `c`, the confirm's `list/c`) reads `plan-policy -> plan-policy-strict` the same way, and the app writes `→` there too.
- Filled button border: Mantine draws a filled `Button`'s 1px border transparent over its fill; drawer-rebind outlines Apply, and the unsynced boards Sync changes (in the banner and the confirm), in its own fill colour. They read the same, but the stroke compares as none.
- Public switch and Change button: in the spec, missing from the boards. The switch sits after a verb's file name, before the spacer, so it moves nothing the text-range board draws. Change sits at the end of a slot row's context line and gives way to the rebind panel, and no board draws a slot row with the panel shut.
- Output links chips: the plan board's (and the unsynced boards') "Its text links to" row runs past the right edge of its output card. The app wraps the chips inside the card, so the card and its links section are taller and `dev-servers/SKILL.md` starts a second row.
- Unsynced boards' stale layer names: unsynced-banner and unsynced-confirm keep two names from the clean plan board. The plan-policy-strict card's handle is `handle · in plan-policy.md`, and the output share bar's segment for it is `seg · plan-policy`, though the card and the list beside the bar name plan-policy-strict. The app names both after the file they show, so each compares as one missing and one extra.

The Graph tab's dotted canvas sits on the page ground (`--tk-bg`), as the boards' `Stage` layer does. That is deliberate: the dotted canvas is the one surface exempt from the "never set `PageShell.Content` to `--tk-bg`" rule in `docs/apps/ui-authoring.md`, and a label on it uses the kit's quiet badge tones rather than a gray `light` one.
