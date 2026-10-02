import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../../state/index.ts";
import { createDiscussionHandlers, type DiscussionHandlerSeams } from "../handlers/discussions.ts";
import type { ReviewMutator } from "../review-submit.ts";
import { fakeStore } from "./fake-cache-store.ts";

const fakeCtx = { repoIndex: () => ({}), cache: fakeStore({}) };
const IDENTITY = "remote:gitlab.com%2Fg%2Fsub%2Frepo-tools";
const MR_URL = "https://gitlab.example.com/g/sub/repo-tools/-/merge_requests/7";
const PAYLOAD = { repoName: IDENTITY, iid: 7, outcome: "approve", summary: "sum", comments: [{ body: "c", path: "a.ts", line: 2 }], replies: [] };
/** a.ts: new line 1 is context (old 1), 2 is added, 3 is context (old 2). */
const DIFF = "@@ -1,2 +1,3 @@\n x\n+y\n z";

function seams(over: Partial<DiscussionHandlerSeams> = {}, calls: string[] = []): DiscussionHandlerSeams {
  const mutator: ReviewMutator & { fetchReviewerStates: () => Promise<Array<{ username: string; state: string }>> } = {
    fetchDiffRefs: async () => ({ base_sha: "b", start_sha: "s", head_sha: "h" }),
    listDraftNotes: async () => [],
    createDraftNote: async (_p, _i, body, opts) => {
      calls.push(`create:${JSON.stringify(opts?.position)}`);
      return { id: 1, note: body, discussion_id: null, line_code: "lc", resolve_discussion: false };
    },
    deleteDraftNote: async () => {},
    publishDraftNotes: async () => { calls.push("publish"); },
    fetchReviewerStates: async () => [{ username: "pat", state: "approved" }],
  };
  return {
    repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "g/sub/repo-tools", projectId: 99 }),
    gitlabToken: async () => "tok",
    reviewMutator: () => mutator,
    reviewActions: async () => ({
      approve: async (iid) => { calls.push(`approve:${iid}`); },
      resolve: async (iid, id) => { calls.push(`resolve:${iid}:${id}`); },
    }),
    selfUsername: () => "pat",
    diffs: async () => ({ diffs: [{ newPath: "a.ts", oldPath: "a.ts", diff: DIFF }], truncated: false }),
    warn: () => {},
    refresh: async () => ({
      discussions: [{ id: "n1", resolved: false, notes: [{ id: 501, body: "sum", author: { username: "pat" } }] }],
      fetchedAt: 1,
    }),
    ...over,
  };
}

