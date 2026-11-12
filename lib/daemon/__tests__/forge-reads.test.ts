import { describe, expect, test } from "bun:test";
import { ForgeHttpError, RateLimitedError } from "@mattstack/glance";
import { FORGE_GET_MAX_BYTES, REFUSED_SEGMENTS, checkForgePath, forgeFailure, forgeGet, gitlabFailure, listLabels, listMrsLive, listPipelines, missingMrReason, projectApi, type RestProvider } from "../forge-reads.ts";

export function restFake(responses: Array<Response | Error>): { provider: RestProvider; paths: string[] } {
  const paths: string[] = [];
  let i = 0;
  const provider: RestProvider = {
    restRequest: async (_method, path) => {
      paths.push(path);
      const next = responses[i++];
      if (next === undefined) throw new Error(`no fake response for ${path}`);
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { provider, paths };
}

describe("forge-reads basics", () => {
  test("projectApi encodes the project path", () => {
    expect(projectApi("grp/sub/proj")).toBe("/projects/grp%2Fsub%2Fproj");
  });

  test("gitlabFailure carries status, status text and a body excerpt", async () => {
    const res = new Response('{"message":"403 Forbidden"}', { status: 403, statusText: "Forbidden" });
    expect(await gitlabFailure(res)).toBe('GitLab returned 403 Forbidden: {"message":"403 Forbidden"}');
  });

  test("gitlabFailure names GitHub for a GitHub response", async () => {
    const res = new Response("Not Found", { status: 404, statusText: "Not Found" });
    expect(await gitlabFailure(res, "github")).toBe("GitHub returned 404 Not Found: Not Found");
  });

  test("gitlabFailure stops reading an endless error body after a small bound", async () => {
    let pulls = 0;
    const chunk = new TextEncoder().encode(`${"e".repeat(300)}${"x".repeat(64 * 1024)}`);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls > 1000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const res = new Response(body, { status: 500, statusText: "Server Error" });
    expect(await gitlabFailure(res)).toBe(`GitLab returned 500 Server Error: ${"e".repeat(200)}`);
    expect(pulls).toBeLessThan(5);
  });

  test("missingMrReason reports GitLab's refusal", async () => {
    const { provider, paths } = restFake([new Response("nope", { status: 403, statusText: "Forbidden" })]);
    expect(await missingMrReason(provider, "grp/proj", 7)).toBe("GitLab returned 403 Forbidden: nope");
    expect(paths).toEqual(["/projects/grp%2Fproj/merge_requests/7"]);
  });

  test("missingMrReason reports a 404 as GitLab's own answer", async () => {
    const { provider } = restFake([new Response("", { status: 404, statusText: "Not Found" })]);
    expect(await missingMrReason(provider, "grp/proj", 7)).toBe("GitLab returned 404 Not Found");
  });

  test("missingMrReason says so when REST finds the MR the detail query lost", async () => {
    const { provider } = restFake([new Response("{}", { status: 200 })]);
    expect(await missingMrReason(provider, "grp/proj", 7)).toContain("detail query failed");
  });
});

const summary = (iid: number, over: Record<string, unknown> = {}) => ({
  iid, title: `t${iid}`, state: "opened", draft: false, sourceBranch: `b${iid}`, targetBranch: "main",
  author: "alice", webUrl: `https://gitlab.com/grp/proj/-/merge_requests/${iid}`, detailedMergeStatus: "mergeable", mergedAt: null, ...over,
});

/** A provider whose reads answer from `answers` in order: a value, or an error to throw. */
function readsFake(answers: Record<string, unknown[]>) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const provider: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [name, queue] of Object.entries(answers)) {
    provider[name] = async (...args: unknown[]) => {
      calls.push({ name, args });
      if (queue.length === 0) throw new Error(`no fake answer for ${name}`);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    };
  }
  return { provider: provider as any, calls };
}

const http = (status: number, statusText: string, bodyText: string, forge = "GitLab") =>
  new ForgeHttpError(`${forge} returned ${status} ${statusText}: ${bodyText}`, status, statusText, bodyText);

