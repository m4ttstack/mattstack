import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { childEnv } from "../../subprocess.ts";
import { createRealProbes } from "../../setup/probes.ts";
import { teamLocalPath } from "../team-local.ts";
import { describe, test, expect } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { UserActionableError } from "../../errors.ts";
import type { Probes } from "../../setup/probes.ts";
import type { SettingsReader } from "../../setup/team-settings.ts";
import { decodeCode, open } from "../invite-crypto.ts";
import { readInviteRecords } from "../invite-records.ts";
import { INVITE_TTL_DAYS, joinLink, joinLinkBase, mintInvite, pasteBlock, realMintInviteSeams, type MintInviteSeams } from "../invite.ts";
import type { RelayClient } from "../relay-client.ts";
import { SWITCHBOARD_URL } from "../../../packages/rt-client/src/switchboard.ts";
import type { setSetting } from "../../settings/write.ts";

const SLUG = "acme";
const NOW = new Date("2026-08-22T00:00:00.000Z");
const HOME = "/home";
const GIT_CONFIG_PATH = "/home/.mattstack/teams/acme/.git/config";

function gitConfigWithRemote(remote: string): string {
  return `[remote "origin"]\n\turl = ${remote}\n`;
}

function fakeRead(values: Record<string, unknown>): SettingsReader {
  return <T>(key: string): T | undefined => values[key] as T | undefined;
}

interface WriteSettingCall {
  key: string;
  value: unknown;
  scope: string;
  opts: unknown;
}

function writeSettingSpy(): { spy: typeof setSetting; calls: WriteSettingCall[] } {
  const calls: WriteSettingCall[] = [];
  const spy = ((key: string, value: unknown, scope: string, opts?: unknown) => {
    calls.push({ key, value, scope, opts });
  }) as typeof setSetting;
  return { spy, calls };
}

/** Wraps a fakeProbes instance so `writeFile` throws for a chosen path — simulates a malformed/unwritable settings or records store without a dedicated fakeProbes knob. */
function withThrowingWrite(p: Probes, pathSubstring: string, message: string): Probes {
  return {
    ...p,
    writeFile(path, content, mode) {
      if (path.includes(pathSubstring)) throw new Error(message);
      p.writeFile(path, content, mode);
    },
  };
}

interface FakeRelay {
  client: RelayClient;
  createCalls: Array<{ ciphertext: string; expiresAt: string; id?: string }>;
  createReturns: Array<{ id: string; creatorSecret: string }>;
  deleteCalls: Array<{ id: string; creatorSecret: string }>;
  callOrder: string[];
}

function fakeRelayClient(opts: { createId?: (requestedId: string | undefined) => string; onDelete?: (id: string, creatorSecret: string) => void } = {}): FakeRelay {
  const createCalls: FakeRelay["createCalls"] = [];
  const createReturns: FakeRelay["createReturns"] = [];
  const deleteCalls: FakeRelay["deleteCalls"] = [];
  const callOrder: string[] = [];
  let secretCounter = 0;

  const client: RelayClient = {
    async create(ciphertext, expiresAt, id) {
      callOrder.push("create");
      createCalls.push({ ciphertext, expiresAt, id });
      secretCounter++;
      const assignedId = opts.createId ? opts.createId(id) : (id ?? "0".repeat(32));
      const result = { id: assignedId, creatorSecret: `creator-secret-${secretCounter}` };
      createReturns.push(result);
      return result;
    },
    async fetch() {
      throw new Error("fetch not used by mintInvite");
    },
    async redeem() {
      throw new Error("redeem not used by mintInvite");
    },
    async reply() {
      throw new Error("reply not used by mintInvite");
    },
    async readReply() {
      throw new Error("readReply not used by mintInvite");
    },
    async delete(id, creatorSecret) {
      callOrder.push("delete");
      deleteCalls.push({ id, creatorSecret });
      opts.onDelete?.(id, creatorSecret);
    },
  };

  return { client, createCalls, createReturns, deleteCalls, callOrder };
}

function baseSeams(overrides: Partial<MintInviteSeams> = {}): { seams: MintInviteSeams; writeCalls: WriteSettingCall[]; warnings: string[] } {
  const { spy, calls } = writeSettingSpy();
  const warnings: string[] = [];
  const seams: MintInviteSeams = {
    read: fakeRead({
      "mattstack.integrations": { forge: { host: "github.com", provider: "github" } },
      "board.title": "Acme Team",
    }),
    readTeamStore: () => ({ "mattstack.roster": [] }),
    writeSetting: spy,
    currentOrg: () => SLUG,
    pullOrg: async () => {},
    publishRoster: async () => {},
    grantRead: async () => ({ access: "granted", manualSteps: [] }),
    // Default ON so the existing suite keeps exercising the grant path it was
    // written for; the tests below cover the default-off behaviour explicitly.
    readTeamLocal: () => ({ createdByRt: true, joinedByRt: false, rtMayManageMembership: true }),
    forgeLogin: async () => "octocat",
    forgeToken: async () => null,
    readLocalSecret: async () => null,
    warn: (m) => warnings.push(m),
    ...overrides,
  };
  return { seams, writeCalls: calls, warnings };
}

