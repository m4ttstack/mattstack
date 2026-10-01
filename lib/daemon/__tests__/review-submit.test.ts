import { describe, expect, test } from "bun:test";
import type { DraftNote } from "@mattstack/glance";
import { parseReviewSubmit, submitReview, type ReviewMutator, type ReviewSubmitDeps } from "../review-submit.ts";

const REFS = { base_sha: "b", start_sha: "s", head_sha: "h" };
const draft = (id: number, over: Partial<DraftNote> = {}): DraftNote =>
  ({ id, note: `n${id}`, discussion_id: null, line_code: `lc${id}`, resolve_discussion: false, ...over });

/** A scripted GitLab: records every call in order and keeps a pending list. */
function fake(over: Partial<ReviewMutator> = {}) {
  const log: string[] = [];
  let pending: DraftNote[] = [];
  let next = 1;
  const mutator: ReviewMutator = {
    fetchDiffRefs: async () => { log.push("refs"); return REFS; },
    listDraftNotes: async () => { log.push("list"); return [...pending]; },
    createDraftNote: async (_p, _i, body, opts = {}) => {
      const d = draft(next++, { note: body, discussion_id: opts.inReplyToDiscussionId ?? null });
      log.push(opts.inReplyToDiscussionId ? `reply:${opts.inReplyToDiscussionId}:${opts.resolveDiscussion}` : `comment:${opts.position?.new_path}:${opts.position?.new_line}`);
      pending.push(d);
      return d;
    },
    deleteDraftNote: async (_p, _i, id) => { log.push(`delete:${id}`); pending = pending.filter(d => d.id !== id); },
    publishDraftNotes: async (_p, _i, o) => { log.push(`publish:${o.reviewerState}:${o.note}`); pending = []; },
    ...over,
  };
  const deps: ReviewSubmitDeps = {
    mutator, projectId: 99, iid: 7,
    position: (c, refs) => ({ ...refs, position_type: "text", new_path: c.path, old_path: c.oldPath ?? c.path, new_line: c.line }),
    approve: async () => { log.push("approve"); },
    resolve: async (id) => { log.push(`resolve:${id}`); },
  };
  return { deps, log, seed: (d: DraftNote[]) => { pending = d; }, pending: () => pending };
}

const INPUT = {
  outcome: "comment" as const, summary: "sum",
  comments: [{ body: "c1", path: "src/a.ts", line: 3 }, { body: "c2", path: "src/b.ts", line: 9 }],
  replies: [{ discussionId: "d1", body: "fixed, thanks", resolve: true }, { discussionId: "d2", resolve: true }, { discussionId: "d3", body: "still wrong", resolve: false }],
};

