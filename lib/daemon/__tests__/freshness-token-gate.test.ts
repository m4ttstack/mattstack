import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as linearModule from "../../linear.ts";
import * as teamSettings from "../../setup/team-settings.ts";
import { getRepoContext } from "../freshness.ts";

let requests: { url: string; token: string | null }[];
let spies: { mockRestore(): void }[];
let repoCounter = 0;

function repoWithOrigin(origin: string): { name: string; path: string } {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "rt-token-gate-")));
  execSync(`git init -q && git remote add origin ${origin}`, { cwd: path, shell: "/bin/zsh", stdio: "pipe" });
  return { name: `token-gate-repo-${++repoCounter}`, path };
}

function stub(gitlabToken: string | undefined, forgeHost?: string): void {
  spies.push(spyOn(linearModule, "loadSecrets").mockResolvedValue({ gitlabToken } as never));
  spies.push(spyOn(teamSettings, "readUserIntegrationOverrides").mockReturnValue({ forgeHost }));
}

beforeEach(() => {
  requests = [];
  spies = [
    spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), token: headers.get("PRIVATE-TOKEN") });
      return new Response(JSON.stringify({ id: 7 }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

describe("getRepoContext only offers the GitLab token to a GitLab host", () => {
  test("a github.com origin is refused and no request leaves", async () => {
    stub("glpat-secret");
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    await expect(getRepoContext(repo.name, repo.path)).rejects.toThrow("unsupported: github.com is not a configured GitLab host");
    expect(requests).toEqual([]);
  });

  test("a github.com origin stays refused when github.com is the confirmed host", async () => {
    stub("glpat-secret", "github.com");
    const repo = repoWithOrigin("https://github.com/acme/widgets.git");
    await expect(getRepoContext(repo.name, repo.path)).rejects.toThrow("unsupported: github.com");
    expect(requests).toEqual([]);
  });

  test("a github.com origin with no GitLab token gets the same refusal, not a request to add one", async () => {
    stub(undefined);
    const repo = repoWithOrigin("git@github.com:acme/widgets.git");
    await expect(getRepoContext(repo.name, repo.path)).rejects.toThrow("unsupported: github.com is not a configured GitLab host");
    expect(requests).toEqual([]);
  });

  test("a gitlab-looking host nobody confirmed is refused and no request leaves", async () => {
    stub("glpat-secret", "gitlab.acme.internal");
    const repo = repoWithOrigin("https://gitlab.evil.example/acme/widgets.git");
    await expect(getRepoContext(repo.name, repo.path)).rejects.toThrow("rt setup gitlab connect --host gitlab.evil.example");
    expect(requests).toEqual([]);
  });

  test("gitlab.com needs no confirmation", async () => {
    stub("glpat-secret");
    const repo = repoWithOrigin("git@gitlab.com:acme/widgets.git");
    const ctx = await getRepoContext(repo.name, repo.path);
    expect(ctx.projectId).toBe(7);
    expect(requests).toEqual([{ url: "https://gitlab.com/api/v4/projects/acme%2Fwidgets", token: "glpat-secret" }]);
  });

  test("a confirmed self-managed host receives the token", async () => {
    stub("glpat-secret", "git.acme.internal");
    const repo = repoWithOrigin("git@git.acme.internal:acme/widgets.git");
    const ctx = await getRepoContext(repo.name, repo.path);
    expect(ctx.projectId).toBe(7);
    expect(requests).toEqual([{ url: "https://git.acme.internal/api/v4/projects/acme%2Fwidgets", token: "glpat-secret" }]);
  });
});