describe("forgeFailure", () => {
  test("a forge refusal keeps the first 200 characters of the forge's message", () => {
    const long = `${"m".repeat(200)}${"z".repeat(100)}`;
    expect(forgeFailure(http(404, "Not Found", long), "gitlab")).toBe(`GitLab returned 404 Not Found: ${"m".repeat(200)}`);
  });

  test("an empty message leaves no trailing colon", () => {
    expect(forgeFailure(http(404, "Not Found", ""), "gitlab")).toBe("GitLab returned 404 Not Found");
  });

  test("a GitLab 429 gitbeaker gave up retrying carries gitbeaker's retry text", () => {
    const retry = "Could not successfully complete this request after 10 retries, last status code: 429. Check the applicable rate limits for this endpoint.";
    expect(forgeFailure(http(429, "Too Many Requests", retry), "gitlab")).toBe(`GitLab returned 429 Too Many Requests: ${retry}`);
  });

  test("names GitHub on a GitHub read", () => {
    expect(forgeFailure(http(403, "Forbidden", "Resource not accessible by integration", "GitHub"), "github")).toBe("GitHub returned 403 Forbidden: Resource not accessible by integration");
  });

  test("a rate limit names the limit and when to retry", () => {
    const limited = new RateLimitedError("GitHub secondary rate limit hit on GET /repos/o/r/labels", { kind: "secondary", resetAt: null, retryAfterMs: 60000, operation: "GET /repos/o/r/labels" });
    expect(forgeFailure(limited, "github")).toBe("GitHub secondary rate limit hit on GET /repos/o/r/labels (retry in 60s)");
    const reset = new RateLimitedError("GitHub primary rate limit hit on x; resets at 2026-11-11T10:00:00Z", { kind: "primary", resetAt: "2026-11-11T10:00:00Z", retryAfterMs: null, operation: "x" });
    expect(forgeFailure(reset, "github")).toBe("GitHub primary rate limit hit on x; resets at 2026-11-11T10:00:00Z");
  });

  test("a listing that was not an array is the bare sentence; anything else is its string form", () => {
    expect(forgeFailure(new Error("GitLab's label listing was not a JSON array"), "gitlab")).toBe("GitLab's label listing was not a JSON array");
    expect(forgeFailure(new Error("ECONNRESET"), "gitlab")).toBe("Error: ECONNRESET");
  });
});

describe("listMrsLive", () => {
  test("sends every filter and orders by last update", async () => {
    const { provider, calls } = readsFake({ fetchPullRequestSummaries: [{ rows: [summary(1)], truncated: false }] });
    const r = await listMrsLive(provider, "grp/proj", { author: "bob", sourceBranch: "feat", targetBranch: "main", state: "merged", search: "refund" });
    expect(r).toMatchObject({ ok: true, truncated: false });
    expect(calls).toEqual([{ name: "fetchPullRequestSummaries", args: ["grp/proj", {
      state: "merged", sort: "updated_desc", author: "bob", sourceBranch: "feat", targetBranch: "main", search: "refund", limit: 50,
    }] }]);
  });

  test("carries each MR's merged_at as mergedAt, null when GitLab has none", async () => {
    const { provider } = readsFake({ fetchPullRequestSummaries: [{ rows: [summary(1, { state: "merged", mergedAt: "2026-10-16T12:00:00Z" }), summary(2)], truncated: false }] });
    const r = await listMrsLive(provider, "grp/proj", {});
    expect(r.ok && r.mrs.map((mr) => mr.mergedAt)).toEqual(["2026-10-16T12:00:00Z", null]);
  });

  test("author me asks GitLab for the token user's own MRs", async () => {
    const { provider, calls } = readsFake({ fetchPullRequestSummaries: [{ rows: [], truncated: false }] });
    await listMrsLive(provider, "grp/proj", { author: "me" });
    expect((calls[0]!.args[1] as { author?: string }).author).toBe("me");
  });

  test("an unfiltered call past the limit returns exactly limit rows and truncated", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => summary(i + 1));
    const { provider, calls } = readsFake({ fetchPullRequestSummaries: [{ rows: fifty, truncated: true }] });
    const r = await listMrsLive(provider, "grp/proj", { limit: 50 });
    expect(r.ok && r.mrs.length).toBe(50);
    expect(r.ok && r.truncated).toBe(true);
    expect((calls[0]!.args[1] as { limit: number }).limit).toBe(50);
  });

  test("asks for the whole limit in one read", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => summary(i + 1));
    const { provider, calls } = readsFake({ fetchPullRequestSummaries: [{ rows, truncated: false }] });
    const r = await listMrsLive(provider, "grp/proj", { limit: 150 });
    expect(r.ok && r.mrs.length).toBe(101);
    expect(r.ok && r.truncated).toBe(false);
    expect(calls.length).toBe(1);
    expect((calls[0]!.args[1] as { limit: number }).limit).toBe(150);
  });

  test("an empty listing is an empty, complete answer", async () => {
    const { provider, calls } = readsFake({ fetchPullRequestSummaries: [{ rows: [], truncated: false }] });
    const r = await listMrsLive(provider, "grp/proj", {});
    expect(r).toEqual({ ok: true, mrs: [], truncated: false });
    expect(calls.length).toBe(1);
  });

  test("a GitLab refusal is the error", async () => {
    const { provider } = readsFake({ fetchPullRequestSummaries: [http(401, "Unauthorized", "nope")] });
    expect(await listMrsLive(provider, "grp/proj", {})).toEqual({ ok: false, error: "GitLab returned 401 Unauthorized: nope" });
  });

  test("a listing that was not an array is the error", async () => {
    const { provider } = readsFake({ fetchPullRequestSummaries: [new Error("GitLab's merge request listing was not a JSON array")] });
    expect(await listMrsLive(provider, "grp/proj", {})).toEqual({ ok: false, error: "GitLab's merge request listing was not a JSON array" });
  });
});

