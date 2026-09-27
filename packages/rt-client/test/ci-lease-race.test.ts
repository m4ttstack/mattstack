import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CiLeaseError, ciLeaseFileName, claimCiLease, heartbeatCiLease, readCiLease } from "../src/ci-lease.ts";

const MR = "https://gitlab.example.com/grp/proj/-/merge_requests/42";
const CLAIMER = join(import.meta.dir, "fixtures", "ci-lease-claimer.ts");
const SCRIPT = join(import.meta.dir, "fixtures", "ci-attendant.sh");
let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ci-lease-race-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function isolatedEnv(): Record<string, string> {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, MATTSTACK_ATTENDANTS_DIR: dir };
}

async function spawnClaimer(owner: string, holder = "watch-ci"): Promise<{ owner: string; claimed: boolean }> {
  const proc = Bun.spawn([process.execPath, CLAIMER, dir, MR, owner, holder], { env: isolatedEnv(), stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out);
}

function script(...args: string[]) {
  return Bun.spawnSync(["bash", SCRIPT, ...args], { env: isolatedEnv(), stdout: "pipe", stderr: "pipe" });
}

function lockPath(): string {
  return join(dir, ciLeaseFileName(MR).replace(/\.json$/, ".lock"));
}

describe("compare-and-set under concurrency", () => {
  test("many concurrent claimers in separate processes: exactly one wins", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => spawnClaimer(`session:${i}`)));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    const winner = results.find((r) => r.claimed)!.owner;
    expect(JSON.parse(readFileSync(join(dir, ciLeaseFileName(MR)), "utf8")).owner).toBe(winner);
  });

  // rt claims as doctor: the script treats any fresh watch-ci lease as its own
  // and overwrites it (its constant-holder bug), so only a doctor race is fair.
  test("a lockless exclusive-create claimer racing rt claimers: exactly one wins", async () => {
    const rt = Array.from({ length: 6 }, (_, i) => spawnClaimer(`session:${i}`, "doctor"));
    const sh = Bun.spawn(["bash", SCRIPT, "claim", MR, "42"], { env: isolatedEnv(), stdout: "pipe" });
    const rtResults = await Promise.all(rt);
    const shCode = await sh.exited;
    const lease = JSON.parse(readFileSync(join(dir, ciLeaseFileName(MR)), "utf8"));
    const rtWins = rtResults.filter((r) => r.claimed).length;
    if (lease.owner === undefined) {
      expect(shCode).toBe(0);
      expect(rtWins).toBe(0);
    } else {
      expect(shCode).toBe(3);
      expect(rtWins).toBe(1);
    }
  });

  test("a lockless creator that appears between the read and the create link makes the claim re-read and refuse", () => {
    const scriptLease = { mr: MR, holder: "watch-ci", sessionLabel: "watch-ci", pid: 999, startedAt: Date.now(), heartbeatAt: Date.now(), ttlSeconds: 600 };
    let fired = false;
    const r = claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, {
      dir,
      onLeaseRead: () => {
        if (fired) return;
        fired = true;
        writeFileSync(join(dir, ciLeaseFileName(MR)), JSON.stringify(scriptLease));
      },
    });
    expect(r).toMatchObject({ claimed: false, holder: { pid: 999 } });
    expect(JSON.parse(readFileSync(join(dir, ciLeaseFileName(MR)), "utf8"))).toEqual(scriptLease);
  });
});

describe("stale lock breaking", () => {
  test("a stale lock is broken and the operation proceeds", () => {
    const lock = lockPath();
    writeFileSync(lock, JSON.stringify({ token: "dead", at: Date.now() - 60_000 }));
    expect(claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, { dir }).claimed).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  test("a fresh lock blocks until its wait deadline", () => {
    const lock = lockPath();
    writeFileSync(lock, JSON.stringify({ token: "live", at: Date.now() + 60_000 }));
    let err: unknown;
    try {
      claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, { dir, lockWaitMs: 150 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CiLeaseError);
    expect((err as Error).message).toMatch(/busy/);
    expect(JSON.parse(readFileSync(lock, "utf8")).token).toBe("live");
  });

  test("a holder whose lock was broken neither writes nor deletes the next holder's lock, and the retry ends consistent", () => {
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, { dir });
    const lock = lockPath();
    const heartbeats = [111, 222];
    let call = 0;
    let waits = 0;
    // Simulates a breaker taking the lock, then releasing it before the deadline.
    const r = heartbeatCiLease(MR, "session:a", {
      dir,
      lockWaitMs: 2_000,
      now: () => {
        const v = heartbeats[call] ?? heartbeats[heartbeats.length - 1];
        if (call === 0) writeFileSync(lock, JSON.stringify({ token: "next-holder", at: Date.now() }));
        call++;
        return v as number;
      },
      onLockWait: () => {
        waits++;
        if (waits === 1) expect(JSON.parse(readFileSync(lock, "utf8")).token).toBe("next-holder");
        if (waits === 2) unlinkSync(lock);
      },
    });
    expect(waits).toBeGreaterThanOrEqual(2);
    expect(r).toMatchObject({ ok: true, lease: { heartbeatAt: 222 } });
    expect(existsSync(lock)).toBe(false);
    expect(readdirSync(dir).filter((f) => /\.tmp$|\.lock$|\.broken$/.test(f))).toEqual([]);
    expect(readCiLease(MR, { dir, now: () => 222 }).lease?.heartbeatAt).toBe(222);
  });

  test("a taker restores a lock that changed underneath a stale judgment", () => {
    const lock = lockPath();
    writeFileSync(lock, JSON.stringify({ token: "stale-token", at: Date.now() - 60_000 }));
    let fired = false;
    const r = (() => {
      try {
        return claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, {
          dir,
          lockStaleMs: 1_000,
          lockWaitMs: 150,
          // Simulates a racer replacing the lock while it is judged stale.
          onStaleLockObserved: () => {
            if (fired) return;
            fired = true;
            writeFileSync(lock, JSON.stringify({ token: "fresh-token", at: Date.now() }));
          },
        });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(r).toBeInstanceOf(CiLeaseError);
    expect(JSON.parse(readFileSync(lock, "utf8")).token).toBe("fresh-token");
    expect(readdirSync(dir).some((f) => f.endsWith(".broken"))).toBe(false);
    expect(existsSync(join(dir, ciLeaseFileName(MR)))).toBe(false);
  });
});

describe("pack script interop", () => {
  test("the script refuses a fresh rt doctor lease and reads it with status", () => {
    claimCiLease({ mrUrl: MR, owner: "board:doctor:x", holder: "doctor" }, { dir });
    const claim = script("claim", MR, "42");
    expect(claim.exitCode).toBe(3);
    expect(JSON.parse(claim.stdout.toString()).holder).toBe("doctor");
    expect(script("status", MR, "42").exitCode).toBe(0);
  });

  test("rt reads a script lease as legacy and refuses to claim over it while fresh", () => {
    expect(script("claim", MR, "42", "--branch", "feat").exitCode).toBe(0);
    const r = claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, { dir });
    expect(r.claimed).toBe(false);
    expect(readCiLease(MR, { dir }).lease).toMatchObject({ holder: "watch-ci", branch: "feat" });
  });
});
