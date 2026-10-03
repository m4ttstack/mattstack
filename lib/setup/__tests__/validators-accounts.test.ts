import { describe, test, expect } from "bun:test";
import { accountRows, type SecretPresence } from "../validators/accounts.ts";
import { fakeProbes, ok } from "./fakes.ts";
import type { ExecScript } from "./fakes.ts";
import type { TeamSnapshot } from "../team-settings.ts";
import type { PackRequirements } from "../requirements.ts";
import type { SetupIntent } from "../intent.ts";
import type { Action, Integration } from "../contract.ts";
import { writeCredentialHealth } from "../../credential-health/db.ts";
import { getStateDb } from "../../state/index.ts";
import { finalizePlan } from "../contract.ts";
import { slackWaitRowDetail } from "../team-slack-secret.ts";
import { SWITCHBOARD_URL } from "../../../packages/rt-client/src/switchboard.ts";
import { teamLocalPath } from "../../team/team-local.ts";

function baseTeam(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return { slug: "acme", integrations: {}, trackingIdentities: [], marketplaces: [], plugins: [], remote: null, ...overrides };
}

/** Keys are "<domain>.<key>" — mirrors the real store's (domain, key) addressing without touching sops/age. */
function fakeSecrets(stored: Record<string, string> = {}): SecretPresence {
  return {
    async has(domain, key) {
      return stored[`${domain}.${key}`] ?? null;
    },
  };
}

async function pickRow(rowsP: ReturnType<typeof accountRows>, id: string) {
  const rows = await rowsP;
  const r = rows.find((row) => row.id === id);
  if (!r) throw new Error(`no row ${id}; got ids: ${rows.map((row) => row.id).join(", ")}`);
  return r;
}

const CREATE_INTENT: SetupIntent = { v: 1, at: "2026-08-21T00:00:00.000Z", mode: "create", team: { slug: "acme", name: "Acme", remote: "https://x/acme.git", others: false } };
const JOIN_INTENT: SetupIntent = {
  v: 1,
  at: "2026-08-21T00:00:00.000Z",
  mode: "join",
  join: { id: "inv1", keyB64: "abc", pointer: { v: 1, team: "acme", name: "Acme", remote: "https://gitlab.example.com/acme/mattstack.git", owner: "owner1", forge: "gitlab.example.com", createdAt: "2026-08-01T00:00:00.000Z" } },
};
const RESTORE_INTENT: SetupIntent = { v: 1, at: "2026-08-21T00:00:00.000Z", mode: "restore", restore: { homeRepo: "/x" } };