function probesWithRemote(remote: string, extraFiles: Record<string, string> = {}): ReturnType<typeof fakeProbes> {
  return fakeProbes({ home: HOME, files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(remote), ...TEAM_FILES, ...extraFiles } });
}

const TEAM_FILES = {
  "/home/.mattstack/teams/acme/mattstack/teams/widgets/settings.team.jsonc": "{}",
  "/home/.mattstack/teams/acme/mattstack/teams/gadgets/settings.team.jsonc": "{}",
};

const REMOTE = "git@github.com:acme/widgets.git";

const CODE = "01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0-12345-6789A-BC";
const PLAIN = "0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABC";

test("joinLinkBase defaults to mattstack.dev and honours RT_JOIN_BASE_URL", () => {
  expect(joinLinkBase({})).toBe("https://mattstack.dev/join");
  expect(joinLinkBase({ RT_JOIN_BASE_URL: "http://localhost:8788/join" })).toBe("http://localhost:8788/join");
});

test("the code rides in the fragment and nowhere else", () => {
  const link = joinLink("https://mattstack.dev/join", CODE);
  expect(link).toBe(`https://mattstack.dev/join#${CODE}`);
  expect(new URL(link).search).toBe("");
});

test("the fragment satisfies the landing page's own validator", () => {
  const fragment = new URL(joinLink("https://mattstack.dev/join", CODE)).hash.slice(1);
  const normalized = fragment.replace(/[\s-]/g, "").toUpperCase();
  expect(normalized).toHaveLength(77);
  expect(normalized).toBe(PLAIN);
  expect(/^[0-9A-HJKMNP-TV-Z]+$/.test(normalized)).toBe(true);
});

describe("pasteBlock", () => {
  test("leads with the link and keeps the deep link and the bare code", () => {
    const block = pasteBlock(CODE, { link: `https://mattstack.dev/join#${CODE}`, teamName: "Acme" });
    expect(block).toContain(`https://mattstack.dev/join#${CODE}`);
    expect(block).toContain(`mattstack://join/${CODE}`);
    expect(block).toContain(CODE);
    expect(block).toContain("Acme");
  });

  test("honors a custom download URL", () => {
    const block = pasteBlock("CODE", { link: "https://mattstack.dev/join#CODE", teamName: "Acme", downloadUrl: "https://example.test/download" });
    expect(block).toContain("https://example.test/download");
  });
});

