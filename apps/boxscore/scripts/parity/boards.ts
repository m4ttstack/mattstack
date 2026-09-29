/** One named layer as the collector (`collect.js`) sees it, box relative to the board root. */
export interface ParityNode {
  key: string;
  kind: 'text' | 'box';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  color: string | null;
  text: string | null;
  /** Product of opacities from the node up to (not including) the root's parent. */
  opacity?: number;
  /** Raw layer name, before the key's `[i]` suffix. */
  name?: string;
  /** Index into the same array of the nearest named ancestor; -1 for the root. */
  parent?: number;
  tag?: string;
}

export interface Mismatch {
  key: string;
  field: string;
  design: string;
  app: string;
}

export type Scenario = 'warm' | 'refreshing' | 'cold-stalled';

/** Text a layer must match (a RegExp source) before the runner collects. */
export interface TextWait {
  layer: string;
  pattern: string;
  timeoutMs: number;
}

/** What the runner does after the route loads, before collecting. */
export type BoardAction =
  | { kind: 'click'; layer: string; waitFor: string; until?: TextWait }
  | { kind: 'hover'; layer: string; waitFor: string; until?: TextWait }
  | { kind: 'waitText'; layer: string; until: TextWait };

export interface Board {
  slug: string;
  /** Top-level frame name in `boxscore.pen`. */
  frame: string;
  /** Pencil node id of that frame, for re-exporting. */
  frameId: string;
  route: string;
  /** localStorage entries (raw stored strings) set before the route loads. */
  storage: Record<string, string>;
  scenario: Scenario;
  /**
   * Content layers compared on `route`, each by its `data-parity` (app) and
   * `data-pencil-name` (design) value. The chrome around them is the kit's, so
   * only content is compared, with boxes relative to each content root.
   */
  roots: string[];
  /** Viewport height in CSS px. The design side is 1440 wide; the app side is sized so each root matches its design width. */
  height: number;
  dynamicText: string[];
  action?: BoardAction;
  /** Boards drawn as several panels compare each panel on its own route, instead of `roots`. */
  panels?: { label: string; route: string; root: string }[];
}

export const VIEWPORT_WIDTH = 1440;
export const DESIGN_NAME_ATTR = 'data-pencil-name';
export const APP_NAME_ATTR = 'data-parity';

const DYNAMIC_TEXT = ['Fresh Label', 'RS Sub'];

const PANEL_STATS: [label: string, stat: string][] = [
  ['Wait for review', 'reviewLatencyHours'],
  ['Coding days', 'codingDays'],
  ['Pipelines', 'pipelines'],
  ['Reciprocity', 'reciprocity'],
  ['MRs merged', 'mrsMerged'],
  ['Size health', 'sizeHealthPct'],
  ['Revert rate', 'revertRate'],
  ['MRs reviewed', 'mrsReviewed'],
  ['Review depth', 'reviewDepth'],
  ['Merge streak', 'longestStreak'],
];

export const BOARDS: Board[] = [
  {
    slug: '01-leaderboard-table',
    frame: 'Leaderboard · Table',
    frameId: 'WqX8t',
    route: '/',
    storage: {
      'forge-view': '"table"',
      'forge-trend': 'false',
      'forge-range': '{"range":"30d"}',
    },
    scenario: 'warm',
    roots: [
      'Crumbs',
      'Top Right',
      'Page Header',
      'Stat Leaders',
      'Standings',
      'Footnote',
    ],
    height: 1000,
    dynamicText: DYNAMIC_TEXT,
  },
  {
    slug: '02-leaderboard-cards',
    frame: 'Leaderboard · Cards',
    frameId: 'iUxSO',
    route: '/',
    storage: { 'forge-view': '"cards"' },
    scenario: 'warm',
    roots: ['Crumbs', 'Top Right', 'Page Header', 'Metric Grid'],
    height: 1400,
    dynamicText: DYNAMIC_TEXT,
  },
  {
    slug: '03-person-stat-detail',
    frame: 'Person · Stat detail',
    frameId: 'bhvvQ',
    route: '/user/srivera/issuesCompleted',
    storage: {},
    scenario: 'warm',
    roots: [
      'Crumbs',
      'Top Right',
      'Back Link',
      'Profile Header',
      'Summary',
      'Body',
    ],
    height: 1300,
    dynamicText: DYNAMIC_TEXT,
  },
  {
    slug: '04-stat-evidence-variants',
    frame: 'Stat detail · evidence variants',
    frameId: 'JPhZn',
    route: '/user/srivera/reviewLatencyHours',
    storage: {},
    scenario: 'warm',
    roots: [],
    height: 1300,
    dynamicText: DYNAMIC_TEXT,
    panels: PANEL_STATS.map(([label, stat]) => ({
      label,
      route: `/user/srivera/${stat}`,
      root: `Panel · ${label}`,
    })),
  },
  {
    slug: '05-refreshing',
    frame: 'Leaderboard · Refreshing',
    frameId: 'k6kFQA',
    route: '/',
    storage: { 'forge-view': '"table"' },
    scenario: 'refreshing',
    roots: [
      'Crumbs',
      'Top Right',
      'Page Header',
      'Refresh Status',
      'Stat Leaders',
      'Standings',
      'Footnote',
    ],
    height: 1100,
    dynamicText: DYNAMIC_TEXT,
    action: {
      kind: 'click',
      layer: 'Refresh Button',
      waitFor: 'Refresh Status',
      until: { layer: 'Fresh Label', pattern: '· \\d{2}s$', timeoutMs: 30_000 },
    },
  },
  {
    slug: '06-first-load-stalled',
    frame: 'Leaderboard · First load, stalled',
    frameId: 'ULlmd',
    route: '/',
    storage: {},
    scenario: 'cold-stalled',
    roots: ['Crumbs', 'Top Right', 'Page Header', 'Refresh Status', 'Skeleton'],
    height: 1000,
    dynamicText: DYNAMIC_TEXT,
    action: {
      kind: 'waitText',
      layer: 'RS Sub',
      until: {
        layer: 'RS Sub',
        pattern: 'still waiting on GitLab',
        timeoutMs: 90_000,
      },
    },
  },
  {
    slug: '07-leaderboard-trend',
    frame: 'Leaderboard · Trend',
    frameId: 'rmvgy',
    route: '/',
    storage: { 'forge-trend': 'true' },
    scenario: 'warm',
    roots: [
      'Crumbs',
      'Top Right',
      'Page Header',
      'Stat Leaders',
      'Standings',
      'Footnote',
    ],
    height: 1000,
    dynamicText: DYNAMIC_TEXT,
  },
];

export function boardBySlug(slug: string): Board {
  const board = BOARDS.find(b => b.slug === slug);
  if (!board) {
    throw new Error(
      `unknown board "${slug}"; one of: ${BOARDS.map(b => b.slug).join(', ')}`
    );
  }
  return board;
}

/** One compared content root. */
export interface ParityTarget {
  /** Output file stem, e.g. `01-leaderboard-table.standings` or `04-stat-evidence-variants.coding-days`. */
  stem: string;
  root: string;
  route: string;
}

const stemPart = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function targetsOf(board: Board): ParityTarget[] {
  if (board.panels) {
    return board.panels.map(p => ({
      stem: `${board.slug}.${stemPart(p.label)}`,
      root: p.root,
      route: p.route,
    }));
  }
  return board.roots.map(root => ({
    stem: `${board.slug}.${stemPart(root)}`,
    root,
    route: board.route,
  }));
}