describe("accountRows — account.gitlab", () => {
  test("declared via forge, no secret -> missing, full row pinned (fields, recheck, optionalNote, required)", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
    const r = await pickRow(accountRows(fakeProbes(), team, [], fakeSecrets(), null), "account.gitlab");
    expect(r).toEqual({
      id: "account.gitlab",
      kind: "account",
      title: "GitLab",
      why: "Lets rt open MRs, check pipelines, and read project metadata on gitlab.example.com.",
      required: true,
      optionalNote: null,
      status: "missing",
      detail: "No GitLab account connected yet",
      action: {
        type: "connect",
        label: "Connect",
        integration: "gitlab",
        fields: [{ name: "token", label: "GitLab token", secret: true, hint: "api" }],
      },
      recheck: "on-change",
    });
  });

  test("create intent -> the owner's scopes in the hint and the create link", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.com", provider: "gitlab" } } });
    const r = await pickRow(accountRows(fakeProbes(), team, [], fakeSecrets(), CREATE_INTENT), "account.gitlab");
    expect(r.action).toEqual({
      type: "connect",
      label: "Connect",
      integration: "gitlab",
      fields: [{ name: "token", label: "GitLab token", secret: true, hint: "api" }],
      create: { label: "Create a token on GitLab…", url: "https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api" },
    });
  });

  test("join intent -> a member's scopes", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.com", provider: "gitlab" } } });
    const r = await pickRow(accountRows(fakeProbes(), team, [], fakeSecrets(), JOIN_INTENT), "account.gitlab");
    expect(r.action).toEqual({
      type: "connect",
      label: "Connect",
      integration: "gitlab",
      fields: [{ name: "token", label: "GitLab token", secret: true, hint: "api" }],
      create: { label: "Create a token on GitLab…", url: "https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api" },
    });
  });

  test("no intent (Install cleared it): a clone rt joined stays a member, any other team is the owner's", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.com", provider: "gitlab" } } });
    const joined = fakeProbes({ files: { "/fake-home/.mattstack/rt/teams/acme.json": JSON.stringify({ joinedByRt: true }) } });
    const member = await pickRow(accountRows(joined, team, [], fakeSecrets(), null), "account.gitlab");
    expect((member.action as { fields: { hint?: string }[] }).fields[0]!.hint).toBe("api");
    const owner = await pickRow(accountRows(fakeProbes(), team, [], fakeSecrets(), null), "account.gitlab");
    expect((owner.action as { fields: { hint?: string }[] }).fields[0]!.hint).toBe("api");
  });

  test("the create link opens the host the user confirmed over the one the team declares", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
    const r = await pickRow(accountRows(fakeProbes(), team, [], fakeSecrets(), JOIN_INTENT, { forgeHost: "git.internal.example" }), "account.gitlab");
    expect((r.action as { create?: { url: string } }).create?.url).toStartWith("https://git.internal.example/-/user_settings/personal_access_tokens?");
  });

  test("a self-hosted forge the team declares but the user has not confirmed gets no create link (a link is still a place rt sends the user)", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
    const r = await pickRow(accountRows(fakeProbes(), team, [], fakeSecrets(), JOIN_INTENT), "account.gitlab");
    expect(r.action?.type).toBe("connect");
    expect((r.action as { create?: unknown }).create).toBeUndefined();
  });

  test("no forge declared and nothing confirmed -> the create link falls back to gitlab.com", async () => {
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: ["gitlab"], tools: [] }];
    const r = await pickRow(accountRows(fakeProbes(), baseTeam(), reqs, fakeSecrets(), null), "account.gitlab");
    expect((r.action as { create?: { url: string } }).create?.url).toStartWith("https://gitlab.com/-/user_settings/personal_access_tokens?");
  });

  test("a stored token the forge accepts but that lacks the role's scopes needs you, names the shortfall, and offers the create link", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
    const fetch = async (url: string) => {
      if (url.includes("personal_access_tokens/self")) return { status: 200, body: JSON.stringify({ scopes: ["read_api", "read_user"] }), headers: {} };
      return { status: 200, body: "{}", headers: {} };
    };
    const r = await pickRow(
      accountRows(fakeProbes({ fetch }), team, [], fakeSecrets({ "rt.gitlabToken": "tok123" }), null, { forgeHost: "gitlab.example.com" }),
      "account.gitlab",
    );
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe("This token is missing api (needs api for the home-repo push and members sync)");
    expect((r.action as { create?: { url: string } }).create?.url).toStartWith("https://gitlab.example.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api");
  });

  test("a member's stored read_api token needs you: the board cannot post reviews with it", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
    const fetch = async (url: string) => {
      if (url.includes("personal_access_tokens/self")) return { status: 200, body: JSON.stringify({ scopes: ["read_api", "read_user"] }), headers: {} };
      return { status: 200, body: "{}", headers: {} };
    };
    const joined = fakeProbes({ fetch, files: { "/fake-home/.mattstack/rt/teams/acme.json": JSON.stringify({ joinedByRt: true }) } });
    const r = await pickRow(accountRows(joined, team, [], fakeSecrets({ "rt.gitlabToken": "tok123" }), null, { forgeHost: "gitlab.example.com" }), "account.gitlab");
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe("This token is missing api (needs api to post board review comments)");
    expect(r.action?.type).toBe("connect");
    expect((r.action as { create?: { url: string } }).create?.url).toBe("https://gitlab.example.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api");
  });

  test("secret present, host user-confirmed, validate 200s -> ready", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
    const fetch = async (url: string) => {
      if (url.includes("/api/v4/user")) return { status: 200, body: "{}", headers: {} };
      if (url.includes("personal_access_tokens/self")) return { status: 200, body: JSON.stringify({ scopes: ["api"] }), headers: {} };
      return { status: 200, body: "{}", headers: {} };
    };
    const joined = fakeProbes({ fetch, files: { "/fake-home/.mattstack/rt/teams/acme.json": JSON.stringify({ joinedByRt: true }) } });
    const r = await pickRow(accountRows(joined, team, [], fakeSecrets({ "rt.gitlabToken": "tok123" }), null, { forgeHost: "gitlab.example.com" }), "account.gitlab");
    expect(r.status).toBe("ready");
    expect(r.detail).toBe("GitLab token works");
  });

  test("secret present, host user-confirmed, validate rejects (401) -> invalid, WITH a connect action so a revoked token is replaceable (H2)", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
    const fetch = async () => ({ status: 401, body: "", headers: {} });
    const r = await pickRow(
      accountRows(fakeProbes({ fetch }), team, [], fakeSecrets({ "rt.gitlabToken": "tok123" }), null, { forgeHost: "gitlab.example.com" }),
      "account.gitlab",
    );
    expect(r.status).toBe("invalid");
    expect(r.action).toEqual({
      type: "connect",
      label: "Connect",
      integration: "gitlab",
      fields: [{ name: "token", label: "GitLab token", secret: true, hint: "api" }],
      create: { label: "Create a token on GitLab…", url: "https://gitlab.example.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api" },
    });
  });

  test("secret present, host NOT user-confirmed -> error, and the token is never sent (R-F2)", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
    const p = fakeProbes();
    const r = await pickRow(accountRows(p, team, [], fakeSecrets({ "rt.gitlabToken": "tok123" }), null), "account.gitlab");
    expect(r.status).toBe("error");
    expect(p.calls.fetch).toEqual([]);
  });

  test("secret present, validate's network call is unreachable -> error, never invalid (R-T4b), still carries an action (H2)", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
    const fetch = async () => ({ status: 0, body: "", headers: {} });
    const r = await pickRow(accountRows(fakeProbes({ fetch }), team, [], fakeSecrets({ "rt.gitlabToken": "tok123" }), null), "account.gitlab");
    expect(r.status).toBe("error");
    expect(r.action?.type).toBe("connect");
  });

  test("why() never borrows the forge host when this row isn't the declared forge (finding 13)", async () => {
    const team = baseTeam({ integrations: { forge: { host: "github.com", provider: "github" } } });
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: ["gitlab"], tools: [] }];
    const r = await pickRow(accountRows(fakeProbes(), team, reqs, fakeSecrets(), null), "account.gitlab");
    expect(r.why).not.toContain("github.com");
    expect(r.why).toBe("Lets rt open MRs, check pipelines, and read project metadata on GitLab.");
  });

  test("dedupe: forge declares gitlab AND a pack also names it directly -> one row only", async () => {
    const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: ["gitlab"], tools: [] }];
    const rows = await accountRows(fakeProbes(), team, reqs, fakeSecrets(), null);
    expect(rows.filter((r) => r.id === "account.gitlab")).toHaveLength(1);
  });
});

