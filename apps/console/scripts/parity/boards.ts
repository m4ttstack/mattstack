import { join } from 'node:path';

import type { Board } from '../../../../scripts/parity/config';

/** The design fixture's scenario (`CONSOLE_FIXTURE_SCENARIO`) a board is drawn from. */
export type Scenario = 'clean' | 'unsynced' | 'runs' | 'runs-empty';

const RUNS_PEN = join(
  import.meta.dirname,
  '../../../../docs/apps/design/console/runs.pen'
);
const RUN = '/runs/remote%3Aacme%2Fweb';

/** A runs board: `frameId` names the light frame (the README lists both). */
const runsBoard = (
  slug: string,
  frame: string,
  frameId: string,
  route: string,
  roots: string[],
  height: number,
  extra: Partial<Board<Scenario>> = {}
): Board<Scenario> => ({
  slug,
  frame,
  frameId,
  penPath: RUNS_PEN,
  route,
  storage: {},
  scenario: 'runs',
  roots,
  height,
  dynamicText: [],
  ...extra,
});

/** The gate boards draw each open gate with a saved draft: its first option
    picked and "draft saved" in the footer. */
const pickedDraft = (gateId: string, question: string, value: string) => ({
  [`console.gateDraft.${gateId}`]: JSON.stringify({
    selections: { [question]: value },
    notes: {},
    item: question,
  }),
});

const RECORD_HEADERS =
  'Run · State · Record headers (abandoned work run, review run)';

const CANVAS = ['Focus list', 'Stage', 'Focus header'];
const GRAPH = '/wiring?tab=graph';

const board = (
  slug: string,
  frame: string,
  frameId: string,
  query: string,
  extra: Partial<Board<Scenario>> = {}
): Board<Scenario> => ({
  slug,
  frame,
  frameId,
  route: `${GRAPH}&${query}`,
  storage: {},
  scenario: 'clean',
  roots: CANVAS,
  height: 1040,
  dynamicText: [],
  ...extra,
});

/**
 * `frame` and `frameId` name the light frame; the dark frame of each pair
 * shares its layer tree (docs/apps/design/console/README.md lists both ids).
 */
export const BOARDS: Board<Scenario>[] = [
  board(
    'template-work',
    'Template · work · light',
    'lC5eZ',
    'focus=pipeline:feature'
  ),
  board(
    'template-plan',
    'Template · plan · light',
    'I4dEtA',
    'focus=stage-plan'
  ),
  board(
    'drawer-text-range',
    'Template · work · drawer · light',
    'BdTVo',
    'focus=pipeline:feature&select=row:1',
    { roots: [...CANVAS, 'Drawer · compiled skill'] }
  ),
  board(
    'drawer-include-row',
    'Drawer · include row · rendered · light',
    'dXMWN',
    'focus=stage-plan&select=row:140',
    { roots: [...CANVAS, 'Drawer'] }
  ),
  board(
    'drawer-input-card',
    'Drawer · input card · used by · light',
    'JG4X2',
    'focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by',
    { roots: [...CANVAS, 'Drawer'] }
  ),
  board(
    'drawer-history',
    'Drawer · output · history · light',
    'vS78O',
    'focus=stage-plan&select=output&drawerTab=history',
    { roots: [...CANVAS, 'Drawer'] }
  ),
  board(
    'drawer-rebind',
    'Drawer · slot row · rebind · light',
    'arHq7',
    'focus=stage-plan&select=row:136&rebind=1',
    {
      roots: [...CANVAS, 'Drawer'],
      // The board draws the picker open on its new choice: open it, pick, open it again.
      action: {
        kind: 'clicks',
        layers: ['Select', 'option · plan-policy-strict', 'Select'],
        waitFor: 'options',
      },
    }
  ),
  board(
    'unsynced-banner',
    'Unsynced · banner after rebind · light',
    'S9Mvq',
    'focus=stage-plan',
    { scenario: 'unsynced', roots: [...CANVAS, 'Banner · unsynced'] }
  ),
  board(
    'unsynced-confirm',
    'Unsynced · sync confirm · light',
    'dkOZg',
    'focus=stage-plan',
    {
      scenario: 'unsynced',
      roots: [...CANVAS, 'Banner · unsynced', 'Modal · sync changes'],
      action: {
        kind: 'click',
        layer: 'button · Sync changes',
        waitFor: 'Modal · sync changes',
      },
    }
  ),
  // The runs pages read 4:23 PM from the fixture, the run pages 4:21 PM, as
  // their boards do; a runs board's ages and stats that the fixture's runs
  // cannot all reproduce compare by their words alone.
  runsBoard('runs-lanes', 'Runs · A · Lanes', 'VgoVH', '/', ['Content'], 1200, {
    dynamicText: ['oldest', 'gate', 'elapsed', 'age', 'median', 'window'],
  }),
  runsBoard(
    'runs-timeline',
    'Runs · B · Day timeline',
    'NnSYh',
    '/?view=timeline',
    ['Title row', 'Legend', 'Timeline card', 'Summary row'],
    900,
    {
      dynamicText: ['sub', 'hint', 'value'],
    }
  ),
  runsBoard(
    'runs-empty',
    'Runs · State · Nothing live or waiting',
    'hf9kp',
    '/',
    ['Content'],
    900,
    { scenario: 'runs-empty', dynamicText: ['median', 'window'] }
  ),
  runsBoard(
    'run-live',
    'Run · A · Live story',
    'CiXq3',
    `${RUN}/20261008-1338`,
    ['Hero', 'Story', 'Story list', 'Side'],
    1420
  ),
  runsBoard(
    'run-gate',
    'Run · A · Gate open',
    'ZDGNt',
    `${RUN}/20261008-1340`,
    ['Hero', 'Gate mine', 'Side'],
    1200,
    { storage: pickedDraft('g-418-plan', 'approach', 'Server-side filter') }
  ),
  runsBoard(
    'run-record',
    'Run · A · Record (finished run)',
    'p54Uq',
    `${RUN}/20261008-1142`,
    ['Hero', 'Tabs', 'Columns'],
    1220
  ),
  runsBoard(
    'run-review-live',
    'Run · State · Review run (live, waiting in the board)',
    'p3K9mj',
    `${RUN}/20261008-1502`,
    ['Hero', 'Story', 'Story list', 'Side'],
    900
  ),
  runsBoard(
    'run-two-gates',
    'Run · State · Two gates (one herd-owned)',
    'b7Glr',
    `${RUN}/20261008-1600`,
    ['Gate herd-owned', 'Gate mine'],
    1034,
    {
      storage: {
        ...pickedDraft('g-1600-ship', 'ship', 'Ready for review'),
        ...pickedDraft('g-1600-plan', 'approach', 'Server-side filter'),
      },
    }
  ),
  runsBoard(
    'run-story-edges',
    'Run · State · Story edge cases',
    'wEAjb',
    `${RUN}/20261008-0900`,
    ['Now empty', 'Story list'],
    610
  ),
  runsBoard(
    'run-record-abandoned',
    RECORD_HEADERS,
    'wHNMJ',
    `${RUN}/20261007-1310`,
    ['Hero abandoned'],
    461,
    { appRoots: { 'Hero abandoned': 'Hero' } }
  ),
  runsBoard(
    'run-record-review',
    RECORD_HEADERS,
    'wHNMJ',
    `${RUN}/20261008-0940`,
    ['Hero review'],
    461,
    { appRoots: { 'Hero review': 'Hero' } }
  ),
];
