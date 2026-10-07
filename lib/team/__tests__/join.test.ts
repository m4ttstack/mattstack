import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { join as pathJoin } from "path";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { childEnv } from "../../subprocess.ts";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import { createRealProbes } from "../../setup/probes.ts";
import { fakeProbes, type ExecScript } from "../../setup/__tests__/fakes.ts";
import { UserActionableError } from "../../errors.ts";
import { resetCltCacheForTests } from "../../setup/home-git.ts";
import { intentPath, readIntent, type InvitePointer, type SetupIntent } from "../../setup/intent.ts";
import type { Probes } from "../../setup/probes.ts";
import type { SettingsReader } from "../../setup/team-settings.ts";
import { decodeCode, encodeCode, openReply, seal } from "../invite-crypto.ts";
import { JoinKeyExchangeError, JoinPeeringStoreError, joinDryRun, joinRedeem, type JoinRedeemSeams } from "../join.ts";
import type { RelayClient } from "../relay-client.ts";
import type { ShownWarning } from "../../ui/warn.ts";
import type { SecretsSeams } from "../../secrets/store.ts";
import type { AgeExecResult, AgeKeySeam } from "../../home/age-key.ts";
import type { ExecResult } from "../../setup/probes.ts";
import { SWITCHBOARD_URL } from "../../../packages/rt-client/src/switchboard.ts";
import { readTeamLocal, teamLocalPath, updateTeamLocal } from "../team-local.ts";
import * as isolation from "../../../packages/rt-client/src/test-isolation.ts";

const HOME = "/home";
const ID_HEX = "0102030405060708090a0b0c0d0e0f10";
const KEY = new Uint8Array(32).fill(7);
const CODE = encodeCode(ID_HEX, KEY);
const REMOTE = "https://github.com/acme/widgets.git";
const TEAM_DIR = pathJoin(HOME, ".mattstack", "orgs", "acme");

