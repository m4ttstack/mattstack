/**
 * forge:get on a GitHub repo: reads stay under repos/<owner>/<repo>, behind
 * GitHub's own refused segments and query keys, with the shared redirect
 * refusal, size cap and token redaction.
 */
import { describe, expect, test } from "bun:test";
import {
  FORGE_GET_MAX_BYTES, GITHUB_REFUSED_QUERY_KEYS, GITHUB_REFUSED_SEGMENTS, checkGithubForgePath, forgeGet, type RestProvider,
} from "../forge-reads.ts";
import { createMRHandlers } from "../handlers/mr.ts";
import { fakeStore } from "./fake-cache-store.ts";

function restFake(responses: Response[]): { provider: RestProvider; paths: string[] } {
  const paths: string[] = [];
  let i = 0;
  const provider: RestProvider = {
    restRequest: async (_method, path) => {
      paths.push(path);
      const next = responses[i++];
      if (next === undefined) throw new Error(`no fake response for ${path}`);
      return next;
    },
  };
  return { provider, paths };
}

const PROJECT = "o/r";
const check = (path: unknown) => checkGithubForgePath(path, PROJECT);
const get = (provider: RestProvider, input: Parameters<typeof forgeGet>[2]) => forgeGet(provider, PROJECT, input, "github");
const credentialRefusal = (seg: string) => ({ ok: false as const, error: `"path" names ${seg}, which can return credentials; gitlab_get refuses it` });

describe("checkGithubForgePath", () => {
  test("the refused segments are the spec's 17, verbatim", () => {
    expect(GITHUB_REFUSED_SEGMENTS).toHaveLength(17);
    expect([...GITHUB_REFUSED_SEGMENTS]).toEqual([
      "secrets", "variables", "hooks", "keys", "deploy_keys", "installations", "tokens", "runners", "registration-token",
      "remove-token", "environments", "codespaces", "dependabot", "actions/oidc", "autolinks", "invitations",
      "private-vulnerability-reporting",
    ]);
  });

  test("refuses every refused segment under the repo, in any case", () => {
    for (const seg of GITHUB_REFUSED_SEGMENTS) {
      for (const path of [`:repo/${seg}`, `:repo/actions/${seg}/x`, `repos/o/r/${seg.toUpperCase()}`]) {
        expect(check(path), path).toEqual(credentialRefusal(seg));
      }
    }
  });

  test("refuses a refused segment hidden by case or an encoded slash", () => {
    expect(check(":repo/Actions/Secrets")).toEqual(credentialRefusal("secrets"));
    expect(check(":repo/actions%2Fsecrets")).toEqual(credentialRefusal("secrets"));
    expect(check(":repo/actions%2Foidc/customization/sub")).toEqual(credentialRefusal("actions/oidc"));
    expect(check(":repo/%73ecrets")).toEqual(credentialRefusal("secrets"));
  });

  test("actions/oidc is refused only as the two segments together", () => {
    expect(check(":repo/actions/oidc/customization/sub")).toEqual(credentialRefusal("actions/oidc"));
    expect(check(":repo/ACTIONS/OIDC")).toEqual(credentialRefusal("actions/oidc"));
    expect(check(":repo/actions/runs")).toMatchObject({ ok: true });
    expect(check(":repo/contents/oidc")).toMatchObject({ ok: true });
  });

  test("refuses git/blobs, which can be too large to read, but not git/trees", () => {
    const blobs = { ok: false as const, error: '"path" names git/blobs, and a blob can be too large to read through gitlab_get; read the file with :repo/contents/<path> instead' };
    expect(check(":repo/git/blobs/abc123")).toEqual(blobs);
    expect(check(":repo/Git/Blobs/abc123")).toEqual(blobs);
    expect(check(":repo/git%2Fblobs/abc123")).toEqual(blobs);
    expect(check(":repo/git/trees/abc123")).toEqual({ ok: true, path: "/repos/o/r/git/trees/abc123" });
  });

  test("refuses a path that leaves the repo", () => {
    const outside = { ok: false as const, error: '"path" must sit under this repo on GitHub; start it with :repo/ (repos/o/r/)' };
    for (const path of ["user", "repos/other/repo/pulls", "orgs/o/members", "repos/o/rextra/pulls", "repos/o", "repositories/1/pulls", "repos/o//r/pulls", "%3Arepo/pulls", ":REPO/pulls", "x/:repo/pulls", ":repox/pulls"]) {
      expect(check(path), path).toEqual(outside);
    }
  });

  test("refuses dot segments in any encoding", () => {
    for (const path of ["repos/o/r/../../user", ":repo/../../user", ":repo/%2e%2e/%2e%2e/user", ":repo/%2E%2E", ":repo/.%2e/x", ":repo/./pulls", ":repo/%2e/pulls", ":repo/pulls/.."]) {
      expect(check(path), path).toEqual({ ok: false, error: '"path" must not contain dot segments' });
    }
  });

  test("refuses braces, which Octokit would expand into a path the checks never saw", () => {
    for (const path of [":repo/{x}../{x}../{x}../user", ":repo/{x}%2e%2e/user", ":repo/pulls/{n}", ":repo/%7Bx%7D/pulls"]) {
      expect(check(path), path).toEqual({ ok: false, error: '"path" must not contain { or }' });
    }
  });

  test("refuses double encoding, malformed escapes, control characters, a query, a fragment, a scheme and a backslash", () => {
    expect(check(":repo/%2573ecrets")).toEqual({ ok: false, error: '"path" must not be percent-encoded more than once' });
    expect(check(":repo/%2e%252e")).toEqual({ ok: false, error: '"path" must not be percent-encoded more than once' });
    expect(check(":repo/%zz")).toEqual({ ok: false, error: '"path" has a malformed percent escape' });
    for (const path of [":repo/pulls?state=all", ":repo/pulls#x", "https://api.github.com/repos/o/r", ":repo\\pulls", ":repo/%5C..%5C..", ":repo/\npulls", ":repo/pulls%00", ":repo/pulls%0a"]) {
      expect(check(path), path).toEqual({ ok: false, error: '"path" must be a plain API path; pass query values in "query"' });
    }
    for (const path of ["", "  ", 5, undefined]) expect(check(path), String(path)).toEqual({ ok: false, error: '"path" is required' });
  });

  test("accepts :repo and a full repo path in another case", () => {
    expect(check(":repo/pulls")).toEqual({ ok: true, path: "/repos/o/r/pulls" });
    expect(check("/:repo/pulls/12/commits")).toEqual({ ok: true, path: "/repos/o/r/pulls/12/commits" });
    expect(check(":repo")).toEqual({ ok: true, path: "/repos/o/r" });
    expect(check("repos/O/R/pulls")).toEqual({ ok: true, path: "/repos/O/R/pulls" });
    expect(check("repos/o/r")).toEqual({ ok: true, path: "/repos/o/r" });
    expect(check(":repo/pulls/")).toEqual({ ok: true, path: "/repos/o/r/pulls/" });
    expect(check(":repo//pulls")).toEqual({ ok: true, path: "/repos/o/r//pulls" });
    expect(check(":repo/contents/docs%2Fa%20b.md")).toEqual({ ok: true, path: "/repos/o/r/contents/docs%2Fa%20b.md" });
  });
});