describe("accountRows — account.github", () => {
  function githubTeam(): TeamSnapshot {
    return baseTeam({ integrations: { forge: { host: "github.com", provider: "github" } } });
  }

  test("no token, gh authenticated -> ready 'via gh (<user>)'", async () => {
    const exec: ExecScript = (argv) =>
      argv[0] === "gh" && argv[1] === "auth" && argv[2] === "status" ? ok("✓ Logged in to github.com account octocat (keyring)\n") : ok();
    const r = await pickRow(accountRows(fakeProbes({ exec }), githubTeam(), [], fakeSecrets(), null), "account.github");
    expect(r.status).toBe("ready");
    expect(r.detail).toBe("Signed in through the gh CLI as octocat");
    expect(r.why).toBe("Lets rt open PRs, check CI, and read repo metadata on github.com.");
  });

  test("no token, gh output doesn't match the known 'as'/'account' shapes -> ready 'via gh' with no user suffix", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "gh" ? ok("gh: you are authenticated\n") : ok());
    const r = await pickRow(accountRows(fakeProbes({ exec }), githubTeam(), [], fakeSecrets(), null), "account.github");
    expect(r.status).toBe("ready");
    expect(r.detail).toBe("Signed in through the gh CLI");
  });

  test("no token, gh not authenticated -> missing, connect action WITHOUT alternatives (H1 fix: no session to fall back to)", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "gh" && argv[1] === "auth" ? { code: 1, stdout: "", stderr: "not logged in" } : ok());
    const r = await pickRow(accountRows(fakeProbes({ exec }), githubTeam(), [], fakeSecrets(), null), "account.github");
    expect(r.status).toBe("missing");
    expect(r.action).toEqual({
      type: "connect",
      label: "Connect",
      integration: "github",
      fields: [{ name: "token", label: "GitHub token", secret: true, hint: "repo, read:org" }],
      create: { label: "Create a token on GitHub…", url: "https://github.com/settings/tokens/new?description=mattstack&scopes=repo%2Cread%3Aorg" },
    });
  });

  test("gh CLI not installed (127) -> missing, detail names it, no alternatives", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "gh" ? { code: 127, stdout: "", stderr: "ENOENT: gh" } : ok());
    const r = await pickRow(accountRows(fakeProbes({ exec }), githubTeam(), [], fakeSecrets(), null), "account.github");
    expect(r.status).toBe("missing");
    expect(r.detail).toContain("not installed");
    expect(r.action).toMatchObject({ type: "connect" });
    expect((r.action as { alternatives?: unknown }).alternatives).toBeUndefined();
  });

  test("token present, validate ready -> ready, gh is never probed", async () => {
    const fetch = async () => ({ status: 200, body: "{}", headers: {} });
    const p = fakeProbes({ fetch });
    const r = await pickRow(accountRows(p, githubTeam(), [], fakeSecrets({ "rt.githubToken": "gh_tok" }), null), "account.github");
    expect(r.status).toBe("ready");
    expect(p.calls.exec).not.toContainEqual(["gh", "auth", "status"]);
  });

  test("token present, forge accepts it but its classic scopes fall short -> needs-you naming the shortfall, still replaceable", async () => {
    const fetch = async () => ({ status: 200, body: "{}", headers: { "x-oauth-scopes": "repo" } as Record<string, string> });
    const exec: ExecScript = (argv) => (argv[0] === "gh" ? { code: 1, stdout: "", stderr: "" } : ok());
    const r = await pickRow(accountRows(fakeProbes({ exec, fetch }), githubTeam(), [], fakeSecrets({ "rt.githubToken": "gh_tok" }), null), "account.github");
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe("This token is missing read:org");
    expect(r.action).toMatchObject({ type: "connect", create: { url: "https://github.com/settings/tokens/new?description=mattstack&scopes=repo%2Cread%3Aorg" } });
  });

  test("token present, validate invalid + gh authenticated -> invalid WITH alternatives (H1 fixed direction)", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "gh" ? ok("Logged in to github.com account octocat (keyring)\n") : ok());
    const fetch = async () => ({ status: 401, body: "", headers: {} });
    const r = await pickRow(accountRows(fakeProbes({ exec, fetch }), githubTeam(), [], fakeSecrets({ "rt.githubToken": "gh_tok" }), null), "account.github");
    expect(r.status).toBe("invalid");
    expect(r.action).toEqual({
      type: "connect",
      label: "Connect",
      integration: "github",
      fields: [{ name: "token", label: "GitHub token", secret: true, hint: "repo, read:org" }],
      alternatives: [{ id: "use-gh", label: "Use your existing gh CLI session instead" }],
      create: { label: "Create a token on GitHub…", url: "https://github.com/settings/tokens/new?description=mattstack&scopes=repo%2Cread%3Aorg" },
    });
  });

  test("token present, validate invalid + gh NOT authenticated -> invalid WITHOUT alternatives (nothing to fall back to)", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "gh" ? { code: 1, stdout: "", stderr: "" } : ok());
    const fetch = async () => ({ status: 401, body: "", headers: {} });
    const r = await pickRow(accountRows(fakeProbes({ exec, fetch }), githubTeam(), [], fakeSecrets({ "rt.githubToken": "gh_tok" }), null), "account.github");
    expect(r.status).toBe("invalid");
    expect((r.action as { alternatives?: unknown })?.alternatives).toBeUndefined();
  });
});

