/**
 * forge:get on a GitHub repo: reads stay under repos/<owner>/<repo>, behind
 * GitHub's own refused segments and query keys, with the shared redirect
 * refusal, size cap and token redaction.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GitHubProvider } from "@mattstack/glance";
import {
  FORGE_GET_MAX_BYTES, GITHUB_REFUSED_BLOBS, GITHUB_REFUSED_QUERY_KEYS, GITHUB_REFUSED_ROUTES, GITHUB_REFUSED_SEGMENTS, checkGithubForgePath, dotSkeleton, foldsToSeparator, forgeGet, githubRouteRefusal, githubWordRefusal, matchingWindow, wordSkeleton, type RestProvider,
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
const emptySegment = { ok: false as const, error: '"path" must not contain an empty segment (//)' };
const credentialRefusal = (seg: string) => ({ ok: false as const, error: githubWordRefusal(seg) });
const routeRefusal = (word: string) => ({ ok: false as const, error: githubRouteRefusal(word) });
const ruleTwo = { ok: false as const, error: '"path" must name the repo as repos/<owner>/<name>, spelled plainly with no percent escapes. Start it with :repo/ instead.' };
const ruleOne = { ok: false as const, error: "gitlab_get cannot read this GitHub repo, because its path is not owner/name. Check the repo's origin remote." };

describe("checkGithubForgePath", () => {
  test("the refused segments are the spec's list, verbatim", () => {
    expect(GITHUB_REFUSED_SEGMENTS).toHaveLength(21);
    expect([...GITHUB_REFUSED_SEGMENTS]).toEqual([
      "secrets", "variables", "hooks", "keys", "deploy_keys", "installations", "tokens", "runners", "registration-token",
      "remove-token", "environments", "codespaces", "dependabot", "actions/oidc", "autolinks", "invitations",
      "private-vulnerability-reporting", "secret-scanning", "organization-secrets", "organization-variables",
      "security-advisories",
    ]);
    expect([...GITHUB_REFUSED_ROUTES]).toEqual(["copilot"]);
  });

  test("refuses secret scanning alerts, organization secrets and variables, and security advisories", () => {
    expect(check(":repo/secret-scanning/alerts")).toEqual(credentialRefusal("secret-scanning"));
    expect(check(":repo/secret-scanning/alerts/1")).toEqual(credentialRefusal("secret-scanning"));
    expect(check(":repo/actions/organization-secrets")).toEqual(credentialRefusal("organization-secrets"));
    expect(check(":repo/actions/organization-variables")).toEqual(credentialRefusal("organization-variables"));
    expect(check(":repo/security-advisories")).toEqual(credentialRefusal("security-advisories"));
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

  test("a 403 with no rate limit headers is GitHub's own refusal, naming GitHub", async () => {
    const { provider, paths } = restFake([new Response('{"message":"Resource not accessible"}', { status: 403, statusText: "Forbidden" })]);
    expect(await get(provider, { path: ":repo/pulls" })).toEqual({ ok: false, error: 'GitHub returned 403 Forbidden: {"message":"Resource not accessible"}' });
    expect(paths).toHaveLength(1);
  });

  test("a primary rate limit names the limit and the seconds until it resets", async () => {
    const reset = Math.floor(Date.now() / 1000) + 300;
    const { provider, paths } = restFake([new Response('{"message":"API rate limit exceeded"}', {
      status: 403, statusText: "Forbidden", headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
    })]);
    const r = await get(provider, { path: ":repo/pulls" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^GitHub rate limit hit on gitlab_get \(retry in (299|300|301)s\)$/);
    expect(paths).toHaveLength(1);
  });

  test("a 429 or a secondary 403 takes the wait from retry-after", async () => {
    const tooMany = restFake([new Response("{}", { status: 429, statusText: "Too Many Requests", headers: { "retry-after": "120" } })]);
    expect(await get(tooMany.provider, { path: ":repo/pulls" })).toEqual({ ok: false, error: "GitHub rate limit hit on gitlab_get (retry in 120s)" });
    const secondary = restFake([new Response('{"message":"You have exceeded a secondary rate limit"}', {
      status: 403, statusText: "Forbidden", headers: { "retry-after": "90", "x-ratelimit-remaining": "4000", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3000) },
    })]);
    expect(await get(secondary.provider, { path: ":repo/pulls" })).toEqual({ ok: false, error: "GitHub rate limit hit on gitlab_get (retry in 90s)" });
  });

  test("a reset already past waits 0s, and a limit with no usable time names no wait", async () => {
    const past = restFake([new Response("{}", { status: 403, statusText: "Forbidden", headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000" } })]);
    expect(await get(past.provider, { path: ":repo/pulls" })).toEqual({ ok: false, error: "GitHub rate limit hit on gitlab_get (retry in 0s)" });
    const bare = restFake([new Response("{}", { status: 403, statusText: "Forbidden", headers: { "x-ratelimit-remaining": "0" } })]);
    expect(await get(bare.provider, { path: ":repo/pulls" })).toEqual({ ok: false, error: "GitHub rate limit hit on gitlab_get" });
  });
});

describe("checkGithubForgePath fix round 1", () => {
  test("refuses whitespace, which Octokit's route split would cut the path at", () => {
    const space = { ok: false as const, error: '"path" must not contain whitespace; send a space in a file name as %20' };
    for (const path of [":repo/actions/secrets x", ":repo/hooks x", ":repo/contents/a b.md", " :repo/pulls", ":repo/pulls ", ":repo/pulls x"]) {
      expect(check(path), JSON.stringify(path)).toEqual(space);
    }
    expect(check(":repo/contents/a%20b.md")).toEqual({ ok: true, path: "/repos/o/r/contents/a%20b.md" });
  });

  test("refuses a refused word carrying a suffix, as on GitLab", () => {
    expect(check(":repo/actions/secrets.json")).toEqual(credentialRefusal("secrets"));
    expect(check(":repo/actions/secrets.")).toEqual(credentialRefusal("secrets"));
    expect(check(":repo/actions/oidc.json/x")).toEqual(credentialRefusal("actions/oidc"));
    expect(check(":repo/git/blobs.json/abc")).toMatchObject({ ok: false, error: expect.stringContaining("git/blobs") });
    expect(check(":repo/actions.json/oidc")).toMatchObject({ ok: true });
    expect(check(":repo/contents/README.md")).toMatchObject({ ok: true });
    expect(check(":repo/contents/secrets-notes.md")).toMatchObject({ ok: true });
    expect(check(":repo/contents/secrets.md")).toEqual({ ok: true, path: "/repos/o/r/contents/secrets.md" });
  });

  test("refuses a semicolon anywhere", () => {
    const semi = { ok: false as const, error: '"path" must not contain ;' };
    for (const path of [":repo/actions/secrets;x", ":repo/..;/..;/user", ":repo/x/..;", ":repo/pulls%3B"]) {
      expect(check(path), path).toEqual(semi);
    }
  });

});

describe("checkGithubForgePath on the repo's own path", () => {
  test("refuses a repo path that is not exactly owner/repo, so the route and under-repo rules count from the right place", () => {
    for (const project of ["o/r/copilot", "o", "o/r/x/y", "/r", "o/", "o//r", ""]) {
      expect(checkGithubForgePath(":repo/cloud-agent/configuration", project), project).toEqual(ruleOne);
    }
    expect(checkGithubForgePath("repos/o/other/pulls", "o")).toEqual(ruleOne);
  });
});

describe("checkGithubForgePath on empty segments", () => {
  const multiSegment = [...GITHUB_REFUSED_SEGMENTS, GITHUB_REFUSED_BLOBS].filter((entry) => entry.includes("/"));

  test("refuses the OIDC customization read split by an empty segment", () => {
    expect(check(":repo/actions//oidc/customization/sub")).toEqual(emptySegment);
  });

  test("refuses every multi-segment entry split by a raw or decoded empty segment", () => {
    expect(multiSegment).toEqual(["actions/oidc", "git/blobs"]);
    for (const entry of multiSegment) {
      const [first, second] = entry.split("/");
      for (const path of [`:repo/${first}//${second}/x`, `:repo/${first}%2F%2F${second}/x`, `:repo/${first}/%2F${second}/x`, `:repo/${first}%2F/${second}`]) {
        expect(check(path), path).toEqual(emptySegment);
      }
    }
  });

  test("refuses an empty segment anywhere inside the path, including right after the repo", () => {
    for (const path of [":repo//pulls", ":repo//copilot/cloud-agent/configuration", ":repo/%2Fcopilot/cloud-agent", ":repo/pulls//1", ":repo/pulls///"]) {
      expect(check(path), path).toEqual(emptySegment);
    }
  });

  test("a normal path and one trailing slash behave as before", () => {
    expect(check(":repo/pulls")).toEqual({ ok: true, path: "/repos/o/r/pulls" });
    expect(check(":repo/pulls/")).toEqual({ ok: true, path: "/repos/o/r/pulls/" });
    expect(check(":repo/")).toEqual({ ok: true, path: "/repos/o/r/" });
    expect(check("/:repo/pulls/12/commits")).toEqual({ ok: true, path: "/repos/o/r/pulls/12/commits" });
  });

  test("an empty segment never reaches GitHub", async () => {
    const { provider, paths } = restFake([]);
    for (const path of [":repo/actions//oidc/customization/sub", ":repo/git%2F%2Fblobs/abc", ":repo//pulls"]) {
      expect(await get(provider, { path }), path).toEqual(emptySegment);
    }
    expect(paths).toEqual([]);
  });
});

describe("checkGithubForgePath on copilot routes", () => {
  const refused = routeRefusal("copilot");

  test("refuses the cloud agent configuration, the code review settings and anything under the repo's copilot route", () => {
    for (const path of [
      ":repo/copilot/cloud-agent/configuration", "repos/o/r/copilot/cloud-agent/configuration", ":repo/copilot/code-review/settings",
      ":repo/copilot", ":repo/copilot/", ":repo/copilot/a/b/c/d", ":repo/copilot.json/x",
    ]) {
      expect(check(path), path).toEqual(refused);
    }
  });

  test("refuses the copilot route hidden by case, a trailing slash, encoded letters or an encoded slash", () => {
    for (const path of [
      ":repo/COPILOT/cloud-agent/configuration", ":repo/CoPilot/Cloud-Agent/Configuration/", ":repo/copilot/cloud-agent/configuration/",
      ":repo/%63opilot/cloud-agent/configuration", ":repo/%43%4F%50%49%4C%4F%54/cloud-agent/configuration",
      ":repo/copilot%2Fcloud-agent%2Fconfiguration",
    ]) {
      expect(check(path), path).toEqual(refused);
    }
    for (const path of [
      "repos%2Fo%2Fr%2Fcopilot/cloud-agent/configuration", "repos/%6F/%72/copilot/cloud-agent/configuration", "REPOS/O/R/COPILOT/code-review/settings",
    ]) {
      expect(check(path), path).toEqual(ruleTwo);
    }
  });

  test("a query string or double encoding on the copilot route is refused before any segment is read", () => {
    expect(check(":repo/copilot/cloud-agent/configuration?x=1")).toEqual({ ok: false, error: '"path" must be a plain API path; pass query values in "query"' });
    expect(check(":repo/%2563opilot/cloud-agent/configuration")).toEqual({ ok: false, error: '"path" must not be percent-encoded more than once' });
    expect(check(":repo/copilot%252Fcloud-agent")).toEqual({ ok: false, error: '"path" must not be percent-encoded more than once' });
  });

  test("refuses the copilot route of a repo that is itself named copilot", () => {
    expect(checkGithubForgePath(":repo/copilot/cloud-agent/configuration", "o/copilot")).toEqual(refused);
  });

  test("copilot anywhere but the route segment after the repo is not refused", () => {
    for (const path of [
      ":repo/rules/branches/copilot/fix-1", ":repo/rules/branches/copilot%2Ffix-1", ":repo/branches/copilot/fix-1",
      ":repo/branches/copilot%2Ffix-1", ":repo/compare/main...copilot/x", ":repo/commits/copilot%2Fx/status",
      ":repo/git/ref/heads/copilot/fix-1", ":repo/contents/docs/copilot.md", ":repo/contents/copilot/x", ":repo/pulls/copilot",
    ]) {
      expect(check(path), path).toEqual({ ok: true, path: `/${path.replace(":repo", "repos/o/r")}` });
    }
    for (const project of ["o/copilot", "o/copilot.vim", "copilot/r"]) {
      expect(checkGithubForgePath(":repo/pulls", project), project).toEqual({ ok: true, path: `/repos/${project}/pulls` });
      expect(checkGithubForgePath(":repo/rules/branches/copilot/fix-1", project), project).toMatchObject({ ok: true });
    }
  });

  test("a copilot route never reaches GitHub, with or without a query, and a copilot branch read does", async () => {
    const { provider, paths } = restFake([new Response("{}", { status: 200 })]);
    for (const path of [":repo/copilot/cloud-agent/configuration", ":repo/Copilot/", ":repo/%63opilot/code-review", ":repo/copilot?x=1"]) {
      expect(await get(provider, { path }), path).toMatchObject({ ok: false });
    }
    expect(await get(provider, { path: ":repo/copilot/cloud-agent/configuration", query: { page: "1" } })).toEqual(refused);
    expect(paths).toEqual([]);
    expect(await get(provider, { path: ":repo/rules/branches/copilot/fix-1" })).toMatchObject({ ok: true });
    expect(paths).toEqual(["/repos/o/r/rules/branches/copilot/fix-1"]);
  });
});

describe("forgeGet through a real GitHubProvider", () => {
  const realFetch = globalThis.fetch;
  let sent: Array<{ url: string; redirect: unknown }> = [];
  let reply: () => Response = () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });

  beforeEach(() => {
    sent = [];
    reply = () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(input instanceof Request ? input.url : input), redirect: init?.redirect });
      return reply();
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const provider = () => new GitHubProvider("https://github.com", "test-token");

  test("an accepted path reaches the wire under /repos/o/r, with redirects not followed", async () => {
    const cases: Array<[string, string]> = [
      [":repo/pulls", "/repos/o/r/pulls"],
      [":repo/pulls/:ab", "/repos/o/r/pulls/%3Aab"],
      [":repo/contents/a%20b.md", "/repos/o/r/contents/a%20b.md"],
      [":repo/:ab../:ab../:ab../user", "/repos/o/r/%3Aab../%3Aab../%3Aab../user"],
    ];
    for (const [path, wirePath] of cases) {
      sent = [];
      expect(await forgeGet(provider(), PROJECT, { path }, "github"), path).toMatchObject({ ok: true });
      expect(sent, path).toHaveLength(1);
      expect(new URL(sent[0]!.url).pathname, path).toBe(wirePath);
      expect(sent[0]!.redirect, path).toBe("manual");
    }
    sent = [];
    expect(await forgeGet(provider(), PROJECT, { path: ":repo/pulls/" }, "github")).toMatchObject({ ok: true });
    const trailing = new URL(sent[0]!.url).pathname;
    expect(trailing === "/repos/o/r/pulls" || trailing === "/repos/o/r/pulls/").toBe(true);
  });

  test("a hostile path is refused and never reaches fetch", async () => {
    for (const path of [
      ":repo/actions/secrets x", ":repo/hooks x", ":repo/{x}../{x}../{x}../user", ":repo/:ab/../../user", ":repo/:ab%2F..%2F..%2Fuser",
      ":repo/actions%2Fsecrets", "repos/o/r%2F..%2F..%2Fuser", ":repo/..;/..;/user", ":repo/actions/secrets.json",
    ]) {
      expect(await forgeGet(provider(), PROJECT, { path }, "github"), path).toMatchObject({ ok: false });
    }
    expect(sent).toEqual([]);
  });

  test("a 302 is refused naming only the host", async () => {
    reply = () => new Response(null, { status: 302, headers: { location: "https://objects.example.net/logs/1?sig=secret" } });
    expect(await forgeGet(provider(), PROJECT, { path: ":repo/actions/runs/1/logs" }, "github")).toEqual({
      ok: false, error: "gitlab_get does not follow redirects: GitHub answered 302 redirecting to objects.example.net",
    });
    expect(sent).toHaveLength(1);
  });

  const wire = async (projectPath: string, path: string) => {
    sent = [];
    const result = await forgeGet(provider(), projectPath, { path }, "github");
    return { result, sent: [...sent] };
  };
  const refusedOnWire = async (path: string, error: string, projectPath = PROJECT) => {
    const { result, sent: out } = await wire(projectPath, path);
    expect(result, path).toEqual({ ok: false, error });
    expect(out, path).toEqual([]);
  };
  const dotError = '"path" must not contain dot segments';
  const plainError = '"path" must be a plain API path; pass query values in "query"';
  const blobsError = '"path" names git/blobs, and a blob can be too large to read through gitlab_get; read the file with :repo/contents/<path> instead';

  test("a guarded word hidden by blanks, invisibles, marks or compatibility forms is refused with the word", async () => {
    const cases: Array<[string, string]> = [
      [":repo/actions/secrets%20", "secrets"],
      [":repo/actions/%20secrets", "secrets"],
      [":repo/hooks%C2%A0", "hooks"],
      [":repo/actions/sec%E2%80%8Brets", "secrets"],
      [":repo/hooks%E2%80%AE", "hooks"],
      [":repo/hoo%C2%ADks", "hooks"],
      [":repo/%EF%BB%BFhooks", "hooks"],
      [":repo/actions/secrets%CC%81", "secrets"],
      [":repo/actions/s%CD%8Fecrets", "secrets"],
      [":repo/actions/%C5%BFecrets", "secrets"],
      [":repo/%E2%84%AAeys", "keys"],
      [":repo/actions/%EF%BD%93%EF%BD%85%EF%BD%83%EF%BD%92%EF%BD%85%EF%BD%94%EF%BD%93", "secrets"],
      [":repo/actions/secrets%20.json", "secrets"],
      [":repo/actions/oidc%E2%80%8B/customization/sub", "actions/oidc"],
      [":repo/actions%20/oidc/customization/sub", "actions/oidc"],
      [":repo/actions/%20/oidc/customization/sub", "actions/oidc"],
      [":repo/actions/%E2%80%8B/oidc/customization/sub", "actions/oidc"],
      [":repo/actions%EF%BC%8Foidc/customization/sub", "actions/oidc"],
    ];
    for (const [path, word] of cases) await refusedOnWire(path, githubWordRefusal(word));
  });

  test("the copilot route hidden by blanks, marks, a suffix or a fullwidth slash is refused with the route text", async () => {
    for (const path of [
      ":repo/%E2%80%8Bcopilot/cloud-agent/configuration", ":repo/%20/copilot/cloud-agent/configuration",
      ":repo/%CC%81/copilot/code-review/settings", ":repo/copilot.json/cloud-agent/configuration",
      ":repo/copilot%EF%BC%8Fcloud-agent/configuration",
    ]) {
      await refusedOnWire(path, githubRouteRefusal("copilot"));
    }
  });

  test("every guarded word and route padded at the end is refused with its own text", async () => {
    const words = GITHUB_REFUSED_SEGMENTS.filter((entry) => !entry.includes("/"));
    for (const pad of ["%20", "%E2%80%8B", "%CC%81", "%E3%85%A4"]) {
      for (const word of words) await refusedOnWire(`:repo/${word}${pad}`, githubWordRefusal(word));
      for (const word of GITHUB_REFUSED_ROUTES) await refusedOnWire(`:repo/${word}${pad}`, githubRouteRefusal(word));
    }
  });

  test("a dot part or dot lookalike in the window is refused as a dot segment", async () => {
    for (const path of [":repo/actions/.%E2%80%8B/oidc/customization/sub", ":repo/%EF%BC%8E%EF%BC%8E/pulls", ":repo/%EF%BC%8E%EF%BC%8E/hooks"]) {
      await refusedOnWire(path, dotError);
    }
  });

  test("a character whose NFKD form adds a separator is refused as a plain-path error", async () => {
    for (const path of [
      ":repo/contents/..%EF%BC%BChooks", ":repo/actions%EF%BC%BCoidc/customization/sub", ":repo/contents/x%EF%BC%9B/a",
      ":repo/pulls%CD%BE", ":repo/contents/a%EF%BC%85b", ":repo/contents/a%EF%BC%9Fb", ":repo/contents/a%EF%BC%83b",
    ]) {
      await refusedOnWire(path, plainError);
    }
  });

  test("a decoded ? or # splits the window, so a guarded word or route before it is refused", async () => {
    const cases: Array<[string, string]> = [
      [":repo/hooks%3F", "hooks"],
      [":repo/hooks%23", "hooks"],
      [":repo/keys%3Fx", "keys"],
      [":repo/actions/secrets%23", "secrets"],
      [":repo/actions/variables%23", "variables"],
      [":repo/agents/variables%3F", "variables"],
    ];
    for (const [path, word] of cases) await refusedOnWire(path, githubWordRefusal(word));
    await refusedOnWire(":repo/copilot%3F/cloud-agent/configuration", githubRouteRefusal("copilot"));
  });

  test("git/blobs joined by a fullwidth slash is refused with the blobs text", async () => {
    await refusedOnWire(":repo/git%EF%BC%8Fblobs/abc", blobsError);
  });

  test("a projectPath that is not owner/name is refused with the repo shape text", async () => {
    for (const project of ["o/r/x", "o"]) await refusedOnWire(":repo/pulls", ruleOne.error, project);
  });

  test("spaced and accented names, escaped # and ?, and copilot off the route are read as sent", async () => {
    const cases: Array<[string, string, string]> = [
      [PROJECT, ":repo/labels/good%20first%20issue", "/repos/o/r/labels/good%20first%20issue"],
      [PROJECT, ":repo/labels/help%20wanted", "/repos/o/r/labels/help%20wanted"],
      [PROJECT, ":repo/readme/my%20docs", "/repos/o/r/readme/my%20docs"],
      [PROJECT, ":repo/actions/workflows/ci%20build.yml", "/repos/o/r/actions/workflows/ci%20build.yml"],
      [PROJECT, ":repo/labels/caf%C3%A9", "/repos/o/r/labels/caf%C3%A9"],
      [PROJECT, ":repo/contents/docs/C%23.md", "/repos/o/r/contents/docs/C%23.md"],
      [PROJECT, ":repo/contents/what%3F.md", "/repos/o/r/contents/what%3F.md"],
      [PROJECT, ":repo/labels/C%23", "/repos/o/r/labels/C%23"],
      [PROJECT, ":repo/labels/what%3F", "/repos/o/r/labels/what%3F"],
      [PROJECT, ":repo/commits/copilot/fix", "/repos/o/r/commits/copilot/fix"],
      [PROJECT, ":repo/git/ref/heads/copilot/x", "/repos/o/r/git/ref/heads/copilot/x"],
      ["acme/copilot", ":repo/pulls", "/repos/acme/copilot/pulls"],
    ];
    for (const [project, path, pathname] of cases) {
      const { result, sent: out } = await wire(project, path);
      expect(result, path).toMatchObject({ ok: true });
      expect(out, path).toHaveLength(1);
      expect(new URL(out[0]!.url).pathname, path).toBe(pathname);
      expect(out[0]!.redirect, path).toBe("manual");
    }
  });

  const readOnWire = async (path: string, pathnames: string[], projectPath = PROJECT) => {
    const { result, sent: out } = await wire(projectPath, path);
    expect(result, `${projectPath} ${path}`).toMatchObject({ ok: true });
    expect(out, `${projectPath} ${path}`).toHaveLength(1);
    expect(pathnames, `${projectPath} ${path}`).toContain(new URL(out[0]!.url).pathname);
    expect(out[0]!.redirect, `${projectPath} ${path}`).toBe("manual");
  };

  const CREDENTIAL_ROUTES: Array<[string, string]> = [
    ["actions/secrets", githubWordRefusal("secrets")],
    ["actions/secrets/public-key", githubWordRefusal("secrets")],
    ["actions/secrets/X", githubWordRefusal("secrets")],
    ["actions/variables", githubWordRefusal("variables")],
    ["actions/variables/X", githubWordRefusal("variables")],
    ["actions/organization-secrets", githubWordRefusal("organization-secrets")],
    ["actions/organization-variables", githubWordRefusal("organization-variables")],
    ["actions/oidc/customization/sub", githubWordRefusal("actions/oidc")],
    ["actions/runners", githubWordRefusal("runners")],
    ["actions/runners/downloads", githubWordRefusal("runners")],
    ["actions/runners/1", githubWordRefusal("runners")],
    ["agents/secrets", githubWordRefusal("secrets")],
    ["agents/secrets/X", githubWordRefusal("secrets")],
    ["agents/variables/X", githubWordRefusal("variables")],
    ["agents/organization-secrets", githubWordRefusal("organization-secrets")],
    ["agents/organization-variables", githubWordRefusal("organization-variables")],
    ["codespaces/secrets", githubWordRefusal("secrets")],
    ["codespaces/secrets/X", githubWordRefusal("secrets")],
    ["codespaces/devcontainers", githubWordRefusal("codespaces")],
    ["dependabot/secrets", githubWordRefusal("secrets")],
    ["dependabot/secrets/X", githubWordRefusal("secrets")],
    ["dependabot/runner-settings", githubWordRefusal("dependabot")],
    ["dependabot/alerts", githubWordRefusal("dependabot")],
    ["environments", githubWordRefusal("environments")],
    ["environments/prod/secrets", githubWordRefusal("secrets")],
    ["environments/prod/secrets/X", githubWordRefusal("secrets")],
    ["environments/prod/variables", githubWordRefusal("variables")],
    ["environments/prod/variables/X", githubWordRefusal("variables")],
    ["hooks", githubWordRefusal("hooks")],
    ["hooks/1", githubWordRefusal("hooks")],
    ["hooks/1/config", githubWordRefusal("hooks")],
    ["hooks/1/deliveries", githubWordRefusal("hooks")],
    ["hooks/1/deliveries/2", githubWordRefusal("hooks")],
    ["keys", githubWordRefusal("keys")],
    ["keys/1", githubWordRefusal("keys")],
    ["secret-scanning/alerts", githubWordRefusal("secret-scanning")],
    ["secret-scanning/alerts/1", githubWordRefusal("secret-scanning")],
    ["secret-scanning/alerts/1/locations", githubWordRefusal("secret-scanning")],
    ["secret-scanning/custom-patterns", githubWordRefusal("secret-scanning")],
    ["secret-scanning/scan-history", githubWordRefusal("secret-scanning")],
    ["security-advisories", githubWordRefusal("security-advisories")],
    ["private-vulnerability-reporting", githubWordRefusal("private-vulnerability-reporting")],
    ["invitations", githubWordRefusal("invitations")],
    ["autolinks", githubWordRefusal("autolinks")],
    ["autolinks/1", githubWordRefusal("autolinks")],
    ["copilot/cloud-agent/configuration", githubRouteRefusal("copilot")],
    ["copilot/code-review/settings", githubRouteRefusal("copilot")],
  ];
  const CREDENTIAL_REPOS = ["o/r", "acme/hooks", "acme/hooks.io", "acme/keys", "secrets/app", "acme/actions", "acme/environments", "acme/contents", "acme/copilot"];

  test("every credential route is refused on every repo shape, before any request", async () => {
    for (const repo of CREDENTIAL_REPOS) {
      for (const [row, error] of CREDENTIAL_ROUTES) await refusedOnWire(`:repo/${row}`, error, repo);
    }
  });

  test("a word in the repo's own name never hides the same word in the route", async () => {
    await refusedOnWire(":repo/hooks", githubWordRefusal("hooks"), "acme/hooks.io");
    await refusedOnWire(":repo/hooks/1/config", githubWordRefusal("hooks"), "acme/hooks.io");
    await refusedOnWire(":repo/actions/secrets", githubWordRefusal("secrets"), "secrets/app");
    await refusedOnWire(":repo/actions/oidc/customization/sub", githubWordRefusal("actions/oidc"), "acme/actions");
    await refusedOnWire(":repo/hooks", githubWordRefusal("hooks"), "acme/contents");
    await refusedOnWire(":repo/actions/secrets", githubWordRefusal("secrets"), "acme/contents");
    await refusedOnWire(":repo/copilot/cloud-agent/configuration", githubRouteRefusal("copilot"), "acme/copilot");
  });

  test("a file path after :repo/contents/ is read whatever its name", async () => {
    const cases: Array<[string, string[]]> = [
      [":repo/contents/src/hooks/useAuth.ts", ["/repos/o/r/contents/src/hooks/useAuth.ts"]],
      [":repo/contents/secrets.md", ["/repos/o/r/contents/secrets.md"]],
      [":repo/contents/infra/variables.tf", ["/repos/o/r/contents/infra/variables.tf"]],
      [":repo/contents/keys/README.md", ["/repos/o/r/contents/keys/README.md"]],
      [":repo/contents/Actions/Secrets", ["/repos/o/r/contents/Actions/Secrets"]],
      [":repo/contents/git/blobs/x", ["/repos/o/r/contents/git/blobs/x"]],
      [":repo/contents/docs%2Fhooks.md", ["/repos/o/r/contents/docs%2Fhooks.md"]],
      [":repo/contents/a%20b.md", ["/repos/o/r/contents/a%20b.md"]],
      [":repo/contents/a%E2%80%8Bb.md", ["/repos/o/r/contents/a%E2%80%8Bb.md"]],
      [":repo/contents/a/b/secrets.tf.json", ["/repos/o/r/contents/a/b/secrets.tf.json"]],
      [":repo/contents", ["/repos/o/r/contents"]],
      [":repo/contents/", ["/repos/o/r/contents", "/repos/o/r/contents/"]],
      [":repo/contents/..%E2%84%80hooks", ["/repos/o/r/contents/..%E2%84%80hooks"]],
    ];
    for (const [path, pathnames] of cases) await readOnWire(path, pathnames);
  });

  test("every guarded word and route is read as a file name or folder", async () => {
    for (const entry of [...GITHUB_REFUSED_SEGMENTS, ...GITHUB_REFUSED_ROUTES]) {
      await readOnWire(`:repo/contents/${entry}`, [`/repos/o/r/contents/${entry}`]);
      await readOnWire(`:repo/contents/dir/${entry}.md`, [`/repos/o/r/contents/dir/${entry}.md`]);
    }
  });

  test("a repo whose owner or name is a guarded word is read", async () => {
    for (const repo of ["acme/keys", "acme/hooks.io", "secrets/app", "acme/contents"]) {
      await readOnWire(":repo", [`/repos/${repo}`], repo);
      await readOnWire(":repo/pulls", [`/repos/${repo}/pulls`], repo);
    }
    await readOnWire(":repo/contents/README.md", ["/repos/acme/contents/contents/README.md"], "acme/contents");
    await readOnWire(":repo/oidc/customization/sub", ["/repos/acme/actions/oidc/customization/sub"], "acme/actions");
    await readOnWire(":repo/oidc/x", ["/repos/acme/actions/oidc/x"], "acme/actions");
    await readOnWire(":repo/blobs/x", ["/repos/acme/git/blobs/x"], "acme/git");
  });

  test("contents counts only as the literal fourth raw segment; anything else is matched strictly", async () => {
    for (const path of [
      ":repo/Contents/hooks", ":repo/%63ontents/hooks", ":repo/contents.json/hooks", ":repo/contents%2Fhooks", ":repo/readme/hooks",
      ":repo/git/ref/heads/feature/hooks", ":repo/commits/hooks",
    ]) {
      await refusedOnWire(path, githubWordRefusal("hooks"));
    }
    await refusedOnWire(":repo/actions/contents/secrets", githubWordRefusal("secrets"));
  });

  test("a dot part or dot lookalike in a file path is refused as a dot segment", async () => {
    for (const path of [
      ":repo/contents/..%20/hooks", ":repo/contents/%EF%BC%8E%EF%BC%8E/hooks", ":repo/contents/..%EF%BB%BF/hooks", ":repo/contents/..%E2%80%8B/hooks",
      ":repo/contents/..%EF%BC%8Fhooks", ":repo/contents/%EF%BC%8E%EF%BC%8E%EF%BC%8Fhooks", ":repo/contents/%E2%80%A5%EF%BC%8Fhooks",
      ":repo/contents/../hooks", ":repo/contents/%2e%2e/hooks",
    ]) {
      await refusedOnWire(path, dotError);
    }
    await refusedOnWire(":repo/contents/%252e%252e/hooks", '"path" must not be percent-encoded more than once');
  });

  test("the whole-path checks still run inside a file path", async () => {
    await refusedOnWire(":repo/contents/x;/../hooks", dotError);
    await refusedOnWire(":repo/contents/{x}", '"path" must not contain { or }');
    await refusedOnWire(":repo/contents/a%5Cb", plainError);
    await refusedOnWire(":repo/contents/a b", '"path" must not contain whitespace; send a space in a file name as %20');
    await refusedOnWire(":repo/hooks%09", plainError);
  });

  test("the repo segments must be spelled plainly as repos/<owner>/<name>", async () => {
    for (const path of ["Repos/o/r/contents/hooks", "repos/o%2Fr/pulls", "repos/o/%72/pulls", "repos/%4F/r/pulls"]) {
      await refusedOnWire(path, ruleTwo.error);
    }
    await refusedOnWire("repos/Kcme/r/pulls", ruleTwo.error, "kcme/r");
    await refusedOnWire("repos/%E2%84%AAcme/r/pulls", ruleTwo.error, "kcme/r");
  });

  test("words and the route are matched before git/blobs", async () => {
    await refusedOnWire(":repo/copilot/git/blobs/x", githubRouteRefusal("copilot"));
    await refusedOnWire(":repo/secrets/git/blobs/x", githubWordRefusal("secrets"));
  });

  test("a 302 from a contents read is refused naming only the host", async () => {
    reply = () => new Response(null, { status: 302, headers: { location: "https://raw.example.net/o/r/main/big.bin?token=secret" } });
    const { result, sent: out } = await wire(PROJECT, ":repo/contents/big.bin");
    expect(result).toEqual({ ok: false, error: "gitlab_get does not follow redirects: GitHub answered 302 redirecting to raw.example.net" });
    expect(out).toHaveLength(1);
  });
});

describe("matchingWindow", () => {
  test("splits skeletons on slashes, backslashes, ? and # and drops empty parts", () => {
    const segments = ["repos", "o", "r", "actions\uFF0Foidc", " ", "\u200B", "x\\y", "hooks?", "keys#z", ""];
    expect(matchingWindow(segments, 3, segments.length)).toEqual({ ok: true, parts: ["actions", "oidc", "x", "y", "hooks", "keys", "z"] });
  });

  test("refuses a part that is a dot or two after folding", () => {
    for (const seg of [".\u200B", "\uFF0E\uFF0E", "\u2024"]) {
      expect(matchingWindow(["repos", "o", "r", seg], 3, 4), JSON.stringify(seg)).toEqual({ ok: false, error: '"path" must not contain dot segments' });
    }
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

describe("checkGithubForgePath C1 controls", () => {
  test("refuses a C1 control character, raw or decoded", () => {
    const plain = { ok: false as const, error: '"path" must be a plain API path; pass query values in "query"' };
    for (const path of [":repo/hooks%C2%85", ":repo/actions/secrets%C2%85", ":repo/contents/a%C2%85b", ":repo/pulls%C2%9F"]) {
      expect(check(path), path).toEqual(plain);
    }
  });
});

describe("wordSkeleton and foldsToSeparator", () => {
  test("wordSkeleton folds blanks, invisibles, marks and compatibility forms", () => {
    for (const s of ["secrets ", "sec\u200Brets", "\uFF53\uFF45\uFF43\uFF52\uFF45\uFF54\uFF53", "secrets\u0301", "s\u034Fecrets", "\u017Fecrets", "SECRETS", "secrets\u3164"]) {
      expect(wordSkeleton(s), JSON.stringify(s)).toBe("secrets");
    }
    expect(wordSkeleton("\u212Aeys")).toBe("keys");
    expect(wordSkeleton("good first issue")).toBe("goodfirstissue");
    expect(wordSkeleton("secrets .json")).toBe("secrets.json");
    expect(wordSkeleton("actions\uFF0Foidc")).toBe("actions/oidc");
    expect(wordSkeleton("actions\uFF3Coidc")).toBe("actions\\oidc");
    expect(wordSkeleton("\u200B")).toBe("");
    expect(wordSkeleton(" ")).toBe("");
    expect(wordSkeleton("\u0455ecrets")).not.toBe("secrets");
  });

  test("dotSkeleton keeps case but folds dots", () => {
    for (const s of [".. ", "\uFF0E\uFF0E", "..\uFEFF", "..\u200B"]) expect(dotSkeleton(s), JSON.stringify(s)).toBe("..");
    expect(dotSkeleton("\u2025\uFF0Fhooks")).toBe("../hooks");
  });

  test("foldsToSeparator is true only when a code point folds to ; % ? # or a backslash", () => {
    for (const s of ["x\uFF1B", "\u037E", "a\uFF05b", "a\uFF1Fb", "a\uFF03b", "..\uFF3Chooks", "\uFE68"]) expect(foldsToSeparator(s), JSON.stringify(s)).toBe(true);
    for (const s of ["docs/C#.md", "what?.md", "a;b", "caf\u00E9", "a\uFF0Fb"]) expect(foldsToSeparator(s), JSON.stringify(s)).toBe(false);
  });
});
