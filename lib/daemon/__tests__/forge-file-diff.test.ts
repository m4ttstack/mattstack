import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createMRHandlers } from "../handlers/mr.ts";
import type { ForgeFileDiffData } from "../../../packages/rt-client/src/commands.ts";
import type { FileDiffContext } from "../file-diff.ts";
import { fakeStore } from "./fake-cache-store.ts";

const GL_REPO = "remote:gitlab.example.com%2Facme%2Fradar";
const GH_REPO = "remote:github.com%2Facme%2Fradar";
const fakeCtx = () => ({
  cache: fakeStore({}),
  repoIndex: () => ({ [GL_REPO]: "/tmp/gl", [GH_REPO]: "/tmp/gh" }),
  log: { warn() {}, info() {}, debug() {}, error() {} } as any,
});

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

/** A forge that answers GET paths from a table and records every call. */
function fakeRest(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const rest = async (path: string) => {
    calls.push(path);
    const route = routes[path];
    if (!route) return new Response(JSON.stringify({ message: "404 Not Found" }), { status: 404 });
    return route();
  };
  return { rest, calls };
}

function handlers(contexts: Record<string, FileDiffContext | Error>) {
  return createMRHandlers(fakeCtx(), () => {}, {
    getContext: async () => { throw new Error("forge:file-diff must use its own forge context"); },
    fileDiffContext: async (repo) => {
      const c = contexts[repo];
      if (!c) throw new Error(`no context for ${repo}`);
      if (c instanceof Error) throw c;
      return c;
    },
  });
}

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const GL_MR = "/projects/acme%2Fradar/merge_requests/812";
const glDiffs = (page: number) => `${GL_MR}/diffs?page=${page}&per_page=100`;
const glMr = () => json({ sha: "head812", diff_refs: { head_sha: "head812" }, web_url: "https://gitlab.example.com/acme/radar/-/merge_requests/812" });
const glRow = (path: string, extra: Record<string, unknown> = {}) => ({
  old_path: path, new_path: path, new_file: false, renamed_file: false, deleted_file: false,
  diff: "@@ -1,2 +1,2 @@\n-a\n+b\n", ...extra,
});

describe("forge:file-diff on GitLab", () => {
  test("pages through the MR's diffs and returns the one file", async () => {
    const { rest, calls } = fakeRest({
      [GL_MR]: glMr,
      [glDiffs(1)]: () => json([glRow("src/a.ts")], { "x-next-page": "2" }),
      [glDiffs(2)]: () => json([glRow("src/old-name.ts", { new_path: "src/radar.ts", renamed_file: true })], { "x-next-page": "" }),
    });
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    const r = await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "src/radar.ts" });
    expect(r).toEqual({
      ok: true,
      data: {
        forge: "gitlab",
        headSha: "head812",
        file: {
          oldPath: "src/old-name.ts", newPath: "src/radar.ts", renamed: true, newFile: false, deletedFile: false,
          binary: false, tooLarge: false, diff: "@@ -1,2 +1,2 @@\n-a\n+b\n",
          webUrl: `https://gitlab.example.com/acme/radar/-/merge_requests/812/diffs#${sha1("src/radar.ts")}`,
        },
      },
    });
    expect(calls).toEqual([GL_MR, glDiffs(1), glDiffs(2)]);
  });

  test("a second file on the same head reads the cached diff", async () => {
    const { rest, calls } = fakeRest({
      [GL_MR]: glMr,
      [glDiffs(1)]: () => json([glRow("src/a.ts"), glRow("src/b.ts")]),
    });
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "src/a.ts" });
    const r = await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "src/b.ts" });
    expect(r).toMatchObject({ ok: true, data: { file: { newPath: "src/b.ts" } } });
    expect(calls).toEqual([GL_MR, glDiffs(1), GL_MR]);
  });

  test("marks too-large, collapsed and binary files with no diff text", async () => {
    const { rest } = fakeRest({
      [GL_MR]: glMr,
      [glDiffs(1)]: () => json([
        glRow("big.json", { diff: "", too_large: true }),
        glRow("folded.ts", { diff: "", collapsed: true }),
        glRow("logo.png", { diff: "Binary files a/logo.png and b/logo.png differ\n" }),
      ]),
    });
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    const file = async (path: string) =>
      ((await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path })) as { ok: true; data: ForgeFileDiffData }).data.file;
    expect(await file("big.json")).toMatchObject({ tooLarge: true, binary: false, diff: null });
    expect(await file("folded.ts")).toMatchObject({ tooLarge: true, binary: false, diff: null });
    expect(await file("logo.png")).toMatchObject({ tooLarge: false, binary: true, diff: null });
  });

  test("a path the diff does not touch answers file null", async () => {
    const { rest } = fakeRest({ [GL_MR]: glMr, [glDiffs(1)]: () => json([glRow("src/a.ts")]) });
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    expect(await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "nope.ts" })).toEqual({
      ok: true, data: { forge: "gitlab", headSha: "head812", file: null },
    });
  });

  test("a GitLab error comes back as the call's error", async () => {
    const { rest } = fakeRest({ [GL_MR]: glMr, [glDiffs(1)]: () => new Response("boom", { status: 500, statusText: "Internal Server Error" }) });
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    const r = await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "src/a.ts" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("500");
  });

  test("a missing MR names it", async () => {
    const { rest } = fakeRest({});
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    const r = await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "src/a.ts" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("404");
  });
});