const POINTER: InvitePointer = {
  v: 2, username: "dev2", teams: ["widgets"],
  team: "acme",
  name: "Acme",
  remote: REMOTE,
  owner: "matt",
  forge: "github.com",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const ORG_STORE = `${TEAM_DIR}/mattstack/org/settings.org.jsonc`;
const rosterWith = (...usernames: string[]) => JSON.stringify({ "mattstack.roster": usernames.map((username) => ({ username, teams: ["widgets", "gadgets"] })) });

const NOW = new Date("2026-08-22T00:00:00.000Z");
const SB = SWITCHBOARD_URL;

function gitConfigWithRemote(remote: string): string {
  return `[remote "origin"]\n\turl = ${remote}\n`;
}

interface FakeRelayOpts {
  fetch?: RelayClient["fetch"];
  redeem?: RelayClient["redeem"];
  reply?: RelayClient["reply"];
}

interface FakeRelay {
  client: RelayClient;
  fetchCalls: string[];
  redeemCalls: string[];
  replyCalls: { id: string; blob: string }[];
  callOrder: string[];
}

function fakeRelay(opts: FakeRelayOpts = {}): FakeRelay {
  const fetchCalls: string[] = [];
  const redeemCalls: string[] = [];
  const replyCalls: FakeRelay["replyCalls"] = [];
  const callOrder: string[] = [];

  const client: RelayClient = {
    async create() {
      throw new Error("create not used by join");
    },
    async fetch(id) {
      fetchCalls.push(id);
      callOrder.push("fetch");
      if (opts.fetch) return opts.fetch(id);
      const ciphertext = await seal(POINTER, KEY, ID_HEX);
      return { ciphertext };
    },
    async redeem(id) {
      redeemCalls.push(id);
      callOrder.push("redeem");
      if (opts.redeem) return opts.redeem(id);
      return "redeemed";
    },
    async reply(id, blob) {
      callOrder.push("reply");
      if (opts.reply) return opts.reply(id, blob);
      replyCalls.push({ id, blob });
    },
    async readReply() {
      throw new Error("readReply not used by join");
    },
    async delete() {
      throw new Error("delete not used by join");
    },
  };

  return { client, fetchCalls, redeemCalls, replyCalls, callOrder };
}

/** A `fetch` implementation serving a pointer sealed for the same id/key as CODE, so tests can exercise a hostile/traversal pointer through the exact same decode path as every other test. */
function relayServing(pointer: InvitePointer): RelayClient["fetch"] {
  return async () => ({ ciphertext: await seal(pointer, KEY, ID_HEX) });
}

function fakeRead(values: Record<string, unknown> = {}): SettingsReader {
  return <T>(key: string): T | undefined => values[key] as T | undefined;
}

const FAKE_PUBLIC_KEY = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

function fakeAgeKeySeam(): AgeKeySeam {
  return {
    async run(cmd: string[]): Promise<AgeExecResult> {
      if (cmd[1] === "find-generic-password") return { code: 0, stdout: "AGE-SECRET-KEY-1QQQ\n", stderr: "" };
      if (cmd[0] === "age-keygen" && cmd[1] === "-y") return { code: 0, stdout: `${FAKE_PUBLIC_KEY}\n`, stderr: "" };
      throw new Error(`fakeAgeKeySeam: unexpected call ${cmd.join(" ")}`);
    },
  };
}

/** A keychain that exists but can't be read right now — distinct from "absent" (which mints instead), this is the locked/denied case `ensureAgeKey` refuses to mint over. */
function fakeAgeKeySeamLocked(): AgeKeySeam {
  return {
    async run(): Promise<AgeExecResult> {
      return { code: 1, stdout: "", stderr: "keychain locked" };
    },
  };
}

function baseJoinRedeemSeams(overrides: Partial<JoinRedeemSeams> = {}): {
  seams: JoinRedeemSeams;
  calls: {
    readTeamSecret: unknown[][];
    forgeLogin: unknown[][];
    secretWrites: { key: string; value: string }[];
    userSettingWrites: { key: string; value: unknown }[];
  };
} {
  const calls = {
    readTeamSecret: [] as unknown[][],
    forgeLogin: [] as unknown[][],
    secretWrites: [] as { key: string; value: string }[],
    userSettingWrites: [] as { key: string; value: unknown }[],
  };
  const seams: JoinRedeemSeams = {
    ageKeySeam: fakeAgeKeySeam(),
    read: fakeRead(),
    readTeamSecret: (async (...args: unknown[]) => {
      calls.readTeamSecret.push(args);
      return null;
    }) as JoinRedeemSeams["readTeamSecret"],
    forgeLogin: (async (...args: unknown[]) => {
      calls.forgeLogin.push(args);
      return "dev2";
    }) as JoinRedeemSeams["forgeLogin"],
    forgeToken: async () => null,
    localStoreReady: async () => true,
    writeLocalSecret: async (key, value) => {
      calls.secretWrites.push({ key, value });
    },
    writeUserSetting: (key, value) => { calls.userSettingWrites.push({ key, value }); },
    warn: () => {},
    ...overrides,
  };
  return { seams, calls };
}

const NO_SECRETS: SecretsSeams = {} as SecretsSeams;

/** A script for git's answer alone: the CLT guard (`xcode-select -p`) that precedes the git call answers ok. */
function gitAnswers(script: ExecScript): ExecScript {
  return (argv, opts) => (argv[0] === "xcode-select" ? { code: 0, stdout: "/Library/Developer/CommandLineTools", stderr: "" } : script(argv, opts));
}

function relayWith(pointer: InvitePointer): RelayClient {
  return fakeRelay({ fetch: relayServing(pointer) }).client;
}

function unreachableRelay(): RelayClient {
  return fakeRelay({
    fetch: async () => {
      throw new UserActionableError("relay-unreachable", "could not reach the invite relay");
    },
  }).client;
}

function ok(): ExecResult {
  return { code: 0, stdout: "", stderr: "" };
}

describe("joinDryRun", () => {
  beforeEach(() => resetCltCacheForTests());

  test("no Command Line Tools yet: git is never run (the xcode-select shim fails and raises Apple's dialog); access deferred, intent written, message defers to the next screen", async () => {
    const seen: string[][] = [];
    const p = fakeProbes({
      home: HOME,
      now: NOW,
      exec: (argv) => {
        seen.push(argv);
        return argv[0] === "xcode-select" ? { code: 2, stdout: "", stderr: "xcode-select: error: unable to get active developer directory" } : { code: 0, stdout: "", stderr: "" };
      },
    });
    const relay = fakeRelay();

    const result = await joinDryRun(p, relay.client, CODE);

    expect(result.access).toBe("deferred");
    expect(result.intent).toBe("written");
    expect(result.message).toContain("once Apple's Command Line Tools are installed");
    expect(readIntent(p)?.mode).toBe("join");
    expect(seen.some((argv) => argv[0] === "git")).toBe(false);
  });

  test("happy path: access ok, writes the resumable intent, exact message", async () => {
    const p = fakeProbes({ home: HOME, now: NOW, exec: () => ({ code: 0, stdout: "", stderr: "" }) });
    const relay = fakeRelay();

    const result = await joinDryRun(p, relay.client, CODE);

    expect(result).toEqual({
      team: { slug: "acme", name: "Acme", owner: "matt" },
      teams: ["widgets"],
      access: "ok",
      peering: "idle",
      message: "Joining Acme, owned by matt.",
      intent: "written",
    });

    const raw = p.calls.writes[intentPath(HOME)];
    expect(raw).toBeDefined();
    const intent = JSON.parse(raw!) as SetupIntent;
    expect(intent.mode).toBe("join");
    expect(intent.join?.id).toBe(ID_HEX);
    expect(intent.join?.keyB64).toBe(Buffer.from(KEY).toString("base64"));
    expect(intent.join?.pointer).toEqual(POINTER);
  });

  test("a malformed code never reaches the relay", async () => {
    const p = fakeProbes({ home: HOME });
    const relay = fakeRelay();

    await expect(joinDryRun(p, relay.client, "not-a-real-code")).rejects.toThrow(UserActionableError);
    expect(relay.fetchCalls).toHaveLength(0);
  });

  test("relay 'gone' throws invite-unknown, exact message", async () => {
    const p = fakeProbes({ home: HOME });
    const relay = fakeRelay({ fetch: async () => "gone" });

    let caught: unknown;
    try {
      await joinDryRun(p, relay.client, CODE);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UserActionableError);
    expect((caught as UserActionableError).code).toBe("invite-unknown");
    expect((caught as UserActionableError).message).toBe("That invite has expired or is not one rt knows");
    expect((caught as UserActionableError).why).toBe("Ask the team's owner for a new one.");
  });

  test("an undecodable blob (wrong key/id) also maps to invite-unknown", async () => {
    const p = fakeProbes({ home: HOME });
    const relay = fakeRelay({
      fetch: async () => ({ ciphertext: await seal(POINTER, KEY, "f".repeat(32)) }), // sealed under a different AAD id
    });

    await expect(joinDryRun(p, relay.client, CODE)).rejects.toMatchObject({ code: "invite-unknown" });
  });

  test("relay-unreachable reports access:unreachable at exit 0 (no throw), empty team", async () => {
    const p = fakeProbes({ home: HOME });
    const relay = fakeRelay({
      fetch: async () => {
        throw new UserActionableError("relay-unreachable", "could not reach the invite relay");
      },
    });

    const result = await joinDryRun(p, relay.client, CODE);
    expect(result.access).toBe("unreachable");
    expect(result.team).toEqual({ slug: "", name: "", owner: "" });
    expect(result.teams).toEqual([]);
    expect(result.peering).toBe("idle");
  });

  test("a programming error from relay.fetch is not swallowed into 'check your network'", async () => {
    const p = fakeProbes({ home: HOME });
    const relay = fakeRelay({
      fetch: async () => {
        throw new TypeError("boom: not a relay-client error at all");
      },
    });

    await expect(joinDryRun(p, relay.client, CODE)).rejects.toThrow(TypeError);
  });

  test("ls-remote auth failure: access denied, message has no URL and no raw git output", async () => {
    const p = fakeProbes({
      home: HOME,
      exec: gitAnswers(() => ({ code: 128, stdout: "", stderr: "fatal: Authentication failed for 'https://github.com/acme/widgets.git/'" })),
    });
    const relay = fakeRelay();

    const result = await joinDryRun(p, relay.client, CODE);

    expect(result.access).toBe("denied");
    expect(result.message).toContain("Ask matt or your org admin for read access.");
    expect(result.message).not.toContain("widgets.git/'");
    expect(result.message).not.toContain("fatal:");
  });

  test("ls-remote exit 2 (empty repo, no HEAD) still counts as access ok", async () => {
    const p = fakeProbes({ home: HOME, now: NOW, exec: gitAnswers(() => ({ code: 2, stdout: "", stderr: "" })) });
    const relay = fakeRelay();

    const result = await joinDryRun(p, relay.client, CODE);
    expect(result.access).toBe("ok");
    expect(result.intent).toBe("written");
  });

  test("no credential at all (could not read Username) with no token: access no-account, intent written, message directs to next screen", async () => {
    const p = fakeProbes({ home: HOME, now: NOW, exec: gitAnswers(() => ({ code: 128, stdout: "", stderr: "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled" })) });
    const relay = fakeRelay();

    const result = await joinDryRun(p, relay.client, CODE);
    expect(result.access).toBe("no-account");
    expect(result.intent).toBe("written");
    expect(result.message).toContain("account so rt can reach the team repo.");
    expect(readIntent(p)?.mode).toBe("join");
  });

  test("a non-auth git failure reports access:unreachable, message provides detail and re-check guidance", async () => {
    const p = fakeProbes({ home: HOME, exec: gitAnswers(() => ({ code: 128, stdout: "", stderr: "fatal: Could not resolve host: github.com" })) });
    const relay = fakeRelay();

    const result = await joinDryRun(p, relay.client, CODE);
    expect(result.access).toBe("unreachable");
    expect(result.message).toContain("It checks again when you join.");
  });

  test("uses GIT_TERMINAL_PROMPT=0, --exit-code against the pointer's remote, and offers the forge token", async () => {
    const calls: { argv: string[]; opts?: Parameters<Probes["exec"]>[1] }[] = [];
    const p = fakeProbes({
      home: HOME,
      exec: (argv, opts) => {
        calls.push({ argv, opts });
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const relay = fakeRelay();

    await joinDryRun(p, relay.client, CODE);

    const git = calls.filter((c) => c.argv[0] === "git");
    expect(git).toHaveLength(1);
    expect(git[0]!.argv).toEqual(["git", "ls-remote", "--exit-code", REMOTE, "HEAD"]);
    expect(git[0]!.opts?.env?.GIT_TERMINAL_PROMPT).toBe("0");
  });

  describe("a hostile pointer is rejected before it ever reaches a path join or a git argv", () => {
    test("ext:: remote — never even attempts an exec call", async () => {
      const p = fakeProbes({ home: HOME });
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, remote: "ext::sh -c 'touch /tmp/pwned'" }) });

      await expect(joinDryRun(p, relay.client, CODE)).rejects.toMatchObject({ code: "invite-malformed" });
      expect(p.calls.exec).toHaveLength(0);
    });

    test("a traversal team slug — rejected before any local path is touched", async () => {
      const p = fakeProbes({ home: HOME });
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, team: "../../etc" }) });

      await expect(joinDryRun(p, relay.client, CODE)).rejects.toMatchObject({ code: "invite-malformed" });
      expect(p.calls.exec).toHaveLength(0);
    });

    test("file:// remote is rejected", async () => {
      const p = fakeProbes({ home: HOME });
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, remote: "file:///etc/passwd" }) });

      await expect(joinDryRun(p, relay.client, CODE)).rejects.toMatchObject({ code: "invite-malformed" });
      expect(p.calls.exec).toHaveLength(0);
    });

    test("a remote whose host starts with '-' (ssh option injection) is rejected", async () => {
      const p = fakeProbes({ home: HOME });
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, remote: "ssh://-oProxyCommand=x/acme/widgets.git" }) });

      await expect(joinDryRun(p, relay.client, CODE)).rejects.toMatchObject({ code: "invite-malformed" });
      expect(p.calls.exec).toHaveLength(0);
    });

    test("a remote carrying --upload-pack= (space-separated tail) is rejected", async () => {
      const p = fakeProbes({ home: HOME });
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, remote: "https://github.com/acme/widgets.git --upload-pack=touch /tmp/x" }) });

      await expect(joinDryRun(p, relay.client, CODE)).rejects.toMatchObject({ code: "invite-malformed" });
      expect(p.calls.exec).toHaveLength(0);
    });

    test("N5: the whitespace rule rejects --config= and -c tails just as symmetrically as --upload-pack=", async () => {
      for (const remote of [
        "https://github.com/acme/widgets.git --config=core.sshCommand=id",
        "https://github.com/acme/widgets.git -c core.pager=id",
      ]) {
        const p = fakeProbes({ home: HOME });
        const relay = fakeRelay({ fetch: relayServing({ ...POINTER, remote }) });

        await expect(joinDryRun(p, relay.client, CODE)).rejects.toMatchObject({ code: "invite-malformed" });
        expect(p.calls.exec).toHaveLength(0);
      }
    });

    test("N3: a 5000-char slug is rejected cleanly (not left to fail as ENAMETOOLONG deep in git)", async () => {
      const p = fakeProbes({ home: HOME });
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, team: "a".repeat(5000) }) });

      await expect(joinDryRun(p, relay.client, CODE)).rejects.toMatchObject({ code: "invite-malformed" });
      expect(p.calls.exec).toHaveLength(0);
    });

    test("N2: control characters and ANSI escapes in name/owner never reach the human message — sanitized, not merely tolerated", async () => {
      const p = fakeProbes({ home: HOME, now: NOW, exec: () => ({ code: 0, stdout: "", stderr: "" }) });
      const hostileName = "\x1b[2J\x1b[1;1HFAKE-SCREEN-CLEAR";
      const hostileOwner = "matt\nrt team join: Joined Acme (owner matt)";
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, name: hostileName, owner: hostileOwner }) });

      const result = await joinDryRun(p, relay.client, CODE);

      expect(result.access).toBe("ok");
      expect(result.team.name).not.toContain("\x1b");
      expect(result.team.owner).not.toContain("\n");
      expect(result.message).not.toContain("\x1b");
      expect(result.message).not.toContain("\n");
      expect(result.message).not.toMatch(/[\x00-\x1f\x7f]/);
    });

    test("a well-formed https, scp-like, ssh-with-port, and credential-bearing https remote all pass (regression guard)", async () => {
      for (const remote of [
        "https://github.com/acme/widgets.git",
        "https://github.com/acme/widgets.git",
        "ssh://git@github.com/acme/widgets.git",
        "ssh://git@github.com:2222/acme/widgets.git",
        "https://user:pass@github.com/acme/widgets.git",
      ]) {
        const p = fakeProbes({ home: HOME, now: NOW, exec: () => ({ code: 0, stdout: "", stderr: "" }) });
        const relay = fakeRelay({ fetch: relayServing({ ...POINTER, remote }) });
        const result = await joinDryRun(p, relay.client, CODE);
        expect(result.access).toBe("ok");
      }
    });
  });

  test("a denial writes the intent anyway, so Continue can proceed and the checklist holds the line", async () => {
    const p = fakeProbes({ exec: gitAnswers(() => ({ code: 128, stdout: "", stderr: "remote: Permission denied" })) });
    const r = await joinDryRun(p, relayWith(POINTER), CODE);
    expect(r.access).toBe("denied");
    expect(r.intent).toBe("written");
    expect(r.message).toContain("Ask matt or your org admin for read access.");
    expect(readIntent(p)?.mode).toBe("join");
  });

  test("no forge account connected says so by name", async () => {
    const p = fakeProbes({ exec: gitAnswers(() => ({ code: 128, stdout: "", stderr: "fatal: could not read Username" })) });
    const r = await joinDryRun(p, relayWith(POINTER), CODE);
    expect(r.access).toBe("no-account");
    expect(r.intent).toBe("written");
  });

  test("an unreachable relay writes nothing and still blocks", async () => {
    const p = fakeProbes({ exec: gitAnswers(() => ok()) });
    const r = await joinDryRun(p, unreachableRelay(), CODE);
    expect(r.access).toBe("unreachable");
    expect(r.intent).toBe("not-written");
    expect(readIntent(p)).toBeNull();
  });

  test("the probe is offered rt's token, so a private repo is a verdict rather than a deferral", async () => {
    const envs: Record<string, string>[] = [];
    const exec = gitAnswers((argv, opts) => { envs.push((opts?.env ?? {}) as Record<string, string>); return ok(); });
    const p = fakeProbes({
      exec,
      home: "/home/joiner",
      files: { "/home/joiner/.mattstack/rt/setup-staging/rt.json": JSON.stringify({ githubToken: "gho_x" }) },
    });
    await joinDryRun(p, relayWith(POINTER), CODE);
    expect(envs.some((e) => e.RT_GIT_TOKEN === "gho_x")).toBe(true);
  });
});

