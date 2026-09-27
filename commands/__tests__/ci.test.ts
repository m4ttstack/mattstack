/**
 * rt ci lease CLI (in-process): cliOwner derivation and every lease verb
 * against a real ci-lease.ts backed by a per-test temp dir. rt ci watch
 * spawns through the daemon and the GitLab client, so its CLI wiring is
 * covered by the spawn suite in no-ci-cli.test.ts instead of duplicated here.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { ciLeaseClaim, ciLeaseHeartbeat, ciLeaseRelease, ciLeaseShow, cliOwner } from "../ci.ts";

const MR_URL = "https://gitlab.example.com/acme/proj/-/merge_requests/7";

class ExitSentinel extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

async function run(fn: (args: string[]) => Promise<void>, args: string[]): Promise<{ code: number; stdout: string }> {
  const chunks: string[] = [];
  const writeSpy = spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
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
    exitSpy.mockRestore();
  }
  return { code, stdout: chunks.join("") };
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

  test("claim --holder rejects anything but watch-ci or doctor", async () => {
    const { code, stdout } = await run(ciLeaseClaim, [MR_URL, "--holder", "bogus", "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(stdout).error).toContain("--holder must be watch-ci or doctor");
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

  test("release frees the owner's lease and always exits 0, even when refused", async () => {
    await run(ciLeaseClaim, [MR_URL, "--json"]);

    process.env.CLAUDE_CODE_SESSION_ID = "s2";
    const refused = await run(ciLeaseRelease, [MR_URL, "--json"]);
    expect(refused.code).toBe(0);
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
