/**
 * rt ci (in-process): cliOwner derivation, every lease verb, and rt ci
 * watch's exit-code mapping, against a real ci-lease.ts backed by a
 * per-test temp dir. The watch runs with fake MR and daemon reads, so no
 * daemon or forge is reached.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { ciLeaseClaim, ciLeaseHeartbeat, ciLeaseRelease, ciLeaseShow, cliOwner, runCiWatch } from "../ci.ts";
import type { CiWatchToolDeps } from "../../lib/mcp/ci-tools.ts";

const MR_URL = "https://gitlab.example.com/acme/proj/-/merge_requests/7";

class ExitSentinel extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

async function run(fn: (args: string[]) => Promise<void>, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const writeSpy = spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    outChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  const errSpy = spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    errChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitSentinel(code ?? 0);
  }) as unknown as typeof process.exit);
  let code = 0;
  try {
    await fn(args);
  } catch (e) {
    if (e instanceof ExitSentinel) code = e.code;
    else throw e;
  } finally {
    writeSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { code, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

describe("cliOwner", () => {
  test("uses the Claude session when present", () => {
    expect(cliOwner({ CLAUDE_CODE_SESSION_ID: "x", USER: "u" })).toBe("session:x");
  });
  test("falls back to the login", () => {
    expect(cliOwner({ USER: "u" })).toBe("user:u");
  });
});

describe("rt ci lease CLI (in-process)", () => {
  let home = "";
  let dir = "";
  let origHome: string | undefined;
  let origDir: string | undefined;
  let origSession: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    origDir = process.env.MATTSTACK_ATTENDANTS_DIR;
    origSession = process.env.CLAUDE_CODE_SESSION_ID;
    home = mkdtempSync(join(tmpdir(), "rt-ci-cli-"));
    dir = join(home, "attendants");
    process.env.HOME = home;
    process.env.MATTSTACK_ATTENDANTS_DIR = dir;
    process.env.CLAUDE_CODE_SESSION_ID = "s1";
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origDir === undefined) delete process.env.MATTSTACK_ATTENDANTS_DIR;
    else process.env.MATTSTACK_ATTENDANTS_DIR = origDir;
    if (origSession === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = origSession;
    rmSync(home, { recursive: true, force: true });
  });

  test("claim reports {claimed: true} and exits 0", async () => {
    const { code, stdout } = await run(ciLeaseClaim, [MR_URL, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ claimed: true, lease: { owner: "session:s1", holder: "watch-ci" } });
  });

  test("claim requires a valid MR URL, exit 2", async () => {
    const { code, stdout } = await run(ciLeaseClaim, ["not-a-url", "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(stdout)).toHaveProperty("error");
  });

  test("a plain-text error goes to stderr, not stdout; --json puts the same failure on stdout", async () => {
    const plain = await run(ciLeaseClaim, ["not-a-url"]);
    expect(plain.code).toBe(2);
    expect(plain.stdout).toBe("");
    expect(plain.stderr).toContain("usage: rt ci lease claim <mr-url>");

    const json = await run(ciLeaseClaim, ["not-a-url", "--json"]);
    expect(json.code).toBe(2);
    expect(json.stderr).toBe("");
    expect(JSON.parse(json.stdout).error).toContain("usage: rt ci lease claim <mr-url>");
  });

  test("each lease verb's usage message names the verb, not a generic placeholder", async () => {
    expect((await run(ciLeaseHeartbeat, ["bad"])).stderr).toContain("usage: rt ci lease heartbeat <mr-url>");
    expect((await run(ciLeaseRelease, ["bad"])).stderr).toContain("usage: rt ci lease release <mr-url>");
    expect((await run(ciLeaseShow, ["bad"])).stderr).toContain("usage: rt ci lease show <mr-url>");
  });

  test("claim --holder rejects anything but watch-ci or doctor", async () => {
    const { code, stdout } = await run(ciLeaseClaim, [MR_URL, "--holder", "bogus", "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toContain("--holder must be watch-ci or doctor");
  });

  test("a dangling --holder (no value) is a usage error, not a silent default", async () => {
    const { code, stdout } = await run(ciLeaseClaim, [MR_URL, "--holder", "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toContain("--holder requires a value");

    const plain = await run(ciLeaseClaim, [MR_URL, "--holder"]);
    expect(plain.code).toBe(2);
    expect(plain.stderr).toContain("--holder requires a value");
  });

  test("a --branch followed by another flag or nothing is a usage error, never a branch named after the flag", async () => {
    const { code, stdout } = await run(ciLeaseClaim, [MR_URL, "--branch", "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toContain("--branch requires a value");
    const plain = await run(ciLeaseClaim, [MR_URL, "--branch"]);
    expect(plain.code).toBe(2);
    expect(plain.stderr).toContain("--branch requires a value");
  });

  test("a URL that is not https is a usage error for every lease verb", async () => {
    for (const url of ["http://gitlab.example.com/acme/proj/-/merge_requests/7", "gitlab.example.com/acme/proj/-/merge_requests/7"]) {
      for (const fn of [ciLeaseClaim, ciLeaseHeartbeat, ciLeaseRelease, ciLeaseShow]) {
        const { code, stdout } = await run(fn, [url, "--json"]);
        expect(code).toBe(2);
        expect(JSON.parse(stdout).error).toContain("usage: rt ci lease");
      }
    }
  });

  test("a second claim from another session is refused with exit 3", async () => {
    await run(ciLeaseClaim, [MR_URL, "--json"]);
    process.env.CLAUDE_CODE_SESSION_ID = "s2";
    const { code, stdout } = await run(ciLeaseClaim, [MR_URL, "--json"]);
    expect(code).toBe(3);
    expect(JSON.parse(stdout)).toMatchObject({ claimed: false, holder: { owner: "session:s1" } });
  });

  test("re-claiming as the same owner refreshes rather than refusing", async () => {
    await run(ciLeaseClaim, [MR_URL, "--json"]);
    const { code, stdout } = await run(ciLeaseClaim, [MR_URL, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).claimed).toBe(true);
  });

  test("show reports mine: true for the owning session and none for an unclaimed MR", async () => {
    const none = await run(ciLeaseShow, [MR_URL, "--json"]);
    expect(none.code).toBe(1);
    expect(JSON.parse(none.stdout)).toMatchObject({ lease: null, mine: false });

    await run(ciLeaseClaim, [MR_URL, "--json"]);
    const mine = await run(ciLeaseShow, [MR_URL, "--json"]);
    expect(mine.code).toBe(0);
    expect(JSON.parse(mine.stdout)).toMatchObject({ lease: { owner: "session:s1" }, mine: true });

    process.env.CLAUDE_CODE_SESSION_ID = "s2";
    const notMine = await run(ciLeaseShow, [MR_URL, "--json"]);
    expect(notMine.code).toBe(0);
    expect(JSON.parse(notMine.stdout)).toMatchObject({ lease: { owner: "session:s1" }, mine: false });
  });

  test("show's plain text names the holder and the heartbeat time", async () => {
    await run(ciLeaseClaim, [MR_URL]);
    const { stdout } = await run(ciLeaseShow, [MR_URL]);
    expect(stdout).toContain("session:s1");
    expect(stdout).toContain("watch-ci");
  });

  test("heartbeat refreshes the owner's own lease and exits 0", async () => {
    await run(ciLeaseClaim, [MR_URL, "--json"]);
    const { code, stdout } = await run(ciLeaseHeartbeat, [MR_URL, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, lease: { owner: "session:s1" } });
  });

  test("heartbeat with no lease on file reports {ok: false, reason: 'none'} and exits 3", async () => {
    const { code, stdout } = await run(ciLeaseHeartbeat, [MR_URL, "--json"]);
    expect(code).toBe(3);
    expect(JSON.parse(stdout)).toEqual({ ok: false, reason: "none" });
  });

  test("heartbeat from a non-owning session reports lost and exits 3", async () => {
    await run(ciLeaseClaim, [MR_URL, "--json"]);
    process.env.CLAUDE_CODE_SESSION_ID = "s2";
    const { code, stdout } = await run(ciLeaseHeartbeat, [MR_URL, "--json"]);
    expect(code).toBe(3);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, reason: "lost", holder: { owner: "session:s1" } });
  });

  test("release frees the owner's lease; a non-owner's refusal exits 3 (matching claim/heartbeat), but releasing nothing is idempotent and exits 0", async () => {
    await run(ciLeaseClaim, [MR_URL, "--json"]);

    process.env.CLAUDE_CODE_SESSION_ID = "s2";
    const refused = await run(ciLeaseRelease, [MR_URL, "--json"]);
    expect(refused.code).toBe(3);
    expect(JSON.parse(refused.stdout)).toMatchObject({ released: false, reason: "not-owner", holder: { owner: "session:s1" } });

    process.env.CLAUDE_CODE_SESSION_ID = "s1";
    const released = await run(ciLeaseRelease, [MR_URL, "--json"]);
    expect(released.code).toBe(0);
    expect(JSON.parse(released.stdout)).toEqual({ released: true });

    const again = await run(ciLeaseRelease, [MR_URL, "--json"]);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout)).toEqual({ released: false, reason: "none" });
  });
});

describe("rt ci watch exit codes (in-process)", () => {
  const SHA = "b".repeat(40);
  let home = "";
  let origHome: string | undefined;
  let origDir: string | undefined;
  let origSession: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    origDir = process.env.MATTSTACK_ATTENDANTS_DIR;
    origSession = process.env.CLAUDE_CODE_SESSION_ID;
    home = mkdtempSync(join(tmpdir(), "rt-ci-watch-"));
    process.env.HOME = home;
    process.env.MATTSTACK_ATTENDANTS_DIR = join(home, "attendants");
    process.env.CLAUDE_CODE_SESSION_ID = "s1";
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origDir === undefined) delete process.env.MATTSTACK_ATTENDANTS_DIR;
    else process.env.MATTSTACK_ATTENDANTS_DIR = origDir;
    if (origSession === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = origSession;
    rmSync(home, { recursive: true, force: true });
  });

  function fakes(status: string, over: Partial<CiWatchToolDeps> = {}): Partial<CiWatchToolDeps> {
    const pipeline = { id: "gitlab:pipeline:10", status, sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] };
    return {
      resolve: (async () => ({ ok: true, identity: "remote:x", iid: 7 })) as unknown as CiWatchToolDeps["resolve"],
      command: (async (name: string) => (name === "mr:get"
        ? { ok: true, data: { mr: { iid: 7, sha: SHA, webUrl: MR_URL, pipeline }, fetchedAt: 0 } }
        : { ok: true, data: [] })) as unknown as CiWatchToolDeps["command"],
      now: () => 0,
      sleep: async () => {},
      ...over,
    };
  }

  test("a settled success exits 0", async () => {
    await run(ciLeaseClaim, [MR_URL, "--json"]);
    const { code, stdout } = await run((a) => runCiWatch(a, fakes("success")), [MR_URL, "--sha", SHA, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).state).toBe("success");
  });

  test("a settled failure exits 1", async () => {
    await run(ciLeaseClaim, [MR_URL, "--json"]);
    const { code, stdout } = await run((a) => runCiWatch(a, fakes("failed")), [MR_URL, "--sha", SHA, "--json"]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).state).toBe("failed");
  });

  test("Ctrl-C mid-watch exits 130 with the aborted state", async () => {
    await run(ciLeaseClaim, [MR_URL, "--json"]);
    const interrupt = fakes("running", { sleep: async () => { process.emit("SIGINT"); } });
    const { code, stdout } = await run((a) => runCiWatch(a, interrupt), [MR_URL, "--sha", SHA, "--json"]);
    expect(code).toBe(130);
    expect(JSON.parse(stdout).state).toBe("aborted");
  });

  test("a watch flag followed by another flag or nothing is a usage error naming the flag", async () => {
    const cases: Array<[string[], string]> = [
      [[MR_URL, "--sha", "--json"], "--sha"],
      [[MR_URL, "--sha", SHA, "--interval", "--json"], "--interval"],
      [[MR_URL, "--sha", SHA, "--json", "--max-wait"], "--max-wait"],
      [[MR_URL, "--sha", SHA, "--json", "--prior-pipeline", "--max-wait", "60"], "--prior-pipeline"],
    ];
    for (const [args, name] of cases) {
      const { code, stdout } = await run((a) => runCiWatch(a, fakes("success")), args);
      expect(code).toBe(2);
      expect(JSON.parse(stdout).error).toContain(`${name} requires a value`);
    }
  });

  test("a missing --sha is a usage error, exit 2", async () => {
    const { code, stdout } = await run((a) => runCiWatch(a, fakes("success")), [MR_URL, "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toContain("usage: rt ci watch");
  });
});
