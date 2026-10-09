# Console design boards

Two designs live here, each in its own pen.dev document: the pipeline viewer
on the Wiring page's Graph tab (`console.pen`) and the settings rows
(`settings.pen`). They share `renders/` and `parity/`; the tables below say
which files are whose.

## Pipeline viewer

The design for console's Wiring Graph tab: skills drawn as templates, with
the files that fill each placeholder on one side and the steps it links to on
the other, a drawer for reading and rebinding, and the unsynced banner and
confirm. The spec is
`docs/superpowers/specs/2026-10-01-console-pipeline-viewer-design.md`; the
`.pen` and the exports here are the reference every UI task is compared with.

Every pack, skill, file and contract name on the canvas is invented (`acme`
is the pack). The line counts and title lengths keep realistic shapes so the
layouts are proofed against real volumes.

### What lives here

| file                               | what it is                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `console.pen`                      | the design source, a pen.dev document. Open it in Pen; the MCP reads and edits it. Never edit the exports by hand. |
| `parity/<slug>.<light\|dark>.html` | html-css export of each board with layer names, the design side of `scripts/parity/compare.ts`                     |
| `renders/<slug>.<light\|dark>.png` | 1x PNG export of each board, 1680 x 1040                                                                           |

The file also holds exploration boards (window chrome, tray options, React
Flow focus studies, anatomy sheets). Only the 18 boards below are the
reference; nothing else is exported or compared.

### Boards

Each slug is drawn in a light and a dark frame. Routes are on the Wiring page
(`/wiring?tab=graph`); `scenario` is the fixture scenario the harness loads.

| slug                 | frame (light)                             | light id | dark id  | route                                                                                     | extra                                      |
| -------------------- | ----------------------------------------- | -------- | -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| `template-work`      | `Template · work · light`                 | `lC5eZ`  | `T2xm1n` | `/wiring?tab=graph&focus=pipeline:feature`                                                |                                            |
| `template-plan`      | `Template · plan · light`                 | `I4dEtA` | `E3EwS`  | `/wiring?tab=graph&focus=stage-plan`                                                      |                                            |
| `drawer-text-range`  | `Template · work · drawer · light`        | `BdTVo`  | `kDP83`  | `/wiring?tab=graph&focus=pipeline:feature&select=row:1`                                   |                                            |
| `drawer-include-row` | `Drawer · include row · rendered · light` | `dXMWN`  | `Z5jhtb` | `/wiring?tab=graph&focus=stage-plan&select=row:140`                                       |                                            |
| `drawer-input-card`  | `Drawer · input card · used by · light`   | `JG4X2`  | `S30e79` | `/wiring?tab=graph&focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by` |                                            |
| `drawer-history`     | `Drawer · output · history · light`       | `vS78O`  | `MlMLL`  | `/wiring?tab=graph&focus=stage-plan&select=output&drawerTab=history`                      |                                            |
| `drawer-rebind`      | `Drawer · slot row · rebind · light`      | `arHq7`  | `yyN81`  | `/wiring?tab=graph&focus=stage-plan&select=row:136&rebind=1`                              | open the picker, pick `plan-policy-strict` |
| `unsynced-banner`    | `Unsynced · banner after rebind · light`  | `S9Mvq`  | `sNfzF`  | `/wiring?tab=graph&focus=stage-plan`                                                      | scenario `unsynced`                        |
| `unsynced-confirm`   | `Unsynced · sync confirm · light`         | `dkOZg`  | `V9BST`  | `/wiring?tab=graph&focus=stage-plan`                                                      | scenario `unsynced`, click "Sync changes"  |

The dark frame of each pair carries the same name with `dark` in place of
`light`. To re-export a board, open `console.pen` in Pen and run Pencil's
`Export` on its id: `html-css` with `includeLayerNames: true` into `parity/`,
and `png` at `scale: 1` into `renders/`, renamed to the slug pattern.

### Checking the app against a board

Follow `apps/console/scripts/parity/run.md`. The app side runs on the design
fixture: the console server started with `CONSOLE_FIXTURE=design` answers from
the same invented `acme` pack the boards draw, and `CONSOLE_FIXTURE_SCENARIO`
is the board's scenario (`clean`, or `unsynced` for the two unsynced boards).

### Kit chrome is not compared

The rail, app bar, PageShell tab bar, Drawer frame and Modal frame are the
kit's and Mantine's own, so a parity run compares the content inside them
and never the frame around it. The boards draw that chrome only so each
content layer sits where it will in the app. The rebind picker is not chrome:
its list of files sits inside the panel, as drawer-rebind draws it, so the
list and its rows are compared with the rest of the drawer.

### Board-fix list

Where a kit piece and a board disagree, the kit wins (`docs/apps/ui-authoring.md`).
Each difference below is expected in a parity run and is not fixed in the
app. A kit-versus-board difference found in a later task is added here by that
task, never left silent.

