import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ReviewSubmission, ReviewSubmitResult } from "@mattstack/glance";
import { closeStateDb } from "../../state/index.ts";
import { createDiscussionHandlers, type DiscussionHandlerSeams, type ThreadContext, type ThreadProvider } from "../handlers/discussions.ts";
import type { Discussion } from "../../../packages/rt-client/src/commands.ts";
import { fakeStore } from "./fake-cache-store.ts";

const fakeCtx = { repoIndex: () => ({}), cache: fakeStore({}) };
const IDENTITY = "remote:gitlab.com%2Fg%2Fsub%2Frepo-tools";
const MR_URL = "https://gitlab.example.com/g/sub/repo-tools/-/merge_requests/7";
const PAYLOAD = { repoName: IDENTITY, iid: 7, outcome: "approve", summary: "sum", comments: [{ body: "c", path: "a.ts", line: 2 }], replies: [] };
/** a.ts: new line 1 is context (old 1), 2 is added, 3 is context (old 2). */
const DIFF = "@@ -1,2 +1,3 @@\n x\n+y\n z";

const PUBLISHED: ReviewSubmitResult = {
  published: true, comments: 1, replies: 0, repliedTo: [], resolved: [], approved: true, resolveErrors: [],
  reviewId: null, reviewerState: null,
};

function summaryThread(noteId: number, body: string, username: string): Discussion {
  return {
    id: "n1", resolvable: false, resolved: null,
    notes: [{
      id: noteId, body, author: { id: "gitlab:user:1", username, name: username, avatarUrl: null },
      createdAt: "2026-11-11T00:00:00Z", system: false, type: null, resolvable: null, resolved: null, position: null,
    }],
  };
}

interface Stub {
  provider: ThreadProvider;
  calls: unknown[][];
  sent: () => ReviewSubmission;
}

function stubProvider(
  over: {
    submit?: (review: ReviewSubmission) => Promise<ReviewSubmitResult>;
    states?: () => Promise<Array<{ username: string; state: string }>>;
    head?: () => Promise<{ sha?: string } | null>;
  } = {},
  baseURL = "https://gitlab.example.com",
): Stub {
  const calls: unknown[][] = [];
  const provider = {
    baseURL,
    submitReview: async (projectPath: string, iid: number, review: ReviewSubmission) => {
      calls.push(["submitReview", projectPath, iid, review]);
      return over.submit ? over.submit(review) : PUBLISHED;
    },
    fetchReviewerStates: async (projectPath: string, iid: number) => {
      calls.push(["fetchReviewerStates", projectPath, iid]);
      return over.states ? over.states() : [{ username: "pat", state: "approved" }];
    },
    ...(over.head ? {
      fetchSingleMR: async (projectPath: string, iid: number, user: string | null) => {
        calls.push(["fetchSingleMR", projectPath, iid, user]);
        return over.head!();
      },
    } : {}),
  } as unknown as ThreadProvider;
  const sent = () => {
    const call = calls.find((c) => c[0] === "submitReview");
    if (!call) throw new Error("submitReview was never called");
    return call[3] as ReviewSubmission;
  };
  return { provider, calls, sent };
}

function seams(stub: Stub, over: Partial<DiscussionHandlerSeams> = {}, forge?: ThreadContext["forge"]): DiscussionHandlerSeams {
  const projectPath = forge === "github" ? "o/r" : "g/sub/repo-tools";
  return {
    repoContext: async () => ({ ...(forge ? { forge } : {}), provider: stub.provider, projectPath, projectId: forge === "github" ? null : 42 }),
    selfUsername: () => "pat",
    diffs: async () => ({ diffs: [{ newPath: "a.ts", oldPath: "a.ts", diff: DIFF }], truncated: false }),
    warn: () => {},
    refresh: async () => ({ discussions: [summaryThread(501, "sum", "pat")], fetchedAt: 1 }),
    ...over,
  };
}

