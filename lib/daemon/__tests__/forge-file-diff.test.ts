import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createMRHandlers } from "../handlers/mr.ts";
import type { ForgeFileDiffData } from "../../../packages/rt-client/src/commands.ts";
import { createFileDiffContextResolver, LISTING_MAX_BYTES, type FileDiffContext } from "../file-diff.ts";
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
        truncated: false,
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
      ok: true, data: { forge: "gitlab", headSha: "head812", truncated: false, file: null },
    });
  });

  test("a bare file name takes the one changed file ending in it", async () => {
    const { rest } = fakeRest({ [GL_MR]: glMr, [glDiffs(1)]: () => json([glRow("src/map/useMapCenter.ts"), glRow("src/a.ts")]) });
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    const res = await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "useMapCenter.ts" });
    expect((res as { data: ForgeFileDiffData }).data.file).toMatchObject({ newPath: "src/map/useMapCenter.ts" });
  });

  test("a bare file name two changed files end in matches neither", async () => {
    const { rest } = fakeRest({ [GL_MR]: glMr, [glDiffs(1)]: () => json([glRow("src/a/index.ts"), glRow("src/b/index.ts")]) });
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    const res = await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "index.ts" });
    expect((res as { data: ForgeFileDiffData }).data.file).toBeNull();
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
        truncated: false,
        file: {
          oldPath: "src/old.ts", newPath: "src/radar.ts", renamed: true, newFile: false, deletedFile: false,
          binary: false, tooLarge: false, diff: "@@ -3 +3 @@\n-a\n+b",
          webUrl: `https://github.com/acme/radar/pull/58/files#diff-${sha256("src/radar.ts")}`,
        },
      },
    });
    expect(calls).toEqual([GH_PR, ghFiles(1), ghFiles(2)]);
  });

  test("a file with no patch is too large when it counts line changes, binary when it counts none", async () => {
    const { rest } = fakeRest({
      [GH_PR]: ghPr,
      [ghFiles(1)]: () => json([
        { filename: "huge.lock", status: "modified", additions: 6000, deletions: 3000, changes: 9000 },
        { filename: "logo.png", status: "modified", additions: 0, deletions: 0, changes: 0 },
        { filename: "src/moved.ts", previous_filename: "src/was.ts", status: "renamed", additions: 0, deletions: 0, changes: 0 },
        { filename: "gone.ts", status: "removed", patch: "@@ -1 +0,0 @@\n-x" },
        { filename: "src/__init__.py", status: "added", additions: 0, deletions: 0, changes: 0 },
        { filename: "assets/icon.PNG", status: "added", additions: 0, deletions: 0, changes: 0 },
        { filename: "bin/run.sh", status: "changed", additions: 0, deletions: 0, changes: 0 },
      ]),
    });
    const h = handlers({ [GH_REPO]: { forge: "github", projectPath: "acme/radar", rest } });
    const file = async (path: string) =>
      ((await h["forge:file-diff"]!({ repoName: GH_REPO, iid: 58, path })) as { ok: true; data: ForgeFileDiffData }).data.file;
    expect(await file("huge.lock")).toMatchObject({ tooLarge: true, binary: false, diff: null });
    expect(await file("logo.png")).toMatchObject({ tooLarge: false, binary: true, diff: null });
    expect(await file("src/moved.ts")).toMatchObject({ renamed: true, tooLarge: false, binary: false, diff: "" });
    expect(await file("gone.ts")).toMatchObject({ deletedFile: true, oldPath: "gone.ts" });
    expect(await file("src/__init__.py")).toMatchObject({ newFile: true, tooLarge: false, binary: false, diff: "" });
    expect(await file("assets/icon.PNG")).toMatchObject({ newFile: true, tooLarge: false, binary: true, diff: null });
    expect(await file("bin/run.sh")).toMatchObject({ tooLarge: false, binary: false, diff: "" });
  });

  test("a PR past GitHub's page cap is marked truncated", async () => {
    const page = (p: number) => Array.from({ length: 100 }, (_, i) => ({ filename: `gen/${p}-${i}.ts`, status: "added", patch: "@@ -0,0 +1 @@\n+x" }));
    const routes: Record<string, () => Response> = { [GH_PR]: ghPr };
    for (let p = 1; p <= 30; p++) routes[ghFiles(p)] = () => json(page(p));
    const { rest, calls } = fakeRest(routes);
    const h = handlers({ [GH_REPO]: { forge: "github", projectPath: "acme/radar", rest } });
    expect(await h["forge:file-diff"]!({ repoName: GH_REPO, iid: 58, path: "src/radar.ts" })).toMatchObject({
      ok: true, data: { truncated: true, file: null },
    });
    expect(calls.filter((c) => c.includes("/files"))).toHaveLength(30);
  });
});

