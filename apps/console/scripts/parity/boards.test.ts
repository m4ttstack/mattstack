// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { targetsOf } from '../../../../scripts/parity/config';
import { hugWidthPaths, readPen } from '../../../../scripts/parity/pen';
import { app } from './harness';

const pen = readPen(app.penPath);
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
  it('lists the nine boards of the design README', () => {
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
    ]);
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
        expect(() => hugWidthPaths(pen, t.root, board.frame)).not.toThrow();
      }
    });
  });
});