describe("listLabels", () => {
  test("returns name, description and color, passing search", async () => {
    const { provider, calls } = readsFake({ fetchProjectLabels: [{ labels: [{ name: "preview-acme", description: null, color: "#fff" }], truncated: false }] });
    expect(await listLabels(provider, "grp/proj", "preview")).toEqual({ ok: true, labels: [{ name: "preview-acme", description: null, color: "#fff" }] });
    expect(calls).toEqual([{ name: "fetchProjectLabels", args: ["grp/proj", { search: "preview", maxRows: 1000 }] }]);
  });
  test("a refusal is the error", async () => {
    const { provider } = readsFake({ fetchProjectLabels: [http(404, "Not Found", "")] });
    expect(await listLabels(provider, "grp/proj")).toEqual({ ok: false, error: "GitLab returned 404 Not Found" });
  });
  test("more labels than the cap is an error, never a short list", async () => {
    const { provider } = readsFake({ fetchProjectLabels: [{ labels: [{ name: "a", description: null, color: null }], truncated: true }] });
    expect(await listLabels(provider, "grp/proj")).toEqual({ ok: false, error: "more than 1000 labels matched; narrow the search" });
  });
});

describe("listPipelines", () => {
  const p = { id: 5, status: "failed", ref: "feat", sha: "abc", source: "push", webUrl: "https://x/5", createdAt: "2026-09-30T00:00:00Z" };
  test("lists a branch's pipelines newest first, with no MR needed", async () => {
    const { provider, calls } = readsFake({ fetchPipelineList: [[p]] });
    expect(await listPipelines(provider, "grp/proj", { ref: "feat" })).toEqual({
      ok: true, pipelines: [{ id: 5, status: "failed", ref: "feat", sha: "abc", source: "push", webUrl: "https://x/5", createdAt: "2026-09-30T00:00:00Z" }],
    });
    expect(calls).toEqual([{ name: "fetchPipelineList", args: ["grp/proj", { ref: "feat", limit: 20 }] }]);
  });
  test("an MR iid together with ref or sha is refused, nothing fetched", async () => {
    for (const extra of [{ ref: "feat" }, { sha: "abc" }]) {
      const { provider, calls } = readsFake({ fetchPipelineList: [[p]] });
      const r = await listPipelines(provider, "grp/proj", { iid: 12, ...extra });
      expect(r).toEqual({ ok: false, error: '"iid" lists one MR\'s own pipelines and cannot be combined with "ref" or "sha"' });
      expect(calls).toEqual([]);
    }
  });
  test("an MR iid reads that MR's pipelines", async () => {
    const { provider, calls } = readsFake({ fetchPipelineList: [[p]] });
    await listPipelines(provider, "grp/proj", { iid: 12, limit: 5 });
    expect(calls).toEqual([{ name: "fetchPipelineList", args: ["grp/proj", { iid: 12, limit: 5 }] }]);
  });
  test("a refusal is the error", async () => {
    const { provider } = readsFake({ fetchPipelineList: [http(403, "Forbidden", "403 Forbidden")] });
    expect(await listPipelines(provider, "grp/proj", { ref: "feat" })).toEqual({ ok: false, error: "GitLab returned 403 Forbidden: 403 Forbidden" });
  });
});

