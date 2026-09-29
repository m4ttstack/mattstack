# Boxscore design overhaul, approved 2026-09-28

A full redesign of boxscore's pages: the leaderboard (table, cards and
trend), the person stat detail with every evidence shape the server returns,
and the refresh states. Approved by Matt on 2026-09-28. The `.pen` file and
the renders here are the reference for implementation; where a component
library cannot draw a design as is, the library is adapted, never the design.

Every person, handle, project, ticket and MR title on the canvas is invented.
The numbers keep realistic shapes (window sizes, counts, title lengths) so the
layouts are proofed against real volumes.

## What lives here

| file | what it is |
| --- | --- |
| `boxscore.pen` | the design source, a pen.dev document. Open it in Pen; the MCP reads and edits it. Never edit the renders by hand. |
| `renders/*.{dark,light}.png` | 1x exports of every board, both themes |

Colours are pen variables named after the `--tk-*` role tokens in
`packages/tokyo/src/tokyo-theme.css` (plus `light-<hue>` for the Mantine
light variant), per `docs/apps/ui-authoring.md`. Weights are 400, 500, 700.

## Boards

- `Leaderboard · Table`: the stat-leaders strip (one leader per group, with
  your own value and rank), then the standings. Group tabs replace the old
  horizontal scroll; Overview shows nine headline stats.
- `Leaderboard · Cards`: every stat as a ranked card. A stat where everyone
  ties shows a tied state instead of a list. The settings tooltip on the rail
  shows the rail entry opening console's boxscore section.
- `Leaderboard · Trend`: the table in Trend mode. Each value carries a
  change against the prior window, green when better and red when worse by
  the stat's own direction (a longer wait for review is worse).
- `Person · Stat detail`: the page a card or table row opens
  (`/user/:name/:stat`). Profile header, rank summary, the stat rail, and
  the Issues done panel.
- `Stat detail · evidence variants`: the right-hand panel for every other
  evidence shape. Stats that share a shape share a panel: Added and Deleted
  open MRs merged, Reverted opens Revert rate, Current streak opens Merge
  streak, Response time uses Wait for review.
- `Leaderboard · Refreshing`: a warm-cache refresh. The last good numbers
  stay, dimmed, under a phase stepper fed by the job's progress events.
- `Leaderboard · First load, stalled`: a cold cache with a skeleton table,
  and the stall notice when progress stops moving.

## Rulings

- Leader mark is gold (`--tk-fill-gold` with `--tk-on-fill-gold`); your own
  row is the accent. Other hues and neutral marks were tried and rejected.
- Five metric groups: Delivery, Volume, Quality, Consistency, Collaboration.
  `src/shared/metrics.ts` moves from three groups to these.
- No settings page in boxscore; the rail entry links to console.
- Charts use `@mantine/charts` through a lazy `@mattstack/app-kit/charts`
  subpath. Histograms, stacked pipeline rows and the merge-days strip are
  `BarChart`; ranking rows and single bars are `Progress`; the push
  calendar (weeks as rows, counts in cells) and the team dot strip are small
  custom components.
