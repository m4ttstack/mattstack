import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { hugsWidth, hugWidthPaths, penPaths, readPen } from './pen';

const EXPORT = fileURLToPath(
  new URL(
    '../../../../docs/apps/design/boxscore/parity/01-leaderboard-table.dark.html',
    import.meta.url
  )
);
const ROOT = 'Leaderboard · Table';
const TABS = 'Main/Content/Standings/Tabs Row/Tabs';

describe('pen layer paths', () => {
  const pen = readPen();

  it('has one path per layer the design export names', () => {
    const named = readFileSync(EXPORT, 'utf8').match(/data-pencil-name=/g);
    expect(penPaths(pen, ROOT).size).toBe(named!.length);
  });

  it('marks layers that hug their content, and only those', () => {
    const hug = new Set(hugWidthPaths(pen, ROOT));
    expect(hug.has(`${TABS}/Tab Overview`)).toBe(true);
    expect(hug.has('Main/Content/Standings/Header Row')).toBe(false);
    expect(hug.has('Main/Content/Standings/Row Nora Vance')).toBe(false);
    expect(hug.has('Rail')).toBe(false);
  });

  it('indexes repeated sibling names the way the collector keys them', () => {
    const paths = penPaths(pen, ROOT);
    expect(
      paths.has(
        'Main/Content/Standings/Row Nora Vance/Cell Issues done/Value Line/Value'
      )
    ).toBe(true);
    expect(paths.has('Main/Topbar/Crumbs/App Name')).toBe(true);
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