describe("checkForgePath", () => {
  test("replaces :id with the encoded project and drops a leading slash or api prefix", () => {
    expect(checkForgePath("projects/:id/merge_requests/12/commits", "grp/proj")).toEqual({ ok: true, path: "/projects/grp%2Fproj/merge_requests/12/commits" });
    expect(checkForgePath("/api/v4/projects/:id/labels", "grp/proj")).toEqual({ ok: true, path: "/projects/grp%2Fproj/labels" });
  });

  test("refuses every credential segment at any depth and in any case", () => {
    for (const seg of REFUSED_SEGMENTS) {
      for (const path of [`projects/:id/${seg}`, `groups/9/${seg}/3`, `projects/:id/${seg.toUpperCase()}`]) {
        const r = checkForgePath(path, "grp/proj");
        expect(r, path).toEqual({ ok: false, error: `"path" names ${seg}, which can return credentials; gitlab_get refuses it` });
      }
    }
  });

  test("refuses a credential segment carrying a format suffix", () => {
    for (const path of ["projects/:id/variables.json", "groups/9/runners.json", "projects/:id/variables%2Ejson", "groups/9/RUNNERS.json"]) {
      expect(checkForgePath(path, "grp/proj"), path).toMatchObject({ ok: false });
    }
    expect(checkForgePath("projects/:id/runners.json", "grp/proj")).toEqual({ ok: false, error: '"path" names runners, which can return credentials; gitlab_get refuses it' });
  });

  test("refuses a path that is still percent-encoded after one decode", () => {
    expect(checkForgePath("projects/:id/%2576ariables", "grp/proj")).toMatchObject({ ok: false });
  });

  test("refuses a control character that only appears after decoding", () => {
    for (const path of ["projects/:id/variables%00", "projects/:id/variables%0A", "projects/:id/labels%0d"]) {
      expect(checkForgePath(path, "grp/proj"), path).toMatchObject({ ok: false });
    }
  });

  test("refuses the application segment", () => {
    expect(REFUSED_SEGMENTS).toContain("application");
    expect(checkForgePath("application/settings", "grp/proj")).toMatchObject({ ok: false });
  });

  test("refuses a segment hidden by URL encoding", () => {
    expect(checkForgePath("projects/1/%76ariables", "grp/proj")).toMatchObject({ ok: false });
    expect(checkForgePath("projects/1%2Fvariables", "grp/proj")).toMatchObject({ ok: false });
  });

  test("refuses a query string, a fragment, dot segments, a scheme and control characters", () => {
    for (const path of ["projects/:id/labels?x=1", "projects/:id#a", "projects/:id/../variables", "https://evil.example/x", "projects/:id/\nlabels", "", 5]) {
      expect(checkForgePath(path, "grp/proj"), String(path)).toMatchObject({ ok: false });
    }
  });
});