describe("accountRows — account.slack + account.slack-app", () => {
  const SLACK_REQS: PackRequirements[] = [{ pack: "somepack", integrations: ["slack"], tools: [] }];

  test("create intent -> owner-once row required:true, no optionalNote, precedes account.slack", async () => {
    const rows = await accountRows(fakeProbes(), baseTeam(), SLACK_REQS, fakeSecrets(), CREATE_INTENT);
    const appIdx = rows.findIndex((r) => r.id === "account.slack-app");
    const slackIdx = rows.findIndex((r) => r.id === "account.slack");
    expect(appIdx).toBeGreaterThanOrEqual(0);
    expect(slackIdx).toBeGreaterThan(appIdx);
    const app = rows[appIdx]!;
    expect(app.required).toBe(true);
    expect(app.optionalNote).toBeNull();
    expect(app.status).toBe("missing");
    expect(app.action).toEqual({ type: "owner-once", label: "Create the team's Slack app…", integration: "slack", fields: [{ name: "configToken", label: "App configuration token", secret: true }] });
  });

  test("no intent -> owner-once row present but required:false with an optionalNote naming the owner path (R-T9-a)", async () => {
    const rows = await accountRows(fakeProbes(), baseTeam(), SLACK_REQS, fakeSecrets(), null);
    const app = rows.find((r) => r.id === "account.slack-app")!;
    expect(app).toBeDefined();
    expect(app.required).toBe(false);
    expect(app.optionalNote).toContain("owner");
  });

  test("join intent -> owner-once row present, required:false (a joining member is never the owner)", async () => {
    const rows = await accountRows(fakeProbes(), baseTeam(), SLACK_REQS, fakeSecrets(), JOIN_INTENT);
    const app = rows.find((r) => r.id === "account.slack-app");
    expect(app).toBeDefined();
    expect(app?.required).toBe(false);
  });

  test("restore intent -> owner-once row present, required:false", async () => {
    const rows = await accountRows(fakeProbes(), baseTeam(), SLACK_REQS, fakeSecrets(), RESTORE_INTENT);
    const app = rows.find((r) => r.id === "account.slack-app");
    expect(app).toBeDefined();
    expect(app?.required).toBe(false);
  });

  test("team already has a clientId -> no owner-once row regardless of intent", async () => {
    const team = baseTeam({ integrations: { slack: { clientId: "abc" } } });
    const rows = await accountRows(fakeProbes(), team, SLACK_REQS, fakeSecrets(), CREATE_INTENT);
    expect(rows.some((r) => r.id === "account.slack-app")).toBe(false);
  });

  test("slack named only via a tool connect field (not reqs.integrations) still triggers the owner-once row (finding 14/L5)", async () => {
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: [], tools: [{ name: "slack-cli", why: "posts standups", connect: { integration: "slack" } }] }];
    const rows = await accountRows(fakeProbes(), baseTeam(), reqs, fakeSecrets(), CREATE_INTENT);
    expect(rows.some((r) => r.id === "account.slack-app")).toBe(true);
  });

  test("account.slack: no app yet -> missing, explains the dependency, no oauth action (finding 15/L6)", async () => {
    const r = await pickRow(accountRows(fakeProbes(), baseTeam(), SLACK_REQS, fakeSecrets(), CREATE_INTENT), "account.slack");
    expect(r.status).toBe("missing");
    expect(r.detail).toContain("Waiting for the team's Slack app to be set up");
    expect(r.action).toBeNull();
  });

  test("account.slack: app exists, no token -> missing with the oauth connect action", async () => {
    const team = baseTeam({ integrations: { slack: { clientId: "abc" } } });
    const r = await pickRow(accountRows(fakeProbes(), team, SLACK_REQS, fakeSecrets(), null), "account.slack");
    expect(r.status).toBe("missing");
    expect(r.action).toEqual({ type: "oauth", label: "Connect", integration: "slack", verb: ["setup", "slack", "connect"] });
  });

  test("account.slack: no token yet -> a short line names the redirect URL to add", async () => {
    const team = baseTeam({ integrations: { slack: { appId: "A0TEAM", clientId: "abc" } } });
    const r = await pickRow(accountRows(fakeProbes(), team, SLACK_REQS, fakeSecrets(), null), "account.slack");
    expect(r.detail).toBe("No Slack account connected yet. If Slack rejects the redirect, add http://localhost:11234/callback in the app's OAuth settings");
  });

  test("account.slack: token accepted but missing user scopes the board reads with -> needs-you naming them, oauth action", async () => {
    const team = baseTeam({ integrations: { slack: { clientId: "abc" } } });
    const fetch = async () => ({ status: 200, body: JSON.stringify({ ok: true, team: "Acme" }), headers: { "x-oauth-scopes": "reactions:write,chat:write" } });
    const r = await pickRow(accountRows(fakeProbes({ fetch }), team, SLACK_REQS, fakeSecrets({ "board.slackToken": "tok" }), null), "account.slack");
    expect(r.status).toBe("needs-you");
    expect(r.detail).toBe("Reconnect Slack to grant these permissions: channels:read, groups:read, channels:history, groups:history, reactions:read");
    expect(r.action).toEqual({ type: "oauth", label: "Connect", integration: "slack", verb: ["setup", "slack", "connect"] });
  });

  test("account.slack: token granted every user scope -> ready", async () => {
    const team = baseTeam({ integrations: { slack: { clientId: "abc" } } });
    const fetch = async () => ({ status: 200, body: JSON.stringify({ ok: true, team: "Acme" }), headers: { "x-oauth-scopes": "channels:read,groups:read,channels:history,groups:history,reactions:read,reactions:write,chat:write" } });
    const r = await pickRow(accountRows(fakeProbes({ fetch }), team, SLACK_REQS, fakeSecrets({ "board.slackToken": "tok" }), null), "account.slack");
    expect(r.status).toBe("ready");
  });

  test("account.slack: app exists, token invalid -> invalid, oauth action still present (H2)", async () => {
    const team = baseTeam({ integrations: { slack: { clientId: "abc" } } });
    const fetch = async () => ({ status: 200, body: JSON.stringify({ ok: false, error: "invalid_auth" }), headers: {} });
    const r = await pickRow(accountRows(fakeProbes({ fetch }), team, SLACK_REQS, fakeSecrets({ "board.slackToken": "tok" }), null), "account.slack");
    expect(r.status).toBe("invalid");
    expect(r.action).toEqual({ type: "oauth", label: "Connect", integration: "slack", verb: ["setup", "slack", "connect"] });
  });

  describe("a joined member waiting on the owner to accept them", () => {
    const MINE = "age1mine0000000000000000000000000000000000000000000000000000000";
    const OWNER = "age1owner000000000000000000000000000000000000000000000000000000";
    const BOARD = "/fake-home/.mattstack/teams/acme/mattstack/secrets/board.json";
    const PULL: Action = { type: "run", label: "Re-check", verb: ["team", "pull", "--team", "acme"] };
    const team = baseTeam({ integrations: { slack: { clientId: "abc" } } });

    function memberProbes(board: string | null, extra: Omit<NonNullable<Parameters<typeof fakeProbes>[0]>, "files"> = {}) {
      return fakeProbes({
        files: {
          [teamLocalPath("/fake-home", "acme")]: JSON.stringify({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false, agePublicKey: MINE }),
          ...(board === null ? {} : { [BOARD]: board }),
        },
        ...extra,
      });
    }

    function board(recipients: string[], keys: string[] = ["slackClientSecret"]): string {
      return JSON.stringify({ ...Object.fromEntries(keys.map((k) => [k, "ENC[x]"])), sops: { age: recipients.map((recipient) => ({ recipient, enc: "x" })) } });
    }

    test("client secret readable on this machine -> Connect as today", async () => {
      const r = await pickRow(accountRows(memberProbes(board([OWNER, MINE])), team, SLACK_REQS, fakeSecrets(), JOIN_INTENT), "account.slack");
      expect(r.status).toBe("missing");
      expect(r.required).toBe(true);
      expect(r.action).toEqual({ type: "oauth", label: "Connect", integration: "slack", verb: ["setup", "slack", "connect"] });
    });

    test("not accepted yet -> needs-you with the waiting wording, and Re-check pulls the team before the row re-reads", async () => {
      const r = await pickRow(accountRows(memberProbes(board([OWNER])), team, SLACK_REQS, fakeSecrets(), JOIN_INTENT), "account.slack");
      expect(r.status).toBe("needs-you");
      expect(r.detail).toBe(slackWaitRowDetail({ kind: "awaiting-acceptance" }, "acme"));
      expect(r.action).toEqual(PULL);
    });

    test("not accepted yet -> the row does not block Install, since only the owner can clear it", async () => {
      const rows = await accountRows(memberProbes(board([OWNER])), team, SLACK_REQS, fakeSecrets(), JOIN_INTENT);
      const r = rows.find((row) => row.id === "account.slack")!;
      expect(r.required).toBe(false);
      expect(r.finishGated).toBeUndefined();
      expect(r.optionalNote?.startsWith("Works without")).toBe(false);
      const plan = finalizePlan({ slug: "acme", name: "Acme", mode: "join" }, [{ id: "accounts", title: "Accounts", rows }]);
      expect(plan.requiredMissing).not.toContain("account.slack");
    });

    test("accepted but the owner has not shared the secret -> says so, not 'accept you', and does not block Install", async () => {
      const r = await pickRow(accountRows(memberProbes(null), team, SLACK_REQS, fakeSecrets(), JOIN_INTENT), "account.slack");
      expect(r.status).toBe("needs-you");
      expect(r.detail).toBe(slackWaitRowDetail({ kind: "not-shared" }, "acme"));
      expect(r.detail).not.toContain("accept");
      expect(r.required).toBe(false);
      expect(r.action).toEqual(PULL);
    });

    test("the team's secrets file cannot be read -> error naming rt team pull, not waiting, and not required", async () => {
      const r = await pickRow(accountRows(memberProbes(board([OWNER, MINE]), { unreadable: [BOARD] }), team, SLACK_REQS, fakeSecrets(), JOIN_INTENT), "account.slack");
      expect(r.status).toBe("error");
      expect(r.detail).toContain(BOARD);
      expect(r.detail).toContain("rt team pull");
      expect(r.required).toBe(false);
      expect(r.action).toEqual(PULL);
    });

    test("a token already connected is validated as before, whatever the client secret's state", async () => {
      const fetch = async () => ({ status: 200, body: JSON.stringify({ ok: true, user: "u", team: "t" }), headers: {} });
      const r = await pickRow(accountRows(memberProbes(board([OWNER]), { fetch }), team, SLACK_REQS, fakeSecrets({ "board.slackToken": "tok" }), JOIN_INTENT), "account.slack");
      expect(r.action).not.toEqual(PULL);
    });
  });
});

