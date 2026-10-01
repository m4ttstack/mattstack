import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';

import {
  hugsWidth,
  hugWidthPaths,
  penPaths,
  readPen,
  type PenNode,
} from './pen';

const pen: PenNode = {
  type: 'frame',
  name: 'Doc',
  children: [
    {
      type: 'frame',
      name: 'Board A',
      children: [
        {
          type: 'frame',
          name: 'Panel',
          width: 400,
          children: [
            {
              type: 'frame',
              name: 'Chip',
              children: [{ type: 'text', name: 'Label' }],
            },
            { type: 'frame', name: 'Row', width: 'fill_container' },
            { type: 'frame', name: 'Row', width: 'fit_content(40)' },
            { type: 'frame', name: 'Hidden', enabled: false },
          ],
        },
      ],
    },
    {
      type: 'frame',
      name: 'Board B',
      children: [{ type: 'frame', name: 'Panel' }],
    },
  ],
};

describe('penPaths', () => {
  it('keys layers from the root, indexes repeated sibling names and skips disabled layers', () => {
    expect([...penPaths(pen, 'Panel', 'Board A').keys()]).toEqual([
      '',
      'Chip',
      'Chip/Label',
      'Row[0]',
      'Row[1]',
    ]);
  });

  it('scopes the search to the named board, since layer names repeat across boards', () => {
    expect([...penPaths(pen, 'Panel', 'Board B').keys()]).toEqual(['']);
    expect(() => penPaths(pen, 'Chip', 'Board B')).toThrow(
      /no layer named "Chip" in "Board B"/
    );
    expect(() => penPaths(pen, 'Panel', 'Board C')).toThrow(
      /no frame named "Board C" in the pen/
    );
  });

  it('searches the whole pen when no board is named', () => {
    expect(penPaths(pen, 'Board B').has('Panel')).toBe(true);
  });
});

describe('hugWidthPaths', () => {
  it('lists the frames that hug their content, never the root or text', () => {
    expect(hugWidthPaths(pen, 'Panel', 'Board A')).toEqual(['Chip', 'Row[1]']);
  });
});

describe('hugsWidth', () => {
  it('treats a frame with no width or a fit_content width as hugging', () => {
    expect(hugsWidth({ type: 'frame' })).toBe(true);
    expect(hugsWidth({ type: 'frame', width: 'fit_content(80)' })).toBe(true);
    expect(hugsWidth({ type: 'frame', width: 80 })).toBe(false);
    expect(hugsWidth({ type: 'frame', width: 'fill_container' })).toBe(false);
    expect(hugsWidth({ type: 'text' })).toBe(false);
  });
});

describe('readPen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-pen-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads a pen file given its path', () => {
    const path = join(dir, 'demo.pen');
    writeFileSync(path, JSON.stringify(pen));
    expect(readPen(path)).toEqual(pen);
  });
});
