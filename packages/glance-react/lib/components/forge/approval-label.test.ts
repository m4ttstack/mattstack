import type { MRDashboardProps } from '@mattstack/glance';
import { describe, expect, it } from 'vitest';

import { approvalLabel } from './approval-label';

type Reviews = MRDashboardProps['reviews'];

const DASH = String.fromCharCode(0x2014);

function reviews(over: Partial<Reviews>): Reviews {
  return {
    required: 2,
    given: 0,
    remaining: 2,
    isApproved: false,
    approvedBy: [],
    reviewers: [],
    totalAssigned: 0,
    haveActed: 0,
    havePending: 0,
    haveNotStarted: 0,
    ...over,
  };
}

describe('approvalLabel', () => {
  it('names the verdict alone when the count is unknown and not approved', () => {
    expect(approvalLabel(reviews({ required: null, remaining: 0 }))).toBe(
      'Review required'
    );
  });

  it('names the verdict alone when the count is unknown and approved', () => {
    expect(
      approvalLabel(
        reviews({ required: null, given: 1, remaining: 0, isApproved: true })
      )
    ).toBe('Approved');
  });

  it('shows the fraction and what is left for a known count', () => {
    expect(approvalLabel(reviews({ required: 2, given: 1, remaining: 1 }))).toBe(
      `1/2 approvals ${DASH} 1 remaining`
    );
  });

  it('keeps the GitLab approved wording', () => {
    expect(
      approvalLabel(
        reviews({ required: 2, given: 2, remaining: 0, isApproved: true })
      )
    ).toBe('Approved by 2/2 reviewers');
  });

  it('counts reviewers as given plus remaining', () => {
    expect(approvalLabel(reviews({ required: 3, given: 0, remaining: 3 }))).toBe(
      `0/3 approvals ${DASH} 3 remaining`
    );
  });
});
