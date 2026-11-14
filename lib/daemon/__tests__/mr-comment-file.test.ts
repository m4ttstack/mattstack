/**
 * mr:comment-file posts one file-level review thread on a GitHub pull
 * request through glance's createFileComment, then refreshes that PR's
 * discussions so a following mr:note-update finds the note's kind.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../../state/index.ts";
import { createDiscussionHandlers, type DiscussionHandlerSeams, type ThreadContext, type ThreadProvider } from "../handlers/discussions.ts";
import { fakeStore } from "./fake-cache-store.ts";

const fakeCtx = { repoIndex: () => ({}), cache: fakeStore({}) };
const GH_IDENTITY = "remote:github.com%2Fo%2Fr";
const GL_IDENTITY = "remote:gitlab.com%2Fg%2Fr";

type FileResult = { discussionId: string; noteId: number; path: string } | null;

function context(forge: ThreadContext["forge"], createFileComment: (...a: unknown[]) => Promise<FileResult>): ThreadContext {
  const unexpected = async (): Promise<never> => { throw new Error("unexpected provider call"); };
  return {
    forge,
    provider: {
      baseURL: forge === "github" ? "https://github.com" : "https://gitlab.com",
      createComment: unexpected,
      createInlineComment: unexpected,
      deleteComment: unexpected,
      replyToDiscussion: unexpected,
      updateComment: unexpected,
      submitReview: unexpected,
      resolveDiscussion: unexpected,
      unresolveDiscussion: unexpected,
      createFileComment,
    } as ThreadProvider,
    projectPath: forge === "github" ? "o/r" : "g/r",
    projectId: forge === "github" ? undefined : 42,
  };
}

function harness(forge: ThreadContext["forge"], result: FileResult, over: Partial<DiscussionHandlerSeams> = {}) {
  const events: unknown[][] = [];
  const seams: DiscussionHandlerSeams = {
    repoContext: async () => context(forge, async (...a) => { events.push(["post", ...a]); return result; }),
    refresh: async (repoName, iid) => { events.push(["refresh", repoName, iid]); return undefined; },
    ...over,
  };
  return { h: createDiscussionHandlers(fakeCtx, () => {}, seams), events };
}

describe("mr:comment-file", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rt-comment-file-"));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("a posted thread answers its ids and path, then refreshes the PR's discussions", async () => {
    const { h, events } = harness("github", { discussionId: "gh-review-thread-404", noteId: 404, path: "src/a.ts" });
    const res = await h["mr:comment-file"]!({ repoName: GH_IDENTITY, iid: 7, body: "banner" });
    expect(res).toEqual({ ok: true, data: { discussionId: "gh-review-thread-404", noteId: 404, path: "src/a.ts" } });
    expect(events).toEqual([["post", "o/r", 7, "banner"], ["refresh", GH_IDENTITY, 7]]);
  });

  test("a PR with no changed files answers the no-files fallback and refreshes nothing", async () => {
    const { h, events } = harness("github", null);
    const res = await h["mr:comment-file"]!({ repoName: GH_IDENTITY, iid: 7, body: "banner" });
    expect(res).toEqual({ ok: true, data: { fallback: "no-files" } });
    expect(events).toEqual([["post", "o/r", 7, "banner"]]);
  });

  test("a GitLab repo is refused before any post", async () => {
    const { h, events } = harness("gitlab", { discussionId: "x", noteId: 1, path: "a" });
    const res = await h["mr:comment-file"]!({ repoName: GL_IDENTITY, iid: 7, body: "banner" });
    expect(res).toEqual({ ok: false, error: "unsupported: mr:comment-file needs a GitHub repo" });
    expect(events).toEqual([]);
  });

  test("a failed refresh still answers the landed thread", async () => {
    const { h } = harness("github", { discussionId: "gh-review-thread-404", noteId: 404, path: "src/a.ts" }, {
      refresh: async () => { throw new Error("forge down"); },
    });
    const res = await h["mr:comment-file"]!({ repoName: GH_IDENTITY, iid: 7, body: "banner" });
    expect(res).toEqual({ ok: true, data: { discussionId: "gh-review-thread-404", noteId: 404, path: "src/a.ts" } });
  });

  test("a failed post answers its error", async () => {
    const { h } = harness("github", null, {
      repoContext: async () => context("github", async () => { throw new Error("422 Validation Failed"); }),
    });
    const res = await h["mr:comment-file"]!({ repoName: GH_IDENTITY, iid: 7, body: "banner" });
    expect(res).toEqual({ ok: false, error: "Error: 422 Validation Failed" });
  });

  test("a bad payload is refused before any lookup", async () => {
    const { h, events } = harness("github", null, {
      repoContext: async () => { throw new Error("repoContext should not be called"); },
    });
    expect(await h["mr:comment-file"]!({ repoName: GH_IDENTITY, iid: 0, body: "banner" })).toEqual({ ok: false, error: "missing repoName/iid/body" });
    expect(await h["mr:comment-file"]!({ repoName: GH_IDENTITY, iid: 7, body: "  " })).toEqual({ ok: false, error: "missing repoName/iid/body" });
    expect(await h["mr:comment-file"]!({ repoName: "o/r", iid: 7, body: "banner" })).toEqual({ ok: false, error: "repo must be a serialized identity" });
    expect(events).toEqual([]);
  });
});
