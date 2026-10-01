/**
 * mr:note-update: replaces the body of an existing MR note and refreshes
 * that MR's discussions without ever reporting a landed edit as failed.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../../state/index.ts";
import { createDiscussionHandlers, type CommentMutator, type DiscussionHandlerSeams } from "../handlers/discussions.ts";
import { fakeStore } from "./fake-cache-store.ts";

const fakeCtx = { repoIndex: () => ({}), cache: fakeStore({}) };
const IDENTITY = "remote:gitlab.com%2Fg%2Fsub%2Frepo-tools";

function makeSeams(mutator: Partial<CommentMutator>, refresh?: DiscussionHandlerSeams["refresh"]): DiscussionHandlerSeams {
  const unexpected = async (): Promise<never> => { throw new Error("unexpected mutator call"); };
  return {
    repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "g/sub/repo-tools", projectId: 99 }),
    gitlabToken: async () => "tok",
    commentMutator: () => ({ createDiscussion: unexpected, createNote: unexpected, updateNote: unexpected, ...mutator }) as CommentMutator,
    refresh: refresh ?? (async () => undefined),
  };
}

describe("mr:note-update", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rt-note-update-"));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("calls updateNote with the project, iid, note and body, then refreshes", async () => {
    let args: unknown[] = [];
    const refreshed: Array<[string, number]> = [];
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(
      { updateNote: async (...a) => { args = a; } },
      async (repoName, iid) => { refreshed.push([repoName, iid]); },
    ));
    const res = await h["mr:note-update"]({ repoName: IDENTITY, iid: 7, noteId: 55, body: "edited" });
    expect(args).toEqual([99, 7, 55, "edited"]);
    expect(refreshed).toEqual([[IDENTITY, 7]]);
    expect(res).toEqual({ ok: true, data: { noteId: 55 } });
  });

  test("GitLab's refusal text passes through as is", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({
      updateNote: async () => { throw new Error("updateNote failed: 403 Forbidden"); },
    }));
    const res = await h["mr:note-update"]({ repoName: IDENTITY, iid: 7, noteId: 55, body: "edited" });
    expect(res).toEqual({ ok: false, error: "Error: updateNote failed: 403 Forbidden" });
  });

  test("a refresh failure does not turn a done edit into a failure", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams(
      { updateNote: async () => {} },
      async () => { throw new Error("refresh boom"); },
    ));
    const res = await h["mr:note-update"]({ repoName: IDENTITY, iid: 7, noteId: 55, body: "edited" });
    expect(res).toEqual({ ok: true, data: { noteId: 55 } });
  });

  test("invalid payloads are refused before any GitLab call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({}));
    const bad: Array<Record<string, unknown>> = [
      { repoName: IDENTITY, iid: 7, noteId: 55, body: "   " },
      { repoName: IDENTITY, iid: 7, noteId: 55 },
      { repoName: IDENTITY, iid: 7, noteId: 0, body: "x" },
      { repoName: IDENTITY, iid: 7, noteId: 1.5, body: "x" },
      { repoName: IDENTITY, iid: -1, noteId: 55, body: "x" },
      { repoName: IDENTITY, noteId: 55, body: "x" },
      { iid: 7, noteId: 55, body: "x" },
    ];
    for (const payload of bad) {
      const res = await h["mr:note-update"](payload);
      expect(res).toEqual({ ok: false, error: "missing repoName/iid/noteId/body" });
    }
  });

  test("a non-identity repoName is refused", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, makeSeams({}));
    const res = await h["mr:note-update"]({ repoName: "repo-tools", iid: 7, noteId: 55, body: "x" });
    expect(res).toEqual({ ok: false, error: "repo must be a serialized identity" });
  });
});
