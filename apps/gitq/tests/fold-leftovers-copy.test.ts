import { describe, expect, test } from 'bun:test';
import { describeLeftovers } from '../src/cli/commands/surgery.ts';

describe('describeLeftovers', () => {
  test('names a GitHub change as a PR', () => {
    expect(describeLeftovers({ branch: 'b', mrIid: 5, mrUrl: 'https://x/5', remoteBranch: true }, 'github')).toBe(
      'b is folded locally only: its PR #5 (https://x/5) is still open and origin/b still exists',
    );
  });

  test('names a GitLab change as an MR', () => {
    expect(describeLeftovers({ branch: 'b', mrIid: 5, mrUrl: null, remoteBranch: false }, 'gitlab')).toBe(
      'b is folded locally only: its MR !5 is still open',
    );
  });
});