describe("joinRedeem", () => {
  function redeemProbes(overrides: Parameters<typeof fakeProbes>[0] = {}): ReturnType<typeof fakeProbes> {
    return fakeProbes({ home: HOME, now: NOW, exec: () => ({ code: 0, stdout: "", stderr: "" }), ...overrides, files: { [ORG_STORE]: rosterWith("dev2"), ...(overrides?.files ?? {}) } });
  }

  test("clones, redeems after the clone, and posts a reply blob the inviter can open", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("ok");
    expect(p.calls.exec).toContainEqual(["git", "clone", REMOTE, TEAM_DIR]);
    expect(relay.callOrder).toEqual(["fetch", "redeem", "reply"]);
    expect(relay.redeemCalls).toEqual([ID_HEX]);

    expect(relay.replyCalls).toHaveLength(1);
    const reply = await openReply(relay.replyCalls[0]!.blob, KEY, ID_HEX);
    expect(reply.agePublicKey).toBe(FAKE_PUBLIC_KEY);
    expect(reply.handle).toBe("dev2");

    // The code itself never leaks into the result.
    expect(JSON.stringify(result)).not.toContain(CODE);
  });

  test("clone uses GIT_TERMINAL_PROMPT=0 and GIT_PROTOCOL_FROM_USER=0", async () => {
    const calls: { argv: string[]; opts?: Parameters<Probes["exec"]>[1] }[] = [];
    const p = redeemProbes({
      exec: (argv, opts) => {
        calls.push({ argv, opts });
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    const clone = calls.find((c) => c.argv[1] === "clone")!;
    expect(clone.opts?.env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(clone.opts?.env?.GIT_PROTOCOL_FROM_USER).toBe("0");
  });

  test("a forge token rt holds is offered to the clone through the env, never argv, and to the forge-login check", async () => {
    const calls: { argv: string[]; opts?: Parameters<Probes["exec"]>[1] }[] = [];
    const p = redeemProbes({
      exec: (argv, opts) => {
        calls.push({ argv, opts });
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const relay = fakeRelay();
    const { seams, calls: seamCalls } = baseJoinRedeemSeams({ forgeToken: async () => "glpat-secret" });

    await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    const clone = calls.find((c) => c.argv.includes("clone"))!;
    expect(clone.argv.join(" ")).not.toContain("glpat-secret");
    expect(clone.argv).toEqual(expect.arrayContaining([expect.stringMatching(/^credential\.https:\/\/[^/]+\.helper=$/)]));
    expect(clone.opts?.env?.RT_GIT_TOKEN).toBe("glpat-secret");
    expect(clone.opts?.env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(seamCalls.forgeLogin[0]?.[3]).toBe("glpat-secret");
  });

  test("the stored token is withheld from a pointer remote on a host the user never confirmed: the token seam is not consulted, the clone and forge-login run tokenless", async () => {
    const hostile: InvitePointer = { ...POINTER, remote: "https://gitlab.evil.example/acme/widgets.git" };
    const calls: { argv: string[]; opts?: Parameters<Probes["exec"]>[1] }[] = [];
    const p = redeemProbes({
      exec: (argv, opts) => {
        calls.push({ argv, opts });
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const relay = fakeRelay({ fetch: relayServing(hostile) });
    const tokenReads: string[] = [];
    const { seams, calls: seamCalls } = baseJoinRedeemSeams({
      forgeToken: async (_p, remote) => {
        tokenReads.push(remote);
        return "glpat-secret";
      },
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("ok");
    expect(tokenReads).toEqual([]);
    const clone = calls.find((c) => c.argv.includes("clone"))!;
    expect(clone.opts?.env?.RT_GIT_TOKEN).toBeUndefined();
    expect(seamCalls.forgeLogin[0]?.[3]).toBeNull();
  });

  test("the stored token IS offered to the one self-hosted host the user confirmed through rt setup connect", async () => {
    const pointer: InvitePointer = { ...POINTER, remote: "https://gitlab.corp.example/acme/widgets.git" };
    const calls: { argv: string[]; opts?: Parameters<Probes["exec"]>[1] }[] = [];
    const p = redeemProbes({
      exec: (argv, opts) => {
        calls.push({ argv, opts });
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const relay = fakeRelay({ fetch: relayServing(pointer) });
    const { seams, calls: seamCalls } = baseJoinRedeemSeams({
      read: fakeRead({ "rt.integrations": { forgeHost: "gitlab.corp.example" } }),
      forgeToken: async () => "glpat-secret",
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("ok");
    const clone = calls.find((c) => c.argv.includes("clone"))!;
    expect(clone.opts?.env?.RT_GIT_TOKEN).toBe("glpat-secret");
    expect(seamCalls.forgeLogin[0]?.[3]).toBe("glpat-secret");
  });

  test("a trusted forge declaration on a different host gets ITS OWN token, never the clone remote's credential", async () => {
    // github.com clone, gitlab.com forge declaration: both hosts pass the
    // gate on their own, but the github credential must not be forwarded to
    // the gitlab host -- forge-login's token is looked up for forge.host.
    const p = redeemProbes();
    const relay = fakeRelay();
    const tokenReads: string[] = [];
    const { seams, calls: seamCalls } = baseJoinRedeemSeams({
      read: fakeRead({ "mattstack.integrations": { forge: { host: "gitlab.com", provider: "gitlab" } } }),
      forgeToken: async (_p, remote) => {
        tokenReads.push(remote);
        return remote.includes("gitlab.com") ? "glpat-for-gitlab" : "ghp-for-github";
      },
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("ok");
    expect(seamCalls.forgeLogin[0]?.[2]).toBe("gitlab.com");
    expect(seamCalls.forgeLogin[0]?.[3]).toBe("glpat-for-gitlab");
  });

  test("a cloned team's own forge declaration cannot route the token to an unconfirmed host: forge-login there runs tokenless", async () => {
    const calls: { argv: string[]; opts?: Parameters<Probes["exec"]>[1] }[] = [];
    const p = redeemProbes({
      exec: (argv, opts) => {
        calls.push({ argv, opts });
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const relay = fakeRelay();
    const { seams, calls: seamCalls } = baseJoinRedeemSeams({
      read: fakeRead({ "mattstack.integrations": { forge: { host: "gitlab.evil.example", provider: "gitlab" } } }),
      forgeToken: async () => "ghp-secret",
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("ok");
    // The clone target (github.com) is unspoofable, so the clone keeps its token.
    const clone = calls.find((c) => c.argv.includes("clone"))!;
    expect(clone.opts?.env?.RT_GIT_TOKEN).toBe("ghp-secret");
    expect(seamCalls.forgeLogin[0]?.[2]).toBe("gitlab.evil.example");
    expect(seamCalls.forgeLogin[0]?.[3]).toBeNull();
  });

  test("in a test run whose home is the account's, refuses before the intent, the clone, or the redeem", async () => {
    const spy = spyOn(isolation, "accountHome").mockReturnValue(HOME);
    try {
      const p = redeemProbes();
      const relay = fakeRelay();
      const { seams } = baseJoinRedeemSeams();
      await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toThrow(/Run bun test from the repo root/);
      expect(p.calls.exec).toEqual([]);
      expect(p.calls.writes[intentPath(HOME)]).toBeUndefined();
      expect(relay.redeemCalls).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  test("checkpoints the resumable intent as soon as the pointer resolves, before cloning", async () => {
    const p = redeemProbes({
      exec: (argv) => {
        // The intent write must have happened before the clone call runs.
        if (argv[1] === "clone") expect(p.calls.writes[intentPath(HOME)]).toBeDefined();
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
    expect(p.calls.writes[intentPath(HOME)]).toBeDefined();
  });

  test("records joinedByRt BEFORE the clone runs, so the daemon watcher cannot race it", async () => {
    const seen: string[] = [];
    const p = redeemProbes({
      exec: (argv) => {
        if (argv[1] === "clone") seen.push(readTeamLocal(p, POINTER.team).joinedByRt ? "flag-first" : "clone-first");
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(seen).toEqual(["flag-first"]);
    expect(readTeamLocal(p, POINTER.team).joinedByRt).toBe(true);
  });

  test("no pointer token + a readable admin token → peering applied: POSTs /boards, stores the returned board token as the local switchboardToken secret", async () => {
    const fetchCalls: { url: string; init?: Parameters<Probes["fetch"]>[1] }[] = [];
    const p = redeemProbes({
      fetch: async (url, init) => {
        fetchCalls.push({ url, init });
        return { status: 201, body: JSON.stringify({ username: "dev2", token: "tok-1" }), headers: {} };
      },
    });
    const relay = fakeRelay();
    const { seams, calls } = baseJoinRedeemSeams({
      readTeamSecret: async () => "admin-token-xyz",
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("applied");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe(`${SB}/boards`);
    expect(fetchCalls[0]!.init?.method).toBe("POST");
    expect(fetchCalls[0]!.init?.headers?.Authorization).toBe("Bearer admin-token-xyz");
    expect(JSON.parse(fetchCalls[0]!.init?.body ?? "{}")).toEqual({ username: "dev2" });
    expect(calls.secretWrites).toEqual([{ key: "switchboardToken", value: "tok-1" }]);
  });

  test("a pointer carrying an embedded switchboard token: stored directly, peering applied, no switchboard call and no team-secret read", async () => {
    const p = redeemProbes();
    const embedded = { ...POINTER, switchboard: { url: SB, token: "tok-emb" } };
    const relay = fakeRelay({ fetch: relayServing(embedded) });
    const secretReads: unknown[] = [];
    const { seams, calls } = baseJoinRedeemSeams({
      readTeamSecret: (async (...args: unknown[]) => {
        secretReads.push(args);
        return null;
      }) as JoinRedeemSeams["readTeamSecret"],
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("applied");
    expect(calls.secretWrites).toEqual([{ key: "switchboardToken", value: "tok-emb" }]);
    expect(p.calls.fetch).toHaveLength(0);
    expect(secretReads).toEqual([]);
  });

  test("an older invite naming a different switchboard is refused: unavailable, nothing stored, its token never sent anywhere", async () => {
    const p = redeemProbes();
    const embedded = { ...POINTER, switchboard: { url: "https://evil.test", token: "tok-x" } };
    const relay = fakeRelay({ fetch: relayServing(embedded) });
    const warnings: string[] = [];
    const { seams, calls } = baseJoinRedeemSeams({ warn: (m) => warnings.push(m) });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("unavailable");
    expect(result.peeringFix).toContain("Ask matt to invite dev2 again");
    expect(calls.secretWrites).toEqual([]);
    expect(p.calls.fetch).toHaveLength(0);
    expect(warnings.some((w) => w.includes("different switchboard"))).toBe(true);
  });

  test("an older invite naming this switchboard, trailing slash and all, is accepted", async () => {
    const p = redeemProbes();
    const embedded = { ...POINTER, switchboard: { url: `${SB}/`, token: "tok-old" } };
    const relay = fakeRelay({ fetch: relayServing(embedded) });
    const { seams, calls } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("applied");
    expect(calls.secretWrites).toEqual([{ key: "switchboardToken", value: "tok-old" }]);
  });

  test("an invite from this rt seals only the token: stored, applied, no network call", async () => {
    const p = redeemProbes();
    const embedded = { ...POINTER, switchboard: { token: "tok-new" } };
    const relay = fakeRelay({ fetch: relayServing(embedded) });
    const { seams, calls } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("applied");
    expect(calls.secretWrites).toEqual([{ key: "switchboardToken", value: "tok-new" }]);
    expect(p.calls.fetch).toHaveLength(0);
  });

  test("RT_SWITCHBOARD_URL steers the re-join register to the override", async () => {
    const urls: string[] = [];
    const p = redeemProbes({
      env: { RT_SWITCHBOARD_URL: "http://localhost:7940" },
      fetch: async (url) => {
        urls.push(url);
        return { status: 201, body: JSON.stringify({ token: "tok-1" }), headers: {} };
      },
    });
    const { seams } = baseJoinRedeemSeams({ readTeamSecret: async () => "admin-token" });

    const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("applied");
    expect(urls).toEqual(["http://localhost:7940/boards"]);
  });

  test("a throwing readTeamSecret stays inside peering: unavailable, join still ok", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams({
      readTeamSecret: async () => {
        throw new Error("keychain sulking");
      },
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("ok");
    expect(result.peering).toBe("unavailable");
  });

  test("a team-secrets failure inside peering keeps its next command in the warning", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const shown: Array<ShownWarning | undefined> = [];
    const { seams } = baseJoinRedeemSeams({
      readTeamSecret: async () => {
        throw new UserActionableError("team-secrets-unreadable", "This Mac cannot read the acme team's secrets yet", { team: "acme" }, { why: "No key matches.", next: "rt team pull", log: "sops -d /x/rt.json: no key" });
      },
      warn: (_message, copy) => {
        shown.push(copy);
      },
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("unavailable");
    expect(shown).toContainEqual({
      title: "rt could not register your board with the switchboard",
      hint: "This Mac cannot read the acme team's secrets yet",
      next: { text: "rt team pull", role: "command" },
    });
  });

  test("a plain error inside peering warns with no next command", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const shown: Array<ShownWarning | undefined> = [];
    const { seams } = baseJoinRedeemSeams({
      readTeamSecret: async () => {
        throw new Error("keychain sulking\nsecond line");
      },
      warn: (_message, copy) => {
        shown.push(copy);
      },
    });

    await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(shown).toContainEqual({ title: "rt could not register your board with the switchboard", hint: "keychain sulking" });
  });

  test("a 2xx register with no parsable token → peering:unavailable, nothing written, and the message names the re-invite repair", async () => {
    const p = redeemProbes({ fetch: async () => ({ status: 201, body: "not json", headers: {} }) });
    const relay = fakeRelay();
    const { seams, calls } = baseJoinRedeemSeams({
      readTeamSecret: async () => "admin-token",
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("unavailable");
    expect(result.access).toBe("ok");
    expect(calls.secretWrites).toEqual([]);
    expect(result.message).toContain("invite dev2 again and join with the new invite");
  });

  test("a minted board token that cannot be stored stops the join before the reply, keeping the intent so a plain rerun finishes it", async () => {
    const p = redeemProbes({
      fetch: async () => ({ status: 201, body: JSON.stringify({ username: "dev2", token: "tok-1" }), headers: {} }),
    });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams({
      readTeamSecret: async () => "admin-token",
      writeLocalSecret: async () => {
        throw new Error("keychain locked");
      },
    });

    const caught = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams).catch((err: unknown) => err);

    expect(caught).toBeInstanceOf(JoinPeeringStoreError);
    expect((caught as JoinPeeringStoreError).detail).toBe("keychain locked");
    expect((caught as Error).message).toContain("Join again to finish; you do not need a new code.");
    expect(relay.callOrder).toEqual(["fetch", "redeem"]);
    expect(p.calls.removed).not.toContain(intentPath(HOME));
  });

  describe("a join never burns an invite whose board token has nowhere to go", () => {
    const EMBEDDED = { ...POINTER, switchboard: { url: SB, token: "tok-emb" } };

    test("an embedded board token with no personal secrets store yet refuses before redeeming, names rt home init, and keeps the intent", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({ fetch: relayServing(EMBEDDED) });
      const { seams, calls } = baseJoinRedeemSeams({ localStoreReady: async () => false });

      const caught = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams).catch((err: unknown) => err);

      expect(caught).toBeInstanceOf(UserActionableError);
      expect((caught as UserActionableError).code).toBe("secrets-store-not-ready");
      expect((caught as UserActionableError).next).toBe("rt home init");
      expect((caught as Error).message).toContain("you do not need a new code");
      expect((caught as Error).message).not.toContain("has not been used");
      expect(relay.redeemCalls).toEqual([]);
      expect(calls.secretWrites).toEqual([]);
      expect(readIntent(p)?.join?.pointer.switchboard?.token).toBe("tok-emb");
    });

    test("an invite with no sealed token never consults the store, so a fresh machine still joins", async () => {
      const p = redeemProbes();
      const relay = fakeRelay();
      let consulted = false;
      const { seams } = baseJoinRedeemSeams({
        localStoreReady: async () => {
          consulted = true;
          return false;
        },
      });

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

      expect(result.access).toBe("ok");
      expect(result.peering).toBe("idle");
      expect(consulted).toBe(false);
    });

    test("an older invite naming a different switchboard never consults the store: it is refused anyway", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, switchboard: { url: "https://evil.test", token: "tok-x" } }) });
      let consulted = false;
      const { seams } = baseJoinRedeemSeams({
        localStoreReady: async () => {
          consulted = true;
          return false;
        },
      });

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

      expect(result.peering).toBe("unavailable");
      expect(consulted).toBe(false);
    });

    test("an embedded token whose store write fails after redeem throws a resumable error: no reply, intent kept with the token", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({ fetch: relayServing(EMBEDDED) });
      const { seams } = baseJoinRedeemSeams({
        writeLocalSecret: async () => {
          throw new Error("sops: no matching creation rules");
        },
      });

      const caught = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams).catch((err: unknown) => err);

      expect(caught).toBeInstanceOf(JoinPeeringStoreError);
      expect((caught as JoinPeeringStoreError).detail).toBe("sops: no matching creation rules");
      expect((caught as Error).message).toContain("you do not need a new code");
      expect(relay.replyCalls).toEqual([]);
      expect(p.calls.removed).not.toContain(intentPath(HOME));
      expect(readIntent(p)?.join?.pointer.switchboard?.token).toBe("tok-emb");
    });

    test("a store failure that quotes the board token never carries it into the log detail", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({ fetch: relayServing(EMBEDDED) });
      const secretKey = `AGE-SECRET-KEY-1${"Q".repeat(58)}`;
      const { seams } = baseJoinRedeemSeams({
        writeLocalSecret: async () => {
          throw new Error(`sops: rejected tok-emb and ${secretKey}`);
        },
      });

      const caught = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams).catch((err: unknown) => err);

      expect(caught).toBeInstanceOf(JoinPeeringStoreError);
      const detail = (caught as JoinPeeringStoreError).detail ?? "";
      expect(detail).not.toContain("tok-emb");
      expect(detail).not.toContain(secretKey);
      expect(detail).toBe("sops: rejected <token> and AGE-SECRET-KEY-1<redacted>");
    });

    test("rerunning after the store is fixed resumes from the intent: stores the sealed token, posts the reply, clears the intent", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({ fetch: relayServing(EMBEDDED) });
      const failing = baseJoinRedeemSeams({
        writeLocalSecret: async () => {
          throw new Error("sops: no matching creation rules");
        },
      });
      await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, failing.seams).catch(() => undefined);

      const relay2 = fakeRelay({ fetch: async () => "gone" });
      const { seams, calls } = baseJoinRedeemSeams();
      const result = await joinRedeem(p, relay2.client, () => NO_SECRETS, {}, seams);

      expect(result.access).toBe("ok");
      expect(result.peering).toBe("applied");
      expect(calls.secretWrites).toEqual([{ key: "switchboardToken", value: "tok-emb" }]);
      expect(relay2.replyCalls).toHaveLength(1);
      expect(p.calls.removed).toContain(intentPath(HOME));
    });
  });

  describe("peering unavailable carries its fix in the result", () => {
    test("a register the switchboard refused: peeringFix asks the owner for a fresh invite for this handle", async () => {
      const p = redeemProbes({ fetch: async () => ({ status: 500, body: "", headers: {} }) });
      const relay = fakeRelay();
      const { seams } = baseJoinRedeemSeams({ readTeamSecret: async () => "admin-token" });

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

      expect(result.access).toBe("ok");
      expect(result.peering).toBe("unavailable");
      expect(result.peeringFix).toContain("Ask matt to invite dev2 again");
      expect(result.peeringFix).not.toContain("members panel");
      expect(result.message).toContain(result.peeringFix!);
    });

    test("a join that ends with peering unavailable records only its provenance: the setup row reads the gap from the tokens themselves", async () => {
      const p = redeemProbes();
      const { seams } = baseJoinRedeemSeams({
        readTeamSecret: async () => {
          throw new Error("not a recipient yet");
        },
      });

      const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, seams);

      expect(result.peering).toBe("unavailable");
      expect(JSON.parse(p.readFile(teamLocalPath(p.home, POINTER.team))!)).toEqual({ createdByRt: false, joinedByRt: true, rtMayManageMembership: false, agePublicKey: FAKE_PUBLIC_KEY, forgeUsername: "dev2" });
    });

    test("applied and idle peering carry no fix", async () => {
      const idle = await joinRedeem(redeemProbes(), fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams);
      expect(idle.peering).toBe("idle");
      expect("peeringFix" in idle).toBe(false);

      const embedded = { ...POINTER, switchboard: { url: SB, token: "tok-emb" } };
      const applied = await joinRedeem(
        redeemProbes(),
        fakeRelay({ fetch: relayServing(embedded) }).client,
        () => NO_SECRETS,
        { code: CODE },
        baseJoinRedeemSeams().seams,
      );
      expect(applied.peering).toBe("applied");
      expect("peeringFix" in applied).toBe(false);
    });
  });

  test("no sealed token and no admin token in the team's secrets → peering idle, no request attempted", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams({ readTeamSecret: async () => null });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("idle");
    expect("peeringFix" in result).toBe(false);
    expect(p.calls.fetch).toHaveLength(0);
  });

  test("a failed peer/join request reports peering:unavailable without failing the join", async () => {
    const p = redeemProbes({ fetch: async () => ({ status: 500, body: "", headers: {} }) });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams({
      readTeamSecret: async () => "admin-token",
    });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("unavailable");
    expect(result.access).toBe("ok");
  });

  test("clone auth failure returns access:denied without ever calling relay.redeem", async () => {
    const p = redeemProbes({ exec: () => ({ code: 128, stdout: "", stderr: "fatal: Authentication failed" }) });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("denied");
    expect(result.message).toBe("Ask matt to let you into Acme, since you don't have access yet.");
    expect(relay.redeemCalls).toHaveLength(0);
  });

  test("the join messages keep the two phrases phase 3 reads", async () => {
    const denied = await joinRedeem(
      redeemProbes({ exec: () => ({ code: 128, stdout: "", stderr: "fatal: Authentication failed" }) }),
      fakeRelay().client,
      () => NO_SECRETS,
      { code: CODE },
      baseJoinRedeemSeams().seams,
    );
    expect(denied.message).toContain("you don't have access yet");

    const joined = await joinRedeem(redeemProbes(), fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams);
    expect(joined.message).toStartWith("Joined Acme");
  });

  test("a failed clone attempt clears joinedByRt back to false, not asserting membership in a team never cloned", async () => {
    const p = redeemProbes({ exec: () => ({ code: 128, stdout: "", stderr: "fatal: Authentication failed" }) });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(readTeamLocal(p, POINTER.team).joinedByRt).toBe(false);
  });

  describe("clone failures are classified honestly — 'check your network' only when it IS the network", () => {
    test("a non-auth, non-network clone failure does not blame the network", async () => {
      const p = redeemProbes({ exec: () => ({ code: 128, stdout: "", stderr: "fatal: destination path already exists and is not an empty directory" }) });
      const relay = fakeRelay();
      const { seams } = baseJoinRedeemSeams();

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
      expect(result.access).toBe("unreachable");
      expect(result.message).not.toContain("network");
      expect(result.message).toContain("already there and is not empty");
    });

    test("disk full reports a disk message, not a network one", async () => {
      const p = redeemProbes({ exec: () => ({ code: 128, stdout: "", stderr: "fatal: write error: No space left on device" }) });
      const relay = fakeRelay();
      const { seams } = baseJoinRedeemSeams();

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
      expect(result.message).toContain("space");
      expect(result.message).not.toContain("check your network");
    });

    test("a missing git binary (exit 127) reports that, not a network guess", async () => {
      const p = redeemProbes({ exec: () => ({ code: 127, stdout: "", stderr: "ENOENT: git" }) });
      const relay = fakeRelay();
      const { seams } = baseJoinRedeemSeams();

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
      expect(result.message).toContain("This Mac cannot run git");
      expect(result.message).not.toContain("check your network");
    });

    test("a genuine transport failure DOES say check your network", async () => {
      const p = redeemProbes({ exec: () => ({ code: 128, stdout: "", stderr: "fatal: unable to access: Could not resolve host: github.com" }) });
      const relay = fakeRelay();
      const { seams } = baseJoinRedeemSeams();

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
      expect(result.message).toContain("check your network");
    });
  });

  test("redeem race lost on a fresh clone throws invite-unknown with the used-invite message", async () => {
    const p = redeemProbes();
    const relay = fakeRelay({ redeem: async () => "already" });
    const { seams } = baseJoinRedeemSeams();

    let caught: unknown;
    try {
      await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UserActionableError);
    expect((caught as UserActionableError).code).toBe("invite-unknown");
    expect((caught as UserActionableError).message).toBe("That invite was already used");
    expect((caught as UserActionableError).why).toBe("Ask matt for a new one.");
  });

  test("resuming after a crash: the team is already cloned, redeem reports 'already' — that is NOT an error", async () => {
    const p = redeemProbes({
      dirs: { [TEAM_DIR]: [".git"] },
      files: { [pathJoin(TEAM_DIR, ".git", "config")]: gitConfigWithRemote(REMOTE) },
    });
    const relay = fakeRelay({ redeem: async () => "already" });
    const { seams } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("ok");
    expect(p.calls.exec.some((argv) => argv[0] === "git" && argv[1] === "clone")).toBe(false);
  });

  test("an owner redeeming a code for a team they already created and cloned themselves is not stamped joinedByRt, which would flip their own machine pull-only", async () => {
    const p = redeemProbes({
      dirs: { [TEAM_DIR]: [".git"] },
      files: { [pathJoin(TEAM_DIR, ".git", "config")]: gitConfigWithRemote(REMOTE) },
    });
    updateTeamLocal(p, POINTER.team, { createdByRt: true });
    const relay = fakeRelay({ redeem: async () => "already" });
    const { seams } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("ok");
    expect(readTeamLocal(p, POINTER.team).joinedByRt).toBe(false);
  });

  test("an existing clone with a DIFFERENT remote throws instead of silently reusing it", async () => {
    const p = redeemProbes({
      dirs: { [TEAM_DIR]: [".git"] },
      files: { [pathJoin(TEAM_DIR, ".git", "config")]: gitConfigWithRemote("git@github.com:someone-else/other.git") },
    });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({ code: "team-remote-mismatch" });
  });

  test("a remote-mismatch refusal clears joinedByRt back to false too", async () => {
    const p = redeemProbes({
      dirs: { [TEAM_DIR]: [".git"] },
      files: { [pathJoin(TEAM_DIR, ".git", "config")]: gitConfigWithRemote("git@github.com:someone-else/other.git") },
    });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({ code: "team-remote-mismatch" });

    expect(readTeamLocal(p, POINTER.team).joinedByRt).toBe(false);
  });

  test("a remote-mismatch refusal does NOT clobber a genuine prior join under the same slug", async () => {
    const p = redeemProbes({
      dirs: { [TEAM_DIR]: [".git"] },
      files: { [pathJoin(TEAM_DIR, ".git", "config")]: gitConfigWithRemote("git@github.com:someone-else/other.git") },
    });
    updateTeamLocal(p, POINTER.team, { joinedByRt: true });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    // A stale or mistyped code resolving to this same slug, with a remote
    // that no longer matches what this machine already joined, must refuse
    // without touching the standing record of that earlier, unrelated join.
    await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({ code: "team-remote-mismatch" });

    expect(readTeamLocal(p, POINTER.team).joinedByRt).toBe(true);
  });

  test("no code and no saved intent throws no-join-intent", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    await expect(joinRedeem(p, relay.client, () => NO_SECRETS, {}, seams)).rejects.toMatchObject({ code: "no-join-intent" });
  });

  test("no code: resumes from the intent saved by a prior dry-run", async () => {
    const intent: SetupIntent = {
      v: 1,
      at: NOW.toISOString(),
      mode: "join",
      join: { id: ID_HEX, keyB64: Buffer.from(KEY).toString("base64"), pointer: POINTER },
    };
    const p = redeemProbes({ files: { [intentPath(HOME)]: JSON.stringify(intent) } });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, {}, seams);

    expect(result.access).toBe("ok");
    expect(relay.fetchCalls).toHaveLength(0); // never re-fetched the relay — the pointer came from the saved intent
  });

  test("a saved intent carrying a hostile pointer is still validated on resume", async () => {
    const intent: SetupIntent = {
      v: 1,
      at: NOW.toISOString(),
      mode: "join",
      join: { id: ID_HEX, keyB64: Buffer.from(KEY).toString("base64"), pointer: { ...POINTER, team: "../../etc" } },
    };
    const p = redeemProbes({ files: { [intentPath(HOME)]: JSON.stringify(intent) } });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    await expect(joinRedeem(p, relay.client, () => NO_SECRETS, {}, seams)).rejects.toMatchObject({ code: "invite-malformed" });
    expect(p.calls.exec).toHaveLength(0);
  });

  test("relay-unreachable while resolving a fresh code returns access:unreachable, no throw", async () => {
    const p = redeemProbes();
    const relay = fakeRelay({
      fetch: async () => {
        throw new UserActionableError("relay-unreachable", "could not reach the invite relay");
      },
    });
    const { seams } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
    expect(result.access).toBe("unreachable");
    expect(result.team).toEqual({ slug: "", name: "", owner: "" });
    expect(result.teams).toEqual([]);
  });

  test("a programming error while resolving the pointer is not swallowed into 'check your network'", async () => {
    const p = redeemProbes();
    const relay = fakeRelay({
      fetch: async () => {
        throw new TypeError("boom");
      },
    });
    const { seams } = baseJoinRedeemSeams();

    await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toThrow(TypeError);
  });

  describe("a relay failure never exits 2 once the code has been redeemed — it's real infrastructure, not a dead invite", () => {
    test("relay.redeem itself unreachable: exit 0, access:unreachable, the clone is not lost", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({
        redeem: async () => {
          throw new UserActionableError("relay-unreachable", "could not reach the invite relay");
        },
      });
      const { seams } = baseJoinRedeemSeams();

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

      expect(result.access).toBe("unreachable");
      expect(p.calls.exec).toContainEqual(["git", "clone", REMOTE, TEAM_DIR]);
      expect(result.message).not.toMatch(/invite.*(dead|unknown|expired)/i);
    });

    test("relay.redeem 5xx: exit 0, access:unreachable, not a thrown UserActionableError", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({
        redeem: async () => {
          throw new UserActionableError("relay-error", "500 /v1/invites/x/redeem");
        },
      });
      const { seams } = baseJoinRedeemSeams();

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
      expect(result.access).toBe("unreachable");
    });

    test("relay.reply unreachable: still access:ok (the join itself succeeded), intent is NOT cleared so a retry can finish", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({
        reply: async () => {
          throw new UserActionableError("relay-unreachable", "could not reach the invite relay");
        },
      });
      const { seams } = baseJoinRedeemSeams();

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

      expect(result.access).toBe("ok");
      expect(p.calls.removed).not.toContain(intentPath(HOME));
      expect(result.message).toContain("could not send your key back");
    });

    test("relay.reply 5xx: same honest half-state report, not exit 2", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({
        reply: async () => {
          throw new UserActionableError("relay-error", "500 /v1/invites/x/reply");
        },
      });
      const { seams } = baseJoinRedeemSeams();

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
      expect(result.access).toBe("ok");
      expect(p.calls.removed).not.toContain(intentPath(HOME));
    });
  });

  test("finding-5 recovery: re-running with the SAME code after redeem-succeeded-but-reply-failed resumes from the matching saved intent instead of dead-ending on invite-unknown", async () => {
    // First attempt: reply fails, leaving the relay-side invite already redeemed and a saved intent behind.
    const p = redeemProbes();
    const relay = fakeRelay({
      reply: async () => {
        throw new UserActionableError("relay-unreachable", "down");
      },
    });
    const { seams } = baseJoinRedeemSeams();
    const first = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
    expect(first.access).toBe("ok");

    // Second attempt: the SAME code is re-typed. The relay now reports the id "gone"
    // (already redeemed) instead of serving the ciphertext again.
    const relay2 = fakeRelay({ fetch: async () => "gone" });
    const { seams: seams2 } = baseJoinRedeemSeams();
    const second = await joinRedeem(p, relay2.client, () => NO_SECRETS, { code: CODE }, seams2);

    expect(second.access).toBe("ok");
    expect(relay2.redeemCalls).toHaveLength(1); // resumed via the intent, then proceeded normally (alreadyCloned, so "already"/"redeemed" both fine)
  });

  test("a join records the age key it sent the owner, so setup can tell without the keychain whether team secrets reach this machine yet", async () => {
    const p = redeemProbes();
    await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams);
    expect(readTeamLocal(p, POINTER.team).agePublicKey).toBe(FAKE_PUBLIC_KEY);
  });

  test("keychain failure after clone+redeem: JoinKeyExchangeError, not a raw crash — names what completed", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams({ ageKeySeam: fakeAgeKeySeamLocked() });

    let caught: unknown;
    try {
      await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(JoinKeyExchangeError);
    expect(caught).not.toBeInstanceOf(UserActionableError);
    const message = (caught as Error).message;
    expect(message).toContain("You joined Acme");
    expect(message).toContain("Join again to finish; you do not need a new code.");
    expect((caught as JoinKeyExchangeError).detail).toBeDefined();
    // The clone and the redeem really did happen — this is a reportable half-state, not a rollback.
    expect(p.calls.exec).toContainEqual(["git", "clone", REMOTE, TEAM_DIR]);
    expect(relay.redeemCalls).toEqual([ID_HEX]);
  });

  test("an undeterminable forge login never gets sealed as a guess — no $USER, no 'unknown' — and is refused BEFORE the invite is consumed (N1/R-T18-e)", async () => {
    const p = redeemProbes({ env: { USER: "localdev" } });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams({ forgeLogin: async () => null });

    let caught: unknown;
    try {
      await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UserActionableError);
    expect((caught as UserActionableError).code).toBe("forge-login-unknown");
    expect((caught as UserActionableError).message).not.toContain("localdev");
    expect((caught as UserActionableError).message).toContain("has not been used yet");
    expect((caught as UserActionableError).message).toBe("rt could not tell who you are on GitHub. The invite has not been used yet.");
    expect((caught as UserActionableError).why).toBe("rt reads your username from the gh command line tool, which is not signed in. The invite still works once you are.");
    expect((caught as UserActionableError).next).toBe("gh auth login");
    // The team WAS cloned (identity resolution needs the just-cloned settings), but
    // relay.redeem must never have run — the invite is still valid for a retry.
    expect(p.calls.exec).toContainEqual(["git", "clone", REMOTE, TEAM_DIR]);
    expect(relay.redeemCalls).toHaveLength(0);
    expect(relay.replyCalls).toHaveLength(0);
  });

  test("passes the pointer's own team slug into the secrets factory", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const factorySlugs: string[] = [];
    const { seams } = baseJoinRedeemSeams({
      readTeamSecret: async () => null,
    });

    await joinRedeem(
      p,
      relay.client,
      (slug) => {
        factorySlugs.push(slug);
        return NO_SECRETS;
      },
      { code: CODE },
      seams,
    );
    expect(factorySlugs).toEqual(["acme"]);
  });

  test("full success clears the saved intent", async () => {
    const p = redeemProbes({ files: { [intentPath(HOME)]: "{}" } });
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);
    expect(p.calls.removed).toContain(intentPath(HOME));
  });

  describe("a hostile pointer on the redeem path is rejected before any local mutation", () => {
    test("ext:: remote via a fresh code — no exec, no mkdirp", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, remote: "ext::sh -c 'touch /tmp/pwned'" }) });
      const { seams } = baseJoinRedeemSeams();

      await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({ code: "invite-malformed" });
      expect(p.calls.exec).toHaveLength(0);
    });

    test("a traversal team slug via a fresh code — never joins a path outside teams/", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, team: "../../etc" }) });
      const { seams } = baseJoinRedeemSeams();

      await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({ code: "invite-malformed" });
      expect(p.calls.exec).toHaveLength(0);
    });

    test("N3: a 5000-char slug via a fresh code is rejected before any exec", async () => {
      const p = redeemProbes();
      const relay = fakeRelay({ fetch: relayServing({ ...POINTER, team: "a".repeat(5000) }) });
      const { seams } = baseJoinRedeemSeams();

      await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({ code: "invite-malformed" });
      expect(p.calls.exec).toHaveLength(0);
    });
  });

  test("N2: control characters in name/owner are sanitized in the redeem success message too", async () => {
    const p = redeemProbes();
    const relay = fakeRelay({ fetch: relayServing({ ...POINTER, name: "Acme\x1b[2J", owner: "matt\r\nFAKE LINE" }) });
    const { seams } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("ok");
    expect(result.message).not.toMatch(/[\x00-\x1f\x7f]/);
    expect(result.team.owner).not.toContain("\r");
  });

  describe("an invite naming the org by an old name", () => {
    const MARKER = `${TEAM_DIR}/mattstack/mattstack.jsonc`;
    const renamed = { [MARKER]: `// org marker\n{ "role": "org", "org": "globex" }` };

    async function refusal(p: ReturnType<typeof redeemProbes>, relay = fakeRelay()): Promise<UserActionableError> {
      const err = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(UserActionableError);
      return err as UserActionableError;
    }

    test("is refused as invite-stale before the roster pull or the redeem", async () => {
      const p = redeemProbes({ files: renamed });
      const relay = fakeRelay();
      const err = await refusal(p, relay);
      expect(err.code).toBe("invite-stale");
      expect(err.message).toBe("This invite names the org by an old name; ask for a fresh one");
      expect(relay.redeemCalls).toEqual([]);
      expect(p.calls.exec.some((argv) => argv.includes("pull"))).toBe(false);
    });

    test("removes the fresh clone, writes no record and leaves no intent", async () => {
      const p = redeemProbes({ files: renamed });
      await refusal(p);
      expect(p.exists(MARKER)).toBe(false);
      expect(p.exists(ORG_STORE)).toBe(false);
      expect(p.exists(teamLocalPath(HOME, POINTER.team))).toBe(false);
      expect(readIntent(p)).toBeNull();
    });

    test("a prior record for the slug keeps its fields and its joinedByRt", async () => {
      const p = redeemProbes({ files: { ...renamed, [teamLocalPath(HOME, POINTER.team)]: JSON.stringify({ joinedByRt: false, forgeUsername: "dev1" }) } });
      await refusal(p);
      const record = readTeamLocal(p, POINTER.team);
      expect(record.joinedByRt).toBe(false);
      expect(record.forgeUsername).toBe("dev1");
    });

    test("an intent for a different invite is put back byte for byte", async () => {
      const prior = JSON.stringify({ v: 1, at: "2026-08-01T00:00:00.000Z", mode: "create", team: { slug: "gadgets", name: "Gadgets", remote: "https://github.com/acme/gadgets.git", others: false } });
      const p = redeemProbes({ files: { ...renamed, [intentPath(HOME)]: prior } });
      await refusal(p);
      expect(p.readFile(intentPath(HOME))).toBe(prior);
    });

    test("this invite's own saved join intent survives, so the setup app's resume keeps showing the refusal", async () => {
      const saved = JSON.stringify({ v: 1, at: "2026-08-01T00:00:00.000Z", mode: "join", join: { id: ID_HEX, keyB64: Buffer.from(KEY).toString("base64"), pointer: POINTER } });
      const p = redeemProbes({ files: { ...renamed, [intentPath(HOME)]: saved } });
      const err = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, {}, baseJoinRedeemSeams().seams).then(() => null, (e: unknown) => e);
      expect((err as UserActionableError).code).toBe("invite-stale");
      expect(p.readFile(intentPath(HOME))).toBe(saved);
    });

    test("keeps the exact why when the clone folder is gone", async () => {
      const err = await refusal(redeemProbes({ files: renamed }));
      expect((err as UserActionableError).why).toBe("The org was renamed after this invite was made; a fresh invite from your admin joins it.");
    });

    test("names the folder in the why when rt cannot remove the clone it made", async () => {
      const p = redeemProbes({ dirs: { [TEAM_DIR]: ["mattstack"] }, files: renamed });
      const removeDir = p.removeDir.bind(p);
      p.removeDir = (path) => { if (path !== TEAM_DIR) removeDir(path); };
      const err = await refusal(p);
      expect(err.code).toBe("invite-stale");
      expect(err.message).toBe("This invite names the org by an old name; ask for a fresh one");
      expect(err.why).toContain("The org was renamed after this invite was made; a fresh invite from your admin joins it.");
      expect(err.why).toContain(TEAM_DIR);
      expect(err.why).toContain("could not remove");
      expect(err.log).toContain(TEAM_DIR);
    });

    test("a marker whose org is not a valid slug is not an org marker and joins as before", async () => {
      const p = redeemProbes({ files: { [MARKER]: `{ "role": "org", "org": "Acme" }` } });
      const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams);
      expect(result.access).toBe("ok");
    });

    test("a marker naming the pointer's own org joins as before", async () => {
      const p = redeemProbes({ files: { [MARKER]: `{ "role": "org", "org": "acme" }` } });
      const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams);
      expect(result.access).toBe("ok");
    });

    describe("when the org folder is already on this Mac", () => {
      const present = (extra: Record<string, string> = {}) => redeemProbes({ dirs: { [TEAM_DIR]: [".git"] }, files: { ...renamed, [`${TEAM_DIR}/.git/config`]: gitConfigWithRemote(REMOTE), ...extra } });

      test("is refused as invite-stale, keeps the folder and its marker, and runs no pull or redeem", async () => {
        const p = present();
        const relay = fakeRelay();
        const err = await refusal(p, relay);
        expect(err.code).toBe("invite-stale");
        expect(err.message).toBe("This invite names the org by an old name; ask for a fresh one");
        expect(err.why).toBe(`The org was renamed after this invite was made, and its folder on this Mac still has the old name. Move ${TEAM_DIR} aside, then join with a fresh invite from your admin.`);
        expect(err.log).toContain(TEAM_DIR);
        expect(p.exists(MARKER)).toBe(true);
        expect(p.exists(`${TEAM_DIR}/.git/config`)).toBe(true);
        expect(relay.redeemCalls).toEqual([]);
        expect(p.calls.exec.some((argv) => argv.includes("pull") || argv.includes("clone"))).toBe(false);
      });

      test("puts back the team record and the setup intent", async () => {
        const prior = JSON.stringify({ v: 1, at: "2026-08-01T00:00:00.000Z", mode: "create", team: { slug: "gadgets", name: "Gadgets", remote: "https://github.com/acme/gadgets.git", others: false } });
        const p = present({ [teamLocalPath(HOME, POINTER.team)]: JSON.stringify({ joinedByRt: false, forgeUsername: "dev1" }), [intentPath(HOME)]: prior });
        await refusal(p);
        expect(readTeamLocal(p, POINTER.team).joinedByRt).toBe(false);
        expect(readTeamLocal(p, POINTER.team).forgeUsername).toBe("dev1");
        expect(p.readFile(intentPath(HOME))).toBe(prior);
      });

      test("writes no record and leaves no intent when there was none before", async () => {
        const p = present();
        await refusal(p);
        expect(p.exists(teamLocalPath(HOME, POINTER.team))).toBe(false);
        expect(readIntent(p)).toBeNull();
      });

      test("a marker naming the pointer's own org joins ok", async () => {
        const p = redeemProbes({ dirs: { [TEAM_DIR]: [".git"] }, files: { [MARKER]: `{ "role": "org", "org": "acme" }`, [`${TEAM_DIR}/.git/config`]: gitConfigWithRemote(REMOTE) } });
        const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams);
        expect(result.access).toBe("ok");
      });
    });
  });
});

describe("joinRedeem's relay failure reports what it actually persisted", () => {
  test("an unreachable relay says not-written, because the redeem path returns before writeIntent", async () => {
    const p = fakeProbes({ home: HOME, now: NOW, exec: () => ({ code: 0, stdout: "", stderr: "" }) });
    const { seams } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, unreachableRelay(), () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("unreachable");
    expect(result.intent).toBe("not-written");
    expect(readIntent(p)).toBeNull();
  });
});

describe("one team per machine", () => {
  const TEAMS_DIR = pathJoin(HOME, ".mattstack", "orgs");
  const REFUSAL = "This Mac is already set up for the globex team, and mattstack supports one team per machine today";

  function zone(slug: string): { dirs: Record<string, string[]>; files: Record<string, string> } {
    return {
      dirs: { [TEAMS_DIR]: [slug] },
      files: { [pathJoin(TEAMS_DIR, slug, "mattstack", "org", "settings.org.jsonc")]: "{}" },
    };
  }

  function probes(overrides: Parameters<typeof fakeProbes>[0]): ReturnType<typeof fakeProbes> {
    return fakeProbes({ home: HOME, now: NOW, exec: () => ({ code: 0, stdout: "", stderr: "" }), ...overrides, files: { [ORG_STORE]: rosterWith("dev2"), ...(overrides?.files ?? {}) } });
  }

  beforeEach(() => resetCltCacheForTests());

  test("a dry run for a second team is refused, and saves no intent", async () => {
    const p = probes(zone("globex"));

    await expect(joinDryRun(p, fakeRelay().client, CODE)).rejects.toMatchObject({ code: "team-already-set-up", message: REFUSAL });

    expect(readIntent(p)).toBeNull();
  });

  test("a redeem for a second team is refused before the clone, the intent and the redeem", async () => {
    const p = probes(zone("globex"));
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams();

    await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({
      code: "team-already-set-up",
      message: REFUSAL,
    });

    expect(p.calls.exec).toEqual([]);
    expect(relay.redeemCalls).toEqual([]);
    expect(readIntent(p)).toBeNull();
    expect(readTeamLocal(p, POINTER.team).joinedByRt).toBe(false);
  });

  test("a dry run for the team this machine already has stays allowed", async () => {
    const p = probes(zone(POINTER.team));

    const result = await joinDryRun(p, fakeRelay().client, CODE);

    expect(result.team.slug).toBe(POINTER.team);
    expect(result.intent).toBe("written");
  });

  test("joining the team this machine already has stays allowed", async () => {
    const own = zone(POINTER.team);
    const p = probes({
      dirs: { ...own.dirs, [TEAM_DIR]: [".git", "mattstack"] },
      files: { ...own.files, [ORG_STORE]: rosterWith("dev2"), [pathJoin(TEAM_DIR, ".git", "config")]: gitConfigWithRemote(REMOTE) },
    });
    const { seams } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.access).toBe("ok");
  });
});


