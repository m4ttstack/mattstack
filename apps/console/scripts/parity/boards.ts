import type { Board } from '../../../../scripts/parity/config';

/** The design fixture's scenario (`CONSOLE_FIXTURE_SCENARIO`) a board is drawn from. */
export type Scenario = 'clean' | 'unsynced';

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
];