describe("accountRows — account.linear declared / not declared", () => {
  test("team.integrations.linear present -> row present, required, no optionalNote", async () => {
    const team = baseTeam({ integrations: { linear: { teamKey: "RT" } } });
    const r = await pickRow(accountRows(fakeProbes(), team, [], fakeSecrets(), null), "account.linear");
    expect(r.required).toBe(true);
    expect(r.optionalNote).toBeNull();
  });

  test("not declared anywhere -> absent", async () => {
    const rows = await accountRows(fakeProbes(), baseTeam(), [], fakeSecrets(), null);
    expect(rows.some((r) => r.id === "account.linear")).toBe(false);
  });
});

describe("accountRows: account.board-peering", () => {
  const HOME = "/fake-home";
  const TEAMS = `${HOME}/.mattstack/teams`;
  const reachable = async (url: string) => (url === `${SWITCHBOARD_URL}/healthz` ? { status: 200, body: "", headers: {} } : { status: 0, body: "", headers: {} });

  /** A machine as a join left it: the team clone and a local record, and nothing else. */
  function machine(teams: Record<string, { joinedByRt: boolean }>, opts: { extra?: Record<string, string>; fetch?: typeof reachable; env?: Record<string, string> } = {}) {
    const files: Record<string, string> = { ...(opts.extra ?? {}) };
    for (const [slug, t] of Object.entries(teams)) {
      files[`${TEAMS}/${slug}/mattstack/org/settings.org.jsonc`] = "// team settings\n{}\n";
      files[`${HOME}/.mattstack/rt/teams/${slug}.json`] = JSON.stringify({ createdByRt: !t.joinedByRt, joinedByRt: t.joinedByRt, rtMayManageMembership: false });
    }
    return fakeProbes({ home: HOME, files, dirs: { [TEAMS]: Object.keys(teams) }, fetch: opts.fetch ?? reachable, env: opts.env ?? {} });
  }

  const rowsFor = (p: ReturnType<typeof fakeProbes>, secrets: SecretPresence = fakeSecrets(), team: TeamSnapshot = baseTeam({ boardProjects: true })) =>
    accountRows(p, team, [], secrets, null);
  const peeringRow = async (p: ReturnType<typeof fakeProbes>, secrets?: SecretPresence) => pickRow(rowsFor(p, secrets), "account.board-peering");
  const withToken = fakeSecrets({ "rt.switchboardToken": "tok-1" });
  const withAdmin = fakeSecrets({ "rt.switchboardAdminToken": "admin-1" });

  test("a team with no token anywhere -> needs-you with the re-invite remedy, never required, no relay probe", async () => {
    const p = machine({ acme: { joinedByRt: true } });
    const r = await peeringRow(p);
    expect(r.status).toBe("needs-you");
    expect(r.required).toBe(false);
    expect(r.finishGated).toBeUndefined();
    expect(r.detail).toContain("acme");
    expect(r.detail).toContain("Ask the team's owner to invite you again (rt team invite --handle <your forge username>)");
    expect(r.action?.type).toBe("steps");
    expect(p.calls.fetch).toEqual([]);
  });

  test("the plan has no switchboard row of its own any more", async () => {
    const rows = await rowsFor(machine({ acme: { joinedByRt: true } }));
    expect(rows.some((row) => row.id === "account.switchboard")).toBe(false);
  });

  test("its note never reads as optional, so the app's Done screen still lists it as outstanding", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }));
    expect(r.optionalNote?.toLowerCase().startsWith("works without")).toBe(false);
  });

  test("a check that throws fails only the peering row", async () => {
    const p = machine({ acme: { joinedByRt: true } });
    p.readDir = () => {
      throw new Error("teams dir unreadable");
    };
    const r = await peeringRow(p);
    expect(r.status).toBe("error");
    expect(r.required).toBe(false);
    expect(r.detail).toContain("teams dir unreadable");
    expect(r.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });
  });

  test("a token in rt's secrets and a switchboard that answers -> ready", async () => {
    const p = machine({ acme: { joinedByRt: true } });
    const r = await peeringRow(p, withToken);
    expect(r.status).toBe("ready");
    expect(p.calls.fetch).toEqual([`${SWITCHBOARD_URL}/healthz`]);
  });

  test("a token only in the board's own .env -> ready, without asking the secrets store", async () => {
    let asked = 0;
    const secrets: SecretPresence = { async has() { asked++; return null; } };
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }, { extra: { [`${HOME}/.mattstack/board/.env`]: "SWITCHBOARD_TOKEN=tok-board\n" } }), secrets);
    expect(r.status).toBe("ready");
    expect(asked).toBe(0);
  });

  test("a token held but the switchboard unreachable -> error with a re-check", async () => {
    const down = async () => ({ status: 0, body: "", headers: {} });
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }, { fetch: down }), withToken);
    expect(r.status).toBe("error");
    expect(r.required).toBe(false);
    expect(r.detail).toContain("could not reach the switchboard");
    expect(r.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });
  });

  test("a token held but the switchboard answers non-200 -> error naming the status", async () => {
    const sick = async () => ({ status: 503, body: "", headers: {} });
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }, { fetch: sick }), withToken);
    expect(r.status).toBe("error");
    expect(r.detail).toContain("HTTP 503");
  });

  test("RT_SWITCHBOARD_URL steers the health probe", async () => {
    const urls: string[] = [];
    const fetch = async (url: string) => {
      urls.push(url);
      return { status: 200, body: "", headers: {} };
    };
    await peeringRow(machine({ acme: { joinedByRt: true } }, { fetch, env: { RT_SWITCHBOARD_URL: "http://127.0.0.1:7940" } }), withToken);
    expect(urls).toEqual(["http://127.0.0.1:7940/healthz"]);
  });

  test("a Mac in no team has no peering row", async () => {
    const rows = await rowsFor(machine({}));
    expect(rows.some((row) => row.id === "account.board-peering")).toBe(false);
  });

  test("a team created on this Mac that holds the admin token gets the row too", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: false } }), withAdmin);
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("acme");
  });

  test("on the Mac that created the team, the row points at inviting your own board, never at asking the owner", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: false } }), withAdmin);
    expect(r.status).toBe("needs-you");
    expect(r.required).toBe(false);
    expect(r.finishGated).toBeUndefined();
    expect(r.detail).toContain("You created acme on this Mac");
    expect(r.detail).not.toContain("invite you again");
    expect(r.optionalNote).not.toContain("owner");
    expect(r.optionalNote?.toLowerCase().startsWith("works without")).toBe(false);
    expect(r.action).toEqual({
      type: "steps",
      label: "Show steps…",
      steps: [
        "Open your board's team members panel",
        "Invite your own username there",
        "Paste that invite into the panel's join row",
        "Re-check this row",
      ],
    });
  });

  test("the creator's Mac without the admin token has no way to peer, so it gets no row", async () => {
    const rows = await rowsFor(machine({ acme: { joinedByRt: false } }));
    expect(rows.find((r) => r.id === "account.board-peering")).toBeUndefined();
  });

  test("the admin token in the board's own .env counts for the creator's Mac", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: false } }, { extra: { [`${HOME}/.mattstack/board/.env`]: "SWITCHBOARD_ADMIN_TOKEN=admin-1\n" } }));
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("You created acme on this Mac");
  });

  test("a creator without the admin token who also joined another team keeps the re-invite remedy", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: false }, beta: { joinedByRt: true } }));
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("invite you again");
  });

  test("the admin token in the environment counts for the creator's Mac", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: false } }, { env: { SWITCHBOARD_ADMIN_TOKEN: "admin-1" } }));
    expect(r.status).toBe("needs-you");
  });

  test("a team that runs no board gets no row", async () => {
    const rows = await rowsFor(machine({ acme: { joinedByRt: true } }), fakeSecrets(), baseTeam());
    expect(rows.find((r) => r.id === "account.board-peering")).toBeUndefined();
  });

  test("a Just Me Mac gets no row", async () => {
    const rows = await accountRows(machine({ acme: { joinedByRt: true } }), baseTeam({ boardProjects: true }), [], fakeSecrets(), null, {}, true);
    expect(rows.find((r) => r.id === "account.board-peering")).toBeUndefined();
  });

  test("every team on the Mac is named, not only the active one", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: false }, beta: { joinedByRt: true } }), withAdmin);
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("acme");
    expect(r.detail).toContain("beta");
  });

  test("a secrets store that throws -> its own could-not-read status, never read as no token", async () => {
    const secrets: SecretPresence = { async has() { throw new Error("keychain locked"); } };
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }), secrets);
    expect(r.status).toBe("error");
    expect(r.detail).toContain("Could not read your secrets store");
    expect(r.detail).toContain("keychain locked");
    expect(r.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });
  });
});

