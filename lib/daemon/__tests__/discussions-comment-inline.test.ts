/**
 * mr:comment-inline on GitLab: posts a positioned discussion through the
 * provider, reads the created note's type from the result, and repairs a
 * silent general-note degrade with one delete-and-retry.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { EmptyDiscussionError, type CommentAnchor, type InlineCommentResult, type NoteRef } from "@mattstack/glance";
import { closeStateDb } from "../../state/index.ts";
import { createDiscussionHandlers, type DiscussionHandlerSeams, type ThreadProvider } from "../handlers/discussions.ts";
import { fakeStore } from "./fake-cache-store.ts";

const fakeCtx = { repoIndex: () => ({}), cache: fakeStore({}) };

const IDENTITY = "remote:gitlab.com%2Fg%2Frepo-tools";
const PROJECT = "g/repo-tools";
const PROJECT_ID = 42;

/** A `null` noteType is GitLab's silent degrade to a general note. */
function inlineResult(discussionId: string, noteId: number, noteType: string | null): InlineCommentResult {
  return {
    noteId,
    discussionId,
    resolvable: true,
    url: `https://gitlab.example.com/${PROJECT_ID}/-/merge_requests/7#note_${noteId}`,
    anchored: noteType === "DiffNote",
    noteType,
  };
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    repoName: IDENTITY,
    iid: 7,
    body: "nice catch",
    path: "src/foo.ts",
    line: 42,
    ...overrides,
  };
}

type InlineStub = Pick<ThreadProvider, "createInlineComment" | "deleteComment">;

/** Builds seams around a scripted provider; repoContext answers a GitLab context. */
function makeSeams(
  provider: InlineStub,
  refresh?: DiscussionHandlerSeams["refresh"],
  diffs?: DiscussionHandlerSeams["diffs"],
): DiscussionHandlerSeams {
  return {
    diffs: diffs ?? (async () => ({ diffs: [], truncated: true })),
    repoContext: async () => ({
      provider: { baseURL: "https://gitlab.example.com", ...provider } as ThreadProvider,
      projectPath: PROJECT,
      projectId: PROJECT_ID,
    }),
    refresh: refresh ?? (async () => undefined),
  };
}

const neverCalled: InlineStub = {
  createInlineComment: async () => { throw new Error("should not be called"); },
  deleteComment: async () => { throw new Error("should not be called"); },
};

