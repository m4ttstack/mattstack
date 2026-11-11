import type { MRDashboardProps } from '@mattstack/glance';

type Reviews = MRDashboardProps['reviews'];

/**
 * A null `required` means GitHub demands a review but the count is not
 * readable, so `given + remaining` is not a total: draw the verdict alone.
 */
export function isApprovalCountUnknown(reviews: Reviews): boolean {
  return reviews.required === null;
}

export function approvalLabel(reviews: Reviews): string {
  if (isApprovalCountUnknown(reviews)) {
    return reviews.isApproved ? 'Approved' : 'Review required';
  }
  const total = reviews.given + reviews.remaining;
  return reviews.isApproved
    ? `Approved by ${reviews.given}/${total} reviewers`
    : `${reviews.given}/${total} approvals — ${reviews.remaining} remaining`;
}
