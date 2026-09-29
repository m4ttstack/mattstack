/**
 * The standings drawn on the leaderboard boards (`Leaderboard · Table`, `· Cards`,
 * `· Trend`) in docs/apps/design/boxscore/boxscore.pen. Every person is invented.
 */
import type { TimeWindow } from '../../shared/types.js';

export const CURRENT_USER = 'srivera';
export const BASE_URL = 'https://gitlab.example.com';
export const LINEAR_URL = 'https://linear.example.com/acme/issue';
export const PROJECT_PATH = 'acme/web-app';

/** Midnight UTC bounds make the day grids exactly Aug 30 to Sep 28; window labels must be formatted from UTC dates (ISO slice) to read Aug 30 to Sep 29. */
export const WINDOW: TimeWindow = {
  start: '2026-08-30T00:00:00.000Z',
  end: '2026-09-29T00:00:00.000Z',
  key: '30d',
};
export const PRIOR_WINDOW: TimeWindow = {
  start: '2026-07-31T00:00:00.000Z',
  end: '2026-08-30T00:00:00.000Z',
  key: '30d',
};

export const ROSTER: readonly (readonly [string, string])[] = [
  ['nvance', 'Nora Vance'],
  ['srivera', 'Sam Rivera'],
  ['pnair', 'Priya Nair'],
  ['tberg', 'Tomas Berg'],
  ['lortiz', 'Lena Ortiz'],
  ['kmorgan', 'Kai Morgan'],
  ['radeyemi', 'Ruth Adeyemi'],
];

type Seven<T> = readonly [T, T, T, T, T, T, T];

/** One column per ROSTER entry, in ROSTER order. */
export const SCALARS = {
  issuesCompleted: [77, 48, 19, 12, 11, 5, 6],
  additions: [25535, 17749, 14766, 2834, 10266, 2210, 3032],
  deletions: [4214, 3849, 1544, 590, 1311, 185, 137],
  mrsMerged: [78, 47, 20, 11, 11, 7, 6],
  mrsReviewed: [65, 74, 45, 6, 0, 13, 0],
  pipelines: [360, 212, 104, 37, 62, 56, 35],
  reviewDepth: [3.38, 1.82, 2.62, 0.17, 0, 0.62, 0],
  revertRate: [0, 0, 0, 0, 0, 0, 0],
  revertedCount: [0, 0, 0, 0, 0, 0, 0],
  sizeHealthPct: [0.71, 0.64, 0.4, 0.73, 0.09, 0.57, 0.67],
  codingDays: [24, 21, 17, 12, 15, 10, 9],
  currentStreak: [3, 1, 2, 1, 0, 1, 1],
  longestStreak: [9, 5, 4, 3, 2, 2, 2],
  reciprocity: [6.1, 8.22, 11.4, 0.55, 0, 1.86, 0],
} as const satisfies Record<string, Seven<number>>;

/** [p50, p90] hours; null = no samples. */
export const DISTRIBUTIONS = {
  reviewLatencyHours: [
    [0.66, 3.1],
    [0.65, 4.29],
    [0.67, 2.8],
    [0.56, 1.9],
    [0.93, 3.4],
    [5.84, 22.5],
    [1.0, 4.0],
  ],
  responseLatencyHours: [
    [4.56, 19.2],
    [18.65, 70.8],
    [22.62, 64.3],
    [0.66, 2.1],
    [null, null],
    [20.37, 55.4],
    [null, null],
  ],
} as const satisfies Record<
  string,
  Seven<readonly [number | null, number | null]>
>;

/** [success, failed, canceled, other]. */
export const PIPELINE_STATUS: Seven<readonly [number, number, number, number]> =
  [
    [252, 94, 8, 6],
    [138, 65, 6, 3],
    [71, 28, 3, 2],
    [27, 9, 1, 0],
    [41, 19, 2, 0],
    [38, 16, 1, 1],
    [25, 9, 1, 0],
  ];

/** The Trend board's chips, signed by raw direction (▲ positive). A cell with no chip is 0. */
export const DELTAS: Partial<
  Record<keyof typeof SCALARS | keyof typeof DISTRIBUTIONS, Seven<number>>
> = {
  issuesCompleted: [8, 4, -6, 4, -10, -11, -14],
  mrsMerged: [0, 3, 10, 7, 14, 14, 0],
  mrsReviewed: [-7, 7, -3, -9, -7, 13, -9],
  reviewDepth: [0.1, 0, 0.5, -0.9, 0.5, 0.8, -0.1],
  reviewLatencyHours: [0.2, 0, -0.2, 0.1, 0.2, 0, 0.2],
  sizeHealthPct: [-0.03, 0.12, -0.02, -0.05, -0.03, -0.04, 0.07],
  codingDays: [10, 0, 5, 0, -11, -6, 2],
  reciprocity: [0, -1.1, -0.1, 0, 0, 0.9, 1.1],
};
