/**
 * Errors this SDK throws that a caller is expected to branch on.
 *
 * Most failures here are transport or forge errors and carry only a message.
 * The ones in this file exist because a caller cannot act correctly on the
 * message alone.
 */

import type { MergeQueueEntry, PullRequest } from './types.ts';

/**
 * A read-back that could not be completed, after a write that had already
 * landed (MAT-169).
 *
 * `createPullRequest`, `updatePullRequest`, and `mergePullRequest` each issue
 * their write and then read the MR back, both to return it and -- for a draft
 * transition -- to confirm the write had the effect it asked for. The write
 * and the read are separate calls to the forge, so a read that fails says
 * nothing about whether the write did. Throwing a bare `Error` left the caller
 * unable to tell "the forge rejected your write" from "your write landed and
 * we cannot describe the result", and the two want opposite handling: the
 * first is worth retrying and surfacing as a failure, the second is a
 * succeeded write that a retry would apply twice.
 *
 * `writeApplied` names which case this is. It is false only where the read had
 * no write in front of it, such as a watcher's poll.
 *
 * This is a plain `Error` subclass, so a caller that does not branch on it
 * keeps the behaviour it already had.
 */
export class ReadBackFailedError extends Error {
  /**
   * True when the forge accepted a write immediately before this read. As far
   * as this SDK knows the MR is in the requested state; what failed is
   * describing it back. A caller should not re-issue the write on this.
   */
  readonly writeApplied: boolean;

  /** SDK operation that gave up, e.g. `"updatePullRequest"`. */
  readonly operation: string;

  /** Project the MR belongs to, as the operation was given it. */
  readonly projectPath: string;

  /** MR/PR number within the project. */
  readonly iid: number;

  constructor(
    message: string,
    details: {
      operation: string;
      projectPath: string;
      iid: number;
      writeApplied: boolean;
      cause?: unknown;
    },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    // Assigned rather than declared as a field initializer: a subclass field
    // would be installed after `super()`, and `name` is read by anything that
    // formats the error during construction.
    this.name = 'ReadBackFailedError';
    this.operation = details.operation;
    this.projectPath = details.projectPath;
    this.iid = details.iid;
    this.writeApplied = details.writeApplied;
  }
}

/**
 * A GitHub merge whose write landed (or was already queued) but whose
 * read-back failed. It still reports what happened to the source branch, so a
 * landed merge always says whether its branch was deleted.
 */
export class MergeReadBackFailedError extends ReadBackFailedError {
  /** Why the source branch is still there; absent when it was deleted or no deletion was asked for. */
  declare readonly sourceBranchNotDeleted?: string;

  /** The merge queue entry, when the merge went through the queue. */
  declare readonly queued?: MergeQueueEntry;

  constructor(
    message: string,
    details: {
      operation: string;
      projectPath: string;
      iid: number;
      writeApplied: boolean;
      cause?: unknown;
      sourceBranchNotDeleted?: string;
      queued?: MergeQueueEntry;
    },
  ) {
    super(message, details);
    this.name = 'MergeReadBackFailedError';
    // Assigned only when present, so `'sourceBranchNotDeleted' in err` matches the result's convention.
    if (details.sourceBranchNotDeleted !== undefined) {
      (this as { sourceBranchNotDeleted?: string }).sourceBranchNotDeleted = details.sourceBranchNotDeleted;
    }
    if (details.queued !== undefined) {
      (this as { queued?: MergeQueueEntry }).queued = details.queued;
    }
  }
}

/** A follow-up write GitHub's create needs, since its create call cannot set these fields. */
export type CreateFollowUpStep = 'reviewers' | 'assignees' | 'labels';

/** One follow-up step that failed after the PR was created. */
export interface FailedCreateStep {
  step: CreateFollowUpStep;
  message: string;
  cause?: unknown;
}

/**
 * A GitHub create whose PR exists but whose reviewers, assignees or labels
 * step failed. Every requested step was attempted before this was thrown, so
 * `failedSteps` is the complete list of what is missing. Retrying the create
 * would hit GitHub's "a pull request already exists"; re-apply only the
 * failed steps to PR `iid` instead.
 *
 * `pullRequest` is the read-back taken after the steps, null when that read
 * failed too; `cause` is then the read-back's error, otherwise the first
 * failed step's.
 */
export class PartialCreateError extends ReadBackFailedError {
  readonly failedSteps: FailedCreateStep[];

