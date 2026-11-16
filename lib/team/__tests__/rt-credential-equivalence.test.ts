import { describe, test, expect } from "bun:test";
import { gitCredentialReply } from "../../../commands/git/credential.ts";
import { forgeTokenLookup, mayOfferToken, storedTokenRefusal, tokenOrNull, type ForgeTokenSeams } from "../forge-token.ts";
import { forgeTokenKey } from "../git-credential.ts";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { publishTeam } from "../publish.ts";
import { teamLocalPath } from "../team-local.ts";
import { rtHelperHost } from "./rt-credential-argv.ts";

type Held = { stored: string | null; staged: string | null; gh: string | null };

const HOSTS = ["github.com", "gitlab.com"] as const;
const SCENARIOS: Array<[string, Held]> = [
  ["stored only", { stored: "tok_stored", staged: null, gh: null }],
  ["staged only", { stored: null, staged: "tok_staged", gh: null }],
  ["gh session only", { stored: null, staged: null, gh: "tok_gh" }],
  ["none", { stored: null, staged: null, gh: null }],
];

const seamsFor = (held: Held): ForgeTokenSeams => ({
  readStored: async () => held.stored,
  readStaged: () => held.staged,
  readGhSession: async () => held.gh,
});

const presenceSeamsFor = (held: Held): ForgeTokenSeams => ({
  readStored: async () => held.stored ?? held.staged,
  readStaged: () => null,
  readGhSession: async () => held.gh,
});

const passwordOf = (reply: string): string | null => reply.match(/^password=(.*)$/m)?.[1] ?? null;

describe("rt git credential reads the token as the existing call sites do", () => {
  for (const host of HOSTS) {
    for (const [name, held] of SCENARIOS) {
      test(`${host}, ${name}`, async () => {
        const remote = `https://${host}/acme/app.git`;
        const site = tokenOrNull(await forgeTokenLookup(remote, seamsFor(held)));
        const presence = tokenOrNull(await forgeTokenLookup(remote, presenceSeamsFor(held)));
        const helper = passwordOf(
          await gitCredentialReply("get", `protocol=https\nhost=${host}\n\n`, {
            confirmedHost: () => null,
            lookupStored: async (r) => tokenOrNull(await forgeTokenLookup(r, seamsFor(held))),
          }),
        );
        expect(helper).toBe(site);
        expect(helper).toBe(presence);
        const expected = held.stored ?? held.staged ?? (host === "github.com" ? held.gh : null);
        expect(helper).toBe(expected);
      });
    }
  }
});

describe("rt git credential gates the token as the existing call sites do", () => {
  const CONFIRMED = "gitlab.acme.dev";
  const BOTH = { githubToken: "tok_rt", gitlabToken: "glpat_fake" } as const;
  const GITLAB_ONLY = { gitlabToken: "glpat_fake" } as const;

  const rows: Array<{ name: string; host: string; store: Partial<Record<"githubToken" | "gitlabToken", string>>; reaches: boolean; fuReaches: boolean }> = [
    { name: "github.com", host: "github.com", store: BOTH, reaches: true, fuReaches: true },
    { name: "gitlab.com", host: "gitlab.com", store: BOTH, reaches: true, fuReaches: true },
    { name: "gitlab.acme.dev confirmed", host: "gitlab.acme.dev", store: BOTH, reaches: true, fuReaches: true },
    { name: "gitlab.other.dev unconfirmed", host: "gitlab.other.dev", store: BOTH, reaches: false, fuReaches: true },
    { name: "example.org unrecognised", host: "example.org", store: BOTH, reaches: false, fuReaches: false },
    { name: "github.com while only a GitLab token is held", host: "github.com", store: GITLAB_ONLY, reaches: false, fuReaches: false },
  ];

  const storeSeams = (store: Partial<Record<string, string>>): ForgeTokenSeams => ({
    readStored: async (_domain, key) => store[key] ?? null,
    readStaged: () => null,
  });

  const siteReaches = (gate: boolean, remote: string, store: Partial<Record<string, string>>): boolean => {
    const key = forgeTokenKey(remote);
    return gate && key !== null && store[key] !== undefined;
  };

  for (const row of rows) {
    test(row.name, async () => {
      const remote = `https://${row.host}/acme/app.git`;
      const helperReply = await gitCredentialReply("get", `protocol=https\nhost=${row.host}\n\n`, {
        confirmedHost: () => CONFIRMED,
        lookupStored: async (r) => tokenOrNull(await forgeTokenLookup(r, storeSeams(row.store))),
      });
      const helper = helperReply !== "";
      const mayOffer = siteReaches(mayOfferToken(remote, CONFIRMED), remote, row.store);
      const storedGate = siteReaches(storedTokenRefusal(remote, CONFIRMED) === null, remote, row.store);
      const noGate = siteReaches(true, remote, row.store);

      expect(helper).toBe(row.reaches);
      expect(mayOffer).toBe(helper);
      expect(storedGate).toBe(helper);
      expect(noGate).toBe(row.fuReaches);
    });
  }

  test("Fu offers to an unconfirmed GitLab-shaped host and the helper does not (section 4)", async () => {
    const host = "gitlab.other.dev";
    const remote = `https://${host}/acme/app.git`;
    const helperReply = await gitCredentialReply("get", `protocol=https\nhost=${host}\n\n`, {
      confirmedHost: () => CONFIRMED,
      lookupStored: async (r) => tokenOrNull(await forgeTokenLookup(r, storeSeams(BOTH))),
    });
    expect(helperReply).toBe("");
    expect(siteReaches(true, remote, BOTH)).toBe(true);
  });
});

