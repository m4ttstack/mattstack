/**
 * The thread handlers on a GitHub pull request: reply, comment, edit,
 * resolve and diffs go through the GitHub provider and answer the same
 * reply shapes as on GitLab.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GitHubProvider, type CommentAnchor, type InlineCommentResult, type NoteWriteResult } from "@mattstack/glance";
import { closeStateDb } from "../../state/index.ts";
import {
  createDiscussionHandlers,
  fetchMrDiffs,
  type DiscussionHandlerSeams,
  type ThreadContext,
  type ThreadProvider,
} from "../handlers/discussions.ts";
import type { Discussion } from "../../../packages/rt-client/src/commands.ts";
import { fakeStore } from "./fake-cache-store.ts";

const fakeCtx = { repoIndex: () => ({}), cache: fakeStore({}) };
const IDENTITY = "remote:github.com%2Fo%2Fr";
const PR_URL = "https://github.com/o/r/pull/7";

function githubContext(provider: Partial<ThreadProvider>): ThreadContext {
  const unexpected = async (): Promise<never> => { throw new Error("unexpected provider call"); };
  return {
    forge: "github",
    provider: {
      baseURL: "https://github.com",
      createComment: unexpected,
      createInlineComment: unexpected,
      deleteComment: unexpected,
      replyToDiscussion: unexpected,
      updateComment: unexpected,
      resolveDiscussion: unexpected,
      unresolveDiscussion: unexpected,
      ...provider,
    } as ThreadProvider,
    projectPath: "o/r",
  };
}

function seams(provider: Partial<ThreadProvider>, over: Partial<DiscussionHandlerSeams> = {}): DiscussionHandlerSeams {
  return { repoContext: async () => githubContext(provider), refresh: async () => undefined, ...over };
}

function thread(id: string, noteIds: number[]): Discussion {
  return { id, resolvable: true, resolved: false, notes: noteIds.map((n) => ({ id: n })) } as unknown as Discussion;
}

describe("thread handlers on GitHub", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rt-disc-github-"));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("a reply goes into the review thread and returns the new note beside the refreshed list", async () => {
    let args: unknown[] = [];
    const list = [thread("gh-review-thread-5", [5, 900])];
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams(
      {
        replyToDiscussion: async (...a): Promise<NoteWriteResult> => {
          args = a;
          return { noteId: 900, discussionId: "gh-review-thread-5", resolvable: true, url: `${PR_URL}#discussion_r900` };
        },
      },
      { refresh: async () => ({ discussions: list, fetchedAt: 5 }) },
    ));
    const res = await h["discussions:reply"]({ repoName: IDENTITY, iid: 7, discussionId: "gh-review-thread-5", body: "hi" });
    expect(args).toEqual(["o/r", 7, "gh-review-thread-5", "hi"]);
    expect(res).toEqual({ ok: true, data: { discussions: list, fetchedAt: 5, noteId: 900 } });
  });

  test("a reply to a pull request comment is refused with glance's message", async () => {
    const origFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => { fetches++; throw new Error("no network in tests"); }) as unknown as typeof fetch;
    try {
      const provider = new GitHubProvider("https://github.com", "tok");
      const h = createDiscussionHandlers(fakeCtx, () => {}, {
        repoContext: async () => ({ forge: "github", provider, projectPath: "o/r" }),
        refresh: async () => { throw new Error("nothing landed, so nothing refreshes"); },
      });
      const res = await h["discussions:reply"]({ repoName: IDENTITY, iid: 7, discussionId: "gh-issue-comment-3", body: "hi" });
      expect(res).toEqual({
        ok: false,
        error: "Error: replyToDiscussion: gh-issue-comment-3 is a pull request comment with no thread on GitHub; post a new comment instead",
      });
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("a comment is a plain pull request comment with the PR url", async () => {
    let args: unknown[] = [];
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams({
      createComment: async (...a): Promise<NoteWriteResult> => {
        args = a;
        return { noteId: 11, discussionId: "gh-issue-comment-11", resolvable: false, url: `${PR_URL}#issuecomment-11` };
      },
    }));
    const res = await h["mr:comment"]({ repoName: IDENTITY, iid: 7, body: "summary" });
    expect(args).toEqual(["o/r", 7, "summary", { resolvable: true }]);
    expect(res).toEqual({
      ok: true,
      data: { noteId: 11, discussionId: "gh-issue-comment-11", resolvable: false, url: `${PR_URL}#issuecomment-11`, mrUrl: PR_URL },
    });
  });

  describe("note-update takes the note's kind from the cached threads", () => {
    const cached = [
      thread("gh-review-thread-5", [5, 6]),
      thread("gh-issue-comment-11", [11]),
      thread("gh-review-20", [20]),
      thread("gh-issue-comment-30", [30]),
      thread("gh-review-thread-30", [30]),
    ];

    async function editAndCapture(
      noteId: number,
      readCached: DiscussionHandlerSeams["readCached"] = () => ({ discussions: cached, fetchedAt: 1 }),
      warnings: string[] = [],
    ) {
      let args: unknown[] = [];
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(
        { updateComment: async (...a) => { args = a; } },
        { readCached, warn: (_o, msg) => { warnings.push(msg); } },
      ));
      const res = await h["mr:note-update"]({ repoName: IDENTITY, iid: 7, noteId, body: "edited" });
      expect(res).toEqual({ ok: true, data: { noteId } });
      return args;
    }

    test("a note in a review thread is a diff note", async () => {
      expect(await editAndCapture(6)).toEqual(["o/r", 7, { id: 6, kind: "diff" }, "edited"]);
    });

    test("a pull request comment is a general note", async () => {
      expect(await editAndCapture(11)).toEqual(["o/r", 7, { id: 11, kind: "general" }, "edited"]);
    });

    test("a review summary is a review note", async () => {
      expect(await editAndCapture(20)).toEqual(["o/r", 7, { id: 20, kind: "review" }, "edited"]);
    });

    test("a note not in the cache sends no kind", async () => {
      expect(await editAndCapture(999)).toEqual(["o/r", 7, { id: 999 }, "edited"]);
    });

    test("an id in two kinds of thread sends no kind", async () => {
      expect(await editAndCapture(30)).toEqual(["o/r", 7, { id: 30 }, "edited"]);
    });

    test("no cached threads sends no kind", async () => {
      expect(await editAndCapture(6, () => undefined)).toEqual(["o/r", 7, { id: 6 }, "edited"]);
    });

    test("an unreadable cache sends no kind and warns", async () => {
      const warnings: string[] = [];
      expect(await editAndCapture(6, () => { throw new Error("database is locked"); }, warnings)).toEqual(["o/r", 7, { id: 6 }, "edited"]);
      expect(warnings).toEqual(["mr:note-update: cached discussions unreadable, editing with no note kind"]);
    });
  });

  describe("inline comments", () => {
    const DIFF = ["@@ -10,4 +10,5 @@", " keep", "-gone", "+fresh", "+extra", " tail", " end"].join("\n");

    function inlineProvider(rows: Array<{ newPath: string; oldPath?: string; diff: string }>) {
      const anchors: CommentAnchor[] = [];
      const diffReads: unknown[][] = [];
      let deletes = 0;
      const provider: Partial<ThreadProvider> = {
        fetchPullRequestDiffs: async (...a) => { diffReads.push(a); return { diffs: rows, truncated: false }; },
        createInlineComment: async (projectPath, iid, body, anchor): Promise<InlineCommentResult> => {
          expect([projectPath, iid, body]).toEqual(["o/r", 7, "nice catch"]);
          anchors.push(anchor);
          return {
            noteId: 900, discussionId: "gh-review-thread-900", resolvable: true,
            url: `${PR_URL}#discussion_r900`, anchored: true, noteType: "DiffNote",
          };
        },
        deleteComment: async () => { deletes++; },
      };
      return { provider, anchors, diffReads, deletes: () => deletes };
    }

    const payload = (over: Record<string, unknown>) => ({ repoName: IDENTITY, iid: 7, body: "nice catch", path: "src/foo.ts", ...over });

    test("an unchanged context line goes on the RIGHT side with no old line", async () => {
      const s = inlineProvider([{ newPath: "src/foo.ts", diff: DIFF }]);
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(s.provider));
      const res = await h["mr:comment-inline"](payload({ line: 13 }));
      expect(res).toEqual({ ok: true, data: { discussionId: "gh-review-thread-900", noteId: 900, verified: true } });
      expect(s.diffReads).toHaveLength(1);
      expect(s.anchors).toEqual([{ path: "src/foo.ts", line: 13 }]);
      expect(s.deletes()).toBe(0);
    });

    test("a renamed file keeps the diff row's old path", async () => {
      const s = inlineProvider([{ newPath: "src/foo.ts", oldPath: "src/bar.ts", diff: DIFF }]);
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(s.provider));
      await h["mr:comment-inline"](payload({ line: 13 }));
      expect(s.anchors).toEqual([{ path: "src/foo.ts", line: 13, oldPath: "src/bar.ts" }]);
    });

    test("a caller's oldLine goes on the LEFT side without reading the diff", async () => {
      const s = inlineProvider([]);
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(s.provider));
      const res = await h["mr:comment-inline"](payload({ line: 41, oldLine: 7, oldPath: "src/old.ts" }));
      expect(res).toEqual({ ok: true, data: { discussionId: "gh-review-thread-900", noteId: 900, verified: true } });
      expect(s.diffReads).toEqual([]);
      expect(s.anchors).toEqual([{ path: "src/foo.ts", oldLine: 7, oldPath: "src/old.ts" }]);
      expect(s.deletes()).toBe(0);
    });

    test("a line outside the diff is refused naming GitHub, with nothing posted", async () => {
      const s = inlineProvider([{ newPath: "src/foo.ts", diff: DIFF }]);
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(s.provider));
      const res = await h["mr:comment-inline"](payload({ line: 41 }));
      expect(res).toEqual({
        ok: false,
        error: "line 41 of src/foo.ts is not in this MR's diff, so GitHub cannot anchor a comment there; lines in the diff near it: 14, 13, 12",
      });
      expect(s.anchors).toEqual([]);
      expect(s.deletes()).toBe(0);
    });

    test("a file with no diff is refused naming GitHub", async () => {
      const s = inlineProvider([{ newPath: "other.ts", diff: DIFF }]);
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams(s.provider));
      const res = await h["mr:comment-inline"](payload({ line: 42 }));
      expect(res).toEqual({
        ok: false,
        error: "line 42 of src/foo.ts is not in this MR's diff, so GitHub cannot anchor a comment there; this file has no diff in this MR",
      });
      expect(s.anchors).toEqual([]);
    });

    test("a failed post is reported once, with no delete and no retry", async () => {
      let posts = 0;
      let deletes = 0;
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams({
        fetchPullRequestDiffs: async () => ({ diffs: [{ newPath: "src/foo.ts", diff: DIFF }], truncated: false }),
        createInlineComment: async () => { posts++; throw new Error("422 Unprocessable Entity"); },
        deleteComment: async () => { deletes++; },
      }));
      const res = await h["mr:comment-inline"](payload({ line: 11 }));
      expect(res).toEqual({ ok: false, error: "Error: 422 Unprocessable Entity" });
      expect([posts, deletes]).toEqual([1, 0]);
    });
  });

  test("resolve and unresolve go to the provider and return the refreshed list", async () => {
    const calls: unknown[][] = [];
    const list = [thread("gh-review-thread-5", [5])];
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams(
      {
        resolveDiscussion: async (...a) => { calls.push(["resolve", ...a]); },
        unresolveDiscussion: async (...a) => { calls.push(["unresolve", ...a]); },
      },
      { refresh: async () => ({ discussions: list, fetchedAt: 9 }) },
    ));
    const resolved = await h["discussions:resolve"]({ repoName: IDENTITY, iid: 7, discussionId: "gh-review-thread-5" });
    const reopened = await h["discussions:resolve"]({ repoName: IDENTITY, iid: 7, discussionId: "gh-review-thread-5", resolved: false });
    expect(calls).toEqual([["resolve", "o/r", 7, "gh-review-thread-5"], ["unresolve", "o/r", 7, "gh-review-thread-5"]]);
    expect(resolved).toEqual({ ok: true, data: { discussions: list, fetchedAt: 9 } });
    expect(reopened).toEqual({ ok: true, data: { discussions: list, fetchedAt: 9 } });
  });

  test("diffs read the pull request's files with a bound signal", async () => {
    let seen: unknown[] = [];
    const rows = [{ newPath: "a.ts", oldPath: "b.ts", diff: "@@ -1 +1 @@" }];
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams({
      fetchPullRequestDiffs: async (...a) => { seen = a; return { diffs: rows, truncated: true }; },
    }));
    const res = await h["discussions:diffs"]({ repoName: IDENTITY, iid: 7 });
    expect(res).toEqual({ ok: true, data: { diffs: rows, truncated: true } });
    expect(seen.slice(0, 2)).toEqual(["o/r", 7]);
    expect((seen[2] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});

test("the GitLab diffs read sends exactly one restRequest with the diffs path", async () => {
  const calls: unknown[][] = [];
  const ctx: ThreadContext = {
    provider: {
      baseURL: "https://gitlab.example.com",
      restRequest: async (...a) => { calls.push(a); return new Response("[]", { status: 200 }); },
    } as ThreadProvider,
    projectPath: "group/proj",
  };
  await fetchMrDiffs(ctx, 7);
  expect(calls).toHaveLength(1);
  const [method, path, body, op, io] = calls[0]!;
  expect([method, path, body, op]).toEqual(["GET", "/projects/group%2Fproj/merge_requests/7/diffs?per_page=100", undefined, "fetchMrDiffs"]);
  expect((io as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
});