describe("forgeGet on GitHub", () => {
  test("sends one GET under the repo with paging, asking not to follow redirects", async () => {
    const seen: string[] = [];
    const ios: unknown[] = [];
    const provider: RestProvider = {
      restRequest: async (method, path, _body, op, io) => {
        seen.push(`${method} ${path} ${op}`);
        ios.push(io);
        return new Response('[{"number":1}]', { status: 200 });
      },
    };
    const r = await get(provider, { path: ":repo/pulls", query: { state: "all" }, page: 2, perPage: 30 });
    expect(r).toEqual({ ok: true, data: { status: 200, body: [{ number: 1 }], truncated: false, nextPage: null, totalPages: null } });
    expect(seen).toEqual(["GET /repos/o/r/pulls?state=all&page=2&per_page=30 forge:get"]);
    expect(ios).toEqual([{ redirect: "manual" }]);
  });

  test("nextPage is the page of the Link header's next URL, and totalPages is null", async () => {
    const link = '<https://api.github.com/repositories/1/pulls?per_page=2&page=1>; rel="prev", <https://api.github.com/repositories/1/pulls?per_page=2&page=3>; rel="next", <https://api.github.com/repositories/1/pulls?per_page=2&page=5>; rel="last"';
    const { provider } = restFake([new Response("[]", { status: 200, headers: { link, "x-next-page": "9", "x-total-pages": "9" } })]);
    expect(await get(provider, { path: ":repo/pulls" })).toEqual({ ok: true, data: { status: 200, body: [], truncated: false, nextPage: 3, totalPages: null } });
    const last = restFake([new Response("[]", { status: 200, headers: { link: '<https://api.github.com/repositories/1/pulls?page=4>; rel="prev"' } })]);
    expect(await get(last.provider, { path: ":repo/pulls" })).toMatchObject({ ok: true, data: { nextPage: null, totalPages: null } });
  });

  test("each refused query key is refused in any case, before any request", async () => {
    expect([...GITHUB_REFUSED_QUERY_KEYS]).toEqual(["access_token", "client_secret", "token"]);
    for (const key of ["access_token", "client_secret", "token", "TOKEN", "Client_Secret", "[token]", "token[]", "access_token]"]) {
      const { provider, paths } = restFake([]);
      expect(await get(provider, { path: ":repo/pulls", query: { [key]: "x" } }), key).toEqual({ ok: false, error: `"query.${key}" can carry credentials; gitlab_get refuses it` });
      expect(paths).toEqual([]);
    }
  });

  test("a refused path never reaches GitHub", async () => {
    const { provider, paths } = restFake([]);
    expect(await get(provider, { path: ":repo/actions/secrets" })).toMatchObject({ ok: false });
    expect(await get(provider, { path: "user" })).toMatchObject({ ok: false });
    expect(paths).toEqual([]);
  });

  test("a 302 is refused naming only the host, and nothing else is fetched", async () => {
    const { provider, paths } = restFake([
      new Response(null, { status: 302, headers: { location: "https://pipelines.actions.githubusercontent.com/logs/1?sig=secret" } }),
      new Response("leaked", { status: 200 }),
    ]);
    expect(await get(provider, { path: ":repo/actions/runs/1/logs" })).toEqual({ ok: false, error: "gitlab_get does not follow redirects: GitHub answered 302 redirecting to pipelines.actions.githubusercontent.com" });
    expect(paths).toHaveLength(1);
  });

  test("a token value in the body comes back redacted", async () => {
    const { provider } = restFake([new Response('{"token":"x","name":"keep","nested":[{"access_token":"y"}]}', { status: 200 })]);
    expect(await get(provider, { path: ":repo" })).toMatchObject({ ok: true, data: { body: { token: "[redacted]", name: "keep", nested: [{ access_token: "[redacted]" }] } } });
  });

  test("a body past the cap comes back as truncated, scrubbed text", async () => {
    const big = `{"token":"secret-value","pad":"${"x".repeat(FORGE_GET_MAX_BYTES)}"}`;
    const { provider } = restFake([new Response(big, { status: 200 })]);
    const r = await get(provider, { path: ":repo/pulls" });
    expect(r.ok && r.data.truncated).toBe(true);
    expect(r.ok && (r.data.body as string).includes("secret-value")).toBe(false);
  });

  test("a Content-Length past the cap is refused before the body is read", async () => {
    const { provider } = restFake([new Response("[]", { status: 200, headers: { "content-length": String(FORGE_GET_MAX_BYTES + 1) } })]);
    expect(await get(provider, { path: ":repo/pulls" })).toEqual({
      ok: false, error: `GitHub's answer is ${FORGE_GET_MAX_BYTES + 1} bytes, over gitlab_get's 256 KiB cap; ask for less with perPage or a narrower path`,
    });
    const at = restFake([new Response("[]", { status: 200, headers: { "content-length": String(FORGE_GET_MAX_BYTES) } })]);
    expect(await get(at.provider, { path: ":repo/pulls" })).toMatchObject({ ok: true });
  });

  test("GitHub's refusal is the error, naming GitHub", async () => {
    const { provider, paths } = restFake([new Response('{"message":"API rate limit exceeded"}', { status: 403, statusText: "Forbidden" })]);
    expect(await get(provider, { path: ":repo/pulls" })).toEqual({ ok: false, error: 'GitHub returned 403 Forbidden: {"message":"API rate limit exceeded"}' });
    expect(paths).toHaveLength(1);
  });
});

