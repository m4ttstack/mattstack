import { afterEach, describe, expect, test } from "bun:test";
import { isGitHubRemote, isGitLabRemote, parseRemoteUrl, setSshHostResolver } from "../enrich.ts";
import { mayOfferGitLabToken } from "../team/forge-token.ts";

const sshConfig: Record<string, string> = {
  "work-github": "github.com",
  "github.com-work": "github.com",
  "work-gitlab": "gitlab.example.com",
  "lan-box": "10.0.0.7",
};

const calls: string[] = [];

/** Stands in for `ssh -G`, which echoes an unconfigured alias back as its own hostname. */
function fakeSsh(alias: string): string | null {
  calls.push(alias);
  return sshConfig[alias] ?? alias;
}

afterEach(() => {
  setSshHostResolver(null);
  calls.length = 0;
});

describe("ssh alias remotes", () => {
  test("an alias for github.com resolves to GitHub", () => {
    setSshHostResolver(fakeSsh);
    expect(parseRemoteUrl("git@work-github:acme/widgets.git")).toEqual({ host: "https://github.com", projectPath: "acme/widgets" });
    expect(isGitHubRemote("git@work-github:acme/widgets.git")).toBe(true);
    expect(isGitHubRemote("git@github.com-work:acme/widgets.git")).toBe(true);
    expect(isGitHubRemote("ssh://git@work-github/acme/widgets.git")).toBe(true);
  });

  test("an alias for a GitLab host resolves to GitLab", () => {
    setSshHostResolver(fakeSsh);
    expect(parseRemoteUrl("git@work-gitlab:team/app.git")).toEqual({ host: "https://gitlab.example.com", projectPath: "team/app" });
    expect(isGitLabRemote("git@work-gitlab:team/app.git")).toBe(true);
    expect(isGitHubRemote("git@work-gitlab:team/app.git")).toBe(false);
  });

  test("an alias with no ssh config entry stays an unknown forge", () => {
    setSshHostResolver(fakeSsh);
    expect(parseRemoteUrl("git@mystery:acme/widgets.git")).toEqual({ host: "https://mystery", projectPath: "acme/widgets" });
    expect(isGitHubRemote("git@mystery:acme/widgets.git")).toBe(false);
    expect(isGitLabRemote("git@mystery:acme/widgets.git")).toBe(false);
  });

  test("an alias whose real host is not a forge keeps the alias", () => {
    setSshHostResolver(fakeSsh);
    expect(parseRemoteUrl("git@lan-box:acme/widgets.git")?.host).toBe("https://lan-box");
  });

  test("a remote that already names a forge or uses https is never resolved", () => {
    setSshHostResolver(fakeSsh);
    expect(parseRemoteUrl("git@github.com:acme/widgets.git")?.host).toBe("https://github.com");
    expect(parseRemoteUrl("git@gitlab.com:acme/widgets.git")?.host).toBe("https://gitlab.com");
    expect(parseRemoteUrl("https://work-github/acme/widgets.git")?.host).toBe("https://work-github");
    expect(calls).toEqual([]);
  });

  test("each alias asks ssh once", () => {
    setSshHostResolver(fakeSsh);
    parseRemoteUrl("git@work-github:acme/widgets.git");
    parseRemoteUrl("git@work-github:acme/other.git");
    expect(calls).toEqual(["work-github"]);
  });

  test("a host that could pass as an ssh option is never handed to ssh", () => {
    setSshHostResolver(fakeSsh);
    parseRemoteUrl("ssh://-oProxyCommand=evil/acme/widgets.git");
    expect(calls).toEqual([]);
  });

  test("a test run never reads the real ssh config", () => {
    expect(isGitHubRemote("git@work-github:acme/widgets.git")).toBe(false);
  });

  test("the GitLab token never goes to an alias for github.com, and goes to an alias GitLab host only once confirmed", () => {
    setSshHostResolver(fakeSsh);
    expect(mayOfferGitLabToken("git@work-github:acme/widgets.git", "github.com")).toBe(false);
    expect(mayOfferGitLabToken("git@work-gitlab:team/app.git", null)).toBe(false);
    expect(mayOfferGitLabToken("git@work-gitlab:team/app.git", "gitlab.example.com")).toBe(true);
  });
});
