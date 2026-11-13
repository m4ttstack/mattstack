import { describe, expect, test } from "bun:test";
import { credentialHealthCtxFor } from "../daemon.ts";
import type { TeamSnapshot } from "../setup/team-settings.ts";

const SOLO: TeamSnapshot = { slug: "", integrations: {}, trackingIdentities: [], marketplaces: [], plugins: [], remote: null };
const TEAM: TeamSnapshot = { ...SOLO, slug: "acme", remote: "git@github.com:acme/mattstack.git", integrations: { forge: { provider: "github", host: "github.com" } } };

describe("credentialHealthCtxFor", () => {
  for (const [name, team] of [["solo", SOLO], ["team", TEAM]] as const) {
    describe(name, () => {
      test("a github.com forgeHost never becomes the GitLab host", () => {
        expect(credentialHealthCtxFor("gitlab", team, { forgeHost: "github.com" }).host).toBeNull();
      });

      test("a confirmed self-hosted GitLab host is the GitLab host", () => {
        expect(credentialHealthCtxFor("gitlab", team, { forgeHost: "gitlab.example.com" }).host).toBe("gitlab.example.com");
      });

      test("the GitHub ctx is unchanged", () => {
        expect(credentialHealthCtxFor("github", team, { forgeHost: "github.com" })).toEqual({
          team: { slug: team.slug, remote: team.remote },
          linearTeamKey: null,
          host: null,
        });
      });
    });
  }
});