describe("the forge:get handler on a GitHub repo", () => {
  const REPO = "remote:github.com%2Fo%2Fr";
  function handlers(provider: RestProvider) {
    return createMRHandlers({ cache: fakeStore({}), repoIndex: () => ({ [REPO]: "/tmp/repo" }), log: { warn() {}, info() {}, debug() {}, error() {} } as any }, () => {}, {
      getContext: async () => ({ forge: "github", provider, projectPath: PROJECT, projectId: null }),
    });
  }

  test("reads under the repo through GitHub's guard", async () => {
    const { provider, paths } = restFake([new Response('{"full_name":"o/r"}', { status: 200 })]);
    expect(await handlers(provider)["forge:get"]({ repoName: REPO, path: ":repo" })).toEqual({ ok: true, data: { status: 200, body: { full_name: "o/r" }, truncated: false, nextPage: null, totalPages: null } });
    expect(paths).toEqual(["/repos/o/r"]);
  });

  test("applies GitHub's guard, not GitLab's", async () => {
    const { provider, paths } = restFake([]);
    const h = handlers(provider);
    expect(await h["forge:get"]({ repoName: REPO, path: "projects/:id/issues" })).toMatchObject({ ok: false, error: expect.stringContaining("must sit under this repo on GitHub") });
    expect(await h["forge:get"]({ repoName: REPO, path: ":repo/hooks" })).toEqual(credentialRefusal("hooks"));
    expect(paths).toEqual([]);
  });
});
