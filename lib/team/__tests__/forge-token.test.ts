import { describe, test, expect } from "bun:test";
import { NoAgeKeyError } from "../../secrets/store.ts";
import { forgeTokenLookup, forgeTokenLookupFromPresence, mayOfferGitLabToken, mayOfferToken, tokenOrNull, withholdFromUntrustedHost } from "../forge-token.ts";
import type { SecretPresence } from "../../setup/validators/accounts.ts";

const REMOTE = "https://github.com/acme/team.git";
const seams = (stored: () => Promise<string | null>, staged: string | null = null) => ({
  readStored: async (_domain: string, _key: string) => stored(),
  readStaged: (_domain: string, _key: string) => staged,
});

describe("forgeTokenLookup", () => {
  test("the store answers", async () => {
    expect(await forgeTokenLookup(REMOTE, seams(async () => "gho_stored"))).toEqual({ kind: "token", token: "gho_stored" });
  });

  test("no age key yet falls through to the stage", async () => {
    const lookup = await forgeTokenLookup(REMOTE, seams(async () => { throw new NoAgeKeyError(); }, "gho_staged"));
    expect(lookup).toEqual({ kind: "token", token: "gho_staged" });
  });

  test("store and stage both empty is absent, which is what licenses no-account", async () => {
    expect(await forgeTokenLookup(REMOTE, seams(async () => null))).toEqual({ kind: "absent" });
  });

  test("a store failure that is not a missing key is unreadable, never absent", async () => {
    const lookup = await forgeTokenLookup(REMOTE, seams(async () => { throw new Error("sops exited 2"); }));
    expect(lookup.kind).toBe("unreadable");
    expect(tokenOrNull(lookup)).toBeNull();
  });

  test("a remote on no known forge is absent", async () => {
    expect(await forgeTokenLookup("https://example.com/x.git", seams(async () => "gho_stored"))).toEqual({ kind: "absent" });
  });
});

describe("forgeTokenLookupFromPresence", () => {
  test("presence-backed returns token", async () => {
    const presence: SecretPresence = {
      has: async () => "gho_token",
    };
    const result = await forgeTokenLookupFromPresence(REMOTE, presence);
    expect(result).toEqual({ kind: "token", token: "gho_token" });
  });

  test("undefined secrets case returns absent without calling anything", async () => {
    const result = await forgeTokenLookupFromPresence(REMOTE, undefined);
    expect(result).toEqual({ kind: "absent" });
  });
});

describe("mayOfferToken", () => {
  test("the public forges are unspoofable, so the token may go to them", () => {
    expect(mayOfferToken("https://github.com/acme/team.git", null)).toBe(true);
    expect(mayOfferToken("https://gitlab.com/acme/team.git", null)).toBe(true);
  });

  test("a cleartext http remote never gets the token, even on an unspoofable host", () => {
    expect(mayOfferToken("http://github.com/acme/team.git", null)).toBe(false);
    expect(mayOfferToken("http://gitlab.acme.internal/acme/team.git", "gitlab.acme.internal")).toBe(false);
  });

  test("a gitlab-shaped host an inviter chose is refused until the user confirms it", () => {
    expect(mayOfferToken("https://gitlab.evil.example/acme/team.git", null)).toBe(false);
    expect(mayOfferToken("https://gitlab.evil.example/acme/team.git", "gitlab.acme.internal")).toBe(false);
    expect(mayOfferToken("https://gitlab.acme.internal/acme/team.git", "gitlab.acme.internal")).toBe(true);
  });

  test("the GitLab token never goes to github.com, even when github.com is the confirmed host", () => {
    expect(mayOfferGitLabToken("https://github.com/acme/team.git", null)).toBe(false);
    expect(mayOfferGitLabToken("git@github.com:acme/team.git", "github.com")).toBe(false);
  });

  test("the GitLab token goes to gitlab.com or the one confirmed host", () => {
    expect(mayOfferGitLabToken("git@gitlab.com:acme/team.git", null)).toBe(true);
    expect(mayOfferGitLabToken("https://git.acme.internal/acme/team.git", "git.acme.internal")).toBe(true);
    expect(mayOfferGitLabToken("https://gitlab.evil.example/acme/team.git", "git.acme.internal")).toBe(false);
  });

  test("a confirmed host matches whatever case it was stored in", () => {
    expect(mayOfferGitLabToken("https://Git.Acme.Internal/acme/team.git", "Git.Acme.Internal")).toBe(true);
    expect(mayOfferGitLabToken("https://git.acme.internal/acme/team.git", "GIT.ACME.INTERNAL")).toBe(true);
  });

  test("a real token is withheld from an unconfirmed host", () => {
    const held = { kind: "token", token: "glpat_x" } as const;
    expect(withholdFromUntrustedHost(held, "https://gitlab.evil.example/acme/team.git", null)).toEqual({ kind: "withheld", host: "gitlab.evil.example" });
    expect(withholdFromUntrustedHost(held, "https://gitlab.acme.internal/acme/team.git", "gitlab.acme.internal")).toEqual(held);
  });

  test("an absent or unreadable store keeps its own verdict, since neither can leak anything", () => {
    const absent = { kind: "absent" } as const;
    const unreadable = { kind: "unreadable", reason: "sops exited 2" } as const;
    expect(withholdFromUntrustedHost(absent, "https://gitlab.evil.example/acme/team.git", null)).toEqual(absent);
    expect(withholdFromUntrustedHost(unreadable, "https://gitlab.evil.example/acme/team.git", null)).toEqual(unreadable);
  });
});