describe("accountRows — required-ness derives from the declaring source (R-T9-b)", () => {
  test("an integration named only by an optional:true tool connect -> required:false, optionalNote mirrors the tool's own why", async () => {
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: [], tools: [{ name: "sdm-cli", why: "db tunnels", optional: true, connect: { integration: "sdm" } }] }];
    const exec: ExecScript = () => ok("session active for a@b.com");
    const r = await pickRow(accountRows(fakeProbes({ exec }), baseTeam(), reqs, fakeSecrets({ "rt.sdmEmail": "a@b.com" }), null), "account.sdm");
    expect(r.required).toBe(false);
    expect(r.optionalNote).toBe("Works without this. db tunnels");
  });

  test("the same integration named by BOTH an optional tool and reqs.integrations -> a required source always wins", async () => {
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: ["sdm"], tools: [{ name: "sdm-cli", why: "db tunnels", optional: true, connect: { integration: "sdm" } }] }];
    const exec: ExecScript = () => ok("session active for a@b.com");
    const r = await pickRow(accountRows(fakeProbes({ exec }), baseTeam(), reqs, fakeSecrets({ "rt.sdmEmail": "a@b.com" }), null), "account.sdm");
    expect(r.required).toBe(true);
    expect(r.optionalNote).toBeNull();
  });
});