- Drawer shadow and border: Mantine `Drawer`. Its 1px border sits inside the drawer's 600, so the drawer's content is 599 wide where the boards draw it 599.5 to 600. Text set against the right edge of drawer-rebind's options (each row's `s`) sits 1px left.
- Modal frame and button sizes: the kit's `modals.confirm`. Its frame draws no rule, and in dark it sits on the panel surface where unsynced-confirm draws the card surface inside the kit border. Its placement and overlay are part of the same frame (kit chrome, not compared): the kit's theme centres every Modal, so the sync confirm's top sits at 407 in the 1040-tall window where unsynced-confirm draws it at 301, and Mantine's overlay dims the page more than the board's backdrop in both schemes.
- Badge and Alert padding: Mantine defaults.
- SegmentedControl active label: Mantine draws the active segment as an indicator beside the labels rather than around its own, so the app names the indicator `seg · <label>` and the active label has no layer to pair with the board's `seg · <label>/l`.
- Focus list box: the list root sits inside `PageShell.Sidebar`, which paints the panel surface (`bg="var(--tk-panel)"`, which the Tokyo theme keeps because an explicit sidebar `bg` marks the rail `data-own-surface`) and the right border. The root itself paints neither, so it compares with no fill or stroke and is 215 wide inside the sidebar's 216. Its height follows console's one page-row height (`PAGE_ROW_HEIGHT`, 40px on every page) rather than the board's 44px Wiring bar, so the list is 4px taller and the bottom-pinned Unwired row sits 4px lower.
- Unwired row rule: a Mantine `Divider` above the row, so the rule is its own element rather than the row's top border.
- Needs attention switch: in the spec, missing from the boards. It sits above the Unwired rule, where it moves nothing the boards draw.
- Stage height: the same 40px page row leaves the stage 952 tall against the board's 948, so the dotted background is 4px taller and the zoom controls, pinned to the bottom, sit 4px lower. Under the unsynced boards' banner the stage is 898 tall against 894, for the same reason.
- Edge layers: the board exports each edge's line as its own svg box, the line's box plus a pixel all round. The app draws the line as a React Flow SVG path, whose measured box is the line itself (no height when it runs straight). Both run between the same points, so only each edge layer's width and height differ.
- Output share bar: the board sizes the segments by eye (8% drawn 23px wide, 58% drawn 181px); the app sizes each by its share of the rendered lines. The darker tone marks the selected part (drawer-include-row selects L140, gate-protocol; drawer-input-card its card), but template-plan and the two unsynced boards draw gate-protocol darker with nothing selected, drawer-history with only the whole output selected, and drawer-rebind with the domain slot (plan-policy) selected. The app darkens only the part the selection names: its row, its card or the part itself.
- Drawer text past the board's last line: the text-range and include-row boards stop drawing at L44 and L330 with room left for about four more lines, and drawer-rebind stops at L232 with half the drawer left. The app fills the drawer's height, so the rows under them (L45-48, L331-335 and L233-247) have no layer to pair with.
- Drawer code row width: every row of the drawer's text is as wide as the file's longest line, so a highlight still covers a line scrolled into view sideways. The boards' rows stop at the drawer's edge, so each highlighted row (`line N`) compares wider: 681.59 against 599.5 on text-range, 1292.39 on include-row and drawer-rebind.
- Rebind chip arrow: drawer-rebind's chip reads `L136 -> L223-302`; the app writes `→`, as the other boards do. The chip is 6.6px narrower and the sentence after it starts 6.6px left. The unsynced boards' change line (the banner's `c`, the confirm's `list/c`) reads `plan-policy -> plan-policy-strict` the same way, and the app writes `→` there too.
- Filled button border: Mantine draws a filled `Button`'s 1px border transparent over its fill; drawer-rebind outlines Apply, and the unsynced boards Sync changes (in the banner and the confirm), in its own fill colour. They read the same, but the stroke compares as none.
- Public switch and Change button: in the spec, missing from the boards. The switch sits after a verb's file name, before the spacer, so it moves nothing the text-range board draws. Change sits at the end of a slot row's context line and gives way to the rebind panel, and no board draws a slot row with the panel shut.
- Output links chips: the plan board's (and the unsynced boards') "Its text links to" row runs past the right edge of its output card. The app wraps the chips inside the card, so the card and its links section are taller and `dev-servers/SKILL.md` starts a second row.
- Unsynced boards' stale layer names: unsynced-banner and unsynced-confirm keep two names from the clean plan board. The plan-policy-strict card's handle is `handle · in plan-policy.md`, and the output share bar's segment for it is `seg · plan-policy`, though the card and the list beside the bar name plan-policy-strict. The app names both after the file they show, so each compares as one missing and one extra.
- Unsynced boards' canvas bottom: the unsynced boards push the stage down under the banner but leave its dotted layer 948 tall and the zoom controls where the clean board pins them, so both run past the stage's bottom edge (the board render cuts the controls off). The app pins the controls to the stage's bottom and sizes the dots to the stage, so the controls sit 50px higher and the dots compare 898 tall.

