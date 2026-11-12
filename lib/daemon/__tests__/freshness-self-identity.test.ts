import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as githubTokenModule from "../../github-token.ts";
import * as linearModule from "../../linear.ts";
import * as teamSettings from "../../setup/team-settings.ts";
import type { RepoTracking } from "../../repo-tracking.ts";
import {
  __test__ as freshnessTest,
  cachedSelfUsername,
  disposeFreshness,
  getRepoContext,
  getSelfIds,
  isGitHubRepo,
  resolveGitHubSelfLogin,
  resolveSelfUsername,
  resolveUserIdAcrossTracking,
} from "../freshness.ts";

const GITLAB_TOKEN = "glpat-self-secret";

let requests: string[];
let spies: { mockRestore(): void }[];
let secrets: { gitlabToken?: string; githubToken?: string };
let githubUserStatus: number;
let warnings: string[];
let restoreLog: () => void;
let repoCounter = 0;

function repoWithOrigin(origin: string): { name: string; path: string } {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "rt-self-identity-")));
  execFileSync("git", ["init", "-q"], { cwd: path, stdio: "pipe" });
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: path, stdio: "pipe" });
  return { name: `self-identity-repo-${++repoCounter}`, path };
}

function tracked(...repos: { name: string; path: string }[]): [Record<string, string>, RepoTracking] {
  const index: Record<string, string> = {};
  const tracking: RepoTracking = {};
  for (const r of repos) {
    index[r.name] = r.path;
    tracking[r.name] = { mode: "poll", caches: ["branches"] };
  }
  return [index, tracking];
}

function githubUserReads(): number {
  return requests.filter((u) => u === "https://api.github.com/user").length;
}

