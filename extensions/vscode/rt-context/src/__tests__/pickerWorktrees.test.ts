import { describe, expect, test } from 'bun:test';
import { pickerWorktrees } from '../worktreeParse';
import type { WorktreeEntry } from '../types';

const wt = (dirPath: string, branch: string | null, isCurrent = false): WorktreeEntry => ({
  dirPath,
  name: dirPath.split('/').pop()!,
  branch,
  isCurrent,
});

const all = () => true;

describe('pickerWorktrees', () => {
  test('drops the trees rt cd hides: on-deck, golden, gitq slots, trash', () => {
    const rows = [
      wt('/r/acme', 'master'),
      wt('/pool/arthur', 'on-deck/arthur'),
      wt('/golden/gl-x', 'rt/golden'),
      wt('/u/.cache/gitq/work/abc/gitq-1', null),
      wt('/pool/.trash/old', 'feature/old'),
      wt('/pool/bill', 'feature/overview-tab'),
    ];
    expect(pickerWorktrees(rows, all).map((r) => r.name)).toEqual(['acme', 'bill']);
  });

  test('keeps the main checkout first and sorts the rest A to Z by branch, else folder', () => {
    const rows = [
      wt('/r/main', 'main'),
      wt('/pool/zed', 'feature/b'),
      wt('/pool/amy', null),
      wt('/pool/kim', 'Feature/a'),
    ];
    expect(pickerWorktrees(rows, all).map((r) => r.name)).toEqual(['main', 'amy', 'kim', 'zed']);
  });

  test('drops a missing folder but never the main checkout', () => {
    const rows = [wt('/r/main', 'main'), wt('/pool/gone', 'x'), wt('/pool/here', 'y')];
    const exists = (p: string) => p === '/pool/here';
    expect(pickerWorktrees(rows, exists).map((r) => r.name)).toEqual(['main', 'here']);
  });

  test('applies the shared rule to the first row too, skipping only its folder check', () => {
    const rows = [wt('/golden/gl-x', 'rt/golden'), wt('/pool/bill', 'feature/b')];
    expect(pickerWorktrees(rows, all).map((r) => r.name)).toEqual(['bill']);
  });

  test('keeps the current window tree even when rt would hide it', () => {
    const rows = [wt('/r/main', 'main'), wt('/pool/arthur', 'on-deck/arthur', true)];
    expect(pickerWorktrees(rows, all).map((r) => r.name)).toEqual(['main', 'arthur']);
  });
});
