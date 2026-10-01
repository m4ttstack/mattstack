import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  hugWidthPaths,
  penPaths,
  readPen,
} from '../../../../scripts/parity/pen';

const EXPORT = fileURLToPath(
  new URL(
    '../../../../docs/apps/design/boxscore/parity/01-leaderboard-table.dark.html',
    import.meta.url
  )
);
const PEN = fileURLToPath(
  new URL('../../../../docs/apps/design/boxscore/boxscore.pen', import.meta.url)
);
const ROOT = 'Leaderboard · Table';
const TABS = 'Main/Content/Standings/Tabs Row/Tabs';

describe('pen layer paths', () => {
  const pen = readPen(PEN);

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

describe('content roots', () => {
  const pen = readPen(PEN);

  it('finds a content layer inside the named board, keyed from that layer', () => {
    const status = penPaths(pen, 'Refresh Status', 'Leaderboard · Refreshing');
    expect(status.has('')).toBe(true);
    expect(status.has('RS Head')).toBe(true);
    expect(() =>
      penPaths(pen, 'Refresh Status', 'Leaderboard · Table')
    ).toThrow(/no layer named "Refresh Status" in "Leaderboard · Table"/);
  });
});