The Graph tab's dotted canvas sits on the page ground (`--tk-bg`), as the boards' `Stage` layer does. That is deliberate: the dotted canvas is the one surface exempt from the "never set `PageShell.Content` to `--tk-bg`" rule in `docs/apps/ui-authoring.md`, and a label on it uses the kit's quiet badge tones rather than a gray `light` one.

## Settings rows, direction B4 approved 2026-10-01

The settings row and its explain view, redrawn after the row's three
trailing controls (summary toggle, `⋯`, `›`) and the busy explain modal
proved confusing in use. Approved by Matt on 2026-10-01 ("build B4, keep
the scope names"). Spec:
`docs/superpowers/specs/2026-10-01-console-settings-row-design.md`.

### What lives here

| file                                                                                                           | what it is                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `settings.pen`                                                                                                 | the design source, a pen.dev document. Open it in Pen; the MCP reads and edits it. Never edit the renders by hand. |
| `renders/B-expand-in-place.light.png`, `renders/B4-open-row.light.png`, `renders/R-run-detail-modal.light.png` | 2x exports of the approved boards                                                                                  |
| `parity/README.md`, `parity/boards/`, `parity/build/`                                                          | the build compared with the boards, by eye and by number, and the board corrections that followed                  |

Approved boards:

- `B · Expand in place (approved row)`: rows at rest and under the pointer,
  one open with the Value tab
- `B4 · Tabs back, calmer (approved 2026-10-01)`: the open row, both tabs
- `R · Run detail keeps a thin modal`: the one place the panel still sits in
  a modal

Kept for the record: `A · One row, one door (rejected)`, `B2 · Open row,
Where it's set (too busy)`, `B3 · One line says where it's set (rejected)`,
and `M1` / `M2`, the detail modal that B replaced. Every name, path and
machine on the canvas is invented.

## Settings scope wash, header and team switcher, approved 2026-10-09

Every section splits into scope blocks on a wash of the scope's colour; the
page header says where you are (org and team) and who you are; an org admin
or team owner can switch to another team's settings; per-project settings
pick their project inside the row. Approved by Matt on 2026-10-09. The org
is `acme`, the teams `widgets`, `gadgets` and `sprockets`, the person
`Sam Rivera`, all invented.

| board | render | what it settles |
| --- | --- | --- |
| `W · Scope wash (approved 2026-10-09)` | `renders/W-scope-wash.light.png` | the wash and the scope badge leading each block's heading |
| `T-A · All settings, every section split (chosen 2026-10-09)` | `renders/T-A-all-settings.light.png` | every section splits, small ones included |
| `H4 · Header on its own surface, quiet title (E2 chosen)`, variant E2 | `renders/H4-header.light.png` | the page name in the app bar on every console page; the header's surface; org, team segment, you and your role; the trimmed filter row |
| `H3 · Context bar with segments` | `renders/H3-team-menu.light.png` | the team menu opening under its segment; the build uses the kit's SearchableMenu, as the archived console's project menu did, with each team's owners |
| `S1 · Team picker open`, `S2 · Viewing another team` | `renders/S1-team-picker.light.png`, `renders/S2-viewing-another-team.light.png` | the viewing banner and Back; their header is superseded by H4 |
| `P · A per-project setting, opened` | `renders/P-per-project-row.light.png` | the project picker in the Value tab and the projects in Where it's set |
| `S3 · Viewing another team, E2 header` | `renders/S3-viewing-another-team-e2.light.png` | viewing another team under the E2 header; the build keeps only a Back to your team button beside the team |
| `R2 · Role badges` | `renders/R2-role-badges.light.png` | the badge for each role: org admin gold, team owner purple, member and not connected grey |

Kept for the record: `W0 · Section headings today`, `T-B · All settings,
12-setting rule (not chosen)`, `H · Settings header, tidied`, `H2 ·
Settings header, calmer`, and H4's E1 and E3.

## Runs redesign

The run page (live and finished) and the runs pages (Lanes and the Day
timeline). The spec is
`docs/superpowers/specs/2026-10-08-console-runs-redesign-design.md`; the
boards here are the reference every UI task of
`docs/superpowers/plans/2026-10-08-console-runs-redesign.md` is compared with.
The design source is `runs.pen` (pen.dev); every ticket, repo, run and name on
it is invented (`acme/web`, `WEB-4xx`).

### Boards

Each slug is drawn in a light and a dark frame. `scenario` is the design
fixture scenario the harness loads (`CONSOLE_FIXTURE_SCENARIO`).

| slug                   | frame (light)                                                                          | light id | dark id  | route                                     | scenario     |
| ---------------------- | -------------------------------------------------------------------------------------- | -------- | -------- | ----------------------------------------- | ------------ |
| `runs-lanes`           | `Runs · A · Lanes`                                                                     | `VgoVH`  | `i3s19q` | `/`                                       | `runs`       |
| `runs-timeline`        | `Runs · B · Day timeline`                                                              | `NnSYh`  | `s72EG`  | `/?view=timeline`                         | `runs`       |
| `runs-empty`           | `Runs · State · Nothing live or waiting`                                               | `hf9kp`  | `h1rK2E` | `/`                                       | `runs-empty` |
| `run-live`             | `Run · A · Live story`                                                                 | `CiXq3`  | `M60gHD` | `/runs/remote%3Aacme%2Fweb/20261008-1338` | `runs`       |
| `run-gate`             | `Run · A · Gate open`                                                                  | `ZDGNt`  | `zcWiu`  | `/runs/remote%3Aacme%2Fweb/20261008-1340` | `runs`       |
| `run-record`           | `Run · A · Record (finished run)`                                                      | `p54Uq`  | `lzSxv`  | `/runs/remote%3Aacme%2Fweb/20261008-1142` | `runs`       |
| `run-review-live`      | `Run · State · Review run (live, waiting in the board)`                                | `p3K9mj` | `AqQeM`  | `/runs/remote%3Aacme%2Fweb/20261008-1502` | `runs`       |
| `run-two-gates`        | `Run · State · Two gates (one herd-owned)`                                             | `b7Glr`  | `Blua8`  | `/runs/remote%3Aacme%2Fweb/20261008-1600` | `runs`       |
| `run-story-edges`      | `Run · State · Story edge cases`                                                       | `wEAjb`  | `LXpRo`  | `/runs/remote%3Aacme%2Fweb/20261008-0900` | `runs`       |
| `run-record-abandoned` | `Run · State · Record headers (abandoned work run, review run)`, root `Hero abandoned` | `wHNMJ`  | `e9le3O` | `/runs/remote%3Aacme%2Fweb/20261007-1310` | `runs`       |
| `run-record-review`    | same frame, root `Hero review`                                                         | `wHNMJ`  | `e9le3O` | `/runs/remote%3Aacme%2Fweb/20261008-0940` | `runs`       |

`Run · B · Stage browser` is the source of the Plain/Annotated evidence viewer
only; it is not a parity board. The dark frame of each pair carries the same
name with `· dark` appended.

Exports follow the pipeline viewer's pattern: `parity/<slug>.<scheme>.html`
(html-css with layer names) and `renders/<slug>.<scheme>.png` (1x). The two
record-header slugs share one frame's export. `runs.pen` here is the design
source the harness reads hug widths from (each runs board's `penPath`).

### Fixture data

`CONSOLE_FIXTURE=design` with `CONSOLE_FIXTURE_SCENARIO=runs` answers the runs,
gates, enrichment, effective-inputs, stage-doc, evidence and artifact routes
from `apps/console/src/server/fixtures/design/runs/` (`runsFixture.ts`), and
`runs-empty` keeps only the finished runs. `runs-outage` answers the runs,
run, gates and effective-inputs routes `502 daemon unreachable`, and every
write under the fixture is refused `403`. Each answer carries the fixture's
clock as `asOf`: 4:23 PM for the runs pages, 4:21 PM for a run page, 3:11 PM
for the live review run. Runs that only a run board draws are hidden from
every list. There is no deck behind the fixture, so a live review run's
`boardUrl` points its waiting post gate at an invented board,
`http://localhost:11006/?gate=<id>`. The boards disagree with each other in places; the fixture takes
these sides:

- Run boards win over the runs pages. The Lanes ages and the `2h 10m` median
  compare by their words only (`dynamicText`). The finished-today stat (3, "2
  merged · 1 review posted") comes from the Earlier rows and compares as
  written.
- run-gate copies WEB-412's header, so WEB-418 starts at 1:38 PM, provision
  takes 1m and plan has run 4m. The timeline's WEB-418 lane (drawn from 3:12
  PM) and WEB-412 lane (rail durations against answers at 1:41 to 2:02 PM)
  follow that data, not the bars. The other lanes follow the bars.
- The record headers board draws both spans as "Oct 8, 11:42 AM → 2:14 PM".
  The abandoned run matches; the review record keeps its 23m and starts 9:40
  AM.
- Timeline lane titles are shorter than the Lanes titles; the fixture has the
  Lanes ones.
- WEB-412's strategy and plan fields share one time, so the Lanes card's
  latest field and the Now card's order (Strategy, Plan) can both hold.
- The board words a pick shorter in the Decisions side card (`Both parcels
and recipients`) than in the story (`Both linked parcels and recipients`).
  The fixture keeps the short wording as the option's value and the long one
  as its label; both places show the label (see the board-fix list).
- No data source yet: a review run's MR title ("Dedupe contacts on import"),
  its author ("by a teammate"), the pack version ("acme pack 1.4.2"), an MR's
  draft state ("!409 draft"), the context labels "The spec · 1 page" and
  "Candidates the agent pulled · 4 orders", and the wording of the
  timeline's "Decisions you made today" rows. The gate panel names its steps
  from the questions' ids (`approach` is "Approach").
- The gate boards (run-gate, run-two-gates) draw each open gate with a saved
  draft: its first option picked and "draft saved" in the footer. The parity
  run seeds those drafts through each board's `storage`
  (`console.gateDraft.<gate id>`). The fixture's open run gates carry a pane
  origin, so "Open the pane" is enabled as drawn (the fixture still refuses
  the focus).
- The record headers board leaves "took the recommendation" off both headers,
  so the abandoned run's gates and the review run's post gate name no
  recommended option.

### Board-fix list (runs redesign)

- Boards draw Inter; the console renders the system sans. Text widths differ
  by font, which the parity run's font handling accounts for.
- The run page layers (run-live, run-review-live, run-story-edges, and the
  hero, Now, story and side layers of run-gate) were renamed by role in
  `runs.pen` (`ticket`, `meta`, `title`, `Chip liveness`, `out <Label>` with
  `v`, `Story <stage>` with `name` and `duration`, `q`/`a`/`stamp` in a
  Decision, `label`/`value`/`sub` in a Fact) and re-exported: the names copied
  between boards no longer described the layers. Nothing drawn changed.
- The gate panel layers (run-gate's `Gate` and both run-two-gates gates) were
  renamed the same way (`title`/`sub`, `step` with `n`/`num`/`label`, `p`,
  `progress`, `q`, `opt` with `label`/`desc`/`kbd`/`k`, `primary` with `l`),
  and run-gate's root is `Gate mine`, as on run-two-gates. run-gate's rail
  durations and its empty Decisions line took their run-live names.
- The record layers (run-record and the record headers board) were renamed the
  same way (`primary`/`ci` pills with glyph-named icons and `label`, `Stat
<role>` with `value`/`label`, `tab <name>` with `label` and `count`/`n`,
  `Index <stage>` with `name`/`overrode`/`count`, `Stage <stage>` with
  `name`/`meta`, `Decision` with `q`/`stamp`/`ov`/`opt`/`rec`/`note`/`text`,
  evidence `title`/`attached`/`img`/`phase`/`name`, `Case` with
  `title`/`value`). The two record headers share a frame, so the board names
  them `Hero abandoned` and `Hero review`; both compare the app's `Hero`
  (`appRoots` in `boards.ts`).

Run page (run-live, run-review-live, run-story-edges), each kit or token
difference once:

- Cards (Hero, Now, Decision, Evidence card, Facts, Decisions mini, Inputs,
  the hand-off card and its option chips) are kit `Paper variant="ground"`,
  ruled in `--tk-border`; the board rules them in `--tk-border-soft`, and the
  Now card in an accent ring.
- Quiet labels (Story label, EVIDENCE, card titles, Fact labels, stage doc,
  answer stamps, not-started stage names) are `--tk-text-3`; the board's
  `--tk-muted` grey misses the 4.5 text bar.
- Accent text (the ticket, the Now head, Open log, View inputs, links) is
  `--tk-text-accent`; the board uses the accent fill, which fails as text in
  dark.
- Kit controls keep their own size and colours: the hotkey `Kbd`s, the
  liveness `Badge`, the Focus pane `Button`, the overflow `ActionIcon`, the
  `CopyActionIcon`s, the Decision expand `ActionIcon` (the stamp sits 8px
  further left), the Plain/Annotated `SegmentedControl` (its options are not
  keyed), the not-started rail `Progress` track, the stage tag `Badge` and the
  hand-off option and recommended `Badge`s.
- The board draws the evidence screenshot as shapes (`a`, `card`, `lab`,
  `b`); the console shows the image itself.
- A story section's rule runs the section's full height; the board's rules
  are fixed lengths (the last run-live section, every run-story-edges
  section), and run-review-live's block keeps the pen's fixed 281px list.
- No data source: the reviewed MR's title (the hero title falls back to the
  branch, and REVIEWED MR shows `!412`), its author ("by a teammate"), and
  the pack version (the side card names the pack's recorded sha, "acme pack
  4c1d9e2"). The stage-doc count is the docs the run read (5 on run-live, 1
  on the review run), not the pipeline's 8.
- The reviewed MR in the side card is a link to the MR; the board draws it as
  text.
- A Decisions side-card row shows the pick's label, as the story's decision
  row does, with its stage tag whole and the pick truncating. The board
  words three run-live picks shorter there ("Both parcels and recipients",
  "Spotlight the parcel card", "Screenshot as planned"), so their text
  differs; real answer values are ids and slugs no person can read.
- The failure Log excerpt carries an "open full artifact in editor" icon in
  its corner, which the board does not draw: the excerpt is bounded, and the
  icon keeps the existing way to the whole log.

Gate panel (run-gate, run-two-gates):

- The panel's step chips are the kit's `Stepper` at `sm`: a numbered icon, a
  label and a separator per step, in the kit's sizes and tones; its icons make
  the head 2px taller. The board draws the active step as a pill, the numbers
  as small filled dots, and short coloured dashes.
- Options are kit `Radio.Card` and `Checkbox.Card` in a `Radio.Group` or
  `Checkbox.Group`, as they ship: the kit's own border, radius and resting
  fill, and the pick shown only by the `Radio.Indicator` /
  `Checkbox.Indicator` (filled, larger than the board's ring, so the label
  sits further right). The board draws a soft outline, and an accent ring and
  wash on the picked card. The recommended `Badge` and the number `Kbd`s are
  the kit's `sm`.
- The note is the kit's `Textarea` (its own height and border, and the
  placeholder is the input's own, not a layer); "Open the pane" and
  Next/Submit are kit `Button`s with their own heights, and the `⌘↵` hint is
  the kit `Kbd`, drawn on the filled button as it is everywhere else.
  The panel grows with those controls and the kit cards: 16px taller than the
  board.
- What the agent found renders through the markdown renderer (paragraphs,
  bullets and a code block in the renderer's own spacing); the board draws it
  as separate text layers, which are not keyed.
- The board's split is a fixed 390px; the panel's is as tall as its form, so
  the herd-owned gate, whose form is shorter, is 15px shorter.
- The rail's gate count is the number of gates on the stage (1 on the plan
  stage); run-gate draws the plan gate's three questions.
- run-gate's story draws the provision stage as a summary row ("1m ·
  worktree molly on …") under "STORY SO FAR · 1 STAGE". The story leaves out
  an attempt with nothing recorded, as run-live draws it, so this run has no
  story yet and run-gate compares Hero, Gate mine and Side only.

Record view (run-record, run-record-abandoned, run-record-review). The run
page entries above (card rule, quiet labels, accent text) apply here too:

- The tabs are kit `Tabs`: their own padding and height, the kit's label
  size and weight (the board sets 13px, 700 on the active tab and 500 on the
  rest), an inactive label in the text colour, the list rule drawn by the kit
  (no stroke on the list itself), and the counts as kit `Badge sm` in its
  light tones (18px tall).
- The By stage index is kit `NavLink`s: 32px rows with the kit's padding and
  label type (the board sets 13px, 500), and the current stage in the kit's
  accent light tone (the board paints it the card colour with plain text).
- The outcome pills are kit `Badge lg` in light tones (abandoned in light
  gray, with no ring); the overrode mark is a kit `Badge sm` in warn; the
  recommended mark is a kit `Badge xs` `outline` in gray as it ships: 16px
  tall against the board's 12px, its ring in the kit's gray (bright in dark)
  rather than the board's soft rule.
- "Compare full size" is a kit default `Button` (36px, filled, the kit's
  label type where the board sets 12.5px, 500), and its arrows are icons, not
  the board's "← →" text.
- The transcript renders through the markdown renderer (a code block on the
  inset surface); the board draws a dark block with a "console transcript ·
  after" head, which has no data source.
- The thumbnails show the evidence images (the board draws shapes `a`-`d`)
  and their captions name the file ("before.png"); the board's "shipping
  panel" has no data source.
- The board draws only the plan and evidence cards (its frame ends at
  1220px); the log lists every stage's gates, so the self-review and ship
  heads and cards are extra keys and `Columns` is taller.
- No data source for two context labels: the board's "The spec · 1 page" and
  "Candidates the agent pulled · 4 orders" read "What the agent found · 3
  lines" and "· structured context".
- The posted label reads in sentence case ("reviewed !412 · Request
  changes"); the board writes it in lower case.

Runs page, Lanes (runs-lanes, runs-empty). The run page entries above (card
rule, quiet labels, accent text) apply here too: the stat cards, lanes, the
Earlier card and the empty card are ruled in `--tk-border`; the stat and
section labels, a lane's age, a row's end time and its evidence dash are
`--tk-text-3`; the banner and lane tickets are `--tk-text-accent`.

- The Lanes layers were renamed by role in `runs.pen` (`Stat <role>` with
  `label`/`value`/`oldest`/`stages`/`split`/`median`/`window`; `Banner
waiting` with `Header` (`title`/`gate`/`hint`), `ticket`/`title`/`q`, `opt`
  with `kbd`/`k`/`label`/`rec`, `Answer btn` with `label`, and `progress`;
  `Live label` and `Earlier label`; `Lane` with `ticket`, `Chip liveness`,
  `focus`, `title`, `stage`/`elapsed`/`field` and a `footer` with `mr
text`/`decisions`/`age`; `Day` with `label`; `Row` with `outcome`,
  `ticket`/`name`/`sub` and `decisions`/`evidence`/`duration`/`end`) and
  re-exported: text layers were named after their first words, and several
  of those words were copy leftovers. Nothing drawn changed.
- The filter is the kit `SegmentedControl` and the repo picker the kit
  `Select` (`all repos`, a branch icon), as they ship; neither is keyed, so
  `Segmented` and `Repo select` are missing keys.
- The banner's options are kit `Badge lg` chips with kit `Kbd xs` numbers,
  as the hand-off card's are: wider and with taller hotkeys, the label in
  the badge's own text colour, and the recommended option in the kit's light
  accent tone with no accent ring; its "recommended" mark sits in the badge's
  right section at the line's height. "Answer gate" is the kit `Button`
  (36px tall, the kit's label type).
- A lane's liveness chip is the kit `Badge` in its light tone (its own tint
  and small-text ink); "focus pane" is the kit `ActionIcon` (28px; a negative
  margin keeps the head row at the board's 24px); the rail is the compact
  `StageRail` (kit `Progress sm`, 5px bars, the not-started track in the
  kit's track colour), so a lane's now line and footer sit up to 2px higher.
- The board's `Content` fills its frame to the foot; the page's is as tall
  as what it holds.
- No data source for an MR's draft state: WEB-397's lane reads "!409 open ·
  CI running" where the board draws "!409 draft".
- The fixture has three finished work runs, so the median card reads "2h
  30m" over "last 3 work runs"; both compare by their words (`dynamicText`).
- The banner's run (WEB-418) is the banner, not a lane, which is why the
  board draws "LIVE · 2" with three runs running.
- The runs page keeps no "seen" state: the old board sank runs you had
  opened, and the redesign draws every run in time order, so the console no
  longer records a visit.
- No board draws a finished run rt still flags (`stranded`): its row takes a
  warn tile (`triangle-alert`) and "· stranded" after its ending, as a stale
  run's row says "stale".

Runs page, Day timeline (runs-timeline). The run page entries above (card
rule, quiet labels, accent text) apply here too: the timeline, time and
decisions cards are ruled in `--tk-border`; the axis ticks and the card labels
are `--tk-text-3`; the tickets and "now" are `--tk-text-accent`.

- The Day timeline layers were renamed by role in `runs.pen` (`title`/`sub`
  in the title block, `prev`/`today`/`next` in the day nav, `label` in each
  legend item, `Lane` with `ticket`/`title`/`sub`, `Hint` with `hint`, `part
<category>` and `Total <category>` with `value`/`label` in the time card,
  `Decision` with `ticket`/`text`) and re-exported: lane layers were named
  after their ticket and text layers after their first words, several of them
  copy leftovers ("Implement", "Plan & evidence", "4 comments · 23m").
  The time card's idle part, painted in the stage colour, now takes the idle
  grey the legend uses; nothing else drawn changed.
- Day navigation is kit `ActionIcon`s and a kit `Button` (36px, the kit's
  label type), and the view toggle is the kit `SegmentedControl`, as they
  ship; none is keyed, so `prev`, `today`, `next` and `View toggle` are
  missing keys. Next is disabled on today.
- Bars are placed from the fixture's run data on the axis's scale, so their
  count, widths and offsets differ from the board's hand-drawn bars: WEB-418
  and WEB-412 follow their run boards (see "Fixture data"), a stage of a
  minute or two draws at the 2px floor, and the board's own bars are
  inconsistent (some end on their minute, some 2px short). Bars keep a 2px
  gap.
- The totals, the hint's waiting time and the time card's stacked bar come
  from those bars, so they read "5h 06m / 53m / 49m / 11h 41m" against the
  board's sample numbers; a figure under an hour has no "h", so masking its
  digits does not make it compare.
- The decisions card lists every gate you answered that day, newest first (14
  on the fixture), where the board draws three sample rows, so the card and the
  summary row are taller and the rows' tickets and wording differ. Each row
  reads the picked options; the board's "Approach: …" wording has no source.
- The "now" line is three accent washes (`--tk-wash`) mixed into the card:
  30% in light, as the board draws it, and 45% in dark, where the board's
  line is a 40% mix that no role token names.
- Lane titles are the fixture's (the Lanes titles), longer than the board's
  (see "Fixture data").
- The Lanes view carries the same Timeline/List toggle beside its filter,
  which the Lanes board does not draw: without it the timeline has no way in.
  It is a kit control and not keyed, so runs-lanes is unchanged.

## Runs pass 2

The second design pass over the runs pages: quieter run pages, a polished
gate form, and a board for every surface a click or a failure can reach. The
spec is `docs/superpowers/specs/2026-10-09-console-runs-pass-2-design.md`; the
plan is `docs/superpowers/plans/2026-10-09-console-runs-pass-2.md`.

In `runs.pen` the pass starts at y=6700. Each section pairs a `Before · …`
frame (a capture of the app before this pass, from the design fixture or
Storybook, images under `before/`) with its `After · …` board at x=1540 and
the board's dark copy at x=3080. Light is the base; each dark board is the
light one with `theme: { mode: "dark" }`, sharing its layer tree. The After
boards are the design; the Before frames are reference only and are never
compared.

### Boards

| slug                    | frame (light)                         | light id | dark id  | route                                     | roots                                                       |
| ----------------------- | ------------------------------------- | -------- | -------- | ----------------------------------------- | ----------------------------------------------------------- |
| `runs-p2-live`          | `After · Live run page (quiet story)` | `BqEgW`  | `viNUJ`  | `/runs/remote%3Aacme%2Fweb/20261008-1338` | `Hero`, `Story`, `Side`                                     |
| `runs-p2-gate`          | `After · Gate open`                   | `Q6YEx`  | `HbRPU`  | `/runs/remote%3Aacme%2Fweb/20261008-1340` | `Hero`, `Gate mine`, `Story list`, `Side`                   |
| `runs-p2-record`        | `After · Record (finished run)`       | `P1gMvv` | `sbDKY`  | `/runs/remote%3Aacme%2Fweb/20261008-1142` | `Hero`, `Tabs`, `Decision log`, `Evidence rail`             |
| `runs-p2-inputs`        | `After · Effective inputs drawer`     | `aJIIw`  | `f8Bru`  | `/runs/remote%3Aacme%2Fweb/20261008-1338?inputs` | `Drawer`                                                    |
| `runs-p2-states`        | `After · states`                      | `kxHe1`  | `YunJz`  | one route per panel                       | `Run load error`, `Runs outage`, `Gate refused`, `Toasts`   |
| `runs-p2-runs`          | `After · Runs page`                   | `dX37S`  | `MHMfu`  | `/`                                       | `Title row`, `Summary`, `Banner waiting`, `Live cards`, `History` |
| `runs-p2-review`        | `After · Review run record`           | `tsWMv`  | `P1PkfE` | `/runs/remote%3Aacme%2Fweb/20261008-0940` | `Hero`, `Tabs`, `Review column`, `Side`                     |
| `runs-p2-story-details` | `After · Story details`               | `yFl93`  | `lV4r8`  | `/runs/remote%3Aacme%2Fweb/20261008-1338` | `Hero`, `Story`, `Side`                                     |
| `runs-p2-overlays`      | `After · overlays`                    | `OID6c`  | `VEOxV`  | one route per panel                       | `Stage doc drawer`, `Compare`, `Abandon dialog`, `Setting inline` |
| `runs-p2-search`        | `After · search etc`                  | `n2WWXe` | `mFvLi`  | one route per panel                       | `Search`, `Palette`, `Not found`, `Timeline hover`          |

Every board uses the `runs` scenario except the outage panel of
`runs-p2-states`, which needs `runs-outage`. The tile boards (`states`,
`overlays`, `search`) compare each tile on its own route (`panels` in
`boards.ts`); the task that builds a tile sets its route and action there.
Exports are `parity/runs-p2-<slug>.<scheme>.html` and
`renders/runs-p2-<slug>.<scheme>.png`.

### Superseded first-pass boards

These first-pass boards are replaced by pass 2 and are no longer parity
gates; their frames stay in `runs.pen` for history:

- `run-live` → `runs-p2-live` and `runs-p2-story-details`
- `run-gate` → `runs-p2-gate`
- `run-record` → `runs-p2-record`
- `run-record-review` → `runs-p2-review`
- `runs-lanes` → `runs-p2-runs`

### Board-fix list (pass 2)

Expected differences between a pass-2 board and the app. Each UI task adds
its entries here as it lands.

Gate panel (runs-p2-gate `Gate mine`):

- The step strip is the kit `SegmentedControl` (`variant="quiet"`, `sm`, no
  item borders), as it ships: its track is the kit's raised tone, not the
  board's 60% white, and the raised step is the kit's indicator, a sibling
  of its label, so `step <name>` keys the label (no fill or stroke, the
  label's own box) and the strip is 8px narrower.
- Options are kit `Radio.Card` and `Checkbox.Card` in the kit's `wash`
  variant, which draws the board's rule, accent ring and wash, and the
  picked option's number in the accent. The kit's `Radio.Indicator` is 20px
  and filled when picked (the board's ring is 16px), so each option's text
  sits 4px further right and the card is 1px taller.
- The recommended `Badge` and the command `Code` chip (fill, no stroke) keep
  the kit's colours. The number `Kbd`s keep the kit's fill, stroke and 3px
  foot (22px; the dark scheme's differ from the board's), so their digit's
  box is taller.
- The note is the kit `Textarea`: its border sits on the input, not the
  keyed wrapper, and its placeholder is not a layer (`note/ph`).
- "Open the pane" is a kit `Button` (`subtle`, gray) and Next/Submit a kit
  `Button` at `sm`: 36px tall where the board draws 31px, with the kit's
  label size and colours. The `⌘↵` hint is the kit `Kbd` in its `on-fill`
  variant, at the kit's `sm` size.
- Those kit sizes make the panel 4px taller than the board, so the layers
  below the first option sit 1-6px lower.
- Quiet text (the WHAT THE AGENT FOUND label, the steps after the current
  one, Draft saved) is the console's dimmed tone (slate 11); the board's
  lighter grey misses the text contrast bar.
- The fixture's WEB-418 plan gate now carries the board's context and option
  text, the first option's command in backticks; pass 1's run-gate board no
  longer matches its text.
- The submit-refused strip (runs-p2-states `Gate refused`) is a kit `Alert`
  (`light`, `bad`) holding the message and a kit `Button`; the tile draws a
  shortened panel with no context column, so it is compared by eye, not by
  a root.
