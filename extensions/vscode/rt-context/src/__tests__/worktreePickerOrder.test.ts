import { describe, expect, test } from 'bun:test';
import { fallbackWorktrees, fromPickerRows, pickerLayout, type OrderedWorktree } from '../worktreeParse';
import type { WorktreeEntry } from '../types';

const wt = (dirPath: string, branch: string | null, isCurrent = false): WorktreeEntry => ({
  dirPath,
  name: dirPath.split('/').pop()!,
  branch,
  isCurrent,
});

const all = () => true;
const same = (p: string) => p;

const slots = (trees: OrderedWorktree[], grouped: boolean) =>
  pickerLayout(trees, grouped).map((s) => (s.kind === 'tree' ? s.tree.name : `-- ${s.label}`));

describe('fromPickerRows', () => {
  test("keeps the daemon's order exactly and marks the window's tree", () => {
    const rows = [
      { path: '/r/main', branch: 'main', group: null },
      { path: '/pool/zed', branch: 'z', group: 'today' as const },
      { path: '/pool/amy', branch: 'a', group: 'idle 7d+' as const },
    ];
    const out = fromPickerRows(rows, '/pool/amy', same);
    expect(out.map((t) => [t.name, t.group, t.isCurrent])).toEqual([
      ['main', null, false],
      ['zed', 'today', false],
      ['amy', 'idle 7d+', true],
    ]);
  });
});

describe('fallbackWorktrees', () => {
  test("keeps git's order and drops the trees rt hides", () => {
    const rows = [
      wt('/r/acme', 'master'),
      wt('/pool/zed', 'feature/z'),
      wt('/pool/arthur', 'on-deck/arthur'),
      wt('/golden/gl-x', 'rt/golden'),
      wt('/u/.cache/gitq/work/abc/gitq-1', null),
      wt('/pool/.trash/old', 'feature/old'),
      wt('/pool/bill', 'feature/a'),
    ];
    expect(fallbackWorktrees(rows, all).map((r) => r.name)).toEqual(['acme', 'zed', 'bill']);
  });

  test('drops a missing folder but never the main checkout', () => {
    const rows = [wt('/r/main', 'main'), wt('/pool/gone', 'x'), wt('/pool/here', 'y')];
    const exists = (p: string) => p === '/pool/here';
    expect(fallbackWorktrees(rows, exists).map((r) => r.name)).toEqual(['main', 'here']);
  });

  test('keeps the current window tree even when rt would hide it', () => {
    const rows = [wt('/r/main', 'main'), wt('/pool/arthur', 'on-deck/arthur', true)];
    expect(fallbackWorktrees(rows, all).map((r) => r.name)).toEqual(['main', 'arthur']);
  });
});

describe('pickerLayout', () => {
  const tree = (name: string, group: OrderedWorktree['group'], isCurrent = false): OrderedWorktree => ({
    dirPath: `/p/${name}`,
    name,
    branch: name,
    isCurrent,
    group,
  });

  test('pins the current tree, then rt order with a separator per group', () => {
    const trees = [
      tree('main', null),
      tree('a', 'today'),
      tree('cur', 'today', true),
      tree('b', 'today'),
      tree('c', 'this week'),
      tree('d', 'idle 7d+'),
    ];
    expect(slots(trees, true)).toEqual([
      'cur',
      '-- ',
      'main',
      '-- today',
      'a',
      'b',
      '-- this week',
      'c',
      '-- idle 7d+',
      'd',
    ]);
  });

  test('says the order is git’s when the daemon is down', () => {
    const trees = [tree('main', null, true), tree('a', null)];
    expect(slots(trees, false)).toEqual(['main', '-- git order: rt daemon not running', 'a']);
  });
});
