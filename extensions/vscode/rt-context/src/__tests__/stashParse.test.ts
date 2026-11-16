import { describe, expect, test } from 'bun:test';
import { desktopStashMessage, findDesktopStashIn, stashRefFor } from '../stashParse';

const row = (n: number, sha: string, subject: string) => `stash@{${n}}\0${sha}\0${subject}`;

const LIST = [
  row(0, 'aaa111', 'On other: !!GitHub_Desktop<other>'),
  row(1, 'bbb222', 'On feat: !!GitHub_Desktop<feat>'),
  row(2, 'ccc333', 'On feat: !!GitHub_Desktop<feat>'),
  row(3, 'ddd444', 'WIP on feat: 1234567 plain stash'),
].join('\n');

describe('findDesktopStashIn', () => {
  test('returns the newest Desktop stash for the branch by sha', () => {
    expect(findDesktopStashIn(LIST, 'feat')).toEqual({ sha: 'bbb222', branchName: 'feat' });
  });

  test('ignores plain stashes and other branches', () => {
    expect(findDesktopStashIn(LIST, 'missing')).toBeNull();
    expect(findDesktopStashIn(row(0, 'eee', 'WIP on feat: x'), 'feat')).toBeNull();
  });

  test('round-trips the marker it writes', () => {
    const subject = `On a/b: ${desktopStashMessage('a/b')}`;
    expect(findDesktopStashIn(row(0, 'fff', subject), 'a/b')?.sha).toBe('fff');
  });
});

describe('stashRefFor', () => {
  test('finds the current index after another stash was pushed on top', () => {
    const shifted = [row(0, 'new999', 'On x: !!GitHub_Desktop<x>'), ...LIST.split('\n').map((l) =>
      l.replace(/stash@\{(\d+)\}/, (_, n) => `stash@{${Number(n) + 1}}`))].join('\n');
    expect(stashRefFor(shifted, 'bbb222')).toBe('stash@{2}');
  });

  test('is null once the stash is gone', () => {
    expect(stashRefFor(LIST, 'gone')).toBeNull();
  });
});
