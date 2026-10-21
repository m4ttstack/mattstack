import { describe, expect, test } from 'bun:test';

import {
  anchorLine,
  diffStats,
  filePatch,
  windowPatch,
  type FileDiff,
} from '../diff-source.ts';

const HUNKS = [
  '@@ -98,6 +98,7 @@ export function useRadarMap(provider: RadarProvider) {',
  ' export function useRadarMap(provider: RadarProvider) {',
  '   const mapRef = useRef<RadarMap | null>(null);',
  '   const layers = useLayers();',
  '+  const isDetached = useRef(false);',
  ' ',
  '   useEffect(() => {',
  '     if (!provider) return;',
  '@@ -112,6 +113,8 @@ export function useRadarMap(provider: RadarProvider) {',
  '   const onModel = (model: RadarModel) => {',
  '-    layers.add(model);',
  '+    if (mapRef.current === null) return;',
  '+    // tore this map down, so drop it here.',
  '+    layers.add(model);',
  '   };',
  '   return { onModel };',
  ' }',
  '',
].join('\n');

const DIFF: FileDiff = {
  path: 'packages/radar-map/src/useRadarMap.ts',
  patch: HUNKS,
  forge: 'gitlab',
  webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/812/diffs',
};

describe('anchorLine', () => {
  test('reads the line off a file:line anchor', () => {
    expect(anchorLine('a/b.ts:119')).toBe(119);
  });
  test('a bare file has no line', () => {
    expect(anchorLine('a/b.ts')).toBeUndefined();
  });
});

describe('filePatch', () => {
  test('gives a hunks-only forge patch its file headers', () => {
    expect(filePatch(DIFF).split('\n').slice(0, 3)).toEqual([
      '--- a/packages/radar-map/src/useRadarMap.ts',
      '+++ b/packages/radar-map/src/useRadarMap.ts',
      '@@ -98,6 +98,7 @@ export function useRadarMap(provider: RadarProvider) {',
    ]);
  });
  test('leaves a patch that already has headers alone', () => {
    const withHeaders = `--- a/x.ts\n+++ b/x.ts\n${HUNKS}`;
    expect(filePatch({ ...DIFF, patch: withHeaders })).toBe(withHeaders);
  });
});

describe('windowPatch', () => {
  test('keeps three diff lines either side of the anchor, inside its hunk, with a header that counts them', () => {
    const lines = windowPatch(DIFF, 116)!.split('\n');
    expect(lines.slice(0, 2)).toEqual([
      '--- a/packages/radar-map/src/useRadarMap.ts',
      '+++ b/packages/radar-map/src/useRadarMap.ts',
    ]);
    expect(lines.slice(2)).toEqual([
      '@@ -113,4 +114,6 @@',
      '-    layers.add(model);',
      '+    if (mapRef.current === null) return;',
      '+    // tore this map down, so drop it here.',
      '+    layers.add(model);',
      '   };',
      '   return { onModel };',
      ' }',
      '',
    ]);
  });

  test('stops at the hunk edge', () => {
    const lines = windowPatch(DIFF, 98)!.split('\n').slice(2);
    expect(lines[0]).toBe('@@ -98,3 +98,4 @@');
    expect(lines).toHaveLength(6);
  });

  test('a blank context line stripped to nothing still counts as a line', () => {
    const stripped = { ...DIFF, patch: HUNKS.replace('\n \n', '\n\n') };
    expect(windowPatch(stripped, 103)).toBe(windowPatch(DIFF, 103));
    expect(filePatch(stripped)).toBe(filePatch(DIFF));
  });

  test('a window of added lines only names the old line it follows', () => {
    const added = {
      ...DIFF,
      patch: [
        '@@ -10,2 +10,9 @@',
        ' a',
        ' b',
        ...['c', 'd', 'e', 'f', 'g', 'h', 'i'].map(x => `+${x}`),
        '',
      ].join('\n'),
    };
    expect(windowPatch(added, 15)!.split('\n')[2]).toBe('@@ -11,0 +12,7 @@');
  });

  test('a new file keeps its zero old range at 0,0', () => {
    const created = {
      ...DIFF,
      patch: ['@@ -0,0 +1,3 @@', '+a', '+b', '+c', ''].join('\n'),
    };
    expect(windowPatch(created, 2)!.split('\n')[2]).toBe('@@ -0,0 +1,3 @@');
  });

  test('an anchor outside every hunk has no window', () => {
    expect(windowPatch(DIFF, 40)).toBeNull();
  });
});

describe('diffStats', () => {
  test('counts added and removed lines', () => {
    expect(diffStats(DIFF)).toEqual({ additions: 4, deletions: 1 });
  });
});
