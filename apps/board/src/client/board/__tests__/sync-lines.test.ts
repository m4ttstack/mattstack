import { describe, expect, test } from 'bun:test';

import {
  liveSyncLines,
  parseSyncLine,
  pushSyncLine,
  shownSyncLog,
  startSyncLines,
  takeAutoOpen,
  tidySyncLog,
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

describe('tidySyncLog', () => {
  const B = 'acme-1234-a-long-branch';
  const log = [
    '[ok] Syncing in worktree percy',
    '[ok] Fetched from origin',
    `[ok] Saved a backup  rt-backup/rebase/${B}/2026-11-10T18-38-44`,
    `[running] Rebasing ${B} onto origin/master  50 commits behind`,
    `[ok] Rebased ${B} onto origin/master`,
    '[ok] Pushed',
  ];

  test('a running line a later line moved past drops out', () => {
    const shown = tidySyncLog(log, B, false).map(l => l.title);
    expect(shown).not.toContain('Rebasing this branch onto origin/master');
    expect(shown).toContain('Rebased this branch onto origin/master');
  });

  test('the branch is named once, not on every line', () => {
    const shown = tidySyncLog(log, B, false);
    expect(shown.some(l => l.title.includes(B))).toBe(false);
    expect(shown.find(l => l.title === 'Saved a backup')!.hint).toBe(
      'rt-backup/rebase/…/2026-11-10T18-38-44'
    );
  });

  test('the step still running keeps its line', () => {
    const shown = tidySyncLog(log.slice(0, 4), B, true);
    expect(shown.at(-1)).toMatchObject({
      status: 'running',
      title: 'Rebasing this branch onto origin/master',
      hint: '50 commits behind',
    });
  });

  test('a failed sync keeps every line, so nothing that led to it is hidden', () => {
    const failed = [...log.slice(0, 5), `[failed] Could not push ${B}`];
    expect(tidySyncLog(failed, B, false)).toHaveLength(6);
  });
});
