/**
 * One GitLab review as one sequence: refuse on the caller's own pending
 * comments, create every comment and reply as a pending comment, publish
 * once, then approve and resolve. Pure over its deps; the handler in
 * handlers/discussions.ts supplies the real GitLab plumbing.
 */
import type { DiffRefs, NoteMutator, TextPosition } from "@mattstack/glance";
import type { ReviewSubmitComment, ReviewSubmitData, ReviewSubmitReply } from "../../packages/rt-client/src/commands.ts";

export type ReviewMutator = Pick<
  NoteMutator,
  "fetchDiffRefs" | "listDraftNotes" | "createDraftNote" | "deleteDraftNote" | "publishDraftNotes"
>;

export interface ReviewSubmitInput {
  outcome: "comment" | "approve";
  summary: string;
  comments: ReviewSubmitComment[];
  replies: ReviewSubmitReply[];
}

export interface ReviewSubmitDeps {
  mutator: ReviewMutator;
  projectId: number;
  iid: number;
  position: (comment: ReviewSubmitComment, refs: DiffRefs) => TextPosition;
  approve: () => Promise<void>;
  resolve: (discussionId: string) => Promise<void>;
}

/** The three fields the handler adds after the sequence: it alone knows the MR url and reads GitLab back. */
type Strip<T> = T extends unknown ? Omit<T, "mrUrl" | "reviewerState" | "summaryNoteId"> : never;
export type ReviewSubmitOutcome = Strip<ReviewSubmitData>;

/** Must not exceed listDraftNotes' page size: the rollback reads pending comments as one page. */
const MAX_ITEMS = 100;
const PENDING_PREVIEW = 5;

const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function parseReviewSubmit(
  payload: unknown,
): { ok: true; input: ReviewSubmitInput } | { ok: false; error: string } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const fail = (error: string) => ({ ok: false as const, error });
  if (p.outcome !== "comment" && p.outcome !== "approve") return fail("outcome must be comment or approve");
  if (!isText(p.summary)) return fail("summary must be a non-empty string");
  if (!Array.isArray(p.comments) || !Array.isArray(p.replies)) return fail("comments and replies must be arrays");
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
  return { ok: true, input: { outcome: p.outcome, summary: p.summary, comments, replies } };
}

function firstLine(text: string): string {
  return (text.split("\n").find(l => l.trim()) ?? "").trim().slice(0, 120);
}

interface Rollback {
  left: number;
  firstError?: string;
}

function leftover({ left, firstError }: Rollback): string {
  const cause = firstError === undefined ? "" : ` (first error: ${firstError})`;
  if (left > 0) {
    return `; ${left} pending comment${left === 1 ? "" : "s"} could not be deleted and ${left === 1 ? "is" : "are"} still on the MR${cause}`;
  }
  return firstError === undefined ? "" : `; pending comments could not be listed, so one may still be on the MR${cause}`;
}

export async function submitReview(deps: ReviewSubmitDeps, input: ReviewSubmitInput): Promise<ReviewSubmitOutcome> {
  const { mutator, projectId, iid } = deps;

  const before = await mutator.listDraftNotes(projectId, iid);
  if (before.length > 0) {
    return {
      published: false,
      reason: "pending-drafts",
      pending: { count: before.length, firstLines: before.slice(0, PENDING_PREVIEW).map(d => firstLine(d.note)) },
    };
  }

  const created: number[] = [];
  const deleteAll = async (ids: number[], firstError?: string): Promise<Rollback> => {
    let left = 0;
    for (const id of ids) {
      try {
        await mutator.deleteDraftNote(projectId, iid, id);
      } catch (err) {
        left++;
        firstError ??= String(err);
      }
    }
    return { left, firstError };
  };
  /**
   * The check above proved the caller had no pending comments, so every one
   * listed now is this call's, including a create that landed and then threw
   * before its id reached `created`.
   */
  const rollback = async (): Promise<Rollback> => {
    let ids: number[];
    try {
      ids = (await mutator.listDraftNotes(projectId, iid)).map(d => d.id);
    } catch (err) {
      return deleteAll(created, String(err));
    }
    return deleteAll(ids);
  };

  const badAnchors: Array<{ index: number; path: string; line: number }> = [];
  try {
    if (input.comments.length > 0) {
      const refs = await mutator.fetchDiffRefs(projectId, iid);
      for (const [index, c] of input.comments.entries()) {
        const d = await mutator.createDraftNote(projectId, iid, c.body, { position: deps.position(c, refs) });
        created.push(d.id);
        if (d.line_code === null) badAnchors.push({ index, path: c.path, line: c.line });
      }
    }
    if (badAnchors.length === 0) {
      for (const r of input.replies) {
        if (r.body === undefined) continue;
        const d = await mutator.createDraftNote(projectId, iid, r.body, {
          inReplyToDiscussionId: r.discussionId,
          resolveDiscussion: r.resolve,
        });
        created.push(d.id);
      }
    }
  } catch (err) {
    throw new Error(`review not posted: ${String(err)}${leftover(await rollback())}`);
  }
  if (badAnchors.length > 0) {
    const rb = await rollback();
    if (rb.left > 0) throw new Error(`review not posted: ${badAnchors.length} comment anchors are outside the diff${leftover(rb)}`);
    return { published: false, reason: "bad-anchors", badAnchors };
  }

  try {
    await mutator.publishDraftNotes(projectId, iid, { note: input.summary, reviewerState: "reviewed" });
  } catch (err) {
    if (created.length === 0) {
      throw new Error(`publish failed and its outcome is unknown: ${String(err)}; look for the summary on the MR before retrying`);
    }
    let remaining;
    try {
      remaining = await mutator.listDraftNotes(projectId, iid);
    } catch (listErr) {
      throw new Error(`publish failed and its outcome is unknown: ${String(err)}; listing pending comments failed too: ${String(listErr)}; look for the summary on the MR before retrying`);
    }
    if (remaining.length > 0) {
      const pendingIds = new Set(remaining.map(d => d.id));
      const stillPending = created.filter(id => pendingIds.has(id)).length;
      const rb = await deleteAll([...pendingIds]);
      if (stillPending === created.length) {
        throw new Error(`publish failed, nothing was posted: ${String(err)}${leftover(rb)}`);
      }
      throw new Error(`publish failed and only partly landed: ${created.length - stillPending} of ${created.length} pending comments were posted: ${String(err)}${leftover(rb)}; look at the MR before retrying`);
    }
  }

  let approved = false;
  let approveError: string | undefined;
  if (input.outcome === "approve") {
    try {
      await deps.approve();
      approved = true;
    } catch (err) {
      approveError = String(err);
    }
  }

  const resolved: string[] = [];
  const resolveErrors: Array<{ discussionId: string; error: string }> = [];
  for (const r of input.replies) {
    if (!r.resolve) continue;
    if (r.body !== undefined) {
      resolved.push(r.discussionId);
      continue;
    }
    try {
      await deps.resolve(r.discussionId);
      resolved.push(r.discussionId);
    } catch (err) {
      resolveErrors.push({ discussionId: r.discussionId, error: String(err) });
    }
  }

  const posted = input.replies.filter(r => r.body !== undefined);
  return {
    published: true,
    comments: input.comments.length,
    replies: posted.length,
    repliedTo: posted.map(r => r.discussionId),
    resolved,
    approved,
    ...(approveError !== undefined ? { approveError } : {}),
    resolveErrors,
  };
}
