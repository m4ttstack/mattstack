import { describe, expect, test } from 'bun:test';

import {
  liveSyncLines,
  parseSyncLine,
  pushSyncLine,
  shownSyncLog,
  startSyncLines,
  takeAutoOpen,
} from '../sync-lines.ts';

describe('parseSyncLine', () => {
  test('reads a tag into rt-ui glyph, title and hint', () => {
    expect(
      parseSyncLine(
        '[running] Rebasing feat onto origin/main  12 commits behind'
      )
    ).toEqual({
      status: 'running',
      glyph: '●',
      title: 'Rebasing feat onto origin/main',
      hint: '12 commits behind',
    });
    expect(parseSyncLine('[ok] Pushed')).toEqual({
      status: 'done',
      glyph: '✓',
      title: 'Pushed',
    });
    expect(parseSyncLine('[needs you] 2 files have conflicts').glyph).toBe('◆');
  });

  test('an untagged or unknown line is plain text', () => {
    expect(parseSyncLine('  why: Syncing rewrites the branch')).toEqual({
      status: null,
      glyph: null,
      title: '  why: Syncing rewrites the branch',
    });
    expect(parseSyncLine('[shrug] x').status).toBeNull();
  });
});

describe('live lines', () => {
  test('a click starts a fresh log that opens once for the clicker', () => {
    startSyncLines('mr-a');
    pushSyncLine('mr-a', '[ok] Fetched from origin');
    expect(liveSyncLines('mr-a')).toEqual(['[ok] Fetched from origin']);
    expect(takeAutoOpen('mr-a')).toBe(true);
    expect(takeAutoOpen('mr-a')).toBe(false);
  });

  test('joins the saved log and the stream where they meet', () => {
    expect(shownSyncLog(['a'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(shownSyncLog(['a', 'b', 'c'], ['a', 'b'])).toEqual(['a', 'b', 'c']);
    expect(shownSyncLog(['a', 'b', 'c'], ['c', 'd'])).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(shownSyncLog(['a', 'b'], ['x'])).toEqual(['a', 'b', 'x']);
    expect(shownSyncLog(undefined, undefined)).toEqual([]);
  });
});
