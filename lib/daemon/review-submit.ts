/**
 * Parses an mr:review-submit payload and anchors its comments against the
 * MR's diffs. The forge's own `submitReview` posts the review.
 */
import type { ReviewSubmitComment, ReviewSubmitReply } from "../../packages/rt-client/src/commands.ts";
import { checkAnchor, type DiffFileRow } from "./diff-line-kind.ts";

export interface ReviewSubmitInput {
  outcome: "comment" | "approve" | "request_changes";
  summary: string;
  comments: ReviewSubmitComment[];
  replies: ReviewSubmitReply[];
  expectedHeadSha?: string;
}

/** glance's GitLab review allows no more: its pending check and rollback each read one 100-item page. */
const MAX_ITEMS = 100;

const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isFullSha = (v: unknown): v is string => typeof v === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(v);

export function parseReviewSubmit(
  payload: unknown,
): { ok: true; input: ReviewSubmitInput } | { ok: false; error: string } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const fail = (error: string) => ({ ok: false as const, error });
  if (p.outcome !== "comment" && p.outcome !== "approve" && p.outcome !== "request_changes") return fail("outcome must be comment, approve or request_changes");
  if (!isText(p.summary)) return fail("summary must be a non-empty string");
  if (!Array.isArray(p.comments) || !Array.isArray(p.replies)) return fail("comments and replies must be arrays");
  if (p.expectedHeadSha !== undefined && !isFullSha(p.expectedHeadSha)) return fail("expectedHeadSha must be a full commit sha");
  if (p.comments.length + p.replies.length > MAX_ITEMS) {
    return fail(`at most ${MAX_ITEMS} comments and replies in total per review`);
  }
  const comments: ReviewSubmitComment[] = [];
  for (const [i, raw] of p.comments.entries()) {
    const c = (raw ?? {}) as Record<string, unknown>;
    if (!isText(c.body) || !isText(c.path) || !isPosInt(c.line)) {
      return fail(`comments[${i}]: body, path and a positive integer line are required`);
    }
    if ((c.oldLine !== undefined && !isPosInt(c.oldLine)) || (c.oldPath !== undefined && !isText(c.oldPath))) {
      return fail(`comments[${i}]: invalid oldPath/oldLine`);
    }
    comments.push({
      body: c.body, path: c.path, line: c.line,
      ...(c.oldPath !== undefined ? { oldPath: c.oldPath as string } : {}),
      ...(c.oldLine !== undefined ? { oldLine: c.oldLine as number } : {}),
    });
  }
  const replies: ReviewSubmitReply[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of p.replies.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (!isText(r.discussionId) || typeof r.resolve !== "boolean") {
      return fail(`replies[${i}]: discussionId and a boolean resolve are required`);
    }
    if (r.body !== undefined && !isText(r.body)) return fail(`replies[${i}]: body must be non-empty when present`);
    if (r.body === undefined && !r.resolve) return fail(`replies[${i}]: a reply needs a body or resolve: true`);
    if (seen.has(r.discussionId)) return fail(`replies[${i}]: discussion ${r.discussionId} appears more than once`);
    seen.add(r.discussionId);
    replies.push({ discussionId: r.discussionId, resolve: r.resolve, ...(r.body !== undefined ? { body: r.body as string } : {}) });
  }
  return {
    ok: true,
    input: {
      outcome: p.outcome, summary: p.summary, comments, replies,
      ...(p.expectedHeadSha !== undefined ? { expectedHeadSha: p.expectedHeadSha as string } : {}),
    },
  };
}

export type BadAnchor = { index: number; path: string; line: number };

/**
 * Anchors each comment against the MR's diffs before anything is created:
 * GitLab needs the old line too for an unchanged context line, and refuses
 * a line the diff does not show. A comment that already names its oldLine
 * is the caller's own anchor and passes through untouched.
 */
export function anchorComments(
  page: { diffs: DiffFileRow[]; truncated: boolean },
  comments: ReviewSubmitComment[],
): { comments: ReviewSubmitComment[]; badAnchors: BadAnchor[] } {
  const badAnchors: BadAnchor[] = [];
  const anchored = comments.map((c, index) => {
    if (c.oldLine !== undefined) return c;
    const anchor = checkAnchor(page, c.path, c.line);
    if (anchor.kind !== "anchorable") {
      badAnchors.push({ index, path: c.path, line: c.line });
      return c;
    }
    return {
      ...c,
      ...(anchor.oldPath && c.oldPath === undefined ? { oldPath: anchor.oldPath } : {}),
      ...(anchor.oldLine !== undefined ? { oldLine: anchor.oldLine } : {}),
    };
  });
  return { comments: anchored, badAnchors };
}