describe("mintInvite", () => {
  test("rejects a handle outside the forge-username charset before touching anything", async () => {
    const p = fakeProbes({ home: HOME });
    const { seams } = baseSeams();
    const relay = fakeRelayClient();

    await expect(mintInvite(p, relay.client, { slug: SLUG, handle: "bad handle!", teams: ["widgets"], now: NOW }, seams)).rejects.toThrow(UserActionableError);
    expect(relay.createCalls).toHaveLength(0);
  });

  test("throws no-team-remote when the team has no git remote configured", async () => {
    const p = fakeProbes({ home: HOME });
    const { seams } = baseSeams();
    const relay = fakeRelayClient();

    await expect(mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams)).rejects.toThrow(UserActionableError);
  });

  test("posts only ciphertext to the relay — the pointer's plaintext AND the code's key never appear in the request", async () => {
    const remote = "git@github.com:acme-corp/secret-repo-name.git";
    const p = probesWithRemote(remote);
    const { seams } = baseSeams();
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(relay.createCalls).toHaveLength(1);
    const body = relay.createCalls[0]!.ciphertext;
    expect(body).not.toContain("github.com");
    expect(body).not.toContain("acme-corp");
    expect(body).not.toContain("secret-repo-name");
    expect(body).not.toContain(SLUG);

    const { key } = decodeCode(result.code);
    expect(body).not.toContain(Buffer.from(key).toString("base64"));
    expect(body).not.toContain(Buffer.from(key).toString("hex"));

    // base64 alphabet only — never raw JSON leaking through unsealed.
    expect(body).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  test("expiresAt is now + 7 days, ISO", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams } = baseSeams();
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    const expected = new Date(NOW.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(result.expiresAt).toBe(expected);
    expect(relay.createCalls[0]!.expiresAt).toBe(expected);
  });

  test("an invite for an org this Mac does not read settings from is refused before anything is minted or written", async () => {
    const p = probesWithRemote(REMOTE);
    const relay = fakeRelayClient();
    const { seams, writeCalls } = baseSeams({ currentOrg: () => "zeta" });

    await expect(mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams)).rejects.toMatchObject({
      code: "org-not-current",
      next: "rt team invite zaphod --team zeta",
    });
    expect(writeCalls).toEqual([]);
    expect(relay.callOrder).toEqual([]);

    const none = baseSeams({ currentOrg: () => null });
    await expect(mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, none.seams)).rejects.toMatchObject({ code: "org-not-on-this-mac", next: "rt team join" });
  });

  test("appends the handle to mattstack.roster at org via the writeSetting seam", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams, writeCalls } = baseSeams();
    const relay = fakeRelayClient();

    await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(writeCalls).toEqual([
      { key: "mattstack.roster", value: [{ username: "zaphod", teams: ["widgets"] }], scope: "org", opts: undefined },
    ]);
  });

  test("does not re-add a handle already on the team's own roster", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams, writeCalls } = baseSeams({
      readTeamStore: () => ({ "mattstack.roster": [{ username: "zaphod", teams: ["widgets"] }] }),
    });
    const relay = fakeRelayClient();

    await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(writeCalls).toHaveLength(0);
  });

  test("addToRoster consults the org store's own roster, not the merged view `read` exposes", async () => {
    const p = probesWithRemote(REMOTE);
    // The merged view (`read`) claims zaphod is already on the roster; the org store's own roster says otherwise.
    const { seams, writeCalls } = baseSeams({
      read: fakeRead({
        "mattstack.integrations": { forge: { host: "github.com", provider: "github" } },
        "board.title": "Acme Team",
        "mattstack.roster": [{ username: "zaphod", teams: ["widgets"] }],
      }),
      readTeamStore: () => ({ "mattstack.roster": [] }),
    });
    const relay = fakeRelayClient();

    await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(writeCalls.map((c) => c.key)).toEqual(["mattstack.roster"]);
  });

  test("replace-on-mint creates the new invite before revoking the old one; a failed old-delete does not wedge the mint", async () => {
    const p = probesWithRemote(REMOTE, {
      "/home/.mattstack/rt/invites/acme.json": JSON.stringify({
        zaphod: { id: "1".repeat(32), creatorSecret: "old-secret", keyB64: "a2V5", expiresAt: "2030-01-01T00:00:00.000Z" },
      }),
    });
    const { seams, warnings } = baseSeams();
    const relay = fakeRelayClient({
      onDelete: () => {
        throw new UserActionableError("relay-error", "403 forbidden");
      },
    });

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(result.code).toBeTruthy();
    expect(relay.callOrder).toEqual(["create", "delete"]);
    expect(relay.deleteCalls).toEqual([{ id: "1".repeat(32), creatorSecret: "old-secret" }]);
    expect(warnings.some((w) => w.includes("could not revoke the previous"))).toBe(true);
  });

  test("the returned code decodes back to the relay-assigned id and opens the sealed pointer", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams } = baseSeams();
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    const { idHex, key } = decodeCode(result.code);
    expect(idHex).toBe(relay.createCalls[0]!.id!);

    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer).toEqual({
      v: 2,
      username: "zaphod",
      teams: ["widgets"],
      team: SLUG,
      name: "Acme Team",
      remote: REMOTE,
      owner: "octocat",
      forge: "github.com",
      createdAt: NOW.toISOString(),
    });

    expect(result.pasteBlock).toContain("mattstack://join/");
    expect(result.link).toBe(`https://mattstack.dev/join#${result.code}`);
  });

  test("falls back to the slug as the pointer name when board.title is unset", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams } = baseSeams({
      read: fakeRead({ "mattstack.integrations": { forge: { host: "github.com", provider: "github" } } }),
    });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.name).toBe(SLUG);
  });

  test("an admin token on this Mac: mint registers the member's board on the built-in switchboard and seals only the token", async () => {
    const fetchCalls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const p = fakeProbes({
      home: HOME,
      files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE), ...TEAM_FILES },
      fetch: async (url, init) => {
        fetchCalls.push({ url, init });
        return { status: 201, body: JSON.stringify({ username: "zaphod", token: "tok-9" }), headers: {} };
      },
    });
    const { seams } = baseSeams({ readLocalSecret: async () => "admin-1" });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe(`${SWITCHBOARD_URL}/boards`);
    expect(fetchCalls[0]!.init?.headers?.Authorization).toBe("Bearer admin-1");
    expect(JSON.parse(fetchCalls[0]!.init?.body ?? "{}")).toEqual({ username: "zaphod" });
    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.switchboard).toEqual({ token: "tok-9" });
  });

  test("RT_SWITCHBOARD_URL steers the register to the override", async () => {
    const urls: string[] = [];
    const p = fakeProbes({
      home: HOME,
      env: { RT_SWITCHBOARD_URL: "http://127.0.0.1:7940" },
      files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE), ...TEAM_FILES },
      fetch: async (url) => {
        urls.push(url);
        return { status: 201, body: JSON.stringify({ token: "tok-9" }), headers: {} };
      },
    });
    const { seams } = baseSeams({ readLocalSecret: async () => "admin-1" });

    await mintInvite(p, fakeRelayClient().client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(urls).toEqual(["http://127.0.0.1:7940/boards"]);
  });

  test("no admin token on this Mac: no register, no warning, and the pointer carries no switchboard", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams, warnings } = baseSeams({ readLocalSecret: async () => null });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(p.calls.fetch).toHaveLength(0);
    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.switchboard).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  test("a throwing readLocalSecret stays inside optional peering: the mint still succeeds, warned", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams, warnings } = baseSeams({
      readLocalSecret: async () => {
        throw new Error("keychain sulking");
      },
    });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(result.code).toBeTruthy();
    expect(result.peering).toBe("missing");
    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.switchboard).toBeUndefined();
    expect(warnings).toContain("board peering: keychain sulking");
  });

  test("a failing switchboard register: the mint still succeeds without a sealed token, warned", async () => {
    const p = fakeProbes({
      home: HOME,
      files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE), ...TEAM_FILES },
      fetch: async () => ({ status: 500, body: "", headers: {} }),
    });
    const { seams, warnings } = baseSeams({ readLocalSecret: async () => "admin-1" });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(result.code).toBeTruthy();
    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.switchboard).toBeUndefined();
    expect(warnings).toContain("board peering: the switchboard register answered 500");
  });

  describe("the result says whether board peering rode the invite", () => {
    const registered = () =>
      fakeProbes({
        home: HOME,
        files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE), ...TEAM_FILES },
        fetch: async () => ({ status: 201, body: JSON.stringify({ username: "zaphod", token: "tok-9" }), headers: {} }),
      });
    const refused = () =>
      fakeProbes({
        home: HOME,
        files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE), ...TEAM_FILES },
        fetch: async () => ({ status: 401, body: "", headers: {} }),
      });

    test("an embedded board token reports peering embedded, with no warning", async () => {
      const { seams } = baseSeams({ readLocalSecret: async () => "admin-1" });

      const result = await mintInvite(registered(), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

      expect(result.peering).toBe("embedded");
      expect(result.peeringWarning).toBeUndefined();
    });

    test("no admin token reports peering none", async () => {
      const { seams } = baseSeams();

      const result = await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

      expect(result.peering).toBe("none");
      expect(result.peeringWarning).toBeUndefined();
    });

    test("a token that could not be minted reports peering missing, and the reason goes to the warning's log text", async () => {
      const { seams, warnings } = baseSeams({ readLocalSecret: async () => "admin-1" });

      const result = await mintInvite(refused(), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

      expect(result.peering).toBe("missing");
      expect(result.peeringWarning).toBe("This invite will not connect their board. After they join, invite their board again from the board's members panel.");
      expect(warnings).toContain("board peering: the switchboard register answered 401");
    });

    test("requirePeering refuses a missing token before anything reaches the relay or the roster", async () => {
      const { seams, writeCalls } = baseSeams({ readLocalSecret: async () => "admin-1" });
      const relay = fakeRelayClient();

      const caught = await mintInvite(refused(), relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW, requirePeering: true }, seams).catch((err: unknown) => err);

      expect(caught).toBeInstanceOf(UserActionableError);
      expect((caught as UserActionableError).code).toBe("peering-not-embedded");
      expect((caught as UserActionableError).log).toContain("the switchboard register answered 401");
      expect(relay.createCalls).toEqual([]);
      expect(writeCalls).toEqual([]);
    });

    test("requirePeering refuses a Mac with no admin token before anything reaches the relay or the roster", async () => {
      const { seams, writeCalls } = baseSeams();
      const relay = fakeRelayClient();
      const p = probesWithRemote(REMOTE);

      const caught = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW, requirePeering: true }, seams).catch((err: unknown) => err);

      expect(caught).toBeInstanceOf(UserActionableError);
      expect((caught as UserActionableError).code).toBe("peering-not-embedded");
      expect((caught as UserActionableError).why).toContain("switchboard admin token");
      expect(relay.createCalls).toEqual([]);
      expect(writeCalls).toEqual([]);
      expect(p.calls.fetch).toEqual([]);
    });
  });

  test("derives forge host/provider from the remote when mattstack.integrations is unset", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams } = baseSeams({ read: fakeRead({ "board.title": "Acme Team" }) });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.forge).toBe("github.com");
  });

  test("falls back to p.env.USER as owner when no forge login is available", async () => {
    const p = fakeProbes({ home: HOME, env: { USER: "localuser" }, files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE), ...TEAM_FILES } });
    const { seams } = baseSeams({ read: fakeRead({ "board.title": "Acme Team" }), forgeLogin: async () => null });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.owner).toBe("localuser");
  });

  test("surfaces forgeAccess and manualSteps from the grantRead seam", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams } = baseSeams({
      grantRead: async () => ({ access: "manual", manualSteps: ["Open https://github.com/acme/widgets/settings/access", "Invite zaphod with Read"] }),
    });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(result.forgeAccess).toBe("manual");
    expect(result.manualSteps).toEqual(["Open https://github.com/acme/widgets/settings/access", "Invite zaphod with Read"]);
  });

  test("the forge token rt holds reaches the owner lookup and the grant, so a never-logged-in gh/glab still works", async () => {
    const p = probesWithRemote(REMOTE);
    const seen: { login: unknown; grant: unknown } = { login: undefined, grant: undefined };
    const { seams } = baseSeams({
      forgeToken: async (_p, remote) => (remote === REMOTE ? "ghp-secret" : null),
      forgeLogin: async (_p, _provider, _host, token) => {
        seen.login = token;
        return "octocat";
      },
      grantRead: async (_p, _remote, _handle, token) => {
        seen.grant = token;
        return { access: "granted", manualSteps: [] };
      },
    });
    const relay = fakeRelayClient();

    await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(seen).toEqual({ login: "ghp-secret", grant: "ghp-secret" });
  });

  test("persists the mint record for later revoke/replace, 0600, BEFORE grantRead/addToRoster run", async () => {
    const p = probesWithRemote(REMOTE);
    const order: string[] = [];
    const { seams } = baseSeams({
      grantRead: async (probe, remote, handle) => {
        const records = readInviteRecords(probe, SLUG);
        expect(records[handle]).toBeDefined();
        order.push("grantRead-saw-record");
        return { access: "granted", manualSteps: [] };
      },
    });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(order).toEqual(["grantRead-saw-record"]);
    const records = readInviteRecords(p, SLUG);
    expect(records.zaphod?.id).toBe(relay.createCalls[0]!.id!);
    expect(records.zaphod?.expiresAt).toBe(result.expiresAt);
    expect(p.calls.modes["/home/.mattstack/rt/invites/acme.json"]).toBe(0o600);
  });

  test("a throwing roster write makes no invite or mint record", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams } = baseSeams({
      writeSetting: (() => {
        throw new Error("malformed team store");
      }) as typeof setSetting,
    });
    const relay = fakeRelayClient();

    await expect(mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams)).rejects.toThrow();

    const records = readInviteRecords(p, SLUG);
    expect(records).toEqual({});
    expect(relay.createCalls).toEqual([]);
  });

  test("a failing record write throws, naming the invite id and code so it is recoverable by hand", async () => {
    const p = withThrowingWrite(probesWithRemote(REMOTE), "/rt/invites/", "disk full");
    const { seams } = baseSeams();
    const relay = fakeRelayClient();

    let caught: unknown;
    try {
      await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UserActionableError);
    const err = caught as UserActionableError;
    expect(err.code).toBe("invite-record-write-failed");
    const code = err.message.split("Write its code down now: ")[1]!;
    expect(decodeCode(code).idHex).toBe(relay.createReturns[0]!.id);
    expect(err.log).toBeUndefined();
  });

  test("throws relay-id-mismatch if the relay does not honor the requested invite id", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams } = baseSeams();
    const relay = fakeRelayClient({ createId: () => "f".repeat(32) });

    await expect(mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams)).rejects.toThrow(UserActionableError);
  });
});