describe("publishTeam offers the helper where rt git credential answers (equivalence test 2, the publish row)", () => {
  const HOME = "/home/x";
  const DIR = `${HOME}/.mattstack/orgs/acme`;
  const CONFIRMED = "gitlab.acme.dev";
  const BOTH = { githubToken: "tok_rt", gitlabToken: "glpat_fake" } as const;
  const GITLAB_ONLY = { gitlabToken: "glpat_fake" } as const;

  /** The token the caller holds for the remote's key, or the GitLab token when it holds only that: what steps/org.ts and steps/team.ts hand publishTeam. */
  const callerToken = (remote: string, store: Partial<Record<string, string>>): string => {
    const key = forgeTokenKey(remote);
    return (key !== null ? store[key] : undefined) ?? store.gitlabToken!;
  };

  const rows: Array<{ name: string; host: string; store: Partial<Record<"githubToken" | "gitlabToken", string>>; helperAnswers: boolean; publishOffers: boolean }> = [
    { name: "github.com", host: "github.com", store: BOTH, helperAnswers: true, publishOffers: true },
    { name: "gitlab.com", host: "gitlab.com", store: BOTH, helperAnswers: true, publishOffers: true },
    { name: "gitlab.acme.dev confirmed", host: "gitlab.acme.dev", store: BOTH, helperAnswers: true, publishOffers: true },
    { name: "gitlab.other.dev unconfirmed", host: "gitlab.other.dev", store: BOTH, helperAnswers: false, publishOffers: false },
    { name: "example.org unrecognised", host: "example.org", store: BOTH, helperAnswers: false, publishOffers: false },
    // The org identity edge (section 4): publishTeam offers, the helper answers with github.com's own token or nothing, never the GitLab token.
    { name: "github.com while only a GitLab token is held", host: "github.com", store: GITLAB_ONLY, helperAnswers: false, publishOffers: true },
  ];

  const pushedHelperHost = async (remote: string, token: string): Promise<string | null> => {
    const seen: string[][] = [];
    const p = fakeProbes({
      home: HOME,
      dirs: { [DIR]: [] },
      exec: (argv) => {
        seen.push(argv);
        if (argv.includes("symbolic-ref")) return { code: 0, stdout: "main\n", stderr: "" };
        if (argv.includes("get-url")) return { code: 0, stdout: `${remote}\n`, stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
      files: {
        [`${DIR}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: {} } }),
        [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: "dev1" }),
        [`${HOME}/.mattstack/user/settings.user.jsonc`]: JSON.stringify({ "rt.integrations": { forgeHost: CONFIRMED } }),
      },
    });
    await publishTeam(p, "acme", remote, { token, tokenRemote: remote });
    return rtHelperHost(seen.find((argv) => argv.includes("push"))!);
  };

  for (const row of rows) {
    test(row.name, async () => {
      const remote = `https://${row.host}/acme/app.git`;
      const token = callerToken(remote, row.store);
      const helperReply = await gitCredentialReply("get", `protocol=https\nhost=${row.host}\n\n`, {
        confirmedHost: () => CONFIRMED,
        lookupStored: async (r) => tokenOrNull(await forgeTokenLookup(r, { readStored: async (_domain, key) => row.store[key as "githubToken"] ?? null, readStaged: () => null })),
      });
      expect(helperReply !== "").toBe(row.helperAnswers);
      expect(await pushedHelperHost(remote, token)).toBe(row.publishOffers ? row.host : null);
      if (row.host === "github.com") expect(helperReply).not.toContain("glpat_fake");
    });
  }
});
