import { expect, test } from 'bun:test';

import { mergeBlockedReason } from '../src/MRDashboard.ts';

const mr = (
  over: Partial<{
    isDraft: boolean;
    statusDetail: string;
    disabled: boolean;
    loading: boolean;
  }> = {}
) => ({
  isDraft: over.isDraft ?? false,
  statusDetail: over.statusDetail ?? 'mergeable',
  mergeButton: {
    visible: true,
    disabled: over.disabled ?? false,
    loading: over.loading ?? false,
    label: 'Merge',
  },
});

test('a mergeable MR has no reason', () => {
  expect(mergeBlockedReason(mr())).toBeNull();
});

test('draft wins over every other reason', () => {
  expect(
    mergeBlockedReason(mr({ isDraft: true, disabled: true, statusDetail: 'conflict' }))
  ).toBe('draft');
});

test('a merge in flight reads merging', () => {
  expect(mergeBlockedReason(mr({ loading: true, disabled: true }))).toBe('merging');
});

test.each([
  ['ci_still_running', 'pipeline running'],
  ['ci_must_pass', 'pipeline must pass'],
  ['draft_status', 'draft'],
  ['need_rebase', 'needs rebase'],
  ['conflict', 'conflicts'],
  ['not_approved', 'needs approval'],
  ['requested_changes', 'changes requested'],
  ['discussions_not_resolved', 'open threads'],
  ['checking', 'checking'],
  ['unchecked', 'checking'],
  ['preparing', 'checking'],
  ['approvals_syncing', 'checking'],
  ['blocked_status', 'not mergeable yet'],
  ['', 'not mergeable yet'],
])('a disabled merge with status %s reads %s', (statusDetail, reason) => {
  expect(mergeBlockedReason(mr({ disabled: true, statusDetail }))).toBe(reason);
});