describe("mr:review-submit", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-review-submit-")); process.env.HOME = home; closeStateDb(); });
  afterEach(() => { process.env.HOME = origHome; closeStateDb(); rmSync(home, { recursive: true, force: true }); });

  test("submits, approves, and reports reviewer state, summary note and MR url", async () => {
    const stub = stubProvider();
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res).toEqual({
      ok: true,
      data: {
        published: true, comments: 1, replies: 0, repliedTo: [], resolved: [], approved: true, resolveErrors: [],
        reviewerState: "approved", summaryNoteId: 501, mrUrl: MR_URL,
      },
    });
    expect(res.ok && "reviewId" in res.data).toBe(false);
    expect(stub.calls).toEqual([
      ["submitReview", "42", 7, {
        outcome: "approve", summary: "sum", replies: [],
        comments: [{ body: "c", path: "a.ts", line: 2, oldPath: "a.ts" }],
      }],
      ["fetchReviewerStates", "42", 7],
    ]);
  });

  test("a pending-drafts refusal answers ok with published false and the MR url", async () => {
    const stub = stubProvider({ submit: async () => ({ published: false, reason: "pending-drafts", pending: { count: 1, firstLines: ["mine"] } }) });
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res).toEqual({ ok: true, data: { published: false, reason: "pending-drafts", pending: { count: 1, firstLines: ["mine"] }, mrUrl: MR_URL } });
    expect(stub.calls.map((c) => c[0])).toEqual(["submitReview"]);
  });

  test("a bad-anchors result from the forge answers ok with published false and the MR url", async () => {
    const stub = stubProvider({ submit: async () => ({ published: false, reason: "bad-anchors", badAnchors: [{ index: 0, path: "a.ts", line: 2 }] }) });
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res).toEqual({ ok: true, data: { published: false, reason: "bad-anchors", badAnchors: [{ index: 0, path: "a.ts", line: 2 }], mrUrl: MR_URL } });
  });

  test("an invalid payload is refused before any network call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stubProvider(), { repoContext: async () => { throw new Error("unexpected"); } }));
    expect(await h["mr:review-submit"]({ ...PAYLOAD, outcome: "reject" })).toEqual({ ok: false, error: "outcome must be comment, approve or request_changes" });
    expect(await h["mr:review-submit"]({ ...PAYLOAD, iid: 0 })).toEqual({ ok: false, error: "missing repoName/iid" });
    expect(await h["mr:review-submit"]({ ...PAYLOAD, repoName: "not-an-identity" })).toEqual({ ok: false, error: "repo must be a serialized identity" });
  });

  test("request_changes is passed to submitReview unchanged", async () => {
    const stub = stubProvider();
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
    const res = await h["mr:review-submit"]({ ...PAYLOAD, outcome: "request_changes" });
    expect(res.ok).toBe(true);
    expect(stub.sent().outcome).toBe("request_changes");
  });

  test("a refresh or reviewer-state failure never turns a published review into a failure", async () => {
    const stub = stubProvider({ states: async () => { throw new Error("states boom"); } });
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub, { refresh: async () => { throw new Error("refresh boom"); } }));
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res.ok && res.data.published).toBe(true);
    expect(res.ok && res.data.published && res.data.reviewerState).toBeNull();
    expect(res.ok && res.data.published && res.data.summaryNoteId).toBeNull();
  });

  test("the summary note is the newest note with the summary body by the signed-in user", async () => {
    const stub = stubProvider();
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub, {
      refresh: async () => ({
        discussions: [summaryThread(600, "sum", "someone-else"), summaryThread(501, "sum", "pat"), summaryThread(502, "sum", "pat"), summaryThread(700, "other", "pat")],
        fetchedAt: 1,
      }),
    }));
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res.ok && res.data.published && res.data.summaryNoteId).toBe(502);
  });

  test("a sequence failure is ok:false with its message", async () => {
    const stub = stubProvider({
      submit: async () => { throw new Error("publish failed and its outcome is unknown: Error: publishDraftNotes failed: 502; GitLab may have posted some or all of this review; look at the MR before retrying"); },
    });
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("publish failed and its outcome is unknown");
  });

  describe("anchors", () => {
    const withComments = (comments: object[]) => ({ ...PAYLOAD, outcome: "comment", comments });

    test("a comment on an unchanged context line gets its old line", async () => {
      const stub = stubProvider();
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
      const res = await h["mr:review-submit"](withComments([{ body: "c", path: "a.ts", line: 3 }]));
      expect(res.ok && res.data.published).toBe(true);
      expect(stub.sent().comments).toEqual([{ body: "c", path: "a.ts", line: 3, oldPath: "a.ts", oldLine: 2 }]);
    });

    test("a comment on an added line keeps its new line alone", async () => {
      const stub = stubProvider();
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
      await h["mr:review-submit"](withComments([{ body: "c", path: "a.ts", line: 2 }]));
      const [comment] = stub.sent().comments;
      expect(comment).toEqual({ body: "c", path: "a.ts", line: 2, oldPath: "a.ts" });
      expect("oldLine" in comment!).toBe(false);
    });

    test("a line outside the diff, or a file with no diff, is a bad anchor and nothing is sent", async () => {
      const stub = stubProvider();
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
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
      expect(stub.calls).toEqual([]);
    });

    test("a renamed file's comment takes the old path from the diff", async () => {
      const stub = stubProvider();
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub, {
        diffs: async () => ({ diffs: [{ newPath: "new.ts", oldPath: "old.ts", diff: DIFF }], truncated: false }),
      }));
      await h["mr:review-submit"](withComments([{ body: "c", path: "new.ts", line: 1 }]));
      expect(stub.sent().comments).toEqual([{ body: "c", path: "new.ts", line: 1, oldPath: "old.ts", oldLine: 1 }]);
    });

    test("a failed diff read posts the anchors unverified and warns", async () => {
      const stub = stubProvider();
      const warned: string[] = [];
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub, {
        diffs: async () => { throw new Error("diffs down"); },
        warn: (_o, msg) => { warned.push(msg); },
      }));
      const res = await h["mr:review-submit"](withComments([{ body: "c", path: "a.ts", line: 40 }]));
      expect(res.ok && res.data.published).toBe(true);
      expect(warned).toEqual(["mr:review-submit: diff read failed, posting the anchors unverified"]);
      expect(stub.sent().comments).toEqual([{ body: "c", path: "a.ts", line: 40 }]);
    });

    test("comments that all name their old line skip the diff read", async () => {
      const stub = stubProvider();
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub, {
        diffs: async () => { throw new Error("unexpected"); },
        warn: () => { throw new Error("unexpected warn"); },
      }));
      const res = await h["mr:review-submit"](withComments([{ body: "c", path: "a.ts", line: 40, oldLine: 38 }]));
      expect(res.ok && res.data.published).toBe(true);
      expect(stub.sent().comments).toEqual([{ body: "c", path: "a.ts", line: 40, oldLine: 38 }]);
    });
  });

  describe("on GitHub", () => {
    const PR_URL = "https://github.com/o/r/pull/7";
    const GH_PUBLISHED: ReviewSubmitResult = {
      published: true, comments: 1, replies: 1, repliedTo: ["gh-review-thread-5"], resolved: [], approved: true, resolveErrors: [],
      reviewId: 4242, reviewerState: "approved",
    };
    const ghStub = (submit?: (review: ReviewSubmission) => Promise<ReviewSubmitResult>) =>
      stubProvider({ submit: submit ?? (async () => GH_PUBLISHED) }, "https://github.com");
    const ghSeams = (stub: Stub, over: Partial<DiscussionHandlerSeams> = {}) =>
      seams(stub, { refresh: async () => ({ discussions: [], fetchedAt: 1 }), selfUsername: () => { throw new Error("unexpected"); }, ...over }, "github");

    test("the summary note is the review and the reviewer state comes from the review", async () => {
      const stub = ghStub();
      const h = createDiscussionHandlers(fakeCtx, () => {}, ghSeams(stub));
      const res = await h["mr:review-submit"](PAYLOAD);
      expect(res).toEqual({
        ok: true,
        data: {
          published: true, comments: 1, replies: 1, repliedTo: ["gh-review-thread-5"], resolved: [], approved: true, resolveErrors: [],
          reviewerState: "approved", summaryNoteId: 4242, mrUrl: PR_URL,
        },
      });
      expect(res.ok && "reviewId" in res.data).toBe(false);
      expect(stub.calls.map((c) => c[0])).toEqual(["submitReview"]);
      expect(stub.calls[0]!.slice(1, 3)).toEqual(["o/r", 7]);
    });

    test("reply failures pass through", async () => {
      const replyErrors = [{ discussionId: "gh-review-thread-9", error: "Error: 404 Not Found" }];
      const h = createDiscussionHandlers(fakeCtx, () => {}, ghSeams(ghStub(async () => ({ ...GH_PUBLISHED, replyErrors }))));
      const res = await h["mr:review-submit"](PAYLOAD);
      expect(res.ok && res.data.published && res.data.replyErrors).toEqual(replyErrors);
    });

    test("an approve on one's own pull request reports the comment fallback", async () => {
      const approveError = "Can not approve your own pull request";
      const h = createDiscussionHandlers(fakeCtx, () => {}, ghSeams(ghStub(async () => ({ ...GH_PUBLISHED, approved: false, approveError, reviewerState: "commented" }))));
      const res = await h["mr:review-submit"](PAYLOAD);
      expect(res.ok && res.data.published && [res.data.approved, res.data.approveError, res.data.reviewerState]).toEqual([false, approveError, "commented"]);
    });

    test("a refresh failure never turns a published review into a failure", async () => {
      const h = createDiscussionHandlers(fakeCtx, () => {}, ghSeams(ghStub(), { refresh: async () => { throw new Error("refresh boom"); } }));
      const res = await h["mr:review-submit"](PAYLOAD);
      expect(res.ok && res.data.published && res.data.summaryNoteId).toBe(4242);
    });

    test("a review the forge did not post is ok:false with its message", async () => {
      const h = createDiscussionHandlers(fakeCtx, () => {}, ghSeams(ghStub(async () => { throw new Error("review not posted: HttpError: Validation Failed"); })));
      expect(await h["mr:review-submit"](PAYLOAD)).toEqual({ ok: false, error: "Error: review not posted: HttpError: Validation Failed" });
    });

    test("a line outside the diff is a bad anchor with the pull request url and nothing is sent", async () => {
      const stub = ghStub();
      const h = createDiscussionHandlers(fakeCtx, () => {}, ghSeams(stub));
      const res = await h["mr:review-submit"]({ ...PAYLOAD, comments: [{ body: "far", path: "a.ts", line: 40 }] });
      expect(res).toEqual({ ok: true, data: { published: false, reason: "bad-anchors", badAnchors: [{ index: 0, path: "a.ts", line: 40 }], mrUrl: PR_URL } });
      expect(stub.calls).toEqual([]);
    });

    test("a context line goes RIGHT without the filled-in old line; a caller's old line goes LEFT without a new line", async () => {
      const stub = ghStub();
      const h = createDiscussionHandlers(fakeCtx, () => {}, ghSeams(stub));
      await h["mr:review-submit"]({
        ...PAYLOAD,
        comments: [{ body: "ctx", path: "a.ts", line: 3 }, { body: "left", path: "a.ts", line: 2, oldLine: 1, oldPath: "a.ts" }],
      });
      const [right, left] = stub.sent().comments;
      expect(right).toEqual({ body: "ctx", path: "a.ts", line: 3 });
      expect("oldLine" in right!).toBe(false);
      expect(left).toEqual({ body: "left", path: "a.ts", oldLine: 1, oldPath: "a.ts" });
      expect("line" in left!).toBe(false);
    });
  });
  describe("expectedHeadSha", () => {
    const HEAD = "ABCDEF0123".repeat(4);
    const expectedHeadSha = HEAD.toLowerCase();
    const MOVED = "1234567890".repeat(4);
    const PINNED = { ...PAYLOAD, expectedHeadSha };
    const UNREADABLE = "could not read the MR's head to check expectedHeadSha; nothing was posted (";
    const names = (stub: Stub) => stub.calls.map((c) => c[0]);

    test("a matching head (any case) posts the review", async () => {
      const stub = stubProvider({ head: async () => ({ sha: HEAD }) });
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
      const res = await h["mr:review-submit"](PINNED);
      expect(res.ok && res.data.published).toBe(true);
      expect(stub.calls[0]).toEqual(["fetchSingleMR", "g/sub/repo-tools", 7, null]);
      expect(names(stub).indexOf("fetchSingleMR")).toBeLessThan(names(stub).indexOf("submitReview"));
      expect("expectedHeadSha" in stub.sent()).toBe(false);
    });

    test("a matching head on GitHub reads by the repo path", async () => {
      const stub = stubProvider({ head: async () => ({ sha: HEAD }), submit: async () => ({ ...PUBLISHED, reviewId: 1 }) }, "https://github.com");
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub, { refresh: async () => ({ discussions: [], fetchedAt: 1 }) }, "github"));
      const res = await h["mr:review-submit"](PINNED);
      expect(res.ok && res.data.published).toBe(true);
      expect(stub.calls[0]).toEqual(["fetchSingleMR", "o/r", 7, null]);
      expect(names(stub)).toContain("submitReview");
    });

    test("a moved head posts nothing and answers head-moved", async () => {
      const stub = stubProvider({ head: async () => ({ sha: MOVED }) });
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
      const res = await h["mr:review-submit"](PINNED);
      expect(res).toEqual({ ok: true, data: { published: false, reason: "head-moved", expectedHeadSha, headSha: MOVED, mrUrl: MR_URL } });
      expect(names(stub)).not.toContain("submitReview");
    });

    for (const [label, head, reason] of [
      ["throws", async () => { throw new Error("boom"); }, "Error: boom"],
      ["returns null", async () => null, "no MR"],
      ["returns no sha", async () => ({}), "no head sha"],
    ] as const) {
      test(`an unreadable head posts nothing: the read ${label}`, async () => {
        const stub = stubProvider({ head });
        const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
        const res = await h["mr:review-submit"](PINNED);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toStartWith(UNREADABLE);
          expect(res.error).toBe(`${UNREADABLE}${reason})`);
        }
        expect(names(stub)).not.toContain("submitReview");
      });
    }

    test("a provider without fetchSingleMR reads as an unreadable head", async () => {
      const stub = stubProvider();
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
      const res = await h["mr:review-submit"](PINNED);
      expect(res).toEqual({ ok: false, error: `${UNREADABLE}the provider cannot read the MR)` });
      expect(stub.calls).toEqual([]);
    });

    test("an abort during the head read posts nothing", async () => {
      const controller = new AbortController();
      const stub = stubProvider({ head: async () => { controller.abort(); return { sha: HEAD }; } });
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
      const res = await h["mr:review-submit"](PINNED, controller.signal);
      expect(res).toEqual({ ok: false, error: "request aborted before the review was posted" });
      expect(names(stub)).not.toContain("submitReview");
    });

    test("no expectedHeadSha never reads the head", async () => {
      const stub = stubProvider({ head: async () => ({ sha: MOVED }) });
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(stub));
      const res = await h["mr:review-submit"](PAYLOAD);
      expect(res.ok && res.data.published).toBe(true);
      expect(names(stub)).not.toContain("fetchSingleMR");
    });
  });
});