describe("accountRows — CLI-owned integrations (no stored secret)", () => {
  test("doppler declared via a pack tool's connect field -> validate() runs directly, required:false (blocker lives in the Tools group)", async () => {
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: [], tools: [{ name: "doppler", why: "reads team secrets", connect: { integration: "doppler" } }] }];
    const exec: ExecScript = (argv) => (argv[0] === "doppler" && argv[1] === "me" ? ok(JSON.stringify({ ok: true })) : ok());
    const r = await pickRow(accountRows(fakeProbes({ exec }), baseTeam(), reqs, fakeSecrets(), null), "account.doppler");
    expect(r.status).toBe("ready");
    expect(r.required).toBe(false);
    expect(r.optionalNote).toContain("Tools group");
    expect(r.action).toBeNull();
  });

  test("doppler declared via reqs.integrations directly -> still required:false (the CLI-owned override always wins)", async () => {
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: ["doppler"], tools: [] }];
    const exec: ExecScript = () => ({ code: 1, stdout: "", stderr: "not logged in" });
    const r = await pickRow(accountRows(fakeProbes({ exec }), baseTeam(), reqs, fakeSecrets(), null), "account.doppler");
    expect(r.required).toBe(false);
  });
});

describe("accountRows — unknown integration id", () => {
  test("an id outside INTEGRATIONS surfaces as an honest error row, never a throw", async () => {
    const badId = "totally-unknown" as unknown as Integration;
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: [badId], tools: [] }];
    const r = await pickRow(accountRows(fakeProbes(), baseTeam(), reqs, fakeSecrets(), null), "account.totally-unknown");
    expect(r.status).toBe("error");
  });
});

describe("accountRows — secrets never leak", () => {
  const SENTINEL = "sk-sentinel-should-never-appear-anywhere";

  test("a stored sentinel token never appears in any row's JSON, or in exec argv (Task 4's leak-table pattern)", async () => {
    const team = baseTeam({
      integrations: {
        forge: { host: "gitlab.example.com", provider: "gitlab" },
        linear: { teamKey: "RT" },
        slack: { clientId: "abc" },
      },
    });
    const reqs: PackRequirements[] = [{ pack: "somepack", integrations: ["github"], tools: [] }];
    const exec: ExecScript = (argv) => (argv[0] === "gh" ? { code: 1, stdout: "", stderr: "" } : ok());
    const fetch = async () => ({ status: 401, body: JSON.stringify({ ok: false, error: "invalid_auth" }), headers: {} });
    const secrets = fakeSecrets({
      "rt.gitlabToken": SENTINEL,
      "rt.linearApiKey": SENTINEL,
      "rt.switchboardToken": SENTINEL,
      "board.slackToken": SENTINEL,
      "rt.githubToken": SENTINEL,
    });

    const p = fakeProbes({ exec, fetch });
    const rows = await accountRows(p, team, reqs, secrets, null);

    for (const r of rows) expect(JSON.stringify(r)).not.toContain(SENTINEL);
    for (const argv of p.calls.exec) expect(argv.join(" ")).not.toContain(SENTINEL);
  });
});

describe("accountRows — per-entry isolation", () => {
  test("one integration's secrets.has() throwing degrades to that entry's own error row; every other declared integration's row is untouched", async () => {
    const team = baseTeam({
      integrations: {
        forge: { host: "gitlab.example.com", provider: "gitlab" },
        linear: { teamKey: "RT" },
      },
    });
    const secrets: SecretPresence = {
      async has(domain, key) {
        if (domain === "rt" && key === "gitlabToken") throw new Error("sops -d exited 1: wrong recipient");
        return null;
      },
    };
    const exec: ExecScript = () => ok();

    const rows = await accountRows(fakeProbes({ exec }), team, [], secrets, null);

    const gitlab = rows.find((r) => r.id === "account.gitlab")!;
    expect(gitlab.status).toBe("error");
    expect(gitlab.required).toBe(true);
    expect(gitlab.detail).toContain("wrong recipient");
    expect(gitlab.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });

    // linear's own secrets.has() call never threw — its row must read exactly
    // as if gitlab's entry did not exist at all.
    const linear = rows.find((r) => r.id === "account.linear")!;
    expect(linear.status).toBe("missing");
  });
});

