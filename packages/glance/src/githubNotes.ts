import { RequestError } from '@octokit/request-error';
import { ForgeHttpError, WriteOutcomeUnknownError } from './errors.ts';
import { bodyText, reasonPhrase, toRateLimitedError } from './githubClient.ts';
import type { CommentAnchor } from './types.ts';

/**
 * The root comment id inside a `gh-review-thread-<id>` discussion id, or null
 * for any other shape.
 *
 * Null for `gh-issue-comment-<id>` is the useful case: those are PR-level
 * comments with no thread behind them, and the caller turns the null into an
 * explanation rather than sending a comment id to a mutation that wants a
 * thread.
 */
export function parseReviewThreadDiscussionId(discussionId: string): number | null {
  const match = /^gh-review-thread-(\d+)$/.exec(discussionId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

/** GitHub's side rule: the new line on `RIGHT` when there is one, else the old line on `LEFT`. */
export function githubLineAndSide(anchor: CommentAnchor): { line: number; side: 'LEFT' | 'RIGHT' } {
  if (anchor.line !== undefined) return { line: anchor.line, side: 'RIGHT' };
  if (anchor.oldLine !== undefined) return { line: anchor.oldLine, side: 'LEFT' };
  throw new Error(`a comment anchor on ${anchor.path} needs line or oldLine`);
}

/** GitHub keeps diff comments and pull request comments in two id spaces. */
export type GitHubCommentKind = 'diff' | 'general';

/**
 * Which id space a comment with no known kind lives in: the diff comment
 * first, the pull request comment on a 404. `read` returns the URL of the
 * pull request or issue the found comment belongs to.
 */
export async function resolveGitHubCommentKind(
  ref: { id: number; projectPath: string; mrIid: number },
  read: (kind: GitHubCommentKind) => Promise<string>
): Promise<GitHubCommentKind> {
  for (const kind of ['diff', 'general'] as const) {
    let parentUrl: string;
    try {
      parentUrl = await read(kind);
    } catch (err) {
      if (err instanceof ForgeHttpError && err.status === 404) continue;
      throw err;
    }
    if (!parentUrl.endsWith(`/${ref.mrIid}`)) {
      throw new Error(`comment ${ref.id} belongs to another pull request`);
    }
    return kind;
  }
  throw new Error(`no comment ${ref.id} on ${ref.projectPath}#${ref.mrIid}`);
}

/**
 * GitHub's `message` plus its `errors` entries, joined by `; `. The entries
 * carry the reason (a line outside the diff, an approval of one's own pull
 * request), so every check on a write failure reads this, never `message`
 * alone.
 */
export function githubErrorDetail(err: RequestError): string {
  const data = err.response?.data as { message?: unknown; errors?: unknown } | string | undefined;
  if (!data || typeof data !== 'object' || typeof data.message !== 'string') return bodyText(err);
  const entries = Array.isArray(data.errors) ? data.errors.map(errorEntryText).filter(Boolean) : [];
  return [data.message, ...entries].join('; ');
}

function errorEntryText(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return '';
  const e = entry as { message?: unknown; field?: unknown; code?: unknown };
  if (typeof e.message === 'string') return e.message;
  return [e.field, e.code].filter((part) => typeof part === 'string').join(' ');
}

/** The one `ForgeHttpError` shape for a GitHub non-2xx; reads and writes differ only in `detail`. */
export function githubHttpError(err: RequestError, detail: string): ForgeHttpError {
  const statusText = reasonPhrase(err.status);
  return new ForgeHttpError(`GitHub returned ${err.status} ${statusText}: ${detail}`, err.status, statusText, detail);
}

const CHECK_BEFORE_RETRYING = 'GitHub may still have applied it; check the pull request before retrying';

/**
 * Runs one GitHub write under its own timeout. A rate limit becomes
 * `RateLimitedError` and a non-2xx `ForgeHttpError` with `githubErrorDetail`.
 * A timeout or a lost answer becomes `WriteOutcomeUnknownError`: the client
 * sends writes with `retries: 0`, so nothing here ever sends it twice.
 */
export async function forgeWrite<T>(
  op: string,
  timeoutMs: number,
  write: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await write(signal);
  } catch (err) {
    // Octokit reports an aborted fetch as a status 500 RequestError with no response.
    if (signal.aborted) {
      throw new WriteOutcomeUnknownError(`${op} timed out: ${CHECK_BEFORE_RETRYING}`, {
        operation: op,
        reason: 'timed-out',
        cause: err
      });
    }
    const limited = toRateLimitedError(err, op);
    if (limited) throw limited;
    if (err instanceof RequestError && err.response) throw githubHttpError(err, githubErrorDetail(err));
    if (err instanceof RequestError) {
      throw new WriteOutcomeUnknownError(
        `${op} got no answer from GitHub (${err.message}): ${CHECK_BEFORE_RETRYING}`,
        { operation: op, reason: 'no-answer', cause: err }
      );
    }
    throw err;
  }
}
