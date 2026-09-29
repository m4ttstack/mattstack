# Boxscore redesign: implementation design

Date: 2026-09-29. Status: draft for review.

## Goal

Rebuild boxscore's UI to match the approved design in
`docs/apps/design/boxscore/` (`boxscore.pen`, `renders/`, `README.md`).
The design is the source of truth: where a component library cannot draw a
board as designed, the library is adapted or a small custom component is
written. Success is every board rendering like its render in both schemes,
driven by live data, with the existing behaviour (range, trend, refresh jobs,
cancel, stall notice, deep links) intact.

## Fixed rulings

These were decided during the design pass and are not reopened here:

- Leader mark is gold: `--tk-fill-gold` fill, `--tk-on-fill-gold` numeral.
  Your own row, bar and dot are the accent.
- Five metric groups replace the current three (see "Metric groups").
- boxscore drops its Settings page. The rail's settings entry is an external
  link to console's `/settings#boxscore`, which already deep-links to the
  boxscore section.
- Charts come from `@mantine/charts` through a new lazy
  `@mattstack/app-kit/charts` subpath. Ranking rows and single bars are
  `Progress` from `@mattstack/app-kit/core`.
- Trend mode keeps every layout and adds a delta beside each value.

## Delivery: two PRs

1. **Kit: `@mattstack/app-kit/charts`** (`packages/ui`).
2. **Boxscore pages** (`apps/boxscore`), including the one server change.

PR 2 depends on PR 1. Each PR is independently green.

## PR 1: the charts subpath

- Add `@mantine/charts` pinned to the installed `@mantine/core` version
  (9.6.2 today) and `recharts` (>= 3.2.1) to `packages/ui` peers and the root
  catalog.
- New subpath `./charts` in `packages/ui/package.json`, source
  `src/charts/index.ts`. It re-exports `BarChart` and its prop and series
  types, plus `ChartTooltip`. It follows the `./lazy` pattern: nothing in
  `./core` or the theme imports it, so Recharts only enters a bundle that
  imports `./charts`.
- Styles: import `@mantine/charts/styles.css` from the charts entry, and add
  a kit default for the chart tooltip that uses the Tokyo surface and text
  tokens so tooltips match cards in both schemes.
- ESLint wall: ban `@mantine/charts` and `recharts` in app code with the same
  "import from `@mattstack/app-kit/charts`" message the other walls use
  (`presets/eslint.js`).
- Treeshake: the existing `scripts/treeshake-check.sh` probe must stay free of
  Recharts. Add a case asserting it.
- Story: `src/charts/BarChart.stories.tsx` showing a highlighted-bin
  histogram and a stacked horizontal bar in both schemes.

## PR 2: boxscore

### Metric groups

`src/shared/metrics.ts` `MetricGroup` becomes
`'delivery' | 'volume' | 'quality' | 'consistency' | 'collaboration'`:

| group | stats | swatch (text / fill) |
| --- | --- | --- |
| Delivery | Issues done | cyan |
| Volume | Added, Deleted, MRs merged, MRs reviewed, Pipelines | neutral (`--tk-text-2` label, `--tk-muted` swatch) |
| Quality | Review depth, Wait for review, Response time, Revert rate, Reverted, Size health | accent |
| Consistency | Coding days, Current streak, Merge streak | gold |
| Collaboration | Reciprocity | purple |

The CLI report groups by the same values. `GROUP_META` gains the swatch hue
per group and loses the old combined "Quality & consistency" label.

Headline stats: the leaders strip shows Issues done, MRs merged, Wait for
review, Coding days and Reciprocity (one per group). The table's Overview tab
shows Issues done, MRs merged, MRs reviewed, Lines ± (added and deleted in
one cell), Review depth, Wait for review, Size health, Coding days,
Reciprocity. Each group tab shows all of that group's stats.

### Server change: typed evidence facts

`MetricEvidence` gains `facts?: Record<string, number>` next to `summary`.
The UI reads numbers only from `facts`; `summary` stays for the CLI.
`src/server/metrics/evidence.ts` fills it per stat:

| stat | facts |
| --- | --- |
| Issues done | `counted`, `excludedByState`, `outsideWindow` |
| Wait for review, Response time | `p50`, `p90`, `count` |
| Size health | `inBand`, `overBand`, `underBand`, `bandLow`, `bandHigh` |
| Revert rate, Reverted | `reverted`, `checked` |
| MRs reviewed | `reviewed`, `authors` |
| Review depth | `reviewed`, `inlineComments` |
| Reciprocity | `given`, `received`, `reviewers` |
| Pipelines | `success`, `failed`, `canceled`, `running` |
| Coding days | `days`, `windowDays` |
| Current streak, Merge streak | `current`, `longest`, `mergeDays` |
| MRs merged, Added, Deleted | `merged`, `added`, `deleted` |

### Client structure

All under `src/app/`. Each directory has one job; components receive data
as props and never fetch.

