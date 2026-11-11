import { describe, expect, test } from "bun:test";
import { join } from "path";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { stageSecret } from "../../setup/staging.ts";
import { storedForgeToken } from "../stored-forge-token.ts";

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
