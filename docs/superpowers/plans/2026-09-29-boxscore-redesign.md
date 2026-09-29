# Boxscore Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild boxscore's UI so every page matches the approved boards in `docs/apps/design/boxscore/`, proven by a machine parity check in Fast Browser for all 7 boards in both schemes.

**Architecture:** PR 1 adds a lazy `@mattstack/app-kit/charts` subpath wrapping `@mantine/charts`. PR 2 regroups metrics into five groups, adds typed evidence `facts` on the server, adds a design fixture mode and a parity harness, then rebuilds the client as pure `model/` functions feeding small presentational units in `shell/ ui/ leaderboard/ detail/ refresh/`. Every board task ends by running the parity harness for that board.

**Tech Stack:** Bun, TypeScript, React 19, Mantine 9.6 via `@mattstack/app-kit`, `@mantine/charts` (Recharts), Hono, react-query, wouter, vitest + Testing Library, Fast Browser MCP, Pencil MCP.

**Spec:** `docs/superpowers/specs/2026-09-29-boxscore-redesign-design.md`. Design source: `docs/apps/design/boxscore/boxscore.pen`, renders in `docs/apps/design/boxscore/renders/`, rulings in `docs/apps/design/boxscore/README.md`. Read all three before any task.

## Global Constraints

- The boards are the source of truth. Adapt Mantine or write a small custom component; never simplify a board.
- UI colour and type: read `docs/apps/ui-authoring.md` first. Colours are `--tk-*` role tokens, the scheme-colors hook, or Mantine virtual colours only. No raw hex/rgb in app code. Weights 400, 500, 700 only (no 600). State a size on every Mantine `Text`.
- Every pen variable maps to a token: `tk-bg`→`--tk-bg`, `tk-card`→`--tk-card`, `tk-panel`→`--tk-panel`, `tk-chrome`→`--tk-chrome`, `tk-inset`→`--tk-inset`, `tk-raised`→`--tk-raised`, `tk-border`→`--tk-border`, `tk-border-soft`→`--tk-border-soft`, `tk-line-3`→`--tk-line-3`, `tk-text-1..3`→`--tk-text-1..3`, `tk-muted`→`--tk-muted`, `tk-fill-<hue>`→`--tk-fill-<hue>`, `tk-on-fill-<hue>`/`tk-on-fill`→`--tk-on-fill-<hue>`, `tk-text-<hue>`→`--tk-text-<hue>`, `tk-text-<hue>-small`→`--tk-text-<hue>-small`, `tk-dot-<ok|warn|bad>`→`--tk-dot-*`, `light-<hue>`→`var(--mantine-color-<hue>-light)` (`light-neutral`→`--tk-raised`).
- Fonts: UI text is the theme's system sans; numbers use the theme monospace (`var(--mantine-font-family-monospace)`). The canvas uses Inter/JetBrains Mono; parity tolerates text width only.
- App code imports Mantine only through `@mattstack/app-kit/*` barrels (`apps/AGENTS.md` §1). Charts only through `@mattstack/app-kit/charts`.
- Leader mark: `--tk-fill-gold` fill, `--tk-on-fill-gold` numeral. You: accent (`--tk-fill-accent`, `--tk-text-accent`, `light-accent`).
- Five groups: delivery, volume, quality, consistency, collaboration (table in Task 2).
- No settings page in boxscore; rail settings entry links to console `/settings#boxscore`.
- All fixtures and test data are invented (people, handles, tickets, titles, projects). Never commit data captured from a live API: `m4ttstack/mattstack` is public.
- Comments follow clean-code rules: only constraints the code cannot show. No em or en dashes anywhere (code, comments, commits).
- Run tests from `apps/boxscore`: `bun run test` (vitest projects `server` and `component`). Root gates: `bun run boxscore:typecheck`, `bun run boxscore:lint`, `bun run boxscore:test`.
- Commit after each task (message style: `boxscore: <imperative>`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Branch: `boxscore-redesign` in worktree `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/melian`. Do not touch the shared checkout `~/Documents/GitHub/repo-tools`.

## Review Focus

1. **Evidence truncation at 300 rows** (`MAX_ROWS` in `evidence.ts`): histograms and calendars built from rows would undercount. Expect totals from `facts` and bins from rows; `facts` must be computed before truncation. Test in Task 3.
2. **Ties everywhere:** a stat where everyone ties (all zero revert rate) must show no gold mark in the table, strip, cards or detail, and the tied card state. Test in Task 6 (`leaderOf` returns null on a full tie) and Task 11.
3. **Unresolved or null users:** a user with `resolved: false` or a null value (response time with no samples) must render "—", sit last, and never get a rank or leader mark. Test in Task 6.
4. **Lower-is-better deltas:** a rise in Wait for review or Response time is worse (red). Test in Task 6 (`deltaTone`).
5. **Person switcher at the ends and unknown users:** first person has no previous, last has no next; `/user/<unknown>/<stat>` shows the existing not-found message, not a crash. Test in Task 12.

---

## File Structure

`packages/ui` (PR 1):
- `src/charts/index.ts`: charts barrel (BarChart, ChartTooltip, types).
- `src/charts/chart-defaults.ts`: Tokyo tooltip and grid defaults.
- `src/charts/BarChart.stories.tsx`: story.
- `presets/eslint.js`: wall entries.
- `scripts/treeshake-check.sh`: Recharts assertion.

`apps/boxscore` (PR 2):
- `src/shared/metrics.ts`: five groups.
- `src/shared/types.ts`: `MetricEvidence.facts`.
- `src/server/metrics/evidence.ts`: facts.
- `src/server/fixture/design-data.ts`, `src/server/fixture/index.ts`: design fixture mode.
- `src/server/routes.ts`: fixture short-circuit, `/api/links`.
- `scripts/parity/`: `export-design.md` (Pencil steps), `collect.js` (browser collector), `compare.ts`, `compare.test.ts`, `boards.ts` (board to route map), `run.md` (runner steps).
- `docs/apps/design/boxscore/parity/*.html`: design HTML exports.
- `src/app/model/`: `groups.ts`, `standings.ts`, `summary.ts`, `delta.ts`, `evidence-shapes.ts` (+ tests).
- `src/app/ui/`: `LeaderMark.tsx`, `RankRow.tsx`, `DeltaMark.tsx`, `GroupTag.tsx`, `CountChip.tsx`, `TeamStrip.tsx`, `PushCalendar.tsx`, `ui.module.css` (+ tests).
- `src/app/shell/`: `Rail.tsx`, `Topbar.tsx`, `PageHeader.tsx`, `useLinks.ts`.
- `src/app/leaderboard/`: `LeadersStrip.tsx`, `StandingsTable.tsx`, `CardsGrid.tsx`, `LeaderboardPage.tsx`.
- `src/app/detail/`: `DetailPage.tsx`, `ProfileHeader.tsx`, `PersonSummary.tsx`, `StatRail.tsx`, `StatPanel.tsx`, `evidence/*.tsx`, `evidence/index.ts`.
- `src/app/refresh/`: `RefreshStatus.tsx`, `SkeletonStandings.tsx`.
- Deleted at the end: `src/app/components/*` (old), `src/app/settings/*`, `src/app/columns.ts`.

---

## PR 1

### Task 1: `@mattstack/app-kit/charts` subpath

**Files:**
- Modify: `package.json` (root catalog), `packages/ui/package.json`
- Create: `packages/ui/src/charts/index.ts`, `packages/ui/src/charts/chart-defaults.ts`, `packages/ui/src/charts/BarChart.stories.tsx`, `packages/ui/src/charts/charts.test.ts`
- Modify: `packages/ui/presets/eslint.js`, `packages/ui/scripts/treeshake-check.sh`

**Interfaces:**
- Produces: `import { BarChart, ChartTooltip, chartDefaults } from '@mattstack/app-kit/charts'` and types `BarChartProps`, `BarChartSeries`.

- [ ] **Step 1: Add deps.** In the root `package.json` `workspaces.catalog` add `"@mantine/charts": "^9.5.2"` (matches `@mantine/core`) and `"recharts": "^3.2.1"`. In `packages/ui/package.json` add both to `peerDependencies` as `"catalog:"` and to `devDependencies` as `"catalog:"`; add `"./charts": "./src/charts/index.ts"` to `exports` next to `"./lazy"`. Run `bun install` at the repo root. Confirm `node_modules/@mantine/charts/package.json` version equals `node_modules/@mantine/core/package.json` version.

- [ ] **Step 2: Write the failing test** `packages/ui/src/charts/charts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('@mattstack/app-kit/charts', () => {
  it('exports BarChart and the Tokyo defaults', async () => {
    const mod = await import('./index');
    expect(mod.BarChart).toBeDefined();
    expect(mod.ChartTooltip).toBeDefined();
    expect(mod.chartDefaults.tooltipProps.wrapperStyle).toBeDefined();
    expect(JSON.stringify(mod.chartDefaults)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
```

- [ ] **Step 3: Run it.** `cd packages/ui && bunx vitest run src/charts/charts.test.ts`. Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 4: Implement.** `src/charts/chart-defaults.ts`:

```ts
export const chartDefaults = {
  tooltipProps: {
    wrapperStyle: { outline: 'none' },
    contentStyle: {
      background: 'var(--tk-raised)',
      border: '1px solid var(--tk-border)',
      borderRadius: 8,
      color: 'var(--tk-text-1)',
    },
  },
  gridProps: { stroke: 'var(--tk-line-3)' },
  textColor: 'var(--tk-text-3)',
} as const;
```

`src/charts/index.ts`:

```ts
import '@mantine/charts/styles.css';

export { BarChart, ChartTooltip } from '@mantine/charts';
export type { BarChartProps, BarChartSeries } from '@mantine/charts';
export { chartDefaults } from './chart-defaults';
```

- [ ] **Step 5: Run the test.** Expected: PASS.

- [ ] **Step 6: ESLint wall.** In `presets/eslint.js`, next to `wall('@mantine/code-highlight', 'lazy')` add `wall('@mantine/charts', 'charts'),` and add `{ group: ['recharts', 'recharts/*'], message: "Import from '@mattstack/app-kit/charts' instead." }` to the `patterns` array. In the kit's own `packages/ui/src/charts/**` the import must stay allowed: check the root `eslint.config.js` does not apply the app preset to `packages/ui/src` (it lints `packages` without the app glob); if it does, add `packages/ui/src/charts/**` to that block's `ignores`.

- [ ] **Step 7: Treeshake assertion.** In `scripts/treeshake-check.sh`, inside the node block after `retained` is computed, add:

```js
const charts = map.sources.filter(s => /node_modules\/(recharts|@mantine\/charts)\//.test(s));
if (charts.length > 0) {
  console.error('Tree-shaking gate FAILED. Chart code reached a bundle that never imports ./charts:');
  charts.slice(0, 10).forEach(s => console.error('  ' + s));
  process.exit(1);
}
```

Run `bun run treeshake` from the repo root. Expected: `Tree-shaking gate passed.`

- [ ] **Step 8: Story.** `src/charts/BarChart.stories.tsx` with two stories following an existing `*.stories.tsx` in `packages/ui/src/core` for `Meta`/`StoryObj` shape: `Histogram` (data `[{bin:'< 0.5h', normal:0, hi:0},{bin:'0.5–1h', normal:0, hi:33},{bin:'1–2h', normal:8, hi:0},{bin:'2–4h',normal:3,hi:0}]`, `type="stacked"`, series `[{name:'normal', color:'gray'},{name:'hi', color:'accent'}]`, `dataKey="bin"`) and `StackedRows` (`orientation="vertical"`, `type="stacked"`, series ok/bad/gray/accent over three day rows). Pass `tooltipProps={chartDefaults.tooltipProps}`. Run `bun run build-storybook` from root. Expected: success.

- [ ] **Step 9: Gates.** From root: `bun run lint:root` and `bun run typecheck`. Expected: pass.

- [ ] **Step 10: Commit.**

```bash
git add package.json bun.lock packages/ui
git commit -m "app-kit: add lazy charts subpath over @mantine/charts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## PR 2

### Task 2: Five metric groups

**Files:**
- Modify: `apps/boxscore/src/shared/metrics.ts`, `apps/boxscore/src/server/cli.ts`
- Test: `apps/boxscore/test/metadata.test.ts`

**Interfaces:**
- Produces: `MetricGroup = 'delivery' | 'volume' | 'quality' | 'consistency' | 'collaboration'`; `GROUP_ORDER: MetricGroup[]` and `GROUPS: Record<MetricGroup, { label: string; hue: 'cyan' | 'neutral' | 'accent' | 'gold' | 'purple' }>` exported from `src/shared/metrics.ts`.

| key | group |
| --- | --- |
| issuesCompleted | delivery |
| additions, deletions, mrsMerged, mrsReviewed, pipelines | volume |
| reviewDepth, reviewLatencyHours, responseLatencyHours, revertRate, revertedCount, sizeHealthPct | quality |
| codingDays, currentStreak, longestStreak | consistency |
| reciprocity | collaboration |

- [ ] **Step 1: Failing test.** Append to `test/metadata.test.ts`:

```ts
import { GROUP_ORDER, GROUPS, METRICS } from '../src/shared/metrics';

describe('metric groups', () => {
  it('uses the five design groups in board order', () => {
    expect(GROUP_ORDER).toEqual(['delivery', 'volume', 'quality', 'consistency', 'collaboration']);
    expect(GROUPS.consistency).toEqual({ label: 'Consistency', hue: 'gold' });
  });
  it('places each metric in its design group', () => {
    const by = Object.fromEntries(METRICS.map(m => [m.key, m.group]));
    expect(by.codingDays).toBe('consistency');
    expect(by.currentStreak).toBe('consistency');
    expect(by.longestStreak).toBe('consistency');
    expect(by.reciprocity).toBe('collaboration');
    expect(by.reviewDepth).toBe('quality');
    expect(by.pipelines).toBe('volume');
  });
});
```

- [ ] **Step 2: Run.** `cd apps/boxscore && bun run test -- test/metadata.test.ts`. Expected: FAIL (`GROUPS` undefined).

- [ ] **Step 3: Implement.** Change the `MetricGroup` union, set `group` on the five moved descriptors per the table, and add:

```ts
export const GROUP_ORDER: MetricGroup[] = ['delivery', 'volume', 'quality', 'consistency', 'collaboration'];

export const GROUPS: Record<MetricGroup, { label: string; hue: 'cyan' | 'neutral' | 'accent' | 'gold' | 'purple' }> = {
  delivery: { label: 'Delivery', hue: 'cyan' },
  volume: { label: 'Volume', hue: 'neutral' },
  quality: { label: 'Quality', hue: 'accent' },
  consistency: { label: 'Consistency', hue: 'gold' },
  collaboration: { label: 'Collaboration', hue: 'purple' },
};
```

In `src/server/cli.ts`, replace any hard-coded group list or labels with `GROUP_ORDER` and `GROUPS[g].label` (grep `quality` and `'Quality & consistency'`). Keep `src/app/columns.ts` compiling by deleting its `GROUP_ORDER`/`GROUP_META` and re-exporting `GROUP_ORDER, GROUPS` from shared; update the four current consumers (`MetricCards.tsx`, `MetricTip.tsx`, `DetailPage.tsx`, `LeaderboardTable.tsx`) to read `GROUPS[g].label` and map `hue` to a Mantine colour name (`neutral`→`dimmed`) so the old UI still renders until it is replaced.

- [ ] **Step 4: Run the whole suite.** `bun run test`. Expected: all pass (fix any snapshot of CLI group headers to the new labels).

- [ ] **Step 5: Commit.** `boxscore: regroup metrics into five design groups`.

### Task 3: Typed evidence facts

**Files:**
- Modify: `apps/boxscore/src/shared/types.ts:132-138`, `apps/boxscore/src/server/metrics/evidence.ts`
- Test: `apps/boxscore/test/evidence.test.ts`

**Interfaces:**
- Produces: `MetricEvidence.facts?: Record<string, number>` with exactly these keys per stat:

| stat keys | facts |
| --- | --- |
| issuesCompleted | `counted`, `excludedByState`, `outsideWindow` |
| reviewLatencyHours, responseLatencyHours | `p50`, `p90`, `count` (p50/p90 rounded to 2 dp; 0 when count is 0) |
| sizeHealthPct | `inBand`, `overBand`, `underBand`, `bandLow`, `bandHigh` |
| revertRate, revertedCount | `reverted`, `checked` |
| mrsReviewed | `reviewed`, `authors` |
| reviewDepth | `reviewed`, `inlineComments` |
| reciprocity | `given`, `received`, `reviewers` |
| pipelines | `success`, `failed`, `canceled`, `running` (`running` counts every status other than success, failed, canceled) |
| codingDays | `days`, `windowDays` |
| currentStreak, longestStreak | `current`, `longest`, `mergeDays` |
| mrsMerged, additions, deletions | `merged`, `added`, `deleted` |

`received` is the count of review events on the user's MRs (sum of `reviewersOfMine` values); `reviewers` is `reviewersOfMine.size`. `underBand` counts MRs with changed lines `<= sizeBand.tooSmall`; `overBand` counts `> sizeBand.tooLarge`. `windowDays` is whole days in the window (`Math.round((end-start)/86_400_000)`).

- [ ] **Step 1: Failing test.** Read the existing `test/evidence.test.ts` to reuse its builder for a `FetchResult` and `EvidenceContext` (and `test/builders.ts`). Add:

```ts
describe('evidence facts', () => {
  it('carries typed totals for every stat', () => {
    const ev = buildUserEvidence(fetched, 'alice', ctx);
    expect(ev.mrsMerged?.facts).toEqual({ merged: expect.any(Number), added: expect.any(Number), deleted: expect.any(Number) });
    expect(Object.keys(ev.sizeHealthPct?.facts ?? {}).sort()).toEqual(['bandHigh', 'bandLow', 'inBand', 'overBand', 'underBand']);
    expect(Object.keys(ev.reciprocity?.facts ?? {}).sort()).toEqual(['given', 'received', 'reviewers']);
    expect(Object.keys(ev.pipelines?.facts ?? {}).sort()).toEqual(['canceled', 'failed', 'running', 'success']);
    expect(ev.longestStreak?.facts).toEqual(ev.currentStreak?.facts);
  });

  it('computes facts before rows are truncated', () => {
    const big = fetchedWithMergedMrs('alice', 320);
    const ev = buildUserEvidence(big, 'alice', ctx);
    expect(ev.mrsMerged?.rows).toHaveLength(300);
    expect(ev.mrsMerged?.facts?.merged).toBe(320);
  });
});
```

If no helper creates N merged MRs, add `fetchedWithMergedMrs(user, n)` to `test/builders.ts` using the existing MR builder in a loop (invented titles `Change ${i}`).

- [ ] **Step 2: Run.** `bun run test -- test/evidence.test.ts`. Expected: FAIL (`facts` undefined).

- [ ] **Step 3: Implement.** Add `facts?: Record<string, number>;` to `MetricEvidence` with the doc comment `/** Typed totals the UI reads instead of parsing summary. Computed before row truncation. */`. In `buildUserEvidence`, set `facts` on each block where its totals are already computed (`merged.length`, `totalAdd`, `totalDel`, `merged.filter(c.inBand).length`, `c.reverted.length`, `reviewed.length`, the set of `r.mr.authorUsername`, the sum of `r.inlineCount`, `given`, `received`, `statusCount`, `pushDays.size`, `ms.current`, `ms.longest`, `mergeByDay.size`, `c.issues.*`). For latency use `percentile` and `round` already imported. Pass the window into `EvidenceContext` if `windowDays` needs it (add `windowStart: string; windowEnd: string` to `EvidenceContext` and thread from the caller in `leaderboard.ts`).

- [ ] **Step 4: Run.** `bun run test`. Expected: all pass, including `test/parity.test.ts`.

- [ ] **Step 5: Commit.** `boxscore: add typed facts to every evidence block`.

### Task 4: Design fixture mode and `/api/links`

**Files:**
- Create: `apps/boxscore/src/server/fixture/design-data.ts`, `apps/boxscore/src/server/fixture/index.ts`
- Modify: `apps/boxscore/src/server/routes.ts`
- Test: `apps/boxscore/test/fixture.test.ts`

**Interfaces:**
- Consumes: `LeaderboardResponse`, `UserDetailResponse`, `RefreshStatusResponse` types; `facts` from Task 3.
- Produces: env `BOXSCORE_FIXTURE=design` makes `/api/leaderboard`, `/api/detail`, `/api/refresh*` answer from fixtures. `BOXSCORE_FIXTURE_SCENARIO` = `warm` (default) | `refreshing` | `cold-stalled`. Route `GET /api/links` returns `{ console: string }`.

The fixture reproduces the canvas exactly. Read every number, name and row from `boxscore.pen` (open it in Pen via the Pencil MCP, or read the JSON directly: the file is plain JSON) and from the renders. People (username, name, you):

| username | name |
| --- | --- |
| nvance | Nora Vance |
| srivera | Sam Rivera (isCurrentUser) |
| pnair | Priya Nair |
| tberg | Tomas Berg |
| lortiz | Lena Ortiz |
| kmorgan | Kai Morgan |
| radeyemi | Ruth Adeyemi |

Values per stat (order as above; `null` = no samples):

| stat | nvance | srivera | pnair | tberg | lortiz | kmorgan | radeyemi |
| --- | --- | --- | --- | --- | --- | --- | --- |
| issuesCompleted | 77 | 48 | 19 | 12 | 11 | 5 | 6 |
| additions | 25535 | 17749 | 14766 | 2834 | 10266 | 2210 | 3032 |
| deletions | 4214 | 3849 | 1544 | 590 | 1311 | 185 | 137 |
| mrsMerged | 78 | 47 | 20 | 11 | 11 | 7 | 6 |
| mrsReviewed | 65 | 74 | 45 | 6 | 0 | 13 | 0 |
| pipelines | 360 | 212 | 104 | 37 | 62 | 56 | 35 |
| reviewDepth | 3.38 | 1.82 | 2.62 | 0.17 | 0 | 0.62 | 0 |
| reviewLatencyHours p50 | 0.66 | 0.65 | 0.67 | 0.56 | 0.93 | 5.84 | 1.0 |
| responseLatencyHours p50 | 4.56 | 18.65 | 22.62 | 0.66 | null | 20.37 | null |
| revertRate | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| revertedCount | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| sizeHealthPct | 0.71 | 0.64 | 0.40 | 0.73 | 0.09 | 0.57 | 0.67 |
| codingDays | 24 | 21 | 17 | 12 | 15 | 10 | 9 |
| currentStreak | 3 | 1 | 2 | 1 | 0 | 1 | 1 |
| longestStreak | 9 | 5 | 4 | 3 | 2 | 2 | 2 |
| reciprocity | 6.1 | 8.22 | 11.4 | 0.55 | 0 | 1.86 | 0 |

`srivera` p90 values: reviewLatency 4.29, responseLatency 70.8. Ranks: compute with the real ranking function (`src/server/metrics/ranking.ts`) so ties match the app. Deltas (Trend board): copy each `▲/▼` number from board 07 (`Leaderboard · Trend`) into `delta` for that cell; cells with no chip have `delta: 0`. Window: `start` = now minus 30 days, `end` = now, `key: '30d'`; `priorWindow` present only when `trend=1`. `generatedAt` = now minus 4 minutes; `fromCache: true`. `scope.projectPaths = ['acme/web-app']`.

Detail evidence for `srivera`: every panel's rows, facts and columns exactly as drawn on boards 03 and 04 (issues table 9 rows shown of 48, the wait histogram inputs as 50 rows whose waits fall 0/33/8/3/2/1/3 into the bins, the push calendar days, pipelines rows totalling 138/65/6/3, reciprocity reviewers, merged MRs, size values for 47 MRs landing 0/3/4/8/15/11/6 in the bins, reviews, depth counts 30/13/10/16/5, merge days). Other users' detail responses reuse the same evidence shapes with their own values (only srivera is on the canvas).

Refresh: `POST /api/refresh` returns a job whose `GET` always reports `{ status: 'running', progress: { phase: 'mrs-detail', label: 'MR details', done: 142, total: 310, window: 'current' } }`. In `cold-stalled`, `/api/leaderboard?cacheOnly=1` answers `{ cached: false }` and the progress never changes (the client's stall timer then fires). In `refreshing`, the leaderboard is warm and the client's Refresh starts the fixture job.

- [ ] **Step 1: Failing test** `test/fixture.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

describe('design fixture mode', () => {
  beforeEach(() => {
    process.env.BOXSCORE_FIXTURE = 'design';
    delete process.env.BOXSCORE_FIXTURE_SCENARIO;
  });

  it('serves the canvas leaderboard', async () => {
    const { routes } = await import('../src/server/routes');
    const res = await routes.request('/api/leaderboard?range=30d&cacheOnly=1');
    const body = await res.json();
    expect(body.users.map((u: { username: string }) => u.username)).toEqual(['nvance', 'srivera', 'pnair', 'tberg', 'lortiz', 'kmorgan', 'radeyemi']);
    expect(body.users[1].metrics.mrsMerged.value).toBe(47);
    expect(body.scope.projectPaths).toEqual(['acme/web-app']);
  });

  it('serves the stalled cold scenario', async () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'cold-stalled';
    const { routes } = await import('../src/server/routes');
    const res = await routes.request('/api/leaderboard?range=30d&cacheOnly=1');
    expect(await res.json()).toEqual({ cached: false });
  });

  it('answers the console link', async () => {
    const { routes } = await import('../src/server/routes');
    const res = await routes.request('/api/links');
    expect((await res.json()).console).toMatch(/^https?:\/\//);
  });
});
```

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** `fixture/index.ts` exports `fixtureMode(): 'design' | null`, `fixtureScenario(): 'warm' | 'refreshing' | 'cold-stalled'`, `fixtureLeaderboard(trend: boolean): LeaderboardResponse`, `fixtureDetail(user: string, trend: boolean): UserDetailResponse | null`, `fixtureRefresh(): RefreshStatusResponse`. Read env at call time (not module load). In each route handler in `routes.ts`, add a first line `if (fixtureMode()) return c.json(...)` using those (keep handlers inline and chained, per the file's comment). Add to the `leaderboard` chain:

```ts
.get('/api/links', async c => {
  const url = await deckAppUrl('console');
  return c.json({ console: url ?? 'https://console.mattstack' });
})
```

importing `deckAppUrl` from `@mattstack/app-server/event-bridge` (check its signature in `packages/server/src/event-bridge*`; in fixture mode skip the deck call and return `https://console.mattstack`).

- [ ] **Step 4: Run.** `bun run test`. Expected: pass.

- [ ] **Step 5: Serve it.** `BOXSCORE_FIXTURE=design bun src/server/index.ts` in the background on a free port (read `src/server/index.ts` for the port env), then `curl -s localhost:<port>/api/leaderboard?range=30d | head -c 300`. Expected: Nora Vance first. Stop it.

- [ ] **Step 6: Commit.** `boxscore: add design fixture mode and console link route`.

### Task 5: Parity harness

**Files:**
- Create: `apps/boxscore/scripts/parity/boards.ts`, `collect.js`, `compare.ts`, `compare.test.ts`, `run.md`
- Create: `docs/apps/design/boxscore/parity/<board-slug>.html` (7 files) and their asset folders if Pencil writes any

**Interfaces:**
- Produces: `collect.js` (a browser function body returning `ParityNode[]`), `compare(design: ParityNode[], app: ParityNode[], opts): Mismatch[]`, board table in `boards.ts`:

```ts
export interface ParityNode { key: string; kind: 'text' | 'box'; x: number; y: number; w: number; h: number; fill: string | null; stroke: string | null; color: string | null; text: string | null }
export interface Mismatch { key: string; field: string; design: string; app: string }
export interface Board { slug: string; frame: string; route: string; storage: Record<string, string>; scenario: 'warm' | 'refreshing' | 'cold-stalled'; root: string; height: number; dynamicText: string[] }
```

`boards.ts` (the `root` is the `data-parity` value on the page frame; `storage` is localStorage set before load):

| slug | frame | route | storage | scenario |
| --- | --- | --- | --- | --- |
| 01-leaderboard-table | Leaderboard · Table | `/` | `forge-view:"table"`, `forge-trend:false`, `forge-range:{"range":"30d"}` | warm |
| 02-leaderboard-cards | Leaderboard · Cards | `/` | `forge-view:"cards"` | warm |
| 03-person-stat-detail | Person · Stat detail | `/user/srivera/issuesCompleted` | | warm |
| 04-stat-evidence-variants | Stat detail · evidence variants | one route per panel: `/user/srivera/<stat>`, root `Panel · <label>` | | warm |
| 05-refreshing | Leaderboard · Refreshing | `/` then click Refresh | table | refreshing |
| 06-first-load-stalled | Leaderboard · First load, stalled | `/`, wait for the stall notice | | cold-stalled |
| 07-leaderboard-trend | Leaderboard · Trend | `/` | `forge-trend:true` | warm |

`dynamicText`: `Fresh Label`, `RS Sub` (their text is time-based and compared by prefix only).

**Keys.** A node's key is the chain of `/`-joined layer names of its *visible* ancestors plus itself, where visible means: text, rectangle, ellipse, icon, or a frame with a fill or stroke. When siblings in that chain share a name, append `[i]` (0-based, document order). The design side reads the layer name from the attribute Pencil writes for layer names in HTML export (inspect one exported file to find it, e.g. `data-name`); the app side reads `data-parity`. App components put `data-parity="<layer name>"` on exactly the elements that correspond to visible design layers, nested the same way.

**What `compare` checks** for each design key: present in the app; `x`, `y`, `h` within 1px; `w` within 1px unless `kind === 'text'`; `fill`, `stroke`, `color` equal after normalising both to `rgb(r, g, b)` / `rgba(...)`; `text` equal (prefix match for keys ending in a `dynamicText` name). Then every app key must exist in the design. Boxes are relative to the board root.

- [ ] **Step 1: Design HTML is already exported.** `docs/apps/design/boxscore/parity/<slug>.<dark|light>.html` (14 files) were exported from `boxscore.pen` with the Pencil MCP (`Export([id], "html-css", path, { includeLayerNames: true })` per board frame, with the frame's `theme.mode` set per scheme). Colours are resolved hex per scheme; the layer-name attribute is `data-pencil-name`. Do not regenerate them unless the `.pen` changes (that needs Pen open on the file; if it is not, stop and report BLOCKED). Record the attribute and the frame ids (`WqX8t` 01, `iUxSO` 02, `bhvvQ` 03, `JPhZn` 04, `k6kFQA` 05, `ULlmd` 06, `rmvgy` 07) in `run.md`.

- [ ] **Step 2: Write `collect.js`**, a plain function body for `browser_run_code_unsafe` taking `{ rootSelector, nameAttr }`:

```js
async ({ page, rootSelector, nameAttr }) => {
  return page.evaluate(({ rootSelector, nameAttr }) => {
    const root = document.querySelector(rootSelector);
    const rb = root.getBoundingClientRect();
    const out = [];
    const visible = el => el.hasAttribute(nameAttr);
    const walk = (el, prefix) => {
      const kids = [...el.children];
      const named = kids.filter(visible);
      const counts = {};
      for (const k of named) counts[k.getAttribute(nameAttr)] = (counts[k.getAttribute(nameAttr)] || 0) + 1;
      const seen = {};
      for (const k of kids) {
        if (!visible(k)) { walk(k, prefix); continue; }
        const n = k.getAttribute(nameAttr);
        const idx = counts[n] > 1 ? `[${(seen[n] = (seen[n] ?? -1) + 1)}]` : '';
        const key = prefix ? `${prefix}/${n}${idx}` : `${n}${idx}`;
        const b = k.getBoundingClientRect();
        const cs = getComputedStyle(k);
        const isText = k.children.length === 0 && (k.textContent || '').trim().length > 0;
        out.push({ key, kind: isText ? 'text' : 'box', x: b.x - rb.x, y: b.y - rb.y, w: b.width, h: b.height,
          fill: cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? null : cs.backgroundColor,
          stroke: cs.borderTopWidth !== '0px' ? cs.borderTopColor : null,
          color: isText ? cs.color : null, text: isText ? k.textContent.trim() : null });
        walk(k, key);
      }
    };
    walk(root, '');
    return out;
  }, { rootSelector, nameAttr });
}
```

For the design HTML, pass `nameAttr` = the recorded Pencil attribute and skip nodes that are not visible (frames without fill/stroke): filter design output to nodes with `fill || stroke || kind === 'text'` or tag `svg`/`img`, and rebuild keys with the same rule (do the filtering in `compare.ts` via a `visibleOnly` pass so the collector stays one function).

- [ ] **Step 3: Failing test** `compare.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compare } from './compare';

const n = (key: string, o: Partial<import('./boards').ParityNode> = {}) => ({ key, kind: 'box' as const, x: 0, y: 0, w: 10, h: 10, fill: null, stroke: null, color: null, text: null, ...o });

describe('parity compare', () => {
  it('passes identical trees', () => {
    expect(compare([n('A')], [n('A')], { dynamicText: [] })).toEqual([]);
  });
  it('flags a box off by 2px', () => {
    expect(compare([n('A')], [n('A', { x: 2 })], { dynamicText: [] })).toEqual([{ key: 'A', field: 'x', design: '0', app: '2' }]);
  });
  it('tolerates text width only', () => {
    expect(compare([n('T', { kind: 'text', w: 40, text: 'Hi' })], [n('T', { kind: 'text', w: 44, text: 'Hi' })], { dynamicText: [] })).toEqual([]);
  });
  it('normalises colours', () => {
    expect(compare([n('A', { fill: '#111113' })], [n('A', { fill: 'rgb(17, 17, 19)' })], { dynamicText: [] })).toEqual([]);
  });
  it('reports missing and extra keys', () => {
    const r = compare([n('A')], [n('B')], { dynamicText: [] });
    expect(r.map(m => m.field)).toEqual(['missing', 'extra']);
  });
  it('prefix-matches dynamic text', () => {
    expect(compare([n('Fresh Label', { kind: 'text', text: 'Synced 4 min ago' })], [n('Fresh Label', { kind: 'text', text: 'Synced 5 min ago' })], { dynamicText: ['Fresh Label'] })).toEqual([]);
  });
});
```

Add `scripts/parity/**/*.test.ts` to the `server` project `include` in `vitest.config.ts`.

- [ ] **Step 4: Run.** `bun run test -- scripts/parity`. Expected: FAIL.

- [ ] **Step 5: Implement `compare.ts`** (`compare(design, app, { dynamicText })`, with `normColor` handling `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`), plus a CLI: `bun scripts/parity/compare.ts <design.json> <app.json> <slug>` printing a mismatch table and exiting 1 on any mismatch.

- [ ] **Step 6: Run.** Expected: PASS.

- [ ] **Step 7: Write `run.md`**, the exact runner steps a later task follows for one board and scheme:
  1. Start the fixture server: `BOXSCORE_FIXTURE=design BOXSCORE_FIXTURE_SCENARIO=<scenario> bun src/server/index.ts` and `vite` for the client (check `vite.config.ts` for the proxy port), both in the background.
  2. Load the Fast Browser tools; use the `fast-browser:fast-browsing` skill. In one `browser_run_code_unsafe` call: `page.setViewportSize({ width: 1440, height: <board height> })`; open the design HTML (`file://…/parity/<slug>.<scheme>.html`), run the collector with the Pencil name attribute, save JSON to `~/.fast-browser/output/parity/<slug>.<scheme>.design.json`; open the app route; set localStorage from `boards.ts` and `document.documentElement.setAttribute('data-mantine-color-scheme', '<scheme>')`; reload; do the board's action (Refresh click, wait for stall); run the collector with `data-parity`; save `…app.json`; take a full-page screenshot of each.
  3. `bun scripts/parity/compare.ts <design.json> <app.json> <slug>`.
  4. Build the side-by-side: design screenshot, app screenshot, and a 50% difference overlay composed in the browser on a canvas, saved to `~/.fast-browser/output/parity/<slug>.<scheme>.side.png`. Look at it.
  5. Report: the mismatch table (must be empty) and what the side-by-side shows.

- [ ] **Step 8: Commit.** `boxscore: add the design parity harness`.

### Task 6: Model: standings, leaders, summary, deltas

**Files:**
- Create: `apps/boxscore/src/app/model/standings.ts`, `summary.ts`, `delta.ts`, `groups.ts`, and `model.test.ts`

**Interfaces:**
- Consumes: `METRICS`, `metricValue`, `metricRank`, `metricDelta`, `deltaIsGood`, `GROUPS`, `GROUP_ORDER` from `src/shared/metrics`; `UserRow`, `MetricKey` from `src/shared/types`.
- Produces:

```ts
// groups.ts
export const HEADLINE: Record<MetricGroup, MetricKey>; // delivery: issuesCompleted, volume: mrsMerged, quality: reviewLatencyHours, consistency: codingDays, collaboration: reciprocity
export const OVERVIEW: Array<MetricKey | 'lines'>; // ['issuesCompleted','mrsMerged','mrsReviewed','lines','reviewDepth','reviewLatencyHours','sizeHealthPct','codingDays','reciprocity']
export function statsInGroup(g: MetricGroup): MetricKey[];
export function hueVar(g: MetricGroup, role: 'swatch' | 'text' | 'small'): string; // e.g. consistency swatch 'var(--tk-text-gold)', volume swatch 'var(--tk-muted)', volume text 'var(--tk-text-2)'
// standings.ts
export interface Ranked { user: UserRow; value: number | null; rank: number | null; isLeader: boolean; isYou: boolean }
export function rankedFor(users: UserRow[], key: MetricKey): Ranked[]; // resolved users with a value, by server rank asc; then null values; unresolved dropped
export function leaderOf(users: UserRow[], key: MetricKey): UserRow | null; // null when nobody ranks or every ranked user shares rank 1
export function isFullTie(users: UserRow[], key: MetricKey): boolean;
export function you(users: UserRow[]): UserRow | null;
// summary.ts
export interface PersonSummary { leads: MetricKey[]; top3: number; statCount: number; medianRank: number | null }
export function personSummary(users: UserRow[], username: string): PersonSummary;
// delta.ts
export type DeltaTone = 'better' | 'worse' | 'none';
export function deltaTone(key: MetricKey, delta: number | null): DeltaTone;
export function formatDelta(key: MetricKey, delta: number): string; // '▲8', '▼0.2h', '▲12%', '▲0.1'
```

- [ ] **Step 1: Failing tests** `model.test.ts`, using a `users()` helper that returns `structuredClone(fixtureLeaderboard(false).users)` from the Task 4 fixture module (the invented canvas people and values, with server-computed ranks):

```ts
describe('standings', () => {
  it('orders by server rank and marks leader and you', () => {
    const r = rankedFor(users(), 'mrsMerged');
    expect(r[0]).toMatchObject({ isLeader: true, rank: 1 });
    expect(r.find(x => x.user.username === 'srivera')).toMatchObject({ isYou: true, isLeader: false });
  });
  it('has no leader on a full tie', () => {
    expect(leaderOf(users(), 'revertRate')).toBeNull();
    expect(isFullTie(users(), 'revertRate')).toBe(true);
  });
  it('drops unresolved users and sinks null values', () => {
    const us = users();
    us[3].resolved = false;
    const r = rankedFor(us, 'responseLatencyHours');
    expect(r.some(x => x.user.username === us[3].username)).toBe(false);
    expect(r.at(-1)?.value).toBeNull();
    expect(r.at(-1)?.isLeader).toBe(false);
  });
});

describe('person summary', () => {
  it('counts leads, top 3 and median rank', () => {
    const s = personSummary(users(), 'srivera');
    expect(s.statCount).toBe(16);
    expect(s.leads).toContain('mrsReviewed');
    expect(s.medianRank).toBe(2);
  });
});

describe('deltas', () => {
  it('reads direction from the metric', () => {
    expect(deltaTone('mrsMerged', 3)).toBe('better');
    expect(deltaTone('reviewLatencyHours', 0.2)).toBe('worse');
    expect(deltaTone('mrsMerged', 0)).toBe('none');
    expect(deltaTone('mrsMerged', null)).toBe('none');
  });
  it('formats like the board', () => {
    expect(formatDelta('mrsMerged', 7)).toBe('▲7');
    expect(formatDelta('reviewLatencyHours', -0.24)).toBe('▼0.2h');
    expect(formatDelta('sizeHealthPct', 0.12)).toBe('▲12%');
    expect(formatDelta('reviewDepth', 0.53)).toBe('▲0.5');
  });
});
```

A full tie counts as no lead for anyone in `personSummary`.

- [ ] **Step 2: Run.** `bun run test -- src/app/model`. Expected: FAIL.
- [ ] **Step 3: Implement** the four files to the interfaces above.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `boxscore: add the standings, summary and delta model`.

### Task 7: Model: evidence shapes

**Files:**
- Create: `apps/boxscore/src/app/model/evidence-shapes.ts`, `evidence-shapes.test.ts`

**Interfaces:**
- Consumes: `MetricEvidence`.
- Produces:

```ts
export interface Bin { label: string; count: number; highlight: boolean }
export function waitBins(ev: MetricEvidence): Bin[]; // labels '< 0.5h','0.5–1h','1–2h','2–4h','4–8h','8–24h','24h +'; highlight = bin containing facts.p50
export function sizeBins(ev: MetricEvidence): Bin[]; // '< 10','10–50','50–100','100–200','200–400','400–800','800 +'; highlight = inside [bandLow, bandHigh]
export function depthBins(ev: MetricEvidence): Bin[]; // '0','1','2','3–5','6 +'; highlight = label !== '0'
export interface CalendarDay { date: string; count: number; inWindow: boolean; level: 0 | 1 | 2 | 3 } // level: 0 none, 1 <6, 2 <15, 3 >=15
export function calendarWeeks(ev: MetricEvidence, windowStart: string, windowEnd: string): CalendarDay[][]; // weeks Sun..Sat as rows
export interface MergeDay { date: string; count: number; run: 'longest' | 'current' | 'other' | 'none' }
export function mergeDays(ev: MetricEvidence, windowStart: string, windowEnd: string): MergeDay[];
export interface DayStatus { date: string; success: number; failed: number; canceled: number; running: number }
export function pipelinesByDay(ev: MetricEvidence, days: number): DayStatus[]; // newest first, days with any pipeline
export function reviewsByAuthor(ev: MetricEvidence): Array<{ author: string; count: number }>; // desc
```

The en dash in bin labels is a visible label copied from the board, not prose; keep it.

- [ ] **Step 1: Failing tests** with invented evidence built inline, e.g.:

```ts
const wait = { columns: ['MR','Title','Wait'], rows: [0.6, 0.7, 1.1, 1.5, 4.3, 44.4, 125.3].map((h, i) => ({ cells: [`!${i}`, `Change ${i}`, `${h}h`] })), facts: { p50: 1.1, p90: 44.4, count: 7 } };
expect(waitBins(wait).map(b => b.count)).toEqual([0, 2, 2, 0, 1, 0, 2]);
expect(waitBins(wait).find(b => b.highlight)?.label).toBe('1–2h');
```

plus: size bins with a 10–400 band, depth bins, a calendar for a 30-day window starting on a Sunday (5 rows, last row partly `inWindow: false`), merge days where a 5-day run is `longest` and the last merge day `current`, pipelines grouped by created date, reviews by author.

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `boxscore: add evidence shaping for the stat panels`.

### Task 8: UI primitives

**Files:**
- Create: `apps/boxscore/src/app/ui/LeaderMark.tsx`, `RankRow.tsx`, `DeltaMark.tsx`, `GroupTag.tsx`, `CountChip.tsx`, `TeamStrip.tsx`, `PushCalendar.tsx`, `ui.module.css`, `ui.test.tsx`

**Interfaces:**
- Consumes: Task 6 and 7 types.
- Produces (all accept an optional `parity?: string` that becomes `data-parity`):

```tsx
LeaderMark({ size?: 16 }) // gold circle, numeral '1'
RankRow({ rank: number | null; name: string; value: string; fraction: number; you?: boolean; leader?: boolean; delta?: { text: string; tone: DeltaTone } })
DeltaMark({ text: string; tone: DeltaTone })
GroupTag({ group: MetricGroup; variant: 'swatch-label' | 'pill' })
CountChip({ label: string; tone: 'ok' | 'bad' | 'warn' | 'accent' | 'gold' | 'purple' | 'neutral' })
TeamStrip({ points: Array<{ username: string; value: number; you: boolean; leader: boolean }>; max: number; maxLabel: string })
PushCalendar({ weeks: CalendarDay[][] })
```

Exact look (measure every spacing from the renders; these are the canvas values): `LeaderMark` 16px circle `--tk-fill-gold`, numeral 9px monospace 700 `--tk-on-fill-gold`. `RankRow` height 26, radius 6, padding 0 6, gap 8; you row background `light-accent`, name `--tk-text-accent` 500; others name `--tk-text-2` 400; track height 4 radius 2 `--tk-line-3`, bar you `--tk-fill-accent`, leader `--tk-fill-gold`, else `--tk-muted`; value 12px monospace right aligned. `DeltaMark` 10px monospace, `--tk-text-ok` or `--tk-text-bad`. `GroupTag` swatch 6-8px square radius 2 plus 10px 700 uppercase label letter-spacing 0.8. `CountChip` radius 999, padding 4 10, 12px, fill `light-<hue>` with `--tk-text-<hue>-small` text (neutral: `--tk-raised` with `--tk-text-2`). `TeamStrip` 360px line 2px `--tk-line-3`, dots 10px (`--tk-muted`, leader `--tk-fill-gold`), you 16px `--tk-fill-accent`, 2px `--tk-card` ring, scale labels 10px monospace. `PushCalendar` 40x32 cells radius 6 gap 6; level 0 `--tk-raised`; levels 1-3 `--tk-fill-gold` at opacity 0.35/0.65/1; counts shown only at level 3 (10px 700 `--tk-on-fill-gold`); out-of-window cells outlined `--tk-border-soft`; weekday header and week labels 10px `--tk-text-3`. Bars inside `RankRow` are `Progress` from `@mattstack/app-kit/core` with `color` set by role and `size={4}`.

- [ ] **Step 1: Failing test** `ui.test.tsx` (render with the app's existing test harness from `src/app/test-setup.ts`):

```tsx
it('RankRow marks you and leader', () => {
  render(<RankRow rank={1} name="Nora V." value="77" fraction={1} leader parity="R" />);
  expect(screen.getByText('1').closest('[data-parity]')).toBeTruthy();
  render(<RankRow rank={2} name="Sam R." value="48" fraction={0.62} you />);
  expect(screen.getByText('Sam R.')).toHaveStyle({ color: 'var(--tk-text-accent)' });
});
it('DeltaMark colours by tone', () => {
  render(<DeltaMark text="▲8" tone="better" />);
  expect(screen.getByText('▲8')).toHaveStyle({ color: 'var(--tk-text-ok)' });
});
it('PushCalendar prints counts only on the busiest days', () => {
  render(<PushCalendar weeks={[[{ date: '2026-09-20', count: 24, inWindow: true, level: 3 }, { date: '2026-09-21', count: 4, inWindow: true, level: 1 }]]} />);
  expect(screen.getByText('24')).toBeInTheDocument();
  expect(screen.queryByText('4')).toBeNull();
});
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** with CSS modules using only `var(--tk-*)` and Mantine colour variables. **Step 4: Run.** Expected: PASS. Run `bun run lint` (token-namespace rules must pass).
- [ ] **Step 5: Commit.** `boxscore: add the shared UI primitives`.

### Task 9: Shell and leaderboard table (board 01)

**Files:**
- Create: `apps/boxscore/src/app/shell/Rail.tsx`, `Topbar.tsx`, `PageHeader.tsx`, `useLinks.ts`, `apps/boxscore/src/app/leaderboard/LeadersStrip.tsx`, `StandingsTable.tsx`, `LeaderboardPage.tsx`, tests `shell.test.tsx`, `leaderboard.test.tsx`
- Modify: `apps/boxscore/src/app/App.tsx`, `apps/boxscore/src/app/routes.ts` (drop `settings`), delete `apps/boxscore/src/app/settings/`

**Interfaces:**
- Consumes: Tasks 6-8; `useLeaderboard`, `useRefreshJob`, `usePersistentState` (existing keys `forge-range`, `forge-trend`, `forge-view`).
- Produces: `<LeaderboardPage data view trend onSelectStat />` and the shell used by every page: `Rail({ active: 'leaderboard' })`, `Topbar({ crumbs: string[]; scope: string; freshness: { label: string; tone: 'ok' | 'accent' | 'warn' }; action: 'refresh' | 'cancel'; onAction })`, `PageHeader({ title; subtitle; range; onRange; trend; onTrend; view?; onView? })`.

Board 01 layout from the canvas (60px rail on `--tk-chrome` with right border; 52px topbar on `--tk-chrome` with bottom border; content padding 28/32 gap 24; leaders strip: one card, 5 equal tiles divided by `--tk-border-soft`; standings card: tabs row, 40px header row on `--tk-panel`, 56px rows, 12px column gap, `#` 36px, Person 236px, Lines ± 170px, other columns equal). Rail: mark (favicon, 32px radius 8), leaderboard nav (active `light-accent`, icon `--tk-text-accent`), spacer, settings (external link to `useLinks().console + '/settings#boxscore'`, `target="_blank"`, tooltip "Settings ↗ / Opens console › boxscore" styled as the canvas tooltip), scheme toggle. Topbar: crumbs `boxscore / Leaderboard` (15px 700 then 13px `--tk-text-2`), scope chip (monospace 12, `--tk-inset`, border), freshness dot + label (`Synced N min ago` from `generatedAt`), Refresh button. Page header: 26px 700 title letter-spacing -0.4, subtitle `<window> · <n> people · sorted by <label>` in `--tk-text-3`; segmented controls (Range, Values/Trend, table/cards icons) styled as the canvas (inset track, card-coloured active pill with a 1px shadow). Tabs: Overview + one per group with swatches; active tab 2px `--tk-fill-accent` bottom border. Overview columns per `OVERVIEW`; group tabs show `statsInGroup(g)`. Cells: value monospace 13, leader gets `LeaderMark` before the value, count stats (issues, merged, reviewed, lines, coding days) get a 72x3 bar under the value (you `--tk-fill-accent`, others `--tk-muted`, fraction of column max). Lines ± shows `+added` `--tk-text-ok` and `−deleted` `--tk-text-bad`. Zero values in `--tk-text-3`. You row `light-accent`, avatar `--tk-fill-accent` with `--tk-on-fill-accent` initials, name `--tk-text-accent` + `you` badge. Sorted header shows an arrow. Clicking a row or cell navigates to `/user/:name/:stat`.

Below the 1440px board width the standings card scrolls horizontally inside itself (the page never scrolls sideways); the leaders strip stays five equal tiles down to 1100px and wraps to rows of three below that.

Every element that corresponds to a visible canvas layer gets `data-parity` with that layer's name (open the pen JSON to read names; e.g. `Rail`, `Mark`, `Nav Leaderboard`, `Topbar`, `Scope Chip`, `Stat Leaders`, `Leader Delivery`, `Standings`, `Tabs Row`, `Header Row`, `Row Nora Vance`, `Cell MRs merged`, `Value`, `Rank Pill`, `Bar Track`, `Bar`). The page frame root is `data-parity="Leaderboard · Table"`.

- [ ] **Step 1: Failing tests.** `shell.test.tsx`: the settings entry is a link with `href` ending `/settings#boxscore` and `target="_blank"`; `/settings` renders the not-found page. `leaderboard.test.tsx` (feed the Task 4 fixture leaderboard through `fixtureLeaderboard(false)` imported from the server module): five leader tiles in group order with leader names Nora Vance, Nora Vance, Tomas Berg, Nora Vance, Priya Nair; Overview header labels equal the `OVERVIEW` labels; the you row has the `you` badge; the Revert rate column never shows a `LeaderMark` (full tie); clicking a cell navigates to `/user/srivera/mrsMerged`; switching to the Quality tab shows its six stats.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the shell and table. Rebuild `App.tsx` around `Rail` + `Topbar` + routed pages (`MattstackShell` is replaced for boxscore by `Rail`+`Topbar` because the board's rail and topbar differ from the shell's; keep `mountMattstackApp`). Keep all refresh wiring from the current `App.tsx` (cold cache probe, `awaitingRefresh`, cancel) verbatim in behaviour.
- [ ] **Step 4: Run.** `bun run test`. Expected: PASS (old component tests for replaced components may be deleted in this task when their component is no longer mounted).
- [ ] **Step 5: Parity, board 01, dark and light.** Follow `scripts/parity/run.md` for `01-leaderboard-table`. Fix every mismatch in the app and rerun until the table is empty in both schemes. Look at both side-by-sides and state plainly anything that still reads wrong.
- [ ] **Step 6: Commit.** `boxscore: rebuild the shell and leaderboard table to the board`.

### Task 10: Trend (board 07)

**Files:**
- Modify: `LeadersStrip.tsx`, `StandingsTable.tsx`, `PageHeader.tsx`; test `leaderboard.test.tsx`

**Interfaces:**
- Consumes: `deltaTone`, `formatDelta`, `DeltaMark`.

Board 07: subtitle `<window> vs <prior window> · 7 people · sorted by …`; Values/Trend segment shows Trend active; each value cell appends `DeltaMark` after the value (none when tone is `none`); the strip's You row appends its delta; the legend adds `▲▼ better` in `--tk-text-ok` and `▲▼ worse than <prior window>` in `--tk-text-bad` beside "Leads this stat".

- [ ] **Step 1: Failing test:** with `fixtureLeaderboard(true)`, the srivera Issues done cell shows `▲4` with ok colour, the Wait for review cell of nvance shows `▲0.2h` with bad colour, and a zero delta renders no mark.
- [ ] **Step 2: Run.** FAIL. **Step 3: Implement.** **Step 4: Run.** PASS.
- [ ] **Step 5: Parity, board 07, dark and light** per `run.md`. Empty mismatch tables; report the side-by-sides.
- [ ] **Step 6: Commit.** `boxscore: show trend deltas as on the trend board`.

### Task 11: Cards (board 02)

**Files:**
- Create: `apps/boxscore/src/app/leaderboard/CardsGrid.tsx`; test `cards.test.tsx`

Board 02: no leaders strip; subtitle `… · every stat, ranked`; 4 columns x 4 rows of 258px cards (radius 12, `--tk-card`, border `--tk-border-soft`, padding 14/16, gap 12), head: stat name 14/500 + `GroupTag` uppercase; body: 7 `RankRow`s using short names (`First L.`), bar fraction by value (inverse for lower-is-better), `—` rows last; full-tie stats show the tied state (value 22px monospace, "All 7 tied, no separation this window", bordered box). Card order follows `METRICS` order within `GROUP_ORDER`. Below 1440px the grid drops to 3 columns, below 1100px to 2. Row click opens `/user/:name/:stat`. The rail settings tooltip layer on this board is a hover state: parity for `Settings Tooltip` runs with the settings link hovered.

- [ ] **Step 1: Failing test:** 16 cards; Revert rate and Reverted show the tied state; Response time lists Lena O. and Ruth A. last with `—`; clicking `Sam R.` in MRs merged navigates to `/user/srivera/mrsMerged`.
- [ ] **Step 2-4:** FAIL, implement, PASS.
- [ ] **Step 5: Parity, board 02, dark and light** (hover the settings link before collecting). Empty tables; report side-by-sides.
- [ ] **Step 6: Commit.** `boxscore: rebuild the cards view to the board`.

### Task 12: Person page and Issues done panel (board 03)

**Files:**
- Create: `apps/boxscore/src/app/detail/DetailPage.tsx`, `ProfileHeader.tsx`, `PersonSummary.tsx`, `StatRail.tsx`, `StatPanel.tsx`, `evidence/IssuesEvidence.tsx`, `evidence/index.ts`; test `detail.test.tsx`
- Modify: `App.tsx` routes for `user` and `stat`

**Interfaces:**
- Consumes: `useLeaderboard` (same selection), `useUserDetail`, `personSummary`, `rankedFor`, `leaderOf`, `TeamStrip`, `CountChip`, `GroupTag`.
- Produces: `EVIDENCE: Record<MetricKey, React.ComponentType<{ ev: MetricEvidence; users: UserRow[]; username: string; statKey: MetricKey; window: TimeWindow }>>` in `evidence/index.ts` (filled in Tasks 12-14; unmapped keys render the "Nothing in this window" state until then). `/user/:name` (no stat) opens the first stat, `issuesCompleted`.

Board 03: back link; profile header (56px avatar, 26px name, you badge, meta line `@handle · window · project`); person switcher (`i of n · Name`, prev/next 32px buttons, disabled at the ends); summary card with 4 cells (Leads with led stat labels, Top 3 `n of 16`, Median rank `#n of 7`, Coding days `n of windowDays` with `streak Xd, best Yd`); body: 300px stat rail (group headers with swatches, 32px rows, selected row `light-accent`, value monospace, rank pill: gold `#1` with on-fill, else outlined `#n`) and the stat panel. Panel top: title 20/700 + group pill (`light-<hue>` with `-small` text), source line, hero (48px value, sub, Rank block, Leader block with `LeaderMark`, "Where the team sits" `TeamStrip`), definition (13px, line-height 1.55, max 820px, `--tk-text-2`, from the metric `description`), count chips from `facts`. Issues evidence: bar with "Evidence" and a filter input (filters rows by any cell text), header row on `--tk-panel`, rows with Issue id (accent monospace link to `href`), Title, State badge (Done: `light-ok` dot `--tk-dot-ok`; other states: `light-accent` dot `--tk-fill-accent`), Closed (monospace), MR(s) (accent monospace); first 9 rows then footer `Showing 9 of N` + `Show all N` toggle.

- [ ] **Step 1: Failing test:** at `/user/srivera/issuesCompleted` with fixtures: switcher reads `2 of 7 · Sam Rivera`; prev goes to `/user/nvance/issuesCompleted`, next to `/user/pnair/issuesCompleted`; on `nvance` prev is disabled; summary shows Leads 2 and Median rank `#2`; chips read `48 counted`, `4 excluded by state`, `96 outside window`; 9 rows then `Show all 48` reveals the rest; the filter narrows rows; `/user/nobody/issuesCompleted` shows the not-found message.
- [ ] **Step 2-4:** FAIL, implement, PASS.
- [ ] **Step 5: Parity, board 03, dark and light.** Empty tables; report side-by-sides.
- [ ] **Step 6: Commit.** `boxscore: rebuild the person page and issues panel to the board`.

### Task 13: Evidence panels A (board 04: Wait for review, Coding days, Pipelines, Reciprocity)

**Files:**
- Create: `detail/evidence/LatencyEvidence.tsx`, `CodingDaysEvidence.tsx`, `PipelinesEvidence.tsx`, `ReciprocityEvidence.tsx`; test `evidence-a.test.tsx`
- Modify: `detail/evidence/index.ts` (map `reviewLatencyHours`, `responseLatencyHours` → Latency; `codingDays` → CodingDays; `pipelines` → Pipelines; `reciprocity` → Reciprocity)

**Interfaces:**
- Consumes: `waitBins`, `calendarWeeks`, `pipelinesByDay`, `BarChart` + `chartDefaults` from `@mattstack/app-kit/charts`, `Progress`, `PushCalendar`, `RankRow`.

Each panel exactly as drawn on board 04 (read the frames `Panel · Wait for review`, `Panel · Coding days`, `Panel · Pipelines`, `Panel · Reciprocity`). Latency: "Distribution" `BarChart` (stacked series `normal` gray-muted and `hi` accent from `highlight`, bar radius top 4, count labels above bars via `withBarValueLabel`, x labels from `Bin.label`, no y axis, no grid), then "Slowest waits" top 6 rows with a 160px log-scale bar (`log10(h+1)/log10(max+1)`), `--tk-dot-warn` bar and `--tk-text-warn` value when over 24h; footer `Showing 6 of N · bars on a log scale`. Coding days: `PushCalendar` plus facts column (Busiest day, Longest run of push days, Weekdays without a push) and the Fewer/More legend. Pipelines: "Outcomes" `Progress` sections (success ok, failed bad, canceled muted, running accent) with legend counts and percentages, then "By day" `BarChart orientation="vertical" type="stacked"` rows for the last 7 days with a pipeline, total and `n failed` in `--tk-text-bad`. Reciprocity: "Give and take" two `Progress` bars (given `--tk-text-purple`, received muted), then "Who reviews your MRs" rows (22px avatar, handle, 4px bar, `n MRs`) top 7 with `Show all`.

- [ ] **Step 1: Failing test:** latency bins render 7 bars with the p50 bin highlighted; slowest waits lists 6 rows longest first; coding days calendar prints `28` on the busiest day; pipelines outcome legend reads `Success 138 65%`; reciprocity Given 74 vs Received 9.
- [ ] **Step 2-4:** FAIL, implement, PASS.
- [ ] **Step 5: Parity, board 04 panels Wait for review, Coding days, Pipelines, Reciprocity, dark and light** (one route per panel, root `Panel · <label>`). Empty tables; report side-by-sides.
- [ ] **Step 6: Commit.** `boxscore: add the latency, coding days, pipelines and reciprocity panels`.

### Task 14: Evidence panels B (board 04: MRs merged, Size health, Revert rate, MRs reviewed, Review depth, Merge streak)

**Files:**
- Create: `detail/evidence/MergedMrsEvidence.tsx`, `SizeEvidence.tsx`, `RevertEvidence.tsx`, `ReviewsEvidence.tsx`, `DepthEvidence.tsx`, `StreakEvidence.tsx`; test `evidence-b.test.tsx`
- Modify: `detail/evidence/index.ts` (`mrsMerged`, `additions`, `deletions` → MergedMrs with initial sort `newest`, `most-added`, `most-deleted` respectively; `sizeHealthPct` → Size; `revertRate`, `revertedCount` → Revert; `mrsReviewed` → Reviews; `reviewDepth` → Depth; `currentStreak`, `longestStreak` → Streak)

Exactly as drawn: MergedMrs sort tabs (Newest, Most added, Most deleted; active `--tk-raised`), rows with id, title, `+a` ok / `−d` bad, five 9px diff blocks (ok share vs bad share), merged date; top 6 + footer. Size: `BarChart` bins with the in-band bins as the `hi` series in `ok` and out-of-band non-zero bins in `warn`, a `referenceAreas` band (or per-bin `light-ok` background) for 10-400 as on the board, legend "Healthy band, 10–400 lines", then "Outside the band" newest 3 with `n lines` in `--tk-text-warn`. Revert: zero state (40px `light-ok` circle with check, "No reverts across N merged MRs", helper line), "When there is one" dimmed example row, footer `N merged MRs checked`; when `facts.reverted > 0` render the reverted rows with the `reverted by … after …` badge (`light-bad`, `--tk-text-bad-small`) instead of the example. Reviews: "By author" proportional bars with `@author · n` labels, then the reviews table (MR, Author, Title, Comments, Inline) top 5. Depth: `BarChart` bins (0 bin muted, others accent) and "Deepest reviews" top 3 with 6x12 accent pips. Streak: "Merge days" `BarChart` of 30 daily bars (longest run gold, current streak accent, other merge days muted, no-merge days 3px `--tk-raised`), axis labels, legend.

- [ ] **Step 1: Failing test:** `/user/srivera/additions` opens MRs merged with `Most added` active; revert panel shows the zero state for srivera and a reverted row when fed a fixture with `facts.reverted: 1`; size bins count 0/3/4/8/15/11/6; streak marks Sep 21-25 longest.
- [ ] **Step 2-4:** FAIL, implement, PASS.
- [ ] **Step 5: Parity, board 04 panels MRs merged, Size health, Revert rate, MRs reviewed, Review depth, Merge streak, dark and light.** Empty tables; report side-by-sides.
- [ ] **Step 6: Commit.** `boxscore: add the merged, size, revert, reviews, depth and streak panels`.

### Task 15: Refresh states (boards 05, 06)

**Files:**
- Create: `apps/boxscore/src/app/refresh/RefreshStatus.tsx`, `SkeletonStandings.tsx`; test `refresh.test.tsx`
- Modify: `apps/boxscore/src/app/lib/progress.ts` (stall copy), `LeaderboardPage.tsx`, `App.tsx`, `Topbar.tsx`

**Interfaces:**
- Consumes: `RefreshProgress`, `progressKey`, `STALL_AFTER_MS`, `REQUEST_DEADLINE_MS`.
- Produces: `RefreshStatus({ progress, stalledMs: number | null, window: string, cold: boolean, onCancel })`.

Board 05 (warm): topbar freshness `Refreshing · Ns` in accent and a Cancel button; a status card (accent border) under the page header with spinner, `Refreshing <window>`, `Showing the last good numbers until this finishes`, `Step k of 7` and `done / total`, overall bar (`(phaseIndex + done/total) / 7`), and 7 phase cells (done: `circle-check` `--tk-text-ok` + detail; active: spinner, `light-accent` cell, `done / total`; waiting: outlined circle + "waiting"). Phase labels in order: Roster, Merge requests, MR details, Pipelines, Pushes, Linear issues, Compute (mapped from `users, mrs-list, mrs-detail, pipelines, pushes, linear, compute`). The leaders strip and standings render at opacity 0.55. Board 06 (cold, stalled): subtitle `<window> · first refresh for this window`, title `Building <window>`, the card switches to `light-warn` fill with `--tk-fill-warn` border and bar, hourglass icon, active phase text `--tk-text-warn`, topbar `Stalled · Ns` with `--tk-dot-warn`, and `SkeletonStandings` (header plus 6 rows of `--tk-raised` bars fading) instead of data. Stall copy in `progress.ts` becomes: under `REQUEST_DEADLINE_MS` `No progress for ${s}s`; at or over it `No progress for ${s}s · still waiting on GitLab, cancel to try again later`. Update `test/progress-stall.test.ts` or its client equivalent for the new copy.

- [ ] **Step 1: Failing test:** with a progress `{ phase: 'mrs-detail', done: 142, total: 310 }` the status shows `Step 3 of 7`, `142 / 310`, Roster and Merge requests done; with `stalledMs: 42000` and `cold` it shows `Building`, the stall copy, and the skeleton; Cancel calls `onCancel`.
- [ ] **Step 2-4:** FAIL, implement, PASS.
- [ ] **Step 5: Parity, boards 05 and 06, dark and light.** Board 05: fixture scenario `refreshing`, click Refresh, collect while running. Board 06: scenario `cold-stalled`, wait until the stall notice appears (over 30s), collect. Empty tables; report side-by-sides.
- [ ] **Step 6: Commit.** `boxscore: rebuild the refresh and first-load states to the boards`.

### Task 16: Cleanup, gates and full parity

**Files:**
- Delete: `apps/boxscore/src/app/components/` (every file no longer imported), `apps/boxscore/src/app/columns.ts` if unused, `apps/boxscore/src/app/settings/` if still present
- Modify: `apps/boxscore/README.md` (UI section: pages, settings live in console), `apps/boxscore/AGENTS.md` (point at `docs/apps/design/boxscore/` and `scripts/parity/run.md`)

- [ ] **Step 1: Delete dead code.** `rg -l "components/" apps/boxscore/src` must return nothing that imports a deleted file. Run `bun run typecheck` in `apps/boxscore`.
- [ ] **Step 2: Gates.** From the repo root: `bun run boxscore:typecheck`, `bun run boxscore:lint`, `bun run boxscore:test`, `bun run boxscore:build`, `scripts/turbo.sh check --affected`. Expected: all pass. Fix and rerun until green.
- [ ] **Step 3: Full parity.** Run `scripts/parity/run.md` for all 7 boards in dark and light: 14 runs (board 04 counts as one board covering its 11 panels). Every mismatch table empty. Paste the 14 results (board, scheme, mismatches: 0) and one line per side-by-side on what it shows.
- [ ] **Step 4: Live data smoke.** Stop the fixture server; run the normal dev server against the real store; load `/`, a person page and one of each evidence shape in Fast Browser; confirm nothing errors in the console and real data renders. Do not screenshot or save any of this output into the repo.
- [ ] **Step 5: Commit.** `boxscore: remove the old UI and document the redesign`.
- [ ] **Step 6: PRs.** Split the branch into two PRs in order: PR 1 = Task 1 commit only (cherry-pick onto a branch from `origin/main`), PR 2 = the rest rebased on PR 1. Push both, open them (PR bodies follow the repo template if one exists, else the fallback in the MR writing rules), and wait for CodeRabbit and CI on each per the repo's standing rules. Do not merge without Matt.