describe("submitReview", () => {
  test("posts comments, then replies, publishes once, then resolves the bodiless reply", async () => {
    const f = fake();
    const out = await submitReview(f.deps, INPUT);
    expect(f.log).toEqual([
      "list", "refs", "comment:src/a.ts:3", "comment:src/b.ts:9",
      "reply:d1:true", "reply:d3:false", "publish:reviewed:sum", "resolve:d2",
    ]);
    expect(out).toEqual({
      published: true, comments: 2, replies: 2, repliedTo: ["d1", "d3"],
      resolved: ["d1", "d2"], approved: false, resolveErrors: [],
    });
  });

  test("approve runs after the publish", async () => {
    const f = fake();
    const out = await submitReview(f.deps, { ...INPUT, outcome: "approve", replies: [] });
    expect(f.log.slice(-2)).toEqual(["publish:reviewed:sum", "approve"]);
    expect(out.published && out.approved).toBe(true);
  });

  test("the caller's own pending comments refuse the review before anything is created", async () => {
    const f = fake();
    f.seed([draft(50, { note: "half a thought\nsecond line" }), draft(51, { note: "another" })]);
    const out = await submitReview(f.deps, INPUT);
    expect(out).toEqual({ published: false, reason: "pending-drafts", pending: { count: 2, firstLines: ["half a thought", "another"] } });
    expect(f.log).toEqual(["list"]);
  });

  test("a null line_code deletes everything this call created and names the anchor", async () => {
    const f = fake({});
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      const d = await create(p, i, body, opts);
      return body === "c2" ? { ...d, line_code: null } : d;
    };
    const out = await submitReview(f.deps, INPUT);
    expect(out).toEqual({ published: false, reason: "bad-anchors", badAnchors: [{ index: 1, path: "src/b.ts", line: 9 }] });
    expect(f.log).not.toContain("publish:reviewed:sum");
    expect(f.pending()).toEqual([]);
  });

  test("a create that throws rolls back and reports nothing posted", async () => {
    const f = fake();
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === "c2") throw new Error("boom");
      return create(p, i, body, opts);
    };
    await expect(submitReview(f.deps, INPUT)).rejects.toThrow(/review not posted: Error: boom/);
    expect(f.pending()).toEqual([]);
  });

  test("a rollback that cannot delete says how many pending comments are left", async () => {
    const f = fake({ deleteDraftNote: async () => { throw new Error("nope"); } });
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === "c2") throw new Error("boom");
      return create(p, i, body, opts);
    };
    await expect(submitReview(f.deps, INPUT)).rejects.toThrow(/1 pending comment could not be deleted/);
  });

  test("a publish that throws but left no pending comments counts as landed", async () => {
    const f = fake();
    const publish = f.deps.mutator.publishDraftNotes;
    f.deps.mutator.publishDraftNotes = async (p, i, o) => { await publish(p, i, o); throw new Error("timeout"); };
    const out = await submitReview(f.deps, INPUT);
    expect(out.published).toBe(true);
  });

  test("a publish that throws and left pending comments deletes them and fails", async () => {
    const f = fake({ publishDraftNotes: async () => { throw new Error("502"); } });
    await expect(submitReview(f.deps, INPUT)).rejects.toThrow(/publish failed, nothing was posted/);
    expect(f.pending()).toEqual([]);
  });

  test("a publish that throws with nothing pending to check reports an unknown outcome", async () => {
    const f = fake({ publishDraftNotes: async () => { throw new Error("timeout"); } });
    await expect(submitReview(f.deps, { outcome: "comment", summary: "sum", comments: [], replies: [{ discussionId: "d2", resolve: true }] }))
      .rejects.toThrow(/outcome is unknown.*look for the summary/);
    expect(f.log).not.toContain("resolve:d2");
  });

  test("a refused approval after the publish is reported, not thrown", async () => {
    const f = fake();
    f.deps.approve = async () => { throw new Error("401 Unauthorized"); };
    const out = await submitReview(f.deps, { ...INPUT, outcome: "approve" });
    expect(out.published && out.approved).toBe(false);
    expect(out.published && out.approveError).toContain("401");
  });

  test("a failed resolve-only is listed and the rest still resolve", async () => {
    const f = fake();
    f.deps.resolve = async (id) => { if (id === "d2") throw new Error("gone"); };
    const out = await submitReview(f.deps, { ...INPUT, replies: [{ discussionId: "d2", resolve: true }, { discussionId: "d4", resolve: true }] });
    expect(out.published && out.resolved).toEqual(["d4"]);
    expect(out.published && out.resolveErrors).toEqual([{ discussionId: "d2", error: "Error: gone" }]);
  });

  test("a summary-only review skips diff refs and publishes", async () => {
    const f = fake();
    await submitReview(f.deps, { outcome: "comment", summary: "sum", comments: [], replies: [] });
    expect(f.log).toEqual(["list", "publish:reviewed:sum"]);
  });
});

describe("parseReviewSubmit", () => {
  const base = { outcome: "comment" as const, summary: "s", comments: [], replies: [] };
  const bad = (over: object, error: string) => expect(parseReviewSubmit({ ...base, ...over })).toEqual({ ok: false, error });

  test("accepts the minimal review", () => {
    expect(parseReviewSubmit(base)).toEqual({ ok: true, input: base });
  });
  test("refuses anything but comment or approve", () => bad({ outcome: "request_changes" }, "outcome must be comment or approve"));
  test("refuses a blank summary", () => bad({ summary: "  " }, "summary must be a non-empty string"));
  test("refuses a comment without a positive integer line", () =>
    bad({ comments: [{ body: "b", path: "a.ts", line: 0 }] }, "comments[0]: body, path and a positive integer line are required"));
  test("refuses a bad oldLine", () =>
    bad({ comments: [{ body: "b", path: "a.ts", line: 1, oldLine: -1 }] }, "comments[0]: invalid oldPath/oldLine"));
  test("refuses a reply that neither posts nor resolves", () =>
    bad({ replies: [{ discussionId: "d1", resolve: false }] }, "replies[0]: a reply needs a body or resolve: true"));
  test("refuses a blank reply body", () =>
    bad({ replies: [{ discussionId: "d1", body: " ", resolve: true }] }, "replies[0]: body must be non-empty when present"));
  test("refuses the same thread twice", () =>
    bad({ replies: [{ discussionId: "d1", resolve: true }, { discussionId: "d1", body: "x", resolve: false }] }, "replies[1]: discussion d1 appears more than once"));
  test("refuses more than 100 comments", () =>
    bad({ comments: Array.from({ length: 101 }, () => ({ body: "b", path: "a.ts", line: 1 })) }, "at most 100 comments and 100 replies per review"));
});