- `model/`: pure functions, no React. Group metadata; headline selection;
  leader and "you" lookup per stat; tie detection; the person summary (stats
  led, top-3 count, median rank) from leaderboard ranks; delta direction
  (better or worse by the stat's `better` field); and evidence shaping:
  wait buckets, size bands, comment-depth buckets, the push calendar's week
  rows, merge-day runs (longest and current), pipelines by day, and reviews
  by author.
- `shell/`: the rail (leaderboard entry, settings external link with its
  tooltip, scheme control), the topbar (breadcrumbs, scope chip, freshness
  dot and label, Refresh or Cancel), and the page header (title, subtitle,
  range, Values/Trend, table/cards switch).
- `ui/`: shared presentational pieces used across pages: `LeaderMark`,
  `RankRow` (rank, name, `Progress` bar, value, you tint), `DeltaMark`,
  `GroupTag`, `CountChip`, `TeamStrip` (the positioned-dot strip, custom),
  `PushCalendar` (custom grid, weeks as rows, counts inside the busiest
  cells).
- `leaderboard/`: `LeadersStrip`, `StandingsTable` with group tabs,
  `CardsGrid` with the tied state.
- `detail/`: `ProfileHeader` with the person switcher, `PersonSummary`,
  `StatRail`, `StatPanel` (hero: value, rank, leader, `TeamStrip`,
  definition, count chips) and one evidence component per shape:
  `IssuesEvidence`, `MergedMrsEvidence` (sort tabs newest, most added, most
  deleted), `SizeEvidence`, `RevertEvidence` (zero state), `ReviewsEvidence`,
  `DepthEvidence`, `LatencyEvidence`, `ReciprocityEvidence`,
  `PipelinesEvidence`, `CodingDaysEvidence`, `StreakEvidence`. A map from
  stat key to evidence component routes the shared shapes.
- `refresh/`: `RefreshStatus` (phase stepper, overall bar, stall variant),
  `DimmedWhileRefreshing`, `SkeletonStandings`.

`src/app/settings/` is deleted along with its route; `/settings` answers the
not-found page. The console link's origin comes from the server: a small
`/api/links` route returns `deckAppUrl('console')` from
`@mattstack/app-server/event-bridge`, falling back to
`https://console.mattstack` when deck does not answer.

### Charts in the design

| board element | built with |
| --- | --- |
| Wait for review, Size health, Review depth histograms | `BarChart`; the highlighted bins are a second series stacked with the first; the size band is a reference area |
| Pipelines "By day" | `BarChart` `type="stacked"` `orientation="vertical"` |
| Merge days strip | `BarChart` with longest-run and current-streak days as their own series |
| Outcome bar, table cell magnitude bars, Given/Received | `Progress` sections |
| Card rankings, reviewer list, by-author bars | `RankRow` / `Progress` |
| Team strip, push calendar | custom components in `ui/` |

Series colours use Tokyo names only (`accent`, `gold`, `ok`, `bad`, `warn`,
`cyan`, `purple`) plus the `--tk-muted` token for neutral bars. No raw colour
values in app code.

### Data flow

- Leaderboard (`/api/leaderboard`) drives the strip, table, cards, ranks,
  leader marks and trend deltas.
- The detail page loads the leaderboard for the same selection too (shared
  react-query cache) for the team strip, the person switcher and the person
  summary, and `/api/detail` for evidence rows and `facts`.
- Refresh keeps `useRefreshJob` and its progress events (`phase`, `label`,
  `done`, `total`, `window`). The stepper lists the seven phases in server
  order; the stall variant keeps the current idle-timer threshold.
- Freshness reads `generatedAt` and `fromCache` from the response.

### States

- Fetch or job error: the existing error alert above the content.
- Evidence block with no rows: "Nothing in this window".
- A stat everyone ties on: the tied state in cards, no leader mark anywhere.
- Warm-cache refresh: last good data dimmed under the stepper.
- Cold cache: skeleton standings under the stepper.

### Layout scope

Desktop widths, as designed (1440 reference). Below that the standings
table scrolls horizontally inside its card and the cards grid drops to fewer
columns. A dedicated mobile design is out of scope.

## Testing

- `model/` is written test first. Fixtures are invented data shaped like
  real responses; nothing captured from a live API is committed.
- Component suites are rewritten against the new components: tabs, tied
  state, shared-shape routing, trend deltas and colours, refresh stepper and
  stall, settings external link, person switcher.
- Server: `facts` per stat in the existing metrics tests; the CLI report
  still prints `summary`.
- Kit: story, treeshake case, eslint wall test.
- Visual sign-off: every page rendered in Fast Browser against the served
  dev app and compared with its render in both schemes before the PR is
  called done; mismatches are reported, not glossed.

## Out of scope

- New metrics or changes to how any metric is computed.
- A mobile layout.
- Boxscore settings UI (console owns it).
