import { describe, expect, test } from "bun:test";
import { FORGE_GET_MAX_BYTES, REFUSED_SEGMENTS, checkForgePath, forgeGet, gitlabFailure, listLabels, listMrsLive, listPipelines, missingMrReason, projectApi, type RestProvider } from "../forge-reads.ts";

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

const row = (iid: number) => ({
  iid, title: `t${iid}`, state: "opened", draft: false, source_branch: `b${iid}`, target_branch: "main",
  author: { username: "alice" }, web_url: `https://gitlab.com/grp/proj/-/merge_requests/${iid}`, detailed_merge_status: "mergeable",
});
const page = (rows: unknown[], next: string) => new Response(JSON.stringify(rows), { status: 200, headers: { "x-next-page": next } });

describe("listMrsLive", () => {
  test("sends every filter and orders by last update", async () => {
    const { provider, paths } = restFake([page([row(1)], "")]);
    const r = await listMrsLive(provider, "grp/proj", { author: "bob", sourceBranch: "feat", targetBranch: "main", state: "merged", search: "refund" });
    expect(r).toMatchObject({ ok: true, truncated: false });
    const query = new URLSearchParams(paths[0]!.split("?")[1]);
    expect(Object.fromEntries(query)).toEqual({
      state: "merged", order_by: "updated_at", sort: "desc", scope: "all", author_username: "bob",
      source_branch: "feat", target_branch: "main", search: "refund", per_page: "100", page: "1",
    });
  });

  test("author me asks GitLab for the token user's own MRs", async () => {
    const { provider, paths } = restFake([page([], "")]);
    await listMrsLive(provider, "grp/proj", { author: "me" });
    const query = new URLSearchParams(paths[0]!.split("?")[1]);
    expect(query.get("scope")).toBe("created_by_me");
    expect(query.has("author_username")).toBe(false);
  });

  test("an unfiltered call past the limit returns exactly limit rows and truncated", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => row(i + 1));
    const { provider } = restFake([page(hundred, "2")]);
    const r = await listMrsLive(provider, "grp/proj", { limit: 50 });
    expect(r.ok && r.mrs.length).toBe(50);
    expect(r.ok && r.truncated).toBe(true);
  });

  test("walks pages until the limit is covered", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => row(i + 1));
    const { provider, paths } = restFake([page(hundred, "2"), page([row(101)], "")]);
    const r = await listMrsLive(provider, "grp/proj", { limit: 150 });
    expect(r.ok && r.mrs.length).toBe(101);
    expect(r.ok && r.truncated).toBe(false);
    expect(paths.length).toBe(2);
  });

  test("an empty page ends the walk even when GitLab names a next page", async () => {
    const { provider, paths } = restFake([page([], "2")]);
    const r = await listMrsLive(provider, "grp/proj", {});
    expect(r).toEqual({ ok: true, mrs: [], truncated: false });
    expect(paths.length).toBe(1);
  });

  test("a GitLab refusal is the error", async () => {
    const { provider } = restFake([new Response("nope", { status: 401, statusText: "Unauthorized" })]);
    expect(await listMrsLive(provider, "grp/proj", {})).toEqual({ ok: false, error: "GitLab returned 401 Unauthorized: nope" });
  });
});

describe("listLabels", () => {
  test("returns name, description and color, passing search", async () => {
    const { provider, paths } = restFake([page([{ name: "preview-acme", description: null, color: "#fff", id: 3 }], "")]);
    expect(await listLabels(provider, "grp/proj", "preview")).toEqual({ ok: true, labels: [{ name: "preview-acme", description: null, color: "#fff" }] });
    expect(paths[0]).toBe("/projects/grp%2Fproj/labels?per_page=100&page=1&search=preview");
  });
  test("a refusal is the error", async () => {
    const { provider } = restFake([new Response("", { status: 404, statusText: "Not Found" })]);
    expect(await listLabels(provider, "grp/proj")).toEqual({ ok: false, error: "GitLab returned 404 Not Found" });
  });
});

describe("listPipelines", () => {
  const p = { id: 5, status: "failed", ref: "feat", sha: "abc", source: "push", web_url: "https://x/5", created_at: "2026-09-30T00:00:00Z" };
  test("lists a branch's pipelines newest first, with no MR needed", async () => {
    const { provider, paths } = restFake([page([p], "")]);
    expect(await listPipelines(provider, "grp/proj", { ref: "feat" })).toEqual({
      ok: true, pipelines: [{ id: 5, status: "failed", ref: "feat", sha: "abc", source: "push", webUrl: "https://x/5", createdAt: "2026-09-30T00:00:00Z" }],
    });
    expect(paths[0]).toBe("/projects/grp%2Fproj/pipelines?per_page=20&order_by=id&sort=desc&ref=feat");
  });
  test("an MR iid together with ref or sha is refused, nothing fetched", async () => {
    for (const extra of [{ ref: "feat" }, { sha: "abc" }]) {
      const { provider, paths } = restFake([page([p], "")]);
      const r = await listPipelines(provider, "grp/proj", { iid: 12, ...extra });
      expect(r).toEqual({ ok: false, error: '"iid" lists one MR\'s own pipelines and cannot be combined with "ref" or "sha"' });
      expect(paths).toEqual([]);
    }
  });
  test("an MR iid reads that MR's pipelines", async () => {
    const { provider, paths } = restFake([page([p], "")]);
    await listPipelines(provider, "grp/proj", { iid: 12, limit: 5 });
    expect(paths[0]).toBe("/projects/grp%2Fproj/merge_requests/12/pipelines?per_page=5");
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
