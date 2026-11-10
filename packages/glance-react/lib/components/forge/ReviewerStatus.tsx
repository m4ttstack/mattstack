/**
 * ReviewerStatus — reviewer approval line with popover for reviewer list.
 */

import { cn } from '@/utils';
import type { MRDashboardProps } from '@mattstack/glance';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { Row } from '../ui/flex';
import { approvalLabel, isApprovalCountUnknown } from './approval-label';
import { BlockerApprovalsIcon, CheckIcon } from './icons';
import { ReviewerList } from './ReviewerList';
import { ExpandChevron, StatusIcon } from './StatusIcon';

export function ReviewerStatus({
  reviews,
}: {
  reviews: MRDashboardProps['reviews'];
}) {
  const countUnknown = isApprovalCountUnknown(reviews);
  if (reviews.reviewers.length === 0 && !countUnknown) return null;

  const totalReviewers = reviews.given + reviews.remaining;

  const reviewTrigger = (
    <Row
      gap={1.5}
      className={cn(
        'group cursor-pointer items-center w-fit data-[state=open]:px-1.5 data-[state=open]:py-0.5 data-[state=open]:rounded-md transition-all duration-150',
        reviews.isApproved
          ? 'data-[state=open]:bg-positive/15'
          : 'data-[state=open]:bg-caution/15'
      )}
    >
      {countUnknown ? (
        <>
          <StatusIcon
            icon={reviews.isApproved ? CheckIcon : BlockerApprovalsIcon}
            color={reviews.isApproved ? 'positive' : 'caution'}
          />
          <span
            className={
              reviews.isApproved ? 'text-positive font-semibold' : undefined
            }
          >
            {approvalLabel(reviews)}
          </span>
        </>
      ) : reviews.isApproved ? (
        <>
          <StatusIcon icon={CheckIcon} color="positive" />
          <span>
            <span className="text-positive font-semibold">Approved</span> by{' '}
            {reviews.given}/{totalReviewers} reviewers
          </span>
        </>
      ) : (
        <>
          <StatusIcon icon={BlockerApprovalsIcon} color="caution" />
          <span>
            {reviews.given}/{totalReviewers} approvals
            {reviews.remaining > 0 && (
              <span className="text-muted-foreground">
                {' '}
                — {reviews.remaining} remaining
              </span>
            )}
          </span>
        </>
      )}
      {reviews.reviewers.length > 0 && <ExpandChevron />}
    </Row>
  );

  if (reviews.reviewers.length === 0) return reviewTrigger;

  return (
    <Popover>
      <PopoverTrigger asChild>{reviewTrigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <ReviewerList reviewers={reviews.reviewers} />
      </PopoverContent>
    </Popover>
  );
}
