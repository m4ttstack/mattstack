// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { targetsOf } from '../../../../scripts/parity/config';
import { hugWidthPaths, readPen } from '../../../../scripts/parity/pen';
import { app } from './harness';

const pens = new Map<string, ReturnType<typeof readPen>>();
const penOf = (board: (typeof app.boards)[number]) => {
  const path = board.penPath ?? app.penPath;
  if (!pens.has(path)) pens.set(path, readPen(path));
  return pens.get(path)!;
};
const exportOf = (slug: string, scheme: 'light' | 'dark') =>
  readFileSync(join(app.designDir, `${slug}.${scheme}.html`), 'utf8');
const layerCount = (html: string, name: string) =>
  html.split(`data-pencil-name="${name}"`).length - 1;

const actionLayers = (board: (typeof app.boards)[number]) => {
  const a = board.action;
  if (!a) return [];
  if (a.kind === 'clicks') return [...a.layers, a.waitFor];
  if (a.kind === 'waitText') return [a.layer, a.until.layer];
  return [a.layer, a.waitFor, ...(a.until ? [a.until.layer] : [])];
};

describe('console parity boards', () => {
  it('lists the thirty boards of the design README', () => {
    expect(app.boards.map(b => b.slug)).toEqual([
      'template-work',
      'template-plan',
      'drawer-text-range',
      'drawer-include-row',
      'drawer-input-card',
      'drawer-history',
      'drawer-rebind',
      'unsynced-banner',
      'unsynced-confirm',
      'runs-lanes',
      'runs-timeline',
      'runs-empty',
      'run-live',
      'run-gate',
      'run-record',
      'run-review-live',
      'run-two-gates',
      'run-story-edges',
      'run-record-abandoned',
      'run-record-review',
      'runs-p2-live',
      'runs-p2-gate',
      'runs-p2-record',
      'runs-p2-inputs',
      'runs-p2-states',
      'runs-p2-runs',
      'runs-p2-review',
      'runs-p2-story-details',
      'runs-p2-overlays',
      'runs-p2-search',
    ]);
  });

  it('names a dynamic text layer only where its board draws one', () => {
    for (const board of app.boards) {
      const html = exportOf(board.slug, 'light');
      for (const name of board.dynamicText)
        expect([board.slug, name, layerCount(html, name)]).not.toEqual([
          board.slug,
          name,
          0,
        ]);
    }
  });

  describe.each(app.boards)('$slug', board => {
    it.each(['light', 'dark'] as const)(
      'names each root and action layer in the %s export',
      scheme => {
        const html = exportOf(board.slug, scheme);
        for (const t of targetsOf(board))
          expect([t.root, layerCount(html, t.root)]).toEqual([t.root, 1]);
        for (const layer of actionLayers(board))
          expect(layerCount(html, layer)).toBeGreaterThan(0);
      }
    );

    it('finds each root inside its frame in the pen', () => {
      for (const t of targetsOf(board)) {
        expect(() =>
          hugWidthPaths(penOf(board), t.root, board.frame)
        ).not.toThrow();
      }
    });
  });
});
