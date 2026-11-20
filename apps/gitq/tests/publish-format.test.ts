import { describe, expect, test } from 'bun:test';
import { formatPublishResult } from '../src/cli/commands/forge.ts';

describe('formatPublishResult', () => {
  test('says a linked MR was already there', () => {
    expect(
      formatPublishResult({ branch: 'b1', success: true, action: 'linked', changes: [], mrIid: 7, mrUrl: 'https://x/7', targetBranch: 'master' }),
    ).toBe('b1: linked existing https://x/7');
  });

  test('names what changed on a linked MR', () => {
    expect(
      formatPublishResult({ branch: 'b2', success: true, action: 'linked', changes: ['target'], mrIid: 8, mrUrl: 'https://x/8', targetBranch: 'b1' }),
    ).toBe('b2: linked existing (retargeted to b1) https://x/8');
  });
});
