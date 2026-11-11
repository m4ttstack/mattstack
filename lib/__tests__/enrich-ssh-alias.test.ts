import { afterEach, describe, expect, test } from "bun:test";
import { forgeTokenFor, isGitHubRemote, isGitLabRemote, parseRemoteUrl, resolveSshAlias, setSshHostResolver } from "../enrich.ts";
import { mayOfferGitLabToken } from "../team/forge-token.ts";

const sshConfig: Record<string, string> = {
  "work-github": "github.com",
  "github.com-work": "github.com",
  "work-gitlab": "gitlab.example.com",
  "lan-box": "10.0.0.7",
  "ops@by-user": "github.com",
};

const calls: string[] = [];

/** Stands in for `ssh -G`, which echoes an unconfigured alias back as its own hostname. */
async function fakeSsh(alias: string, user: string | null): Promise<string | null> {
  const key = user ? `${user}@${alias}` : alias;
  calls.push(key);
  return sshConfig[key] ?? sshConfig[alias] ?? alias;
}

async function parsed(url: string) {
  await resolveSshAlias(url);
  return parseRemoteUrl(url);
}

afterEach(() => {
  setSshHostResolver(null);
  calls.length = 0;
});

describe("ssh alias remotes", () => {
  test("an alias for github.com resolves to GitHub", async () => {
    setSshHostResolver(fakeSsh);
    expect(await parsed("git@work-github:acme/widgets.git")).toEqual({ host: "https://github.com", projectPath: "acme/widgets" });
    await resolveSshAlias("git@github.com-work:acme/widgets.git");
    await resolveSshAlias("ssh://git@work-github/acme/widgets.git");
    expect(isGitHubRemote("git@work-github:acme/widgets.git")).toBe(true);
    expect(isGitHubRemote("git@github.com-work:acme/widgets.git")).toBe(true);
    expect(isGitHubRemote("ssh://git@work-github/acme/widgets.git")).toBe(true);
  });

  test("an alias for a GitLab host resolves to GitLab", async () => {
    setSshHostResolver(fakeSsh);
    expect(await parsed("git@work-gitlab:team/app.git")).toEqual({ host: "https://gitlab.example.com", projectPath: "team/app" });
    expect(isGitLabRemote("git@work-gitlab:team/app.git")).toBe(true);
    expect(isGitHubRemote("git@work-gitlab:team/app.git")).toBe(false);
  });

  test("an alias with no ssh config entry stays an unknown forge", async () => {
    setSshHostResolver(fakeSsh);
    expect(await parsed("git@mystery:acme/widgets.git")).toEqual({ host: "https://mystery", projectPath: "acme/widgets" });
    expect(isGitHubRemote("git@mystery:acme/widgets.git")).toBe(false);
    expect(isGitLabRemote("git@mystery:acme/widgets.git")).toBe(false);
  });

  test("an alias whose real host is not a forge keeps the alias", async () => {
    setSshHostResolver(fakeSsh);
    expect((await parsed("git@lan-box:acme/widgets.git"))?.host).toBe("https://lan-box");
  });

  test("a remote that already names a forge or uses https is never resolved", async () => {
    setSshHostResolver(fakeSsh);
    expect((await parsed("git@github.com:acme/widgets.git"))?.host).toBe("https://github.com");
    expect((await parsed("git@gitlab.com:acme/widgets.git"))?.host).toBe("https://gitlab.com");
    expect((await parsed("https://work-github/acme/widgets.git"))?.host).toBe("https://work-github");
    expect(calls).toEqual([]);
  });

  test("parsing never waits on ssh: an unresolved alias reads as itself until the lookup lands", async () => {
    setSshHostResolver(fakeSsh);
    expect(parseRemoteUrl("git@work-github:acme/widgets.git")?.host).toBe("https://work-github");
    await resolveSshAlias("git@work-github:acme/widgets.git");
    expect(parseRemoteUrl("git@work-github:acme/widgets.git")?.host).toBe("https://github.com");
  });

  test("each alias asks ssh once", async () => {
    setSshHostResolver(fakeSsh);
    await Promise.all([
      resolveSshAlias("git@work-github:acme/widgets.git"),
      resolveSshAlias("git@work-github:acme/other.git"),
    ]);
    await resolveSshAlias("git@work-github:acme/third.git");
    expect(calls).toEqual(["git@work-github"]);
  });

  test("the remote's user goes to ssh and keeps its own cache entry", async () => {
    setSshHostResolver(fakeSsh);
    expect((await parsed("ops@by-user:acme/widgets.git"))?.host).toBe("https://github.com");
    expect((await parsed("by-user:acme/widgets.git"))?.host).toBe("https://by-user");
    expect(calls).toEqual(["ops@by-user", "by-user"]);
  });

  test("a host that could pass as an ssh option is never handed to ssh", async () => {
    setSshHostResolver(fakeSsh);
    await resolveSshAlias("ssh://-oProxyCommand=evil/acme/widgets.git");
    await resolveSshAlias("-oProxyCommand=evil@work-github:acme/widgets.git");
    expect(calls).toEqual([]);
  });

  test("a test run never reads the real ssh config", async () => {
    expect((await parsed("git@work-github:acme/widgets.git"))?.host).toBe("https://work-github");
  });

  test("forgeTokenFor resolves the alias before it picks a forge", async () => {
    setSshHostResolver(fakeSsh);
    expect(await forgeTokenFor("git@work-github:acme/widgets.git", { githubToken: "gh-token" })).toEqual({ forge: "github", token: "gh-token" });
  });

  test("the GitLab token never goes to an alias for github.com, and goes to an alias GitLab host only once confirmed", async () => {
    setSshHostResolver(fakeSsh);
    await resolveSshAlias("git@work-github:acme/widgets.git");
    await resolveSshAlias("git@work-gitlab:team/app.git");
    expect(mayOfferGitLabToken("git@work-github:acme/widgets.git", "github.com")).toBe(false);
    expect(mayOfferGitLabToken("git@work-gitlab:team/app.git", null)).toBe(false);
    expect(mayOfferGitLabToken("git@work-gitlab:team/app.git", "gitlab.example.com")).toBe(true);
  });
});