const GH_PR = "/repos/acme/radar/pulls/58";
const ghFiles = (page: number) => `${GH_PR}/files?per_page=100&page=${page}`;
const ghPr = () => json({ head: { sha: "head58" }, html_url: "https://github.com/acme/radar/pull/58" });

describe("forge:file-diff on GitHub", () => {
  test("pages through the PR's files and returns the one file", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ filename: `gen/${i}.ts`, status: "added", patch: "@@ -0,0 +1 @@\n+x" }));
    const { rest, calls } = fakeRest({
      [GH_PR]: ghPr,
      [ghFiles(1)]: () => json(full),
      [ghFiles(2)]: () => json([{ filename: "src/radar.ts", previous_filename: "src/old.ts", status: "renamed", patch: "@@ -3 +3 @@\n-a\n+b" }]),
    });
    const h = handlers({ [GH_REPO]: { forge: "github", projectPath: "acme/radar", rest } });
    const r = await h["forge:file-diff"]!({ repoName: GH_REPO, iid: 58, path: "src/radar.ts" });
    expect(r).toEqual({
      ok: true,
      data: {
        forge: "github",
        headSha: "head58",
        file: {
          oldPath: "src/old.ts", newPath: "src/radar.ts", renamed: true, newFile: false, deletedFile: false,
          binary: false, tooLarge: false, diff: "@@ -3 +3 @@\n-a\n+b",
          webUrl: `https://github.com/acme/radar/pull/58/files#diff-${sha256("src/radar.ts")}`,
        },
      },
    });
    expect(calls).toEqual([GH_PR, ghFiles(1), ghFiles(2)]);
  });

  test("a file GitHub sends no patch for is too large", async () => {
    const { rest } = fakeRest({
      [GH_PR]: ghPr,
      [ghFiles(1)]: () => json([
        { filename: "huge.lock", status: "modified", changes: 9000 },
        { filename: "gone.ts", status: "removed", patch: "@@ -1 +0,0 @@\n-x" },
      ]),
    });
    const h = handlers({ [GH_REPO]: { forge: "github", projectPath: "acme/radar", rest } });
    expect(await h["forge:file-diff"]!({ repoName: GH_REPO, iid: 58, path: "huge.lock" })).toMatchObject({
      ok: true, data: { file: { tooLarge: true, binary: false, diff: null } },
    });
    expect(await h["forge:file-diff"]!({ repoName: GH_REPO, iid: 58, path: "gone.ts" })).toMatchObject({
      ok: true, data: { file: { deletedFile: true, oldPath: "gone.ts" } },
    });
  });
});

describe("forge:file-diff payload", () => {
  const h = handlers({});

  test("refuses a missing iid or path", async () => {
    expect(await h["forge:file-diff"]!({ repoName: GL_REPO, path: "a.ts" })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 1 })).toEqual({ ok: false, error: '"path" must be a non-empty string' });
  });

  test("refuses a display name or an unindexed repo", async () => {
    expect(await h["forge:file-diff"]!({ repoName: "radar", iid: 1, path: "a.ts" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(await h["forge:file-diff"]!({ repoName: "remote:gitlab.example.com%2Fother", iid: 1, path: "a.ts" })).toEqual({ ok: false, error: "repo-unknown" });
  });

  test("a context failure (no token) is the call's error", async () => {
    const failing = handlers({ [GL_REPO]: new Error("missing gitlabToken (run: rt secrets set rt gitlabToken)") });
    expect(await failing["forge:file-diff"]!({ repoName: GL_REPO, iid: 1, path: "a.ts" })).toEqual({
      ok: false, error: "Error: missing gitlabToken (run: rt secrets set rt gitlabToken)",
    });
  });
});