  readonly pullRequest: PullRequest | null;

  constructor(
    message: string,
    details: {
      projectPath: string;
      iid: number;
      failedSteps: FailedCreateStep[];
      pullRequest: PullRequest | null;
      cause?: unknown;
    },
  ) {
    super(message, {
      operation: 'createPullRequest',
      projectPath: details.projectPath,
      iid: details.iid,
      writeApplied: true,
      cause: details.cause,
    });
    this.name = 'PartialCreateError';
    this.failedSteps = details.failedSteps;
    this.pullRequest = details.pullRequest;
  }
}

/**
 * A forge refused a request because a rate limit is exhausted, and waiting it
 * out is longer than the caller can afford.
 *
 * Raised instead of letting the throttling plugin sleep until the window
 * resets, which stalled a daemon poll for up to an hour. `kind` separates the
 * hourly quota (`primary`) from the burst limit (`secondary`): they reset on
 * different clocks, so a caller deciding when to retry needs to know which.
 * GitLab's per-minute limit is a burst limit, so GitLab raises `secondary`
 * once its wait passes `GITLAB_READ_RATE_LIMIT_DEADLINE_S` or
 * `GITLAB_WRITE_RATE_LIMIT_DEADLINE_S`.
 */
export class RateLimitedError extends Error {
  readonly kind: 'primary' | 'secondary';

  /** ISO time the limit lifts, when the forge said; null when it did not. */
  readonly resetAt: string | null;

  /**
   * How long to wait before retrying: GitHub's `Retry-After` when sent, 60s
   * for a secondary limit with quota left and no header; GitLab's reset plus
   * a margin; otherwise null.
   */
  readonly retryAfterMs: number | null;

  /** The request that hit the limit, e.g. `"GET /repos/a/b/pulls/1"`. */
  readonly operation: string;

  constructor(
    message: string,
    details: {
      kind: 'primary' | 'secondary';
      resetAt: string | null;
      retryAfterMs: number | null;
      operation: string;
      cause?: unknown;
    },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'RateLimitedError';
    this.kind = details.kind;
    this.resetAt = details.resetAt;
    this.retryAfterMs = details.retryAfterMs;
    this.operation = details.operation;
  }
}

/**
 * A forge answered a request with a non-2xx status. Carries the parts a caller
 * branches on, so it never has to parse them back out of the message.
 *
 * Thrown by `fetchProjectLabels`, `fetchPipelineList`, `addPullRequestLabels`
 * and `removePullRequestLabels` on both forges, by GitLab's
 * `fetchPullRequestSummaries`, and by GitHub's `fetchCommitParents` and
 * `fetchPipelineFailedJobs`. GitHub's `fetchPullRequestSummaries` throws a
 * plain `Error` on a GraphQL or HTTP failure, and GitLab's
 * `fetchCommitParents` and `fetchPipelineFailedJobs` throw the legacy
 * `"<method> failed: ..."` `Error`.
 */
export class ForgeHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  /**
   * The forge's error message text (GitHub's `message`, GitLab's `message` or
   * `error`), or the raw response body when it has no message field. After
   * gitbeaker gives up retrying a GitLab 429 or 502, it is gitbeaker's retry
   * message, since no response reaches glance.
   */
  readonly bodyText: string;

  constructor(message: string, status: number, statusText: string, bodyText: string) {
    super(message);
    this.name = 'ForgeHttpError';
    this.status = status;
    this.statusText = statusText;
    this.bodyText = bodyText;
  }
}

/** GitLab created a discussion but returned it with no notes, so there is no note to report. */
export class EmptyDiscussionError extends Error {
  readonly discussionId: string;

  constructor(discussionId: string, message = `GitLab created discussion ${discussionId} with no notes`) {
    super(message);
    this.name = 'EmptyDiscussionError';
    this.discussionId = discussionId;
  }
}

/**
 * A write whose outcome is unknown: it timed out, or GitHub's answer never
 * arrived. The forge may still have applied it, so a caller must look before
 * retrying rather than send it again.
 */
export class WriteOutcomeUnknownError extends Error {
  readonly operation: string;
  readonly reason: 'timed-out' | 'no-answer' | 'server-error';

  constructor(
    message: string,
    details: { operation: string; reason: 'timed-out' | 'no-answer' | 'server-error'; cause?: unknown }
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'WriteOutcomeUnknownError';
    this.operation = details.operation;
    this.reason = details.reason;
  }
}
