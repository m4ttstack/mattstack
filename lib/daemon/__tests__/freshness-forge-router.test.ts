import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as githubTokenModule from "../../github-token.ts";
import * as linearModule from "../../linear.ts";
import * as teamSettings from "../../setup/team-settings.ts";
import { getCurrentUserId, getGitLabContext, getRepoContext, getSelfUserId, repositoryIdFor } from "../freshness.ts";

const GITLAB_TOKEN = "glpat-router-secret";
const GITHUB_TOKEN = "ghp_router_secret";

type Sent = { url: string; headers: Record<string, string> };

let requests: Sent[];
let spies: { mockRestore(): void }[];
let secrets: { gitlabToken?: string; githubToken?: string };
let forgeHost: string | undefined;
let loadSecretsSpy: ReturnType<typeof spyOn>;
let resolveGithubSpy: ReturnType<typeof spyOn>;
let repoCounter = 0;
let githubUserStatus: number;

function repoWithOrigin(origin: string): { name: string; path: string } {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "rt-forge-router-")));
  execFileSync("git", ["init", "-q"], { cwd: path, stdio: "pipe" });
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: path, stdio: "pipe" });
  return { name: `forge-router-repo-${++repoCounter}`, path };
}

function headerValues(sent: Sent): string {
  return Object.values(sent.headers).join("\n");
}

beforeEach(() => {
  requests = [];
  secrets = {};
  forgeHost = undefined;
  githubUserStatus = 200;
  loadSecretsSpy = spyOn(linearModule, "loadSecrets").mockImplementation((async () => ({ ...secrets })) as never);
  resolveGithubSpy = spyOn(githubTokenModule, "resolveGithubToken");
  spies = [
    loadSecretsSpy,
    resolveGithubSpy,
    spyOn(teamSettings, "readUserIntegrationOverrides").mockImplementation(() => ({ forgeHost })),
    spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const headers: Record<string, string> = {};
      new Headers(input instanceof Request ? input.headers : init?.headers).forEach((v, k) => { headers[k] = v; });
      requests.push({ url, headers });
      const github = url.startsWith("https://api.github.com/");
      const status = github ? githubUserStatus : 200;
      const body = status !== 200 ? { message: "Bad credentials" } : github ? { id: 9, login: "octo" } : { id: 7 };
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

describe("getRepoContext picks the forge from the repo's remote", () => {
  test("a github.com remote returns a GitHub context with no project id", async () => {
    secrets = { githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    const ctx = await getRepoContext(repo.name, repo.path);
    expect(ctx.forge).toBe("github");
    expect(ctx.projectId).toBeNull();
    expect(ctx.projectPath).toBe("acme/widgets");
    expect(ctx.provider.providerName).toBe("github");
    expect(requests).toEqual([]);
    expect(resolveGithubSpy).toHaveBeenCalled();
  });

  test("a project path override wins over the remote on GitHub", async () => {
    secrets = { githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("https://github.com/acme/widgets.git");
    const ctx = await getRepoContext(repo.name, repo.path, "acme/renamed");
    expect(ctx.projectPath).toBe("acme/renamed");
  });

  test("two calls share one GitHub provider", async () => {
    secrets = { githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    const first = await getRepoContext(repo.name, repo.path);
    const second = await getRepoContext(repo.name, repo.path);
    expect(second.provider).toBe(first.provider);
  });

  test("a changed GitHub token builds a new provider", async () => {
    secrets = { githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    const first = await getRepoContext(repo.name, repo.path);
    secrets = { githubToken: "ghp_rotated" };
    const second = await getRepoContext(repo.name, repo.path);
    expect(second.provider).not.toBe(first.provider);

    await second.provider.validateToken();
    expect(requests.map((r) => r.url)).toEqual(["https://api.github.com/user"]);
    expect(headerValues(requests[0]!)).toContain("ghp_rotated");
    expect(headerValues(requests[0]!)).not.toContain(GITHUB_TOKEN);
  });

  test("no GitHub token throws the setup hint", async () => {
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    await expect(getRepoContext(repo.name, repo.path)).rejects.toThrow("missing GitHub token (run: rt setup github connect)");
    expect(requests).toEqual([]);
  });

  test("a GitHub token that disappears is not reused", async () => {
    secrets = { githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    await getRepoContext(repo.name, repo.path);
    secrets = {};
    await expect(getRepoContext(repo.name, repo.path)).rejects.toThrow("missing GitHub token (run: rt setup github connect)");
  });

  test("each token goes only to its own forge's host", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN, githubToken: GITHUB_TOKEN };
    const hub = repoWithOrigin("git@github.com:acme/widgets.git");
    const lab = repoWithOrigin("git@gitlab.com:acme/widgets.git");

    const hubCtx = await getRepoContext(hub.name, hub.path);
    await hubCtx.provider.validateToken();
    const labCtx = await getRepoContext(lab.name, lab.path);
    expect(labCtx.forge).toBe("gitlab");

    const toGithub = requests.filter((r) => new URL(r.url).host === "api.github.com");
    const toGitlab = requests.filter((r) => new URL(r.url).host === "gitlab.com");
    expect(toGithub.length).toBeGreaterThan(0);
    expect(toGitlab.length).toBeGreaterThan(0);
    expect(toGithub.length + toGitlab.length).toBe(requests.length);
    for (const r of toGithub) {
      expect(headerValues(r)).toContain(GITHUB_TOKEN);
      expect(headerValues(r)).not.toContain(GITLAB_TOKEN);
    }
    for (const r of toGitlab) {
      expect(r.headers["private-token"]).toBe(GITLAB_TOKEN);
      expect(headerValues(r)).not.toContain(GITHUB_TOKEN);
    }
  });

  test("a gitlab.com remote never resolves a GitHub token", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN, githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    await getRepoContext(repo.name, repo.path);
    expect(resolveGithubSpy).not.toHaveBeenCalled();
  });

  test("a bitbucket.org remote is refused as today and reads no token", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN, githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("git@bitbucket.org:acme/widgets.git");
    await expect(getRepoContext(repo.name, repo.path)).rejects.toThrow(
      "unsupported: bitbucket.org is not a configured GitLab host (run: rt setup gitlab connect --host bitbucket.org)",
    );
    expect(requests).toEqual([]);
    expect(loadSecretsSpy).not.toHaveBeenCalled();
    expect(resolveGithubSpy).not.toHaveBeenCalled();
  });

  test("getGitLabContext refuses a GitHub repo", async () => {
    secrets = { githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    await expect(getGitLabContext("threads", repo.name, repo.path)).rejects.toThrow("unsupported: threads needs a GitLab repo");
    expect(requests).toEqual([]);
  });

  test("getGitLabContext refuses a GitHub repo with no GitHub token before reading one", async () => {
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    await expect(getGitLabContext("threads", repo.name, repo.path)).rejects.toThrow("unsupported: threads needs a GitLab repo");
    expect(resolveGithubSpy).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  test("getGitLabContext passes a GitLab context through", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN };
    const repo = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    const ctx = await getGitLabContext("threads", repo.name, repo.path);
    expect(ctx.projectId).toBe(7);
  });

  test("a gitlab.com remote returns today's GitLab context", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN };
    const repo = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    const ctx = await getRepoContext(repo.name, repo.path);
    expect(ctx).toMatchObject({ forge: "gitlab", projectPath: "acme/widgets", projectId: 7 });
    expect(ctx.provider.providerName).toBe("gitlab");
    expect(requests.map((r) => [r.url, r.headers["private-token"]])).toEqual([
      ["https://gitlab.com/api/v4/projects/acme%2Fwidgets", GITLAB_TOKEN],
    ]);
  });

  test("a confirmed self-managed GitLab host keeps working", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN };
    forgeHost = "git.acme.internal";
    const repo = repoWithOrigin("git@git.acme.internal:acme/widgets.git");
    const ctx = await getRepoContext(repo.name, repo.path);
    expect(ctx).toMatchObject({ forge: "gitlab", projectPath: "acme/widgets", projectId: 7 });
    expect(requests.map((r) => [r.url, r.headers["private-token"]])).toEqual([
      ["https://git.acme.internal/api/v4/projects/acme%2Fwidgets", GITLAB_TOKEN],
    ]);
  });

  test("an origin added after a failed lookup is picked up", async () => {
    secrets = { githubToken: GITHUB_TOKEN };
    const path = realpathSync(mkdtempSync(join(tmpdir(), "rt-forge-router-")));
    execFileSync("git", ["init", "-q"], { cwd: path, stdio: "pipe" });
    const name = `forge-router-repo-${++repoCounter}`;
    await expect(getRepoContext(name, path)).rejects.toThrow();
    execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/late.git"], { cwd: path, stdio: "pipe" });
    const ctx = await getRepoContext(name, path);
    expect(ctx.forge).toBe("github");
    expect(ctx.projectPath).toBe("acme/late");
  });
});

describe("repositoryIdFor", () => {
  test("names a GitHub repo by owner and name", async () => {
    secrets = { githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    expect(repositoryIdFor(await getRepoContext(repo.name, repo.path))).toBe("github:acme/widgets");
  });

  test("names a GitLab repo by its numeric project id", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN };
    const repo = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    expect(repositoryIdFor(await getRepoContext(repo.name, repo.path))).toBe("gitlab:7");
  });
});

