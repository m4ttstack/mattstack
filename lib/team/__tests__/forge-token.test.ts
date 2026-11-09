import { describe, test, expect } from "bun:test";
import { NoAgeKeyError } from "../../secrets/store.ts";
import { forgeTokenLookup, forgeTokenLookupFromPresence, ghSessionToken, mayOfferGitLabToken, mayOfferToken, tokenOrNull, withholdFromUntrustedHost } from "../forge-token.ts";
import { fakeProbes, ok } from "../../setup/__tests__/fakes.ts";
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

  test("a gh session answers for GitHub when rt holds nothing", async () => {
    const lookup = await forgeTokenLookup(REMOTE, { ...seams(async () => null), readGhSession: async () => "gho_session" });
    expect(lookup).toEqual({ kind: "token", token: "gho_session" });
  });

  test("rt's own token outranks the gh session", async () => {
    const lookup = await forgeTokenLookup(REMOTE, { ...seams(async () => "gho_stored"), readGhSession: async () => "gho_session" });
    expect(lookup).toEqual({ kind: "token", token: "gho_stored" });
  });

  test("the gh session is never offered to GitLab", async () => {
    const lookup = await forgeTokenLookup("https://gitlab.com/acme/team.git", { ...seams(async () => null), readGhSession: async () => "gho_session" });
    expect(lookup).toEqual({ kind: "absent" });
  });

  test("an unreadable store stays unreadable even with a gh session", async () => {
    const lookup = await forgeTokenLookup(REMOTE, { ...seams(async () => { throw new Error("sops exited 2"); }), readGhSession: async () => "gho_session" });
    expect(lookup.kind).toBe("unreadable");
  });
});

describe("ghSessionToken", () => {
  test("reads the token gh holds", async () => {
    const p = fakeProbes({ exec: (argv) => (argv.join(" ") === "gh auth token" ? ok("gho_session\n") : ok()) });
    expect(await ghSessionToken(p)).toBe("gho_session");
  });

  test("a signed-out gh is no token", async () => {
    const p = fakeProbes({ exec: () => ({ code: 1, stdout: "", stderr: "not logged in" }) });
    expect(await ghSessionToken(p)).toBeNull();
  });

  test("an empty answer is no token", async () => {
    expect(await ghSessionToken(fakeProbes({ exec: () => ok() }))).toBeNull();
  });

  test("the test-run switch keeps a real gh login out of reach", async () => {
    const p = fakeProbes({ env: { RT_GH_TOKEN_FALLBACK: "off" }, exec: () => ok("gho_session\n") });
    expect(await ghSessionToken(p)).toBeNull();
    expect(p.calls.exec).toEqual([]);
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
