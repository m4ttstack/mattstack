import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupGitHubSignIn, type GitHubSignInDeps } from "../setup-github.ts";
import type { SecretWriter } from "../setup.ts";
import { readGitHubSignIn, writeGitHubSignIn } from "../../lib/setup/github-signin.ts";
import { readStagedSecret } from "../../lib/setup/staging.ts";
import { readSetupState } from "../../lib/setup/state.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { capturePlain } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

const HOME = "/fake-home";
const START = new Date("2026-01-01T00:00:00Z");
const RECORD = `${HOME}/.mattstack/rt/logins/github.json`;
const DEVICE_CODE = "device-code-secret";
const TOKEN = "gho_tokensecret";

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body), headers: {} });

interface Rig {
  deps: GitHubSignInDeps;
  probes: ReturnType<typeof fakeProbes>;
  jsons: unknown[];
  spawned: Array<{ argv: string[]; input: string }>;
  written: Array<[string, string, string]>;
  slept: number[];
  clock: { now: Date };
}

function rig(opts: { polls?: unknown[]; ready?: boolean; files?: Record<string, string>; clientId?: string; intervalSec?: number; writeFails?: boolean } = {}): Rig {
  const clock = { now: START };
  const polls = [...(opts.polls ?? [])];
  const probes = fakeProbes({
    home: HOME,
    files: opts.files,
    fetch: async (url) => {
      if (url.endsWith("/login/device/code")) {
        return reply({ device_code: DEVICE_CODE, user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 });
      }
      return reply(polls.shift() ?? { error: "authorization_pending" });
    },
  });
  probes.now = () => clock.now;
  const jsons: unknown[] = [];
  const spawned: Rig["spawned"] = [];
  const written: Rig["written"] = [];
  const slept: number[] = [];
  const writer: SecretWriter = {
    storeReady: async () => opts.ready ?? true,
    write: async (domain, key, value) => {
      if (opts.writeFails) throw new Error("sops failed");
      written.push([domain, key, value]);
    },
  };
  const deps: GitHubSignInDeps = {
    probes,
    json: (v) => jsons.push(v),
    exit: (code) => {
      throw new ExitSentinel(code);
    },
    spawnWaiter: (argv, input) => {
      spawned.push({ argv, input });
      return 4242;
    },
    readWaiterInput: async () => ({ deviceCode: DEVICE_CODE, intervalSec: opts.intervalSec ?? 5 }),
    writer,
    sleep: async (ms) => {
      slept.push(ms);
      clock.now = new Date(clock.now.getTime() + ms);
    },
    alive: () => true,
    clientId: opts.clientId ?? "acme-client",
  };
  return { deps, probes, jsons, spawned, written, slept, clock };
}

function liveRecord(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ userCode: "ABCD-1234", url: "https://github.com/login/device", expiresAt: "2026-01-01T00:15:00.000Z", pid: 4242, ...extra });
}

let cap: CapturedOut;
beforeEach(() => {
  cap = capturePlain();
});
afterEach(() => cap.restore());

describe("sign-in start", () => {
  test("writes the record, spawns the waiter and reports the code without the device code", async () => {
    const r = rig();
    await setupGitHubSignIn(["--json"], {}, r.deps);
    expect(r.spawned).toHaveLength(1);
    expect(r.spawned[0]!.argv.slice(-4)).toEqual(["setup", "github", "sign-in", "--wait"]);
    expect(JSON.parse(r.spawned[0]!.input)).toEqual({ deviceCode: DEVICE_CODE, intervalSec: 5 });
    expect(r.spawned[0]!.argv.join(" ")).not.toContain(DEVICE_CODE);
    const env = r.jsons[0] as Record<string, unknown>;
    expect(env.userCode).toBe("ABCD-1234");
    expect(env.url).toBe("https://github.com/login/device");
    expect(JSON.stringify(env)).not.toContain(DEVICE_CODE);
    const record = readGitHubSignIn(r.probes, () => true);
    expect(record?.pid).toBe(4242);
    expect(r.probes.readFile(RECORD)).not.toContain(DEVICE_CODE);
  });

  test("a live record is returned as is and nothing is spawned", async () => {
    const r = rig({ files: { [RECORD]: liveRecord() } });
    await setupGitHubSignIn(["--json"], {}, r.deps);
    expect(r.spawned).toEqual([]);
    expect(r.probes.calls.fetch).toEqual([]);
    expect((r.jsons[0] as Record<string, unknown>).userCode).toBe("ABCD-1234");
  });

  test("a leftover outcome record does not block a new sign-in", async () => {
    const r = rig({ files: { [RECORD]: liveRecord({ outcome: "expired", userCode: "OLD-0000" }) } });
    await setupGitHubSignIn(["--json"], {}, r.deps);
    expect(r.spawned).toHaveLength(1);
    const record = readGitHubSignIn(r.probes, () => true);
    expect(record?.userCode).toBe("ABCD-1234");
    expect(record?.pid).toBe(4242);
    expect(record?.outcome).toBeUndefined();
  });

  test("a human start prints the code and the url", async () => {
    const r = rig();
    await setupGitHubSignIn([], {}, r.deps);
    expect(cap.stdout() + cap.stderr()).toContain("ABCD-1234");
    expect(cap.stdout() + cap.stderr()).toContain("https://github.com/login/device");
  });

  test("an empty client id refuses", async () => {
    const r = rig({ clientId: "" });
    const err = await setupGitHubSignIn(["--json"], {}, r.deps).catch((e) => e);
    expect(err).toBeInstanceOf(ExitSentinel);
    expect((r.jsons[0] as { error: { message: string } }).error.message).toBe("GitHub sign-in isn't set up in this build");
    expect(r.spawned).toEqual([]);
  });

  test("a waiter that will not start leaves no record", async () => {
    const r = rig();
    r.deps.spawnWaiter = () => null;
    await expect(setupGitHubSignIn(["--json"], {}, r.deps)).rejects.toBeInstanceOf(ExitSentinel);
    expect(r.probes.readFile(RECORD)).toBeNull();
  });
});