// ─── membership permission (MAT-387) ─────────────────────────────────────────

describe("mintInvite: forge membership is not rt's to grant", () => {
  test("permission absent on a repo rt created: never calls the forge, and points at the opt-in verb", async () => {
    const grantCalls: string[] = [];
    const { seams } = baseSeams({
      readTeamLocal: () => ({ createdByRt: true, joinedByRt: false, rtMayManageMembership: false }),
      grantRead: async (_p, _remote, handle) => {
        grantCalls.push(handle);
        return { access: "granted", manualSteps: [] };
      },
    });
    const relay = fakeRelayClient();

    const result = await mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "alice", teams: ["widgets"], now: NOW }, seams);

    expect(grantCalls).toEqual([]);
    expect(result.forgeAccess).toBe("skipped");
    expect(result.manualSteps.join(" ")).toContain("rt team manage-membership on --team acme");
    expect(result.manualSteps.join(" ")).toContain("alice");
  });

  // createdByRt alone must not be enough: provenance decides whether the
  // permission can be OFFERED, never whether it is held.
  test("createdByRt without the permission still does not touch the forge", async () => {
    const grantCalls: string[] = [];
    const { seams } = baseSeams({
      readTeamLocal: () => ({ createdByRt: true, joinedByRt: false, rtMayManageMembership: false }),
      grantRead: async () => {
        grantCalls.push("called");
        return { access: "granted", manualSteps: [] };
      },
    });
    const relay = fakeRelayClient();
    await mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "alice", teams: ["widgets"], now: NOW }, seams);
    expect(grantCalls).toEqual([]);
  });

  test("permission granted: the forge call happens, as before", async () => {
    const grantCalls: string[] = [];
    const { seams } = baseSeams({
      readTeamLocal: () => ({ createdByRt: true, joinedByRt: false, rtMayManageMembership: true }),
      grantRead: async (_p, _remote, handle) => {
        grantCalls.push(handle);
        return { access: "granted", manualSteps: [] };
      },
    });
    const relay = fakeRelayClient();
    const result = await mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "alice", teams: ["widgets"], now: NOW }, seams);
    expect(grantCalls).toEqual(["alice"]);
    expect(result.forgeAccess).toBe("granted");
  });

  // The invite must still be usable — declining to administer someone's repo
  // is not a failure to mint.
  test("the invite is still minted and returned when rt cannot grant", async () => {
    const { seams } = baseSeams({ readTeamLocal: () => ({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false }) });
    const relay = fakeRelayClient();
    const result = await mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "alice", teams: ["widgets"], now: NOW }, seams);
    expect(relay.createCalls.length).toBe(1);
    expect(result.code.length).toBeGreaterThan(0);
  });

  test("createdByRt without the permission points at the opt-in verb, and still never calls the forge", async () => {
    let called = false;
    const { seams } = baseSeams({
      readTeamLocal: () => ({ createdByRt: true, joinedByRt: false, rtMayManageMembership: false }),
      grantRead: async () => { called = true; return { access: "granted" as const, manualSteps: [] }; },
    });
    const relay = fakeRelayClient();
    const result = await mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(called).toBe(false);
    expect(result.forgeAccess).toBe("skipped");
    expect(result.manualSteps[0]).toContain("rt team manage-membership on --team acme");
    expect(result.manualSteps).toContain("Open https://github.com/acme/widgets/settings/access");
  });

  test("the permission alone does not grant on a repo rt did not create", async () => {
    let called = false;
    const { seams } = baseSeams({
      readTeamLocal: () => ({ createdByRt: false, joinedByRt: false, rtMayManageMembership: true }),
      grantRead: async () => { called = true; return { access: "granted" as const, manualSteps: [] }; },
    });
    const relay = fakeRelayClient();
    const result = await mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(called).toBe(false);
    expect(result.forgeAccess).toBe("skipped");
  });

  test("an unparseable remote still gets the admin sentence, never an empty steps list", async () => {
    const { seams } = baseSeams({ readTeamLocal: () => ({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false }) });
    const relay = fakeRelayClient();
    const result = await mintInvite(probesWithRemote("weird://host/thing"), relay.client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(result.manualSteps.length).toBeGreaterThan(0);
    expect(result.manualSteps.at(-1)).toContain("Ask whoever runs the team repo");
  });
});