describe("mr:comment-inline", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rt-comment-inline-"));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("a clean DiffNote on the first try returns ok:true verified:true", async () => {
    const calls: unknown[][] = [];
    const seams = makeSeams({
      createInlineComment: async (...a) => { calls.push(a); return inlineResult("d1", 101, "DiffNote"); },
      deleteComment: async () => { throw new Error("deleteComment should not be called on a clean first try"); },
    });

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res).toEqual({ ok: true, data: { discussionId: "d1", noteId: 101, verified: true } });
    expect(calls).toEqual([["42", 7, "nice catch", { path: "src/foo.ts", line: 42 }]]);
  });

  test("degrade then clean on retry deletes the first note and succeeds on the second", async () => {
    const deleted: unknown[][] = [];
    let createCalls = 0;
    const seams = makeSeams({
      createInlineComment: async () => {
        createCalls++;
        if (createCalls === 1) return inlineResult("d1", 101, null);
        return inlineResult("d2", 102, "DiffNote");
      },
      deleteComment: async (...a) => { deleted.push(a); },
    });

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res).toEqual({ ok: true, data: { discussionId: "d2", noteId: 102, verified: true } });
    expect(deleted).toEqual([["42", 7, { id: 101 }]]);
    expect(createCalls).toBe(2);
  });

  test("degrade twice returns ok:false naming both deleted note ids", async () => {
    const deletedIds: number[] = [];
    let createCalls = 0;
    const seams = makeSeams({
      createInlineComment: async () => {
        createCalls++;
        if (createCalls === 1) return inlineResult("d1", 11, null);
        return inlineResult("d2", 12, null);
      },
      deleteComment: async (_projectPath, _iid, note: NoteRef) => { deletedIds.push(note.id); },
    });

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res.ok).toBe(false);
    expect(deletedIds).toEqual([11, 12]);
    expect(createCalls).toBe(2);
    if (!res.ok) {
      expect(res.error).toContain("11");
      expect(res.error).toContain("12");
      expect(res.error).toContain("null");
      expect(res.error).not.toMatch(new RegExp("[\\u2013\\u2014]"));
      expect(res.error).toBe(
        "GitLab dropped the position twice (note 11 type null, note 12 type null); both general notes were deleted",
      );
    }
  });

  test("a discussion with no notes on the first post is refused with no delete and no retry", async () => {
    let createCalls = 0;
    const seams = makeSeams({
      createInlineComment: async () => { createCalls++; throw new EmptyDiscussionError("d1"); },
      deleteComment: async () => { throw new Error("should not be called"); },
    });

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res).toEqual({ ok: false, error: "GitLab created a discussion with no notes" });
    expect(createCalls).toBe(1);
  });

  test("a retry discussion with no notes is refused after the first note was deleted", async () => {
    const deletedIds: number[] = [];
    let createCalls = 0;
    const seams = makeSeams({
      createInlineComment: async () => {
        createCalls++;
        if (createCalls === 1) return inlineResult("d1", 101, null);
        throw new EmptyDiscussionError("d2");
      },
      deleteComment: async (_projectPath, _iid, note: NoteRef) => { deletedIds.push(note.id); },
    });

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res).toEqual({ ok: false, error: "GitLab created a retry discussion with no notes" });
    expect(deletedIds).toEqual([101]);
    expect(createCalls).toBe(2);
  });

  test("a non-identity repoName returns the same refusal discussions:reply produces", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(neverCalled));

    const inline = await h["mr:comment-inline"]!(basePayload({ repoName: "not-an-identity" }));
    const reply = await h["discussions:reply"]!(
      { repoName: "not-an-identity", iid: 7, discussionId: "d", body: "x" } as unknown as never,
    );

    expect(inline).toEqual(reply as unknown as typeof inline);
    expect(inline).toEqual({ ok: false, error: "repo must be a serialized identity" });
  });

  test("a serialized identity not in the repo index returns the real getRepoContext refusal", async () => {
    // No repoContext seam: the real getRepoContext plumbing runs and must
    // refuse for an identity absent from the (empty) repo index, the same
    // way discussions:reply's real path does.
    const h = createDiscussionHandlers(fakeCtx, () => {});

    const inline = await h["mr:comment-inline"]!(basePayload());
    const reply = await h["discussions:reply"]!(
      { repoName: IDENTITY, iid: 7, discussionId: "d", body: "x" } as unknown as never,
    );

    expect(inline.ok).toBe(false);
    expect(reply.ok).toBe(false);
    expect(inline).toEqual(reply as unknown as typeof inline);
  });

  test("missing fields refuse before any network call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(neverCalled));

    const res = await h["mr:comment-inline"]!(basePayload({ line: 0 }));
    expect(res).toEqual({ ok: false, error: "missing repoName/iid/body/path/line" });
  });

  test("a non-positive-integer oldLine is refused before any network call", async () => {
    let called = false;
    const seams = makeSeams({
      createInlineComment: async () => { called = true; return inlineResult("d1", 1, "DiffNote"); },
      deleteComment: async () => { called = true; },
    });
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);

    const res = await h["mr:comment-inline"]!(basePayload({ oldLine: 0 }));

    expect(res).toEqual({ ok: false, error: "invalid oldPath/oldLine" });
    expect(called).toBe(false);
  });

  test("an empty oldPath is refused before any network call", async () => {
    let called = false;
    const seams = makeSeams({
      createInlineComment: async () => { called = true; return inlineResult("d1", 1, "DiffNote"); },
      deleteComment: async () => { called = true; },
    });
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);

    const res = await h["mr:comment-inline"]!(basePayload({ oldPath: "" }));

    expect(res).toEqual({ ok: false, error: "invalid oldPath/oldLine" });
    expect(called).toBe(false);
  });

  function anchorRecorder() {
    const anchors: CommentAnchor[] = [];
    const provider: InlineStub = {
      createInlineComment: async (_p, _i, _b, anchor) => { anchors.push(anchor); return inlineResult("d1", 101, "DiffNote"); },
      deleteComment: async () => { throw new Error("should not be called"); },
    };
    return { anchors, provider };
  }

  test("neither oldPath nor oldLine sends the path and line alone", async () => {
    const { anchors, provider } = anchorRecorder();
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider));

    await h["mr:comment-inline"]!(basePayload());

    expect(anchors).toEqual([{ path: "src/foo.ts", line: 42 }]);
  });

  test("oldLine alone is sent beside the line", async () => {
    const { anchors, provider } = anchorRecorder();
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider));

    await h["mr:comment-inline"]!(basePayload({ oldLine: 10 }));

    expect(anchors).toEqual([{ path: "src/foo.ts", line: 42, oldLine: 10 }]);
  });

  test("oldLine and oldPath together map straight through", async () => {
    const { anchors, provider } = anchorRecorder();
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider));

    await h["mr:comment-inline"]!(basePayload({ oldLine: 10, oldPath: "src/old.ts" }));

    expect(anchors).toEqual([{ path: "src/foo.ts", line: 42, oldPath: "src/old.ts", oldLine: 10 }]);
  });

  test("oldPath alone is sent with no oldLine", async () => {
    const { anchors, provider } = anchorRecorder();
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider));

    await h["mr:comment-inline"]!(basePayload({ oldPath: "src/old.ts" }));

    expect(anchors).toEqual([{ path: "src/foo.ts", line: 42, oldPath: "src/old.ts" }]);
  });

  test("a createInlineComment throw (400) returns ok:false with no delete and no retry", async () => {
    let deleteCalls = 0;
    let createCalls = 0;
    const seams = makeSeams({
      createInlineComment: async () => {
        createCalls++;
        throw new Error("createPositionedDiscussion failed: 400 Bad Request: line_code can't be blank");
      },
      deleteComment: async () => { deleteCalls++; },
    });

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("line_code can't be blank");
    expect(deleteCalls).toBe(0);
    expect(createCalls).toBe(1);
  });

  test("a deleteComment failure during repair is not swallowed", async () => {
    const seams = makeSeams({
      createInlineComment: async () => inlineResult("d1", 55, null),
      deleteComment: async () => { throw new Error("GitLab 500"); },
    });

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("55");
      expect(res.error).toContain("GitLab 500");
      expect(res.error).toBe("could not delete stray note 55: Error: GitLab 500");
    }
  });

  test("a retry throw after the first note degraded reports the degrade and the retry error together", async () => {
    const deletedIds: number[] = [];
    let createCalls = 0;
    const seams = makeSeams({
      createInlineComment: async () => {
        createCalls++;
        if (createCalls === 1) return inlineResult("d1", 101, null);
        throw new Error("GitLab 503");
      },
      deleteComment: async (_projectPath, _iid, note: NoteRef) => { deletedIds.push(note.id); },
    });

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res.ok).toBe(false);
    expect(deletedIds).toEqual([101]);
    if (!res.ok) {
      expect(res.error).toContain("101");
      expect(res.error).toContain("null");
      expect(res.error).toContain("GitLab 503");
      expect(res.error).not.toMatch(new RegExp("[\\u2013\\u2014]"));
      expect(res.error).toBe("first attempt degraded (note 101 type null, deleted); retry failed: Error: GitLab 503");
    }
  });

  test("a retry throw naming line_code carries the anchoring hint", async () => {
    let createCalls = 0;
    const seams = makeSeams({
      createInlineComment: async () => {
        createCalls++;
        if (createCalls === 1) return inlineResult("d1", 101, null);
        throw new Error("400 Bad request - Note {:line_code=>[\"can't be blank\"]}");
      },
      deleteComment: async () => {},
    });

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.startsWith("first attempt degraded (note 101 type null, deleted); retry failed: ")).toBe(true);
      expect(res.error.endsWith(" (an unchanged line needs both line and oldLine; a removed line needs oldLine)")).toBe(true);
    }
  });

  test("a refresh throw after a verified post does not turn success into ok:false", async () => {
    const seams = makeSeams(
      {
        createInlineComment: async () => inlineResult("d1", 101, "DiffNote"),
        deleteComment: async () => { throw new Error("should not be called"); },
      },
      async () => { throw new Error("refresh boom"); },
    );

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    const res = await h["mr:comment-inline"]!(basePayload());

    expect(res).toEqual({ ok: true, data: { discussionId: "d1", noteId: 101, verified: true } });
  });

  test("the refresh call completes before the handler resolves", async () => {
    let refreshFinished = false;
    const seams = makeSeams(
      {
        createInlineComment: async () => inlineResult("d1", 101, "DiffNote"),
        deleteComment: async () => { throw new Error("should not be called"); },
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        refreshFinished = true;
        return undefined;
      },
    );

    const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
    await h["mr:comment-inline"]!(basePayload());

    expect(refreshFinished).toBe(true);
  });

  describe("anchor resolution against the MR diff", () => {
    const DIFF = ["@@ -10,4 +10,5 @@", " keep", "-gone", "+fresh", "+extra", " tail", " end"].join("\n");
    const diffsFor = (diff: string, truncated = false): DiscussionHandlerSeams["diffs"] =>
      async () => ({ diffs: [{ newPath: "src/foo.ts", diff }], truncated });

    test("a context line gets oldLine filled in from the diff", async () => {
      const { anchors, provider } = anchorRecorder();
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, diffsFor(DIFF)));
      const res = await h["mr:comment-inline"]!(basePayload({ line: 13 }));
      expect(res.ok).toBe(true);
      expect(anchors[0]).toMatchObject({ line: 13, oldLine: 12 });
    });

    test("an added line sends no oldLine", async () => {
      const { anchors, provider } = anchorRecorder();
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, diffsFor(DIFF)));
      const res = await h["mr:comment-inline"]!(basePayload({ line: 11 }));
      expect(res.ok).toBe(true);
      expect(anchors[0]!.line).toBe(11);
      expect("oldLine" in anchors[0]!).toBe(false);
    });

    test("a line outside the diff is refused with the nearby lines and no POST", async () => {
      const { anchors, provider } = anchorRecorder();
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, diffsFor(DIFF)));
      const res = await h["mr:comment-inline"]!(basePayload({ line: 41 }));
      expect(res).toEqual({
        ok: false,
        error: "line 41 of src/foo.ts is not in this MR's diff, so GitLab cannot anchor a comment there; lines in the diff near it: 14, 13, 12",
      });
      expect(anchors).toEqual([]);
    });

    test("a file with no diff in a complete page is refused", async () => {
      const { anchors, provider } = anchorRecorder();
      const none: DiscussionHandlerSeams["diffs"] = async () => ({ diffs: [{ newPath: "other.ts", diff: DIFF }], truncated: false });
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, none));
      const res = await h["mr:comment-inline"]!(basePayload());
      expect(res).toEqual({
        ok: false,
        error: "line 42 of src/foo.ts is not in this MR's diff, so GitLab cannot anchor a comment there; this file has no diff in this MR",
      });
      expect(anchors).toEqual([]);
    });

    test("a missing file on a truncated page posts as before", async () => {
      const { anchors, provider } = anchorRecorder();
      const none: DiscussionHandlerSeams["diffs"] = async () => ({ diffs: [], truncated: true });
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, none));
      const res = await h["mr:comment-inline"]!(basePayload());
      expect(res.ok).toBe(true);
      expect("oldLine" in anchors[0]!).toBe(false);
    });

    test("a failed diff read posts as before", async () => {
      const { anchors, provider } = anchorRecorder();
      const boom: DiscussionHandlerSeams["diffs"] = async () => { throw new Error("GitLab diffs API: 500"); };
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, boom));
      const res = await h["mr:comment-inline"]!(basePayload());
      expect(res.ok).toBe(true);
      expect(anchors).toHaveLength(1);
    });

    test("the diff read gets the caller's signal and a short timeout", async () => {
      const { provider } = anchorRecorder();
      const controller = new AbortController();
      let seen: { reqSignal?: AbortSignal; timeoutMs?: number } | undefined;
      const spy: DiscussionHandlerSeams["diffs"] = async (_ctx, _i, opts) => {
        seen = opts;
        return { diffs: [{ newPath: "src/foo.ts", diff: DIFF }], truncated: false };
      };
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, spy));
      await h["mr:comment-inline"]!(basePayload({ line: 11 }), controller.signal);
      expect(seen?.reqSignal).toBe(controller.signal);
      expect(seen?.timeoutMs).toBe(8_000);
    });

    test("a caller who aborts during the diff read gets a failure and no POST", async () => {
      const { anchors, provider } = anchorRecorder();
      const controller = new AbortController();
      const aborting: DiscussionHandlerSeams["diffs"] = async () => {
        controller.abort();
        throw new Error("aborted");
      };
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, aborting));
      const res = await h["mr:comment-inline"]!(basePayload(), controller.signal);
      expect(res.ok).toBe(false);
      expect(anchors).toEqual([]);
    });

    test("a caller who aborts after a successful read gets a failure and no POST", async () => {
      const { anchors, provider } = anchorRecorder();
      const controller = new AbortController();
      const slow: DiscussionHandlerSeams["diffs"] = async () => {
        controller.abort();
        return { diffs: [{ newPath: "src/foo.ts", diff: DIFF }], truncated: false };
      };
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, slow));
      const res = await h["mr:comment-inline"]!(basePayload({ line: 11 }), controller.signal);
      expect(res.ok).toBe(false);
      expect(anchors).toEqual([]);
    });

    test("a collapsed or too-large file posts as before", async () => {
      for (const flags of [{ collapsed: true }, { tooLarge: true }, {}]) {
        const { anchors, provider } = anchorRecorder();
        const rows: DiscussionHandlerSeams["diffs"] = async () => ({ diffs: [{ newPath: "src/foo.ts", diff: "", ...flags }], truncated: false });
        const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, rows));
        const res = await h["mr:comment-inline"]!(basePayload({ line: 41 }));
        expect(res.ok).toBe(true);
        expect(anchors).toHaveLength(1);
      }
    });

    test("a file with no new-side lines points at oldLine instead of an empty list", async () => {
      const { anchors, provider } = anchorRecorder();
      const deleted = "@@ -1,2 +0,0 @@\n-a\n-b";
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, diffsFor(deleted)));
      const res = await h["mr:comment-inline"]!(basePayload({ line: 1 }));
      expect(res).toEqual({
        ok: false,
        error: "line 1 of src/foo.ts is not in this MR's diff, so GitLab cannot anchor a comment there; the file has no new-side lines, so pass oldLine to comment on a removed line",
      });
      expect(anchors).toEqual([]);
    });

    test("a renamed file's old path defaults from the diff row", async () => {
      const { anchors, provider } = anchorRecorder();
      const renamed: DiscussionHandlerSeams["diffs"] = async () => ({
        diffs: [{ newPath: "src/foo.ts", oldPath: "src/bar.ts", diff: DIFF }],
        truncated: false,
      });
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, renamed));
      await h["mr:comment-inline"]!(basePayload({ line: 13 }));
      expect(anchors[0]).toMatchObject({ path: "src/foo.ts", oldPath: "src/bar.ts", oldLine: 12 });
    });

    test("a caller-given oldPath wins over the row's", async () => {
      const { anchors, provider } = anchorRecorder();
      const renamed: DiscussionHandlerSeams["diffs"] = async () => ({
        diffs: [{ newPath: "src/foo.ts", oldPath: "src/bar.ts", diff: DIFF }],
        truncated: false,
      });
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, renamed));
      await h["mr:comment-inline"]!(basePayload({ line: 13, oldPath: "src/baz.ts" }));
      expect(anchors[0]).toMatchObject({ oldPath: "src/baz.ts" });
    });

    test("a failed diff read logs a warning", async () => {
      const { provider } = anchorRecorder();
      const warnings: string[] = [];
      const boom: DiscussionHandlerSeams["diffs"] = async () => { throw new Error("GitLab diffs API: 500"); };
      const seams = { ...makeSeams(provider, undefined, boom), warn: (_o: object, msg: string) => { warnings.push(msg); } };
      const h = createDiscussionHandlers(fakeCtx, () => {}, seams);
      await h["mr:comment-inline"]!(basePayload());
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("diff read failed");
    });

    test("a caller-given oldLine is passed through without reading diffs", async () => {
      const { anchors, provider } = anchorRecorder();
      const never: DiscussionHandlerSeams["diffs"] = async () => { throw new Error("diffs should not be read"); };
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, never));
      const res = await h["mr:comment-inline"]!(basePayload({ line: 41, oldLine: 7 }));
      expect(res.ok).toBe(true);
      expect(anchors[0]).toMatchObject({ line: 41, oldLine: 7 });
    });

    test("a GitLab 400 naming line_code gets the anchoring hint appended", async () => {
      const provider: InlineStub = {
        createInlineComment: async () => { throw new Error("400 Bad request - Note {:line_code=>[\"can't be blank\"]}"); },
        deleteComment: async () => { throw new Error("should not be called"); },
      };
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, diffsFor(DIFF)));
      const res = await h["mr:comment-inline"]!(basePayload({ line: 11 }));
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("line_code");
        expect(res.error.endsWith(" (an unchanged line needs both line and oldLine; a removed line needs oldLine)")).toBe(true);
      }
    });

    test("a failure without line_code gets no hint", async () => {
      const provider: InlineStub = {
        createInlineComment: async () => { throw new Error("403 Forbidden"); },
        deleteComment: async () => { throw new Error("should not be called"); },
      };
      const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(provider, undefined, diffsFor(DIFF)));
      const res = await h["mr:comment-inline"]!(basePayload({ line: 11 }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).not.toContain("unchanged line needs");
    });
  });
});