describe("join identity and teams", () => {
  const probes = (files: Record<string, string> = {}) => fakeProbes({ home: HOME, now: NOW, files: { [ORG_STORE]: rosterWith("dev2"), ...files }, exec: () => ({ code: 0, stdout: "", stderr: "" }) });

  test("an old pointer is refused before intent or clone writes on dry run, redeem and resume", async () => {
    const old = { ...POINTER, v: 1 } as unknown as InvitePointer;
    const error = { code: "invite-outdated", message: "That invite was made by an older mattstack. Ask for a new invite." };
    const p = probes();
    await expect(joinDryRun(p, relayWith(old), CODE)).rejects.toMatchObject(error);
    await expect(joinRedeem(p, relayWith(old), () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams)).rejects.toMatchObject(error);
    expect(readIntent(p)).toBeNull();
    expect(p.calls.exec).toEqual([]);
    expect(p.calls.writes).toEqual({});
    const saved: SetupIntent = { v: 1, at: NOW.toISOString(), mode: "join", join: { id: ID_HEX, keyB64: Buffer.from(KEY).toString("base64"), pointer: old } };
    const resumed = probes({ [intentPath(HOME)]: JSON.stringify(saved) });
    await expect(joinRedeem(resumed, fakeRelay().client, () => NO_SECRETS, {}, baseJoinRedeemSeams().seams)).rejects.toMatchObject(error);
    expect(resumed.calls.exec).toEqual([]);
    expect(resumed.calls.writes).toEqual({});
  });

  test("invalid username or team names are refused before writes", async () => {
    for (const patch of [{ teams: ["../x"] }, { teams: [] }, { teams: ["Widgets"] }, { teams: [1] }, { username: "bad handle!" }, { username: "" }]) {
      const p = probes();
      const bad = { ...POINTER, ...patch } as InvitePointer;
      await expect(joinDryRun(p, relayWith(bad), CODE)).rejects.toMatchObject({ code: "invite-malformed" });
      await expect(joinRedeem(p, relayWith(bad), () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams)).rejects.toMatchObject({ code: "invite-malformed" });
      expect(p.calls.exec).toEqual([]);
      expect(readIntent(p)).toBeNull();
    }
  });

  test("dry run reports the ordered teams with no clone", async () => {
    const p = probes();
    expect(p.exists(TEAM_DIR)).toBe(false);
    expect((await joinDryRun(p, relayWith({ ...POINTER, teams: ["gadgets", "widgets"] }), CODE)).teams).toEqual(["gadgets", "widgets"]);
  });

  test("redeem stores the real login and selects the pointer's first team", async () => {
    const p = probes();
    const { seams, calls } = baseJoinRedeemSeams({ forgeLogin: async () => "Dev2" });
    const result = await joinRedeem(p, relayWith({ ...POINTER, teams: ["gadgets", "widgets"] }), () => NO_SECRETS, { code: CODE }, seams);
    expect(result).toMatchObject({ access: "ok", teams: ["gadgets", "widgets"] });
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("Dev2");
    expect(calls.userSettingWrites).toEqual([{ key: "mattstack.activeTeam", value: "gadgets" }]);
  });

  test("a different login keeps the intent and refuses before redeem or identity writes", async () => {
    const p = probes();
    const relay = fakeRelay();
    const { seams, calls } = baseJoinRedeemSeams({ forgeLogin: async () => "dev1" });
    await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({ code: "invite-login-mismatch", message: "This invite is for dev2; you're signed in as dev1.", why: "Ask for an invite for dev1, or connect dev2's token." });
    expect(relay.redeemCalls).toEqual([]);
    expect(readIntent(p)?.mode).toBe("join");
    expect(readTeamLocal(p, "acme").forgeUsername).toBeUndefined();
    expect(calls.userSettingWrites).toEqual([]);
  });

  test("a missing roster entry pulls once and accepts the newly arrived entry", async () => {
    const p = probes({ [ORG_STORE]: rosterWith() });
    p.exec = async (argv) => { p.calls.exec.push(argv); if (argv.includes("pull")) p.writeFile(ORG_STORE, rosterWith("dev2")); return { code: 0, stdout: "", stderr: "" }; };
    expect((await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams)).access).toBe("ok");
    expect(p.calls.exec.filter((argv) => argv.includes("pull"))).toEqual([["git", "pull", "--ff-only"]]);
  });

  test("a roster still missing after one pull keeps the invite and resume intent", async () => {
    const p = probes({ [ORG_STORE]: rosterWith("dev1") });
    const relay = fakeRelay();
    const { seams, calls } = baseJoinRedeemSeams();
    await expect(joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams)).rejects.toMatchObject({ code: "roster-not-ready", message: "Your admin's roster change has not reached the org repo yet; try again in a minute" });
    expect(p.calls.exec.filter((argv) => argv.includes("pull"))).toHaveLength(1);
    expect(relay.redeemCalls).toEqual([]);
    expect(readIntent(p)?.mode).toBe("join");
    expect(readTeamLocal(p, "acme").forgeUsername).toBeUndefined();
    expect(calls.userSettingWrites).toEqual([]);
  });

  test("roster identity is case insensitive and skips the extra pull", async () => {
    const p = probes({ [ORG_STORE]: rosterWith("Dev2") });
    expect((await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams)).access).toBe("ok");
    expect(p.calls.exec.some((argv) => argv.includes("pull"))).toBe(false);
  });
});