describe("joinLinkBase refuses a base the code could be intercepted on", () => {
  test("plain http on a public host is refused, since the page reading the fragment could be replaced in transit", () => {
    expect(() => joinLinkBase({ RT_JOIN_BASE_URL: "http://mattstack.example/join" })).toThrow(/https/);
  });

  test("http on loopback is allowed, which is where the harness serves its fixture", () => {
    expect(joinLinkBase({ RT_JOIN_BASE_URL: "http://localhost:8788/join" })).toBe("http://localhost:8788/join");
    expect(joinLinkBase({ RT_JOIN_BASE_URL: "http://127.0.0.1:8788/join" })).toBe("http://127.0.0.1:8788/join");
  });

  test("a refused base that carries credentials is redacted before it reaches the log", () => {
    const secret = "hunter2-invented";
    let caught: unknown;
    try {
      joinLinkBase({ RT_JOIN_BASE_URL: `http://someone:${secret}@mattstack.example/join` });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UserActionableError);
    const actionable = caught as UserActionableError;
    expect(actionable.code).toBe("invalid-join-base");
    expect(actionable.log ?? "").not.toContain(secret);
    expect(actionable.log ?? "").toContain("mattstack.example/join");
  });

  test("a value that is not a url at all is refused rather than pasted into a link", () => {
    expect(() => joinLinkBase({ RT_JOIN_BASE_URL: "mattstack.example/join" })).toThrow(/https/);
  });
});

  describe("teams", () => {
    test("the pointer carries the invited username and the teams, at version 2", async () => {
      const p = probesWithRemote(REMOTE);
      const relay = fakeRelayClient();
      const { seams } = baseSeams();
      const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "dev2", teams: ["widgets", "gadgets"], now: NOW }, seams);
      const { idHex, key } = decodeCode(result.code);
      const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
      expect(pointer).toMatchObject({ v: 2, team: "acme", username: "dev2", teams: ["widgets", "gadgets"] });
    });

    test("a new roster entry carries the teams, first team first, written at org scope", async () => {
      const { seams, writeCalls } = baseSeams();
      await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "dev2", teams: ["widgets", "gadgets"], now: NOW }, seams);
      expect(writeCalls).toEqual([{ key: "mattstack.roster", value: [{ username: "dev2", teams: ["widgets", "gadgets"] }], scope: "org", opts: undefined }]);
    });

    test("re-inviting someone already on the roster adds the new teams after their own and keeps their first team", async () => {
      const { seams, writeCalls } = baseSeams({ readTeamStore: () => ({ "mattstack.roster": [{ username: "Dev2", name: "D", teams: ["gadgets"] }] }) });
      await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "dev2", teams: ["widgets", "gadgets"], now: NOW }, seams);
      expect(writeCalls[0]!.value).toEqual([{ username: "Dev2", name: "D", teams: ["gadgets", "widgets"] }]);
    });

    test("an invite with no team, or a team name that is not a folder name, is refused before anything is minted", async () => {
      const relay = fakeRelayClient();
      const { seams } = baseSeams();
      await expect(mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "dev2", teams: [], now: NOW }, seams)).rejects.toMatchObject({ code: "invite-needs-team" });
      await expect(mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "dev2", teams: ["../x"], now: NOW }, seams)).rejects.toMatchObject({ code: "bad-team-name" });
      expect(relay.createCalls).toEqual([]);
    });

    test("the org is pulled, then the roster entry is written and pushed, all before the invite exists", async () => {
      const relay = fakeRelayClient();
      const order: string[] = [];
      const { seams } = baseSeams({
        pullOrg: async () => { order.push("pull"); },
        readTeamStore: () => { order.push("read roster"); return { "mattstack.roster": [] }; },
        writeSetting: (() => { order.push("write roster"); }) as unknown as MintInviteSeams["writeSetting"],
        publishRoster: async (_p, slug, handle) => { order.push(`publish ${slug} ${handle}, invites so far: ${relay.createCalls.length}`); },
      });
      await mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "dev2", teams: ["widgets"], now: NOW }, seams);
      expect(order).toEqual(["pull", "read roster", "write roster", "publish acme dev2, invites so far: 0"]);
      expect(relay.createCalls.length).toBe(1);
    });

    test("a pull that fails makes no invite and writes no roster", async () => {
      const relay = fakeRelayClient();
      const { seams, writeCalls } = baseSeams({ pullOrg: async () => { throw new Error("could not resolve host"); } });
      await expect(mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "dev2", teams: ["widgets"], now: NOW }, seams)).rejects.toMatchObject({
        code: "org-not-current",
        message: "rt could not bring the org repo up to date, so it made no invite",
        why: "could not resolve host",
      });
      expect(writeCalls).toEqual([]);
      expect(relay.createCalls).toEqual([]);
    });

    test("a re-invite whose entry needs no change still pushes: an earlier write may never have left this Mac", async () => {
      let pushed = 0;
      const { seams, writeCalls } = baseSeams({
        readTeamStore: () => ({ "mattstack.roster": [{ username: "dev2", teams: ["widgets"] }] }),
        publishRoster: async () => { pushed++; },
      });
      await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "dev2", teams: ["widgets"], now: NOW }, seams);
      expect(writeCalls).toEqual([]);
      expect(pushed).toBe(1);
    });

    test("a push that fails makes no invite, and says what to do", async () => {
      const relay = fakeRelayClient();
      const { seams } = baseSeams({ publishRoster: async () => { throw new UserActionableError("push-denied", "The org repo refused the push"); } });
      await expect(mintInvite(probesWithRemote(REMOTE), relay.client, { slug: SLUG, handle: "dev2", teams: ["widgets"], now: NOW }, seams)).rejects.toMatchObject({
        code: "roster-not-published",
        message: "rt could not push dev2's roster entry, so it made no invite",
        why: "The org repo refused the push",
      });
      expect(relay.createCalls).toEqual([]);
    });

    test("a team with no folder in the org is refused", async () => {
      const relay = fakeRelayClient();
      const { seams } = baseSeams();
      const p = probesWithRemote(REMOTE, { "/home/.mattstack/teams/acme/mattstack/teams/widgets/settings.team.jsonc": "{}" });
      await expect(mintInvite(p, relay.client, { slug: SLUG, handle: "dev2", teams: ["sprockets"], now: NOW }, seams)).rejects.toMatchObject({ code: "no-such-team" });
      expect(relay.createCalls).toEqual([]);
    });
  });