describe("forge:file-diff listing", () => {
  test("concurrent first calls for one MR share one listing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    const rest = async (path: string) => {
      calls.push(path);
      if (path === GL_MR) return glMr();
      if (path === glDiffs(1)) {
        await gate;
        return json([glRow("src/a.ts"), glRow("src/b.ts"), glRow("src/c.ts")]);
      }
      return new Response("{}", { status: 404 });
    };
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    const asks = ["src/a.ts", "src/b.ts", "src/c.ts"].map((path) => h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path }));
    await new Promise((r) => setTimeout(r, 10));
    release();
    const answers = await Promise.all(asks);
    expect(answers.map((a) => (a as { ok: true; data: ForgeFileDiffData }).data.file?.newPath)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(calls.filter((c) => c === glDiffs(1))).toHaveLength(1);
  });

  test("a failed listing is asked again on the next call", async () => {
    let fail = true;
    const { rest, calls } = fakeRest({
      [GL_MR]: glMr,
      [glDiffs(1)]: () => (fail ? new Response("boom", { status: 503, statusText: "Service Unavailable" }) : json([glRow("src/a.ts")])),
    });
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    expect(await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "src/a.ts" })).toMatchObject({ ok: false });
    fail = false;
    expect(await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "src/a.ts" })).toMatchObject({ ok: true, data: { file: { newPath: "src/a.ts" } } });
    expect(calls.filter((c) => c === glDiffs(1))).toHaveLength(2);
  });

  test("a listing past the byte budget stops, marked truncated", async () => {
    const big = "x".repeat(LISTING_MAX_BYTES);
    const { rest } = fakeRest({
      [GL_MR]: glMr,
      [glDiffs(1)]: () => json([glRow("src/a.ts")], { "x-next-page": "2" }),
      [glDiffs(2)]: () => json([glRow("src/huge.ts", { diff: big })]),
    });
    const h = handlers({ [GL_REPO]: { forge: "gitlab", projectPath: "acme/radar", rest } });
    expect(await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "src/huge.ts" })).toMatchObject({
      ok: true, data: { truncated: true, file: null },
    });
    expect(await h["forge:file-diff"]!({ repoName: GL_REPO, iid: 812, path: "src/a.ts" })).toMatchObject({
      ok: true, data: { truncated: true, file: { newPath: "src/a.ts" } },
    });
  });
});

describe("the forge a repo's diff is read from", () => {
  const gitlab = async () => ({
    provider: { restRequest: async (_m: string, p: string) => json({ asked: p }) },
    projectPath: "acme/radar",
  });

  function resolver(origin: string | undefined, token: string | null = "ghs_fake") {
    const originReads: string[] = [];
    const resolve = createFileDiffContextResolver({
      originUrl: async (repoPath) => {
        originReads.push(repoPath);
        return origin;
      },
      githubToken: async () => token,
      githubRest: (host, t) => async (p) => json({ host, token: t, p }),
    });
    return { resolve, originReads };
  }

  test("a GitHub origin reads through GitHub with rt's GitHub token", async () => {
    const { resolve } = resolver("git@github.com:acme/radar.git");
    const ctx = await resolve("/tmp/gh", () => { throw new Error("a GitHub repo must not ask for a GitLab context"); });
    expect(ctx.forge).toBe("github");
    expect(ctx.projectPath).toBe("acme/radar");
    expect(await (await ctx.rest("/repos/acme/radar/pulls/1")).json()).toEqual({ host: "https://github.com", token: "ghs_fake", p: "/repos/acme/radar/pulls/1" });
  });

  test("a GitLab origin, or none, uses the daemon's GitLab context", async () => {
    for (const origin of ["https://gitlab.example.com/acme/radar.git", undefined]) {
      const ctx = await resolver(origin).resolve("/tmp/gl", gitlab);
      expect(ctx.forge).toBe("gitlab");
      expect(ctx.projectPath).toBe("acme/radar");
      expect(await (await ctx.rest("/projects/x")).json()).toEqual({ asked: "/projects/x" });
    }
  });

  test("a GitHub origin with no token says how to get one", async () => {
    const { resolve } = resolver("https://github.com/acme/radar", null);
    await expect(resolve("/tmp/gh", gitlab)).rejects.toThrow("no GitHub token (run: gh auth login)");
  });

  test("a checkout's origin is read once", async () => {
    const { resolve, originReads } = resolver("git@github.com:acme/radar.git");
    await resolve("/tmp/gh", gitlab);
    await resolve("/tmp/gh", gitlab);
    expect(originReads).toEqual(["/tmp/gh"]);
  });

  test("an origin that could not be read is asked again, so a GitHub checkout is not pinned to GitLab", async () => {
    const answers: Array<string | undefined> = [undefined, "git@github.com:acme/radar.git"];
    const resolve = createFileDiffContextResolver({
      originUrl: async () => answers.shift(),
      githubToken: async () => "ghs_fake",
      githubRest: () => async () => json({}),
    });
    expect((await resolve("/tmp/gh", gitlab)).forge).toBe("gitlab");
    expect((await resolve("/tmp/gh", gitlab)).forge).toBe("github");
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