describe("forgeGet", () => {
  test("sends one GET and returns parsed JSON with paging", async () => {
    const methods: string[] = [];
    const provider: RestProvider = {
      restRequest: async (method, path) => {
        methods.push(`${method} ${path}`);
        return new Response('[{"id":1}]', { status: 200, headers: { "x-next-page": "2", "x-total-pages": "4" } });
      },
    };
    const r = await forgeGet(provider, "grp/proj", { path: "projects/:id/merge_requests/12/commits", query: { order: "asc" }, page: 1, perPage: 20 });
    expect(r).toEqual({ ok: true, data: { status: 200, body: [{ id: 1 }], truncated: false, nextPage: 2, totalPages: 4 } });
    expect(methods).toEqual(["GET /projects/grp%2Fproj/merge_requests/12/commits?order=asc&page=1&per_page=20"]);
  });

  test("asks the provider not to follow redirects", async () => {
    const seen: unknown[] = [];
    const provider: RestProvider = {
      restRequest: async (_method, _path, _body, _op, io) => {
        seen.push(io);
        return new Response("{}", { status: 200 });
      },
    };
    await forgeGet(provider, "grp/proj", { path: "projects/:id" });
    expect(seen).toEqual([{ redirect: "manual" }]);
  });

  test("a redirect is refused naming only the target host, and nothing else is fetched", async () => {
    const { provider, paths } = restFake([
      new Response(null, { status: 302, headers: { location: "https://objects.example.net/bucket/file?X-Sig=secret" } }),
      new Response("leaked", { status: 200 }),
    ]);
    const r = await forgeGet(provider, "grp/proj", { path: "projects/:id/releases/v1/downloads/a" });
    expect(r).toEqual({ ok: false, error: "gitlab_get does not follow redirects: GitLab answered 302 redirecting to objects.example.net" });
    expect(paths).toHaveLength(1);
  });

  test("a redirect's streamed body is cancelled, not left open", async () => {
    for (const forge of ["gitlab", "github"] as const) {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(1024)); },
        cancel() { cancelled = true; },
      });
      const { provider } = restFake([new Response(stream, { status: 302, headers: { location: "https://objects.example.net/x" } })]);
      const path = forge === "github" ? ":repo/releases/assets/1" : "projects/:id/releases/v1/downloads/a";
      const r = await forgeGet(provider, "grp/proj", { path }, forge);
      expect(r.ok ? "" : r.error, forge).toContain("does not follow redirects");
      expect(cancelled, forge).toBe(true);
    }
  });

  test("a redirect with a relative or missing Location still refuses without a URL", async () => {
    const rel = await forgeGet(restFake([new Response(null, { status: 301, headers: { location: "/other?token=abc" } })]).provider, "grp/proj", { path: "projects/:id" });
    expect(rel).toEqual({ ok: false, error: "gitlab_get does not follow redirects: GitLab answered 301 redirecting to a relative location" });
    const none = await forgeGet(restFake([new Response(null, { status: 307 })]).provider, "grp/proj", { path: "projects/:id" });
    expect(none).toEqual({ ok: false, error: "gitlab_get does not follow redirects: GitLab answered 307 with no Location header" });
  });

  test("an oversized body comes back as truncated text", async () => {
    const { provider } = restFake([new Response("x".repeat(FORGE_GET_MAX_BYTES + 10), { status: 200 })]);
    const r = await forgeGet(provider, "grp/proj", { path: "projects/:id/repository/tree" });
    expect(r.ok && r.data.truncated).toBe(true);
    expect(r.ok && (r.data.body as string).length).toBe(FORGE_GET_MAX_BYTES);
  });

  test("token values are redacted in parsed and in cut bodies", async () => {
    const project = { id: 1, runners_token: "glrt-abc", nested: [{ token: "t0p", name: "keep" }], token_count: 3 };
    const parsed = restFake([new Response(JSON.stringify(project), { status: 200 })]);
    const r = await forgeGet(parsed.provider, "grp/proj", { path: "projects/:id" });
    expect(r.ok && r.data.body).toEqual({ id: 1, runners_token: "[redacted]", nested: [{ token: "[redacted]", name: "keep" }], token_count: 3 });
    const big = `{"runners_token":"glrt-abc","pad":"${"x".repeat(FORGE_GET_MAX_BYTES)}"}`;
    const cut = restFake([new Response(big, { status: 200 })]);
    const c = await forgeGet(cut.provider, "grp/proj", { path: "projects/:id" });
    expect(c.ok && (c.data.body as string).startsWith('{"runners_token":"[redacted]"')).toBe(true);
    const straddle = `{"pad":"${"x".repeat(FORGE_GET_MAX_BYTES - 30)}","runners_token":"glrt-secret-value-past-the-cut"}`;
    const s = await forgeGet(restFake([new Response(straddle, { status: 200 })]).provider, "grp/proj", { path: "projects/:id" });
    expect(s.ok && (s.data.body as string).includes("glrt-")).toBe(false);
  });

  test("a multi-byte body past the cap in bytes is truncated and decodes without throwing", async () => {
    const text = "é".repeat(FORGE_GET_MAX_BYTES / 2 + 10);
    expect(text.length).toBeLessThan(FORGE_GET_MAX_BYTES);
    const odd = restFake([new Response(`${"a"}${text}`, { status: 200 })]);
    const r = await forgeGet(odd.provider, "grp/proj", { path: "projects/:id/repository/tree" });
    expect(r.ok && r.data.truncated).toBe(true);
    expect(r.ok && typeof r.data.body).toBe("string");
    expect(r.ok && new TextEncoder().encode(r.data.body as string).length).toBeLessThanOrEqual(FORGE_GET_MAX_BYTES + 2);
  });

  test("a body exactly at the cap is not truncated", async () => {
    const { provider } = restFake([new Response("x".repeat(FORGE_GET_MAX_BYTES), { status: 200 })]);
    const r = await forgeGet(provider, "grp/proj", { path: "projects/:id/repository/tree" });
    expect(r.ok && r.data.truncated).toBe(false);
  });

  test("a huge streamed body is cancelled, not consumed", async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(120);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
        if (pulled > 10000) controller.close();
      },
      cancel() { cancelled = true; },
    });
    const { provider } = restFake([new Response(stream, { status: 200 })]);
    const r = await forgeGet(provider, "grp/proj", { path: "projects/:id/repository/tree" });
    expect(r.ok && r.data.truncated).toBe(true);
    expect(pulled).toBeLessThan(20);
    expect(cancelled).toBe(true);
  });

  test("a response with no body is an empty text body", async () => {
    const { provider } = restFake([new Response(null, { status: 204 })]);
    expect(await forgeGet(provider, "grp/proj", { path: "projects/:id/issues" })).toMatchObject({ ok: true, data: { status: 204, body: "", truncated: false } });
  });

  test("the query keys sudo, private_token and access_token are refused in any case", async () => {
    for (const key of ["sudo", "private_token", "access_token", "SUDO", "Private_Token", "sudo]", "[sudo]", "sudo[]", "private_token]", "job_token", "bearer_token"]) {
      const { provider, paths } = restFake([]);
      const r = await forgeGet(provider, "grp/proj", { path: "projects/:id/issues", query: { [key]: "x" } });
      expect(r, key).toEqual({ ok: false, error: `"query.${key}" can carry credentials or impersonation; gitlab_get refuses it` });
      expect(paths).toEqual([]);
    }
  });

  test("an array query key such as iids[] still passes", async () => {
    const { provider, paths } = restFake([new Response("[]", { status: 200 })]);
    const r = await forgeGet(provider, "grp/proj", { path: "projects/:id/merge_requests", query: { "iids[]": 4 } });
    expect(r.ok).toBe(true);
    expect(paths).toEqual(["/projects/grp%2Fproj/merge_requests?iids%5B%5D=4"]);
  });

  test("a cut body does not leak the tail of a value with an escaped quote", async () => {
    const whole = await forgeGet(restFake([new Response('{"token":"ab\\"cd"}', { status: 200 })]).provider, "grp/proj", { path: "projects/:id" });
    expect(whole.ok && whole.data.body).toEqual({ token: "[redacted]" });
    const head = `{"token":"ab\\"cd-leaky-tail","pad":"`;
    const body = `${head}${"x".repeat(FORGE_GET_MAX_BYTES)}"}`;
    const cut = await forgeGet(restFake([new Response(body, { status: 200 })]).provider, "grp/proj", { path: "projects/:id" });
    expect(cut.ok && (cut.data.body as string).includes("leaky")).toBe(false);
    const cutInside = `{"pad":"${"x".repeat(FORGE_GET_MAX_BYTES - 24)}","token":"ab\\"cd-leaky-tail"}`;
    const inside = await forgeGet(restFake([new Response(cutInside, { status: 200 })]).provider, "grp/proj", { path: "projects/:id" });
    expect(inside.ok && (inside.data.body as string).includes("leaky")).toBe(false);
  });

  test("a refused path never reaches GitLab", async () => {
    const { provider, paths } = restFake([]);
    expect(await forgeGet(provider, "grp/proj", { path: "projects/:id/variables" })).toMatchObject({ ok: false });
    expect(paths).toEqual([]);
  });

  test("GitLab's refusal is the error", async () => {
    const { provider } = restFake([new Response("no", { status: 403, statusText: "Forbidden" })]);
    expect(await forgeGet(provider, "grp/proj", { path: "projects/9/issues" })).toEqual({ ok: false, error: "GitLab returned 403 Forbidden: no" });
  });
});