describe("real invite git seams", () => {
  test("a known org pulls with rebase and autostash, credentials only in env", async () => {
    const seen: { argv: string[]; env?: Record<string, string> }[] = [];
    const p = probesWithRemote("https://github.com/acme/widgets.git");
    p.exec = async (argv, opts) => { seen.push({ argv, env: opts?.env }); return { code: 0, stdout: "", stderr: "" }; };
    await realMintInviteSeams().pullOrg(p, SLUG, "https://github.com/acme/widgets.git", "private-token");
    expect(seen[0]!.argv).toEqual(["git", "rev-parse", "--verify", "-q", "refs/remotes/origin/main"]);
    expect(seen[1]!.argv.slice(-5)).toEqual(["pull", "--rebase", "--autostash", "origin", "main"]);
    expect(JSON.stringify(seen.map((call) => call.argv))).not.toContain("private-token");
    expect(seen[1]!.env).toMatchObject({ GIT_TERMINAL_PROMPT: "0", RT_GIT_TOKEN: "private-token", RT_GIT_HOST: "github.com" });
  });

  test("a never-published org has nothing to pull", async () => {
    const p = probesWithRemote(REMOTE);
    p.exec = async (argv) => { p.calls.exec.push(argv); return { code: 1, stdout: "", stderr: "" }; };
    await realMintInviteSeams().pullOrg(p, SLUG, REMOTE, null);
    expect(p.calls.exec).toEqual([["git", "rev-parse", "--verify", "-q", "refs/remotes/origin/main"]]);
  });

  test("failed pulls redact urls before mint turns them into a visible reason", async () => {
    const p = probesWithRemote(REMOTE);
    p.exec = async (argv) => argv.includes("pull") ? { code: 1, stdout: "", stderr: "fatal: https://user:private-token@github.com/acme/widgets.git refused" } : { code: 0, stdout: "", stderr: "" };
    const err = await realMintInviteSeams().pullOrg(p, SLUG, REMOTE, null).catch((err: Error) => err);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("private-token");
  });
});

