import { ForgeHttpError, WriteOutcomeUnknownError } from './errors.ts';
import type { GlanceOctokit } from './githubClient.ts';
import { forgeWrite, githubLineAndSide, parseReviewThreadDiscussionId } from './githubNotes.ts';
import { pendingPreview } from './gitlabReview.ts';
import type { ReviewSubmission, ReviewSubmitResult } from './types.ts';

export interface GitHubReviewDeps {
  octokit: GlanceOctokit;
  owner: string;
  repo: string;
  pullNumber: number;
  reviewTimeoutMs: number;
  /** The provider's REST read wrapper, so read failures keep their typed errors. */
  read<T>(op: string, fn: () => Promise<T>): Promise<T>;
  reply(discussionId: string, body: string): Promise<unknown>;
  resolve(discussionId: string): Promise<void>;
}

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

const EVENT: Record<ReviewSubmission['outcome'], ReviewEvent> = {
  comment: 'COMMENT',
  approve: 'APPROVE',
  request_changes: 'REQUEST_CHANGES'
};

const REVIEWER_STATE: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'requested_changes',
  COMMENTED: 'reviewed'
};

const OWN_PULL_REQUEST = /own pull request/i;
const ANCHOR_REFUSAL = /\b(line|path|position|diff[ _]hunk)\b/i;

const OP = 'submitReview';

type Posted = { id: number; state: string };
type PostOutcome = { posted: Posted } | { failure: unknown };

/**
 * One GitHub review: refuse replies that have no thread, stop on the token's
 * own pending review, post the summary and every comment as one review, then
 * reply and resolve. The summary and comments go in one POST, so unlike
 * GitLab there is nothing to roll back.
 */
export async function submitGitHubReview(deps: GitHubReviewDeps, review: ReviewSubmission): Promise<ReviewSubmitResult> {
  for (const [i, r] of review.replies.entries()) {
    if (parseReviewThreadDiscussionId(r.discussionId) == null) {
      throw new Error(
        `review not posted: replies[${i}]: ${r.discussionId} has no thread on GitHub; post a new comment instead`
      );
    }
  }
  const comments = review.comments.map((c) => ({ path: c.path, body: c.body, ...githubLineAndSide(c) }));
  const { octokit, owner, repo, pullNumber } = deps;

  const reviews = await deps.read(OP, () =>
    octokit.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100
    })
  );
  const pending = reviews.find((r) => r.state === 'PENDING');
  if (pending) {
    const { data: drafts } = await deps.read(OP, () =>
      octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments', {
        owner,
        repo,
        pull_number: pullNumber,
        review_id: Number(pending.id),
        per_page: 100
      })
    );
    const texts = drafts.length > 0 ? drafts.map((d) => d.body) : pending.body ? [pending.body] : [];
    return {
      published: false,
      reason: 'pending-drafts',
      pending: { count: Math.max(drafts.length, 1), firstLines: pendingPreview(texts) }
    };
  }

  const post = async (event: ReviewEvent): Promise<PostOutcome> => {
    try {
      const { data } = await forgeWrite(OP, deps.reviewTimeoutMs, (signal) =>
        octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
          owner,
          repo,
          pull_number: pullNumber,
          body: review.summary,
          event,
          comments,
          request: { retries: 0, signal }
        })
      );
      return { posted: { id: Number(data.id), state: data.state } };
    } catch (err) {
      return { failure: err };
    }
  };
  const badAnchors = (): ReviewSubmitResult => ({
    published: false,
    reason: 'bad-anchors',
    badAnchors: comments.map((c, index) => ({ index, path: c.path, line: c.line }))
  });
  const refusedAnchors = (err: unknown) =>
    comments.length > 0 && err instanceof ForgeHttpError && err.status === 422 && ANCHOR_REFUSAL.test(err.bodyText);

  let approveError: string | undefined;
  let outcome = await post(EVENT[review.outcome]);
  if ('failure' in outcome) {
    const err = outcome.failure;
    const ownPullRequest = err instanceof ForgeHttpError && err.status === 422 && OWN_PULL_REQUEST.test(err.bodyText);
    if (ownPullRequest && review.outcome === 'approve') {
      approveError = err.bodyText;
      outcome = await post('COMMENT');
      if ('failure' in outcome) {
        if (refusedAnchors(outcome.failure)) return badAnchors();
        throw notPosted(outcome.failure);
      }
    } else {
      if (refusedAnchors(err)) return badAnchors();
      throw notPosted(err);
    }
  }
  const posted = outcome.posted;

  const repliedTo: string[] = [];
  const replyErrors: Array<{ discussionId: string; error: string }> = [];
  for (const r of review.replies) {
    if (r.body === undefined) continue;
    try {
      await deps.reply(r.discussionId, r.body);
      repliedTo.push(r.discussionId);
    } catch (err) {
      replyErrors.push({ discussionId: r.discussionId, error: String(err) });
    }
  }

  const failedReplies = new Set(replyErrors.map((e) => e.discussionId));
  const resolved: string[] = [];
  const resolveErrors: Array<{ discussionId: string; error: string }> = [];
  for (const r of review.replies) {
    if (!r.resolve || failedReplies.has(r.discussionId)) continue;
    try {
      await deps.resolve(r.discussionId);
      resolved.push(r.discussionId);
    } catch (err) {
      resolveErrors.push({ discussionId: r.discussionId, error: String(err) });
    }
  }

  return {
    published: true,
    comments: comments.length,
    replies: repliedTo.length,
    repliedTo,
    resolved,
    approved: posted.state === 'APPROVED',
    ...(approveError !== undefined ? { approveError } : {}),
    resolveErrors,
    ...(replyErrors.length > 0 ? { replyErrors } : {}),
    reviewId: posted.id,
    reviewerState: REVIEWER_STATE[posted.state] ?? null
  };
}

/**
 * The `publish failed` prefix on an unknown outcome is what the MCP tool
 * matches to leave the message unwrapped.
 */
function notPosted(err: unknown): Error {
  if (err instanceof WriteOutcomeUnknownError) {
    const what =
      err.reason === 'timed-out'
        ? 'the review request timed out'
        : `the review request got no answer from GitHub (${err.cause instanceof Error ? err.cause.message : String(err.cause)})`;
    return new Error(`publish failed and its outcome is unknown: ${what}; look at the pull request before retrying`, {
      cause: err
    });
  }
  return new Error(`review not posted: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
}