beforeEach(() => {
  disposeFreshness();
  requests = [];
  secrets = {};
  githubUserStatus = 200;
  warnings = [];
  const record = (...args: unknown[]) => {
    const msg = args.find((a): a is string => typeof a === "string");
    if (msg !== undefined) warnings.push(msg);
  };
  restoreLog = freshnessTest.swapLog({ info: () => {}, debug: () => {}, error: () => {}, warn: record });
  spies = [
    spyOn(linearModule, "loadSecrets").mockImplementation((async () => ({ ...secrets })) as never),
    spyOn(githubTokenModule, "resolveGithubToken"),
    spyOn(teamSettings, "readUserIntegrationOverrides").mockImplementation(() => ({ forgeHost: undefined })),
    spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      const github = url.startsWith("https://api.github.com/");
      const status = github ? githubUserStatus : 200;
      const body = status !== 200 ? { message: "Bad credentials" } : github ? { id: 9, login: "octo" } : { id: 7, username: "gl-me" };
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  restoreLog();
  disposeFreshness();
});

describe("your identity on each forge", () => {
  test("getSelfIds reports the GitHub id after resolution", async () => {
    secrets = { githubToken: "ghp_x" };
    const hub = repoWithOrigin("git@github.com:acme/widgets.git");
    await resolveUserIdAcrossTracking(...tracked(hub));
    expect(getSelfIds()).toEqual({ gitlab: null, github: 9 });
    expect(githubUserReads()).toBe(1);
  });

  test("resolves GitHub after GitLab is already resolved", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN, githubToken: "ghp_x" };
    const lab = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    const hub = repoWithOrigin("git@github.com:acme/widgets.git");
    await resolveUserIdAcrossTracking(...tracked(lab, hub));
    expect(getSelfIds()).toEqual({ gitlab: 7, github: 9 });
  });

  test("a failed GitHub read is retried; a success is not re-read", async () => {
    secrets = { githubToken: "ghp_x" };
    const a = repoWithOrigin("git@github.com:acme/one.git");
    const b = repoWithOrigin("git@github.com:acme/two.git");
    const args = tracked(a, b);
    githubUserStatus = 401;
    await resolveUserIdAcrossTracking(...args);
    expect(getSelfIds().github).toBeNull();
    expect(githubUserReads()).toBe(1);

    githubUserStatus = 200;
    await resolveUserIdAcrossTracking(...args);
    expect(getSelfIds().github).toBe(9);
    expect(githubUserReads()).toBe(2);

    await resolveUserIdAcrossTracking(...args);
    expect(githubUserReads()).toBe(2);
  });

  test("two tracked GitHub repos sharing a token read /user once", async () => {
    secrets = { githubToken: "ghp_x" };
    const a = repoWithOrigin("git@github.com:acme/one.git");
    const b = repoWithOrigin("git@github.com:acme/two.git");
    await resolveUserIdAcrossTracking(...tracked(a, b));
    await resolveSelfUsername(b.name, b.path);
    expect(githubUserReads()).toBe(1);
  });

  test("a GitHub-only Mac never logs the GitLab warning", async () => {
    secrets = { githubToken: "ghp_x" };
    githubUserStatus = 401;
    const hub = repoWithOrigin("git@github.com:acme/widgets.git");
    const args = tracked(hub);
    await resolveUserIdAcrossTracking(...args);
    const githubWarnings = () => warnings.filter((w) => w.includes("which GitHub user you are") && w.includes("rt setup github connect"));
    expect(githubWarnings()).toHaveLength(1);
    expect(warnings.some((w) => w.includes("userId is unresolved"))).toBe(false);

    await resolveUserIdAcrossTracking(...args);
    expect(githubWarnings()).toHaveLength(1);
    expect(warnings.some((w) => w.includes("userId is unresolved"))).toBe(false);
  });

  test("a new token re-reads the GitHub user", async () => {
    secrets = { githubToken: "ghp_a" };
    const hub = repoWithOrigin("git@github.com:acme/widgets.git");
    const args = tracked(hub);
    await resolveUserIdAcrossTracking(...args);
    expect(getSelfIds().github).toBe(9);

    secrets = { githubToken: "ghp_b" };
    await getRepoContext(hub.name, hub.path);
    expect(getSelfIds().github).toBeNull();
    expect(githubUserReads()).toBe(1);

    await resolveUserIdAcrossTracking(...args);
    expect(getSelfIds().github).toBe(9);
    expect(githubUserReads()).toBe(2);
  });

  test("cachedSelfUsername returns the GitHub login for a GitHub repo and the GitLab username for a GitLab one", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN, githubToken: "ghp_x" };
    const lab = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    const hub = repoWithOrigin("git@github.com:acme/widgets.git");
    await resolveUserIdAcrossTracking(...tracked(lab, hub));
    expect(await cachedSelfUsername(hub.name, hub.path)).toBe("octo");
    expect(await cachedSelfUsername(lab.name, lab.path)).toBe("gl-me");
  });

  test("cachedSelfUsername never gives a GitHub repo the GitLab name", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN, githubToken: "ghp_x" };
    const lab = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    const hub = repoWithOrigin("git@github.com:acme/widgets.git");
    await resolveUserIdAcrossTracking(...tracked(lab));
    expect(await cachedSelfUsername(lab.name, lab.path)).toBe("gl-me");
    const before = requests.length;
    expect(await cachedSelfUsername(hub.name, hub.path)).toBeNull();
    expect(requests.length).toBe(before);
  });

  test("an empty repo path takes the GitLab username path", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN, githubToken: "ghp_x" };
    const lab = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    const hub = repoWithOrigin("git@github.com:acme/widgets.git");
    await resolveUserIdAcrossTracking(...tracked(lab, hub));
    expect(await isGitHubRepo("")).toBe(false);
    expect(await cachedSelfUsername(lab.name, "")).toBe("gl-me");
  });

  test("resolveSelfUsername on a GitHub repo returns the login", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN, githubToken: "ghp_x" };
    const hub = repoWithOrigin("git@github.com:acme/widgets.git");
    expect(await resolveSelfUsername(hub.name, hub.path)).toBe("octo");
    expect(requests.filter((u) => new URL(u).host !== "api.github.com")).toEqual([]);
  });

  test("resolveGitHubSelfLogin on a GitHub repo returns the login", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN, githubToken: "ghp_x" };
    const hub = repoWithOrigin("git@github.com:acme/widgets.git");
    expect(await resolveGitHubSelfLogin(hub.name, hub.path)).toBe("octo");
    expect(requests.filter((u) => new URL(u).host !== "api.github.com")).toEqual([]);
  });

  test("resolveGitHubSelfLogin never answers with the GitLab username", async () => {
    secrets = { gitlabToken: GITLAB_TOKEN, githubToken: "ghp_x" };
    const lab = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    await resolveUserIdAcrossTracking(...tracked(lab));
    expect(await cachedSelfUsername(lab.name, lab.path)).toBe("gl-me");
    expect(await resolveGitHubSelfLogin(lab.name, lab.path)).toBeNull();
    expect(await resolveGitHubSelfLogin(lab.name, "")).toBeNull();
  });
});