describe("roster publication in an existing clone", () => {
  for (const mode of ["changed", "unchanged", "add-fails", "commit-fails"] as const) {
    test(`${mode}: only the org store is committed and unrelated staged bytes survive`, async () => {
      const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-invite-index-")));
      const dir = join(home, ".mattstack", "teams", "acme");
      mkdirSync(join(dir, "mattstack", "org"), { recursive: true });
      const env = { ...childEnv(), HOME: home, GIT_AUTHOR_NAME: "dev1", GIT_AUTHOR_EMAIL: "dev1@example.com", GIT_COMMITTER_NAME: "dev1", GIT_COMMITTER_EMAIL: "dev1@example.com", GIT_CONFIG_NOSYSTEM: "1" };
      const run = (args: string[]) => {
        const res = Bun.spawnSync(["git", ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
        expect(res.exitCode).toBe(0);
        return res.stdout.toString();
      };
      try {
        run(["init", "-b", "main"]);
        const file = join(dir, "mattstack", "org", "settings.org.jsonc");
        writeFileSync(file, JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: {} }, "mattstack.roster": [] }));
        writeFileSync(join(dir, "unrelated.txt"), "original\n");
        run(["add", "--", "mattstack/org/settings.org.jsonc", "unrelated.txt"]);
        run(["commit", "-m", "fixture"]);
        const head = run(["rev-parse", "HEAD"]);
        writeFileSync(join(dir, "unrelated.txt"), "staged\n");
        run(["add", "--", "unrelated.txt"]);
        writeFileSync(join(dir, "unrelated.txt"), "working\n");
        const staged = run(["diff", "--cached", "--binary", "--", "unrelated.txt"]);
        if (mode !== "unchanged") writeFileSync(file, JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: {} }, "mattstack.roster": [{ username: "dev2", teams: ["widgets"] }] }));
        const local = teamLocalPath(home, "acme");
        mkdirSync(join(local, ".."), { recursive: true });
        writeFileSync(local, JSON.stringify({ forgeUsername: "dev1" }));
        const p = { ...createRealProbes(), home, env };
        const realExec: Probes["exec"] = async (argv, opts) => {
          const res = Bun.spawnSync(argv, { cwd: opts?.cwd, env: { ...env, ...opts?.env }, stdout: "pipe", stderr: "pipe" });
          return { code: res.exitCode, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
        };
        let pushes = 0;
        p.exec = async (argv, opts) => {
          if (argv.includes("push")) { pushes++; return { code: 0, stdout: "", stderr: "" }; }
          if (argv[1] === (mode === "add-fails" ? "add" : mode === "commit-fails" ? "commit" : "")) return { code: 1, stdout: "", stderr: "fixture denied" };
          return realExec(argv, opts);
        };
        const result = realMintInviteSeams().publishRoster(p, "acme", "dev2", REMOTE, null);
        if (mode === "add-fails" || mode === "commit-fails") {
          await expect(result).rejects.toMatchObject({ code: mode === "add-fails" ? "git-add-failed" : "git-commit-failed" });
          expect(pushes).toBe(0);
          expect(run(["rev-parse", "HEAD"])).toBe(head);
        } else {
          await result;
          expect(pushes).toBe(1);
          if (mode === "changed") expect(run(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).trim()).toBe("mattstack/org/settings.org.jsonc");
          else expect(run(["rev-parse", "HEAD"])).toBe(head);
        }
        expect(run(["diff", "--cached", "--binary", "--", "unrelated.txt"])).toBe(staged);
        expect(run(["show", ":unrelated.txt"])).toBe("staged\n");
        expect(p.readFile(join(dir, "unrelated.txt"))).toBe("working\n");
        expect(run(["show", "HEAD:unrelated.txt"])).toBe("original\n");
      } finally { rmSync(home, { recursive: true, force: true }); }
    });
  }
});