describe("mr:review-submit", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-review-submit-")); process.env.HOME = home; closeStateDb(); });
  afterEach(() => { process.env.HOME = origHome; closeStateDb(); rmSync(home, { recursive: true, force: true }); });

  test("submits, approves, and reports reviewer state, summary note and MR url", async () => {
    const calls: string[] = [];
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams({}, calls));
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res).toEqual({
      ok: true,
      data: {
        published: true, comments: 1, replies: 0, repliedTo: [], resolved: [], approved: true, resolveErrors: [],
        reviewerState: "approved", summaryNoteId: 501, mrUrl: MR_URL,
      },
    });
    expect(calls).toEqual([
      'create:{"base_sha":"b","start_sha":"s","head_sha":"h","position_type":"text","new_path":"a.ts","new_line":2,"old_path":"a.ts"}',
      "publish", "approve:7",
    ]);
  });

  test("a pending-drafts refusal answers ok with published false and the MR url", async () => {
    const s = seams();
    const m = s.reviewMutator!("", "");
    m.listDraftNotes = async () => [{ id: 9, note: "mine", discussion_id: null, line_code: null, resolve_discussion: false }];
    const h = createDiscussionHandlers(fakeCtx, () => {}, { ...s, reviewMutator: () => m });
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res).toEqual({ ok: true, data: { published: false, reason: "pending-drafts", pending: { count: 1, firstLines: ["mine"] }, mrUrl: MR_URL } });
  });

  test("an invalid payload is refused before any network call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams({ repoContext: async () => { throw new Error("unexpected"); } }));
    expect(await h["mr:review-submit"]({ ...PAYLOAD, outcome: "request_changes" })).toEqual({ ok: false, error: "outcome must be comment or approve" });
    expect(await h["mr:review-submit"]({ ...PAYLOAD, iid: 0 })).toEqual({ ok: false, error: "missing repoName/iid" });
    expect(await h["mr:review-submit"]({ ...PAYLOAD, repoName: "not-an-identity" })).toEqual({ ok: false, error: "repo must be a serialized identity" });
  });

  test("a refresh or reviewer-state failure never turns a published review into a failure", async () => {
    const s = seams({ refresh: async () => { throw new Error("refresh boom"); } });
    const m = s.reviewMutator!("", "") as ReviewMutator & { fetchReviewerStates: () => Promise<never> };
    m.fetchReviewerStates = async () => { throw new Error("states boom"); };
    const h = createDiscussionHandlers(fakeCtx, () => {}, { ...s, reviewMutator: () => m });
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res.ok && res.data.published).toBe(true);
    expect(res.ok && res.data.published && res.data.reviewerState).toBeNull();
    expect(res.ok && res.data.published && res.data.summaryNoteId).toBeNull();
  });

  test("a sequence failure is ok:false with its message", async () => {
    const s = seams();
    const m = s.reviewMutator!("", "");
    m.publishDraftNotes = async () => { throw Object.assign(new Error("publishDraftNotes failed: 502"), { status: 502 }); };
    m.listDraftNotes = (() => { let n = 0; return async () => (n++ === 0 ? [] : [{ id: 1, note: "c", discussion_id: null, line_code: "lc", resolve_discussion: false }]); })();
    const h = createDiscussionHandlers(fakeCtx, () => {}, { ...s, reviewMutator: () => m });
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("publish failed and its outcome is unknown");
  });

  describe("anchors", () => {
    const withComments = (comments: object[]) => ({ ...PAYLOAD, outcome: "comment", comments });

    test("a comment on an unchanged context line gets its old line", async () => {
      const calls: string[] = [];
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams({}, calls));
      const res = await h["mr:review-submit"](withComments([{ body: "c", path: "a.ts", line: 3 }]));
      expect(res.ok && res.data.published).toBe(true);
      expect(calls[0]).toBe('create:{"base_sha":"b","start_sha":"s","head_sha":"h","position_type":"text","new_path":"a.ts","new_line":3,"old_path":"a.ts","old_line":2}');
    });

    test("a comment on an added line keeps new_line alone", async () => {
      const calls: string[] = [];
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams({}, calls));
      await h["mr:review-submit"](withComments([{ body: "c", path: "a.ts", line: 2 }]));
      expect(calls[0]).toBe('create:{"base_sha":"b","start_sha":"s","head_sha":"h","position_type":"text","new_path":"a.ts","new_line":2,"old_path":"a.ts"}');
    });

    test("a line outside the diff, or a file with no diff, is a bad anchor and nothing is created", async () => {
      const calls: string[] = [];
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams({}, calls));
      const res = await h["mr:review-submit"](withComments([
        { body: "ok", path: "a.ts", line: 2 },
        { body: "far", path: "a.ts", line: 40 },
        { body: "elsewhere", path: "b.ts", line: 1 },
      ]));
      expect(res).toEqual({
        ok: true,
        data: {
          published: false, reason: "bad-anchors", mrUrl: MR_URL,
          badAnchors: [{ index: 1, path: "a.ts", line: 40 }, { index: 2, path: "b.ts", line: 1 }],
        },
      });
      expect(calls).toEqual([]);
    });

    test("a renamed file's comment takes the old path from the diff", async () => {
      const calls: string[] = [];
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams({
        diffs: async () => ({ diffs: [{ newPath: "new.ts", oldPath: "old.ts", diff: DIFF }], truncated: false }),
      }, calls));
      await h["mr:review-submit"](withComments([{ body: "c", path: "new.ts", line: 1 }]));
      expect(calls[0]).toBe('create:{"base_sha":"b","start_sha":"s","head_sha":"h","position_type":"text","new_path":"new.ts","new_line":1,"old_path":"old.ts","old_line":1}');
    });

    test("a failed diff read posts the anchors unverified and warns", async () => {
      const calls: string[] = [];
      const warned: string[] = [];
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams({
        diffs: async () => { throw new Error("diffs down"); },
        warn: (_o, msg) => { warned.push(msg); },
      }, calls));
      const res = await h["mr:review-submit"](withComments([{ body: "c", path: "a.ts", line: 40 }]));
      expect(res.ok && res.data.published).toBe(true);
      expect(warned).toEqual(["mr:review-submit: diff read failed, posting the anchors unverified"]);
    });

    test("comments that all name their old line skip the diff read", async () => {
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams({
        diffs: async () => { throw new Error("unexpected"); },
        warn: () => { throw new Error("unexpected warn"); },
      }));
      const res = await h["mr:review-submit"](withComments([{ body: "c", path: "a.ts", line: 40, oldLine: 38 }]));
      expect(res.ok && res.data.published).toBe(true);
    });
  });
});
