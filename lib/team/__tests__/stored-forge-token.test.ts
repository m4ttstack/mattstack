import { describe, expect, test } from "bun:test";
import { join } from "path";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { stageSecret } from "../../setup/staging.ts";
import { confirmedForgeHost, storedForgeToken, storedTokenForForge } from "../stored-forge-token.ts";

const HOME = "/home/x";
const USER_SETTINGS = join(HOME, ".mattstack", "user", "settings.user.jsonc");

function probesWithStagedGitlabToken(confirmedHost?: string) {
  const files = confirmedHost ? { [USER_SETTINGS]: JSON.stringify({ "rt.integrations": { forgeHost: confirmedHost } }) } : {};
  const p = fakeProbes({ home: HOME, files });
  stageSecret(p, "rt", "gitlabToken", "glpat-secret");
  return p;
}

describe("storedForgeToken", () => {
  test("an unconfirmed gitlab-shaped host gets no token", async () => {
    const p = probesWithStagedGitlabToken();
    expect(await storedForgeToken(p, "https://gitlab.evil.example/acme/org.git")).toBeNull();
  });

  test("a host other than the confirmed one gets no token", async () => {
    const p = probesWithStagedGitlabToken("gitlab.acme.internal");
    expect(await storedForgeToken(p, "git@gitlab.evil.example:acme/org.git")).toBeNull();
  });

  test("the confirmed host still gets the token", async () => {
    const p = probesWithStagedGitlabToken("gitlab.acme.internal");
    expect(await storedForgeToken(p, "https://gitlab.acme.internal/acme/org.git")).toBe("glpat-secret");
  });

  test("gitlab.com needs no confirmation", async () => {
    const p = probesWithStagedGitlabToken();
    expect(await storedForgeToken(p, "https://gitlab.com/acme/org.git")).toBe("glpat-secret");
  });
});

describe("confirmedForgeHost", () => {
  test("a confirmed host that is not a hostname string counts as none", async () => {
    const p = fakeProbes({ home: HOME, files: { [USER_SETTINGS]: JSON.stringify({ "rt.integrations": { forgeHost: 5 } }) } });
    expect(confirmedForgeHost(p)).toBeNull();
    expect(await storedForgeToken(p, "https://gitlab.acme.internal/acme/org.git")).toBeNull();
  });
});

describe("storedTokenForForge", () => {
  const read = async (_p: unknown, remote: string) => (remote.includes("gitlab") ? "glpat-secret" : remote.includes("github.com") ? "ghp-secret" : null);
  const p = fakeProbes({ home: HOME });

  test("a declared GitLab forge on an unconfirmed host gets no token, whatever the remote", async () => {
    expect(await storedTokenForForge(p, { provider: "gitlab", host: "gitlab.evil.example" }, null, read)).toBeNull();
  });

  test("a declared GitLab forge on gitlab.com or the confirmed host gets the GitLab token", async () => {
    expect(await storedTokenForForge(p, { provider: "gitlab", host: "gitlab.com" }, null, read)).toBe("glpat-secret");
    expect(await storedTokenForForge(p, { provider: "gitlab", host: "gitlab.acme.internal" }, "gitlab.acme.internal", read)).toBe("glpat-secret");
  });

  test("a GitLab forge declared on github.com never gets a token", async () => {
    expect(await storedTokenForForge(p, { provider: "gitlab", host: "github.com" }, "github.com", read)).toBeNull();
  });

  test("a GitHub forge declared on a GitLab host never gets the GitLab token", async () => {
    expect(await storedTokenForForge(p, { provider: "github", host: "gitlab.com" }, null, read)).toBeNull();
  });

  test("a GitHub forge on github.com gets the GitHub token", async () => {
    expect(await storedTokenForForge(p, { provider: "github", host: "github.com" }, null, read)).toBe("ghp-secret");
  });
});
