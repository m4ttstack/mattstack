import { describe, expect, it } from 'bun:test';

import {
  boardBySlug,
  OUTPUT_DIR,
  outputDirOf,
  targetsOf,
  type Board,
} from './config';

const board = (o: Partial<Board> = {}): Board => ({
  slug: '01-demo',
  frame: 'Demo',
  frameId: 'abc',
  route: '/',
  storage: {},
  scenario: 'warm',
  roots: ['Top Right', 'Stat Leaders'],
  height: 1000,
  dynamicText: [],
  ...o,
});

describe('targetsOf', () => {
  it('stems each root as <slug>.<kebab root> on the board route', () => {
    expect(targetsOf(board({ route: '/runs' }))).toEqual([
      { stem: '01-demo.top-right', root: 'Top Right', route: '/runs' },
      { stem: '01-demo.stat-leaders', root: 'Stat Leaders', route: '/runs' },
    ]);
  });

  it('stems each panel from its label and keeps its own route and root', () => {
    expect(
      targetsOf(
        board({
          roots: [],
          panels: [
            {
              label: 'Coding days',
              route: '/u/a',
              root: 'Panel · Coding days',
            },
          ],
        })
      )
    ).toEqual([
      {
        stem: '01-demo.coding-days',
        root: 'Panel · Coding days',
        route: '/u/a',
      },
    ]);
  });
});

describe('boardBySlug', () => {
  it('finds a board and names the valid slugs when it is unknown', () => {
    const boards = [board(), board({ slug: '02-demo' })];
    expect(boardBySlug(boards, '02-demo').slug).toBe('02-demo');
    expect(() => boardBySlug(boards, 'nope')).toThrow(
      'unknown board "nope"; one of: 01-demo, 02-demo'
    );
  });
});

describe('outputDirOf', () => {
  it('falls back to the shared output dir', () => {
    const app = {
      boards: [],
      designDir: '',
      penPath: '',
      harnessPort: 1,
      appOrigin: '',
    };
    expect(outputDirOf(app)).toBe(OUTPUT_DIR);
    expect(outputDirOf({ ...app, outputDir: '/tmp/x' })).toBe('/tmp/x');
  });
});