describe("accountRows, catch-path does not apply cached health (Fix 3)", () => {
  function neutralize(integration: string): void {
    writeCredentialHealth(getStateDb("cli"), {
      integration, status: "error", detail: "test cleanup",
      expiresAt: null, checkedAt: Date.now(), lastNotifiedAt: null, lastNotifiedKind: null,
    });
  }

  test("secrets.has throwing yields bare error, not cached ready from credential_health", async () => {
    const db = getStateDb("cli");
    writeCredentialHealth(db, {
      integration: "gitlab", status: "ready", detail: "gitlab token valid",
      expiresAt: null, checkedAt: Date.now(), lastNotifiedAt: null, lastNotifiedKind: null,
    });

    try {
      const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
      const secrets: SecretPresence = {
        async has() { throw new Error("sops keychain failure"); },
      };
      const r = await pickRow(accountRows(fakeProbes(), team, [], secrets, null), "account.gitlab");
      expect(r.status).toBe("error");
      expect(r.detail).toContain("sops keychain failure");
    } finally {
      neutralize("gitlab");
    }
  });
});

describe("accountRows on solo", () => {
  test("one optional github row, nothing else", async () => {
    const exec: ExecScript = (argv) => (argv[0] === "gh" && argv[1] === "auth" ? { code: 1, stdout: "", stderr: "not logged in" } : ok());
    const rows = await accountRows(fakeProbes({ exec }), baseTeam({ slug: "" }), [], fakeSecrets(), { v: 1, at: "", mode: "solo" }, {}, true);
    expect(rows.map((r) => r.id)).toEqual(["account.github"]);
    expect(rows[0]!.required).toBe(false);
    expect(rows[0]!.optionalNote).toBe("Works without this. Connect a GitHub or GitLab account later to open PRs and MRs from rt.");
    expect(rows[0]!.status).toBe("missing");
  });
});

describe("accountRows, credential_health integration (rt-132)", () => {
  // Neutralizes the row written by each test below to a non-interfering
  // "error" health entry once assertions are done: getStateDb("cli") is a
  // process-wide singleton over one file under the shared test HOME, so a
  // leftover "ready"/near-expiry row here would otherwise bleed into any
  // later test file in the same `bun test` run that also builds a
  // github/gitlab account row.
  function neutralize(integration: string): void {
    writeCredentialHealth(getStateDb("cli"), {
      integration,
      status: "error",
      detail: "test cleanup",
      expiresAt: null,
      checkedAt: Date.now(),
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });
  }

  test("ready row gets an expiry callout when credential_health shows the same integration expiring within 7 days", async () => {
    const db = getStateDb("cli");
    const expiresAt = new Date(Date.now() + 3 * 24 * 3600_000).toISOString().slice(0, 10);
    writeCredentialHealth(db, {
      integration: "github",
      status: "ready",
      detail: "ok",
      expiresAt,
      checkedAt: Date.now(),
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });

    try {
      const fetch = async () => ({ status: 200, body: "{}", headers: {} });
      const team = baseTeam({ integrations: { forge: { host: "github.com", provider: "github" } } });
      const r = await pickRow(
        accountRows(fakeProbes({ fetch }), team, [], fakeSecrets({ "rt.githubToken": "gh_tok" }), null),
        "account.github",
      );
      expect(r.status).toBe("ready");
      expect(r.detail).toContain("Expires in 3 days");
      expect(r.detail).toContain(expiresAt);
    } finally {
      neutralize("github");
    }
  });

  test("ready row is untouched when credential_health has no expiry or expiry is more than 7 days out", async () => {
    const db = getStateDb("cli");
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600_000).toISOString().slice(0, 10);
    writeCredentialHealth(db, {
      integration: "github",
      status: "ready",
      detail: "ok",
      expiresAt,
      checkedAt: Date.now(),
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });

    try {
      const fetch = async () => ({ status: 200, body: "{}", headers: {} });
      const team = baseTeam({ integrations: { forge: { host: "github.com", provider: "github" } } });
      const r = await pickRow(
        accountRows(fakeProbes({ fetch }), team, [], fakeSecrets({ "rt.githubToken": "gh_tok" }), null),
        "account.github",
      );
      expect(r.status).toBe("ready");
      expect(r.detail).toBe("GitHub token works");
    } finally {
      neutralize("github");
    }
  });

  test("error row falls back to a fresh-enough cached credential_health result instead of reading as dead", async () => {
    const db = getStateDb("cli");
    writeCredentialHealth(db, {
      integration: "gitlab",
      status: "ready",
      detail: "gitlab token valid",
      expiresAt: null,
      checkedAt: Date.now() - 4 * 3600_000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });

    try {
      const fetch = async () => ({ status: 0, body: "", headers: {} });
      const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
      const r = await pickRow(
        accountRows(fakeProbes({ fetch }), team, [], fakeSecrets({ "rt.gitlabToken": "tok123" }), null, { forgeHost: "gitlab.example.com" }),
        "account.gitlab",
      );
      // The live probe was unreachable ("error"), but a health row cached
      // "ready" recently enough takes over the row's status and detail.
      expect(r.status).toBe("ready");
      expect(r.detail).toContain("Last checked");
      expect(r.detail).toContain("4h");
    } finally {
      neutralize("gitlab");
    }
  });

  test("invalid row (a rejected credential, not a probe error) is never overridden by a stale cached health result", async () => {
    const db = getStateDb("cli");
    writeCredentialHealth(db, {
      integration: "gitlab",
      status: "ready",
      detail: "gitlab token valid",
      expiresAt: null,
      checkedAt: Date.now() - 4 * 3600_000,
      lastNotifiedAt: null,
      lastNotifiedKind: null,
    });

    try {
      const fetch = async () => ({ status: 401, body: "", headers: {} });
      const team = baseTeam({ integrations: { forge: { host: "gitlab.example.com", provider: "gitlab" } } });
      const r = await pickRow(
        accountRows(fakeProbes({ fetch }), team, [], fakeSecrets({ "rt.gitlabToken": "tok123" }), null, { forgeHost: "gitlab.example.com" }),
        "account.gitlab",
      );
      expect(r.status).toBe("invalid");
      expect(r.detail).not.toContain("last checked");
    } finally {
      neutralize("gitlab");
    }
  });
});