describe("getSelfUserId", () => {
  test("on GitHub reads /user once per provider and again after the token changes", async () => {
    secrets = { githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    expect(await getSelfUserId(await getRepoContext(repo.name, repo.path))).toBe(9);
    expect(await getSelfUserId(await getRepoContext(repo.name, repo.path))).toBe(9);
    expect(requests.map((r) => r.url)).toEqual(["https://api.github.com/user"]);

    secrets = { githubToken: "ghp_rotated" };
    expect(await getSelfUserId(await getRepoContext(repo.name, repo.path))).toBe(9);
    expect(requests.map((r) => r.url)).toEqual(["https://api.github.com/user", "https://api.github.com/user"]);
    expect(headerValues(requests[1]!)).toContain("ghp_rotated");
  });

  test("on GitHub a failed /user read returns null and is tried again next time", async () => {
    secrets = { githubToken: GITHUB_TOKEN };
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    const ctx = await getRepoContext(repo.name, repo.path);
    githubUserStatus = 401;
    expect(await getSelfUserId(ctx)).toBeNull();
    githubUserStatus = 200;
    expect(await getSelfUserId(ctx)).toBe(9);
    expect(requests.map((r) => r.url)).toEqual(["https://api.github.com/user", "https://api.github.com/user"]);
  });

  test("on GitLab returns the resolved user id with no request", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN };
    const repo = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    const ctx = await getRepoContext(repo.name, repo.path);
    const before = requests.length;
    expect(await getSelfUserId(ctx)).toBe(getCurrentUserId());
    expect(requests.length).toBe(before);
  });
});