test("a joined identity reads the selected team's board title through the resolver", async () => {
  const home = mkdtempSync(pathJoin(tmpdir(), "join-team-title-"));
  const priorHome = process.env.HOME;
  process.env.HOME = home;
  const notices: string[] = [];
  const priorSink = setSettingsNoticeSink((line) => { notices.push(line); });
  try {
    seedOrg({ org: "acme", roster: [{ username: "Dev2", teams: ["widgets", "gadgets"] }], settings: { "board.title": "Acme" }, teams: { widgets: { "board.title": "Widgets" }, gadgets: { "board.title": "Gadgets" } } });
    const p = createRealProbes();
    p.exec = async () => ({ code: 0, stdout: "", stderr: "" });
    const { seams } = baseJoinRedeemSeams({ forgeLogin: async () => "dev2", writeUserSetting: (key, value) => { setSetting(key, value, "user"); } });
    await joinRedeem(p, relayWith({ ...POINTER, teams: ["gadgets", "widgets"] }), () => NO_SECRETS, { code: CODE }, seams);
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev2");
    expect(getSetting("mattstack.activeTeam").value).toBe("gadgets");
    expect(getSetting("board.title").value).toBe("Gadgets");
    expect(notices).toHaveLength(1);
  } finally {
    setSettingsNoticeSink(priorSink);
    if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("a real clone whose marker names another org is removed, with no record and no intent left", async () => {
  const home = mkdtempSync(pathJoin(tmpdir(), "join-stale-"));
  const priorHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const env = { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
    const work = pathJoin(home, "work");
    mkdirSync(pathJoin(work, "mattstack", "org"), { recursive: true });
    writeFileSync(pathJoin(work, "mattstack", "mattstack.jsonc"), `{ "role": "org", "org": "globex" }\n`);
    writeFileSync(pathJoin(work, "mattstack", "org", "settings.org.jsonc"), rosterWith("dev2"));
    const bare = pathJoin(home, "origin.git");
    execFileSync("git", ["init", "-q", "-b", "main", work], { env });
    execFileSync("git", ["-C", work, "add", "."], { env });
    execFileSync("git", ["-C", work, "commit", "-q", "-m", "org"], { env });
    execFileSync("git", ["clone", "-q", "--bare", work, bare], { env });

    const p = createRealProbes();
    const realExec = p.exec.bind(p);
    // The pointer's remote must be an https url; the clone itself reads the local bare repo, which join's GIT_PROTOCOL_FROM_USER=0 would refuse as a file transport.
    p.exec = (argv, opts) => realExec(argv.map((arg) => (arg === REMOTE ? bare : arg)), { ...opts, env: { ...opts?.env, GIT_PROTOCOL_FROM_USER: "1" } });

    const err = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, baseJoinRedeemSeams().seams).then(() => null, (e: unknown) => e);

    expect((err as UserActionableError).code).toBe("invite-stale");
    expect(existsSync(pathJoin(home, ".mattstack", "orgs", "acme"))).toBe(false);
    expect(existsSync(teamLocalPath(home, "acme"))).toBe(false);
    expect(existsSync(intentPath(home))).toBe(false);
  } finally {
    if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
  }
});