describe("sign-in --wait", () => {
  const seed = (r: Rig) => writeGitHubSignIn(r.probes, { userCode: "ABCD-1234", url: "https://github.com/login/device", expiresAt: "2026-01-01T00:15:00.000Z", pid: 4242 });

  test("pending, pending, then a token stores it, stages the remote and clears the record", async () => {
    const r = rig({ polls: [{ error: "authorization_pending" }, { error: "authorization_pending" }, { access_token: TOKEN }] });
    seed(r);
    await setupGitHubSignIn(["--wait"], {}, r.deps);
    expect(r.written).toEqual([["rt", "githubToken", TOKEN]]);
    expect(readSetupState(r.probes).homeBackup).toEqual({ mode: "remote", create: true });
    expect(r.probes.readFile(RECORD)).toBeNull();
    expect(r.slept).toEqual([5000, 5000, 5000]);
  });

  test("with the personal store not ready the token is staged", async () => {
    const r = rig({ ready: false, polls: [{ access_token: TOKEN }] });
    seed(r);
    await setupGitHubSignIn(["--wait"], {}, r.deps);
    expect(r.written).toEqual([]);
    expect(readStagedSecret(r.probes, "rt", "githubToken")).toBe(TOKEN);
    expect(readSetupState(r.probes).homeBackup).toEqual({ mode: "remote", create: true });
  });

  test("slow-down lengthens the wait", async () => {
    const r = rig({ polls: [{ error: "slow_down", interval: 10 }, { access_token: TOKEN }] });
    seed(r);
    await setupGitHubSignIn(["--wait"], {}, r.deps);
    expect(r.slept).toEqual([5000, 10000]);
  });

  test("expired leaves an expired outcome", async () => {
    const r = rig({ polls: [{ error: "expired_token" }] });
    seed(r);
    await setupGitHubSignIn(["--wait"], {}, r.deps);
    expect(readGitHubSignIn(r.probes, () => true)?.outcome).toBe("expired");
    expect(r.written).toEqual([]);
  });

  test("declined leaves a declined outcome", async () => {
    const r = rig({ polls: [{ error: "access_denied" }] });
    seed(r);
    await setupGitHubSignIn(["--wait"], {}, r.deps);
    expect(readGitHubSignIn(r.probes, () => true)?.outcome).toBe("declined");
  });

  test("running past expiresAt leaves an expired outcome", async () => {
    const r = rig();
    seed(r);
    await setupGitHubSignIn(["--wait"], {}, r.deps);
    expect(readGitHubSignIn(r.probes, () => true)?.outcome).toBe("expired");
    expect(r.clock.now.getTime()).toBeGreaterThanOrEqual(Date.parse("2026-01-01T00:15:00.000Z"));
  });

  test("with no record there is nothing to wait for", async () => {
    const r = rig();
    await setupGitHubSignIn(["--wait"], {}, r.deps);
    expect(r.probes.calls.fetch).toEqual([]);
    expect(r.slept).toEqual([]);
  });

  test("polls at the interval GitHub gave", async () => {
    const r = rig({ intervalSec: 7, polls: [{ error: "authorization_pending" }, { access_token: TOKEN }] });
    seed(r);
    await setupGitHubSignIn(["--wait"], {}, r.deps);
    expect(r.slept).toEqual([7000, 7000]);
  });

  test("a failed store write stages the token and still finishes", async () => {
    const r = rig({ writeFails: true, polls: [{ access_token: TOKEN }] });
    seed(r);
    await setupGitHubSignIn(["--wait"], {}, r.deps);
    expect(readStagedSecret(r.probes, "rt", "githubToken")).toBe(TOKEN);
    expect(readSetupState(r.probes).homeBackup).toEqual({ mode: "remote", create: true });
    expect(r.probes.readFile(RECORD)).toBeNull();
  });

  test("a waiter whose record was replaced leaves the newer record alone", async () => {
    for (const poll of [{ access_token: TOKEN }, { error: "expired_token" }, { error: "access_denied" }]) {
      const r = rig({ polls: [poll] });
      seed(r);
      const newer = { userCode: "WXYZ-9876", url: "https://github.com/login/device", expiresAt: "2026-01-01T00:20:00.000Z", pid: 5151 };
      const sleep = r.deps.sleep;
      r.deps.sleep = async (ms) => {
        await sleep(ms);
        writeGitHubSignIn(r.probes, newer);
      };
      await setupGitHubSignIn(["--wait"], {}, r.deps);
      expect(JSON.parse(r.probes.readFile(RECORD)!)).toEqual(newer);
    }
  });

  test("neither the token nor the device code reaches output", async () => {
    const r = rig({ polls: [{ access_token: TOKEN }] });
    seed(r);
    await setupGitHubSignIn(["--wait", "--json"], {}, r.deps);
    const all = JSON.stringify(r.jsons) + cap.stdout() + cap.stderr();
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(DEVICE_CODE);
  });
});
