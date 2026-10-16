import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciLeaseFileName, claimCiLease, CiLeaseLockBusyError, type CiLeaseOpts } from "../../../packages/rt-client/src/index.ts";
import { KEEPALIVE_IDLE_MS, KEEPALIVE_TICK_MS, LeaseKeepalive } from "../lease-keepalive.ts";

const MR = "https://gitlab.example.com/group/proj/-/merge_requests/7";
const ME = "session:me";
const OTHER = "session:other";

let dir: string;
let clockNow: number;
let intervals: { fn: () => void; ms: number; unrefs: number; cleared: boolean }[];

function leaseOpts(): CiLeaseOpts {
  return { dir, now: () => clockNow };
}

function make(overrides: ConstructorParameters<typeof LeaseKeepalive>[0] = {}) {
  return new LeaseKeepalive({
    now: () => clockNow,
    leaseOpts,
    setInterval: (fn, ms) => {
      const rec = { fn, ms, unrefs: 0, cleared: false };
      intervals.push(rec);
      return { unref: () => { rec.unrefs++; }, rec } as { unref(): void };
    },
    clearInterval: (h) => { (h as unknown as { rec: { cleared: boolean } }).rec.cleared = true; },
    ...overrides,
  });
}

function heartbeatAt(): number {
  return (JSON.parse(readFileSync(join(dir, ciLeaseFileName(MR)), "utf8")) as { heartbeatAt: number }).heartbeatAt;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lease-keepalive-"));
  clockNow = 1_000_000;
  intervals = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("LeaseKeepalive", () => {
  test("touch starts one unref'd interval and a tick heartbeats the lease", () => {
    claimCiLease({ mrUrl: MR, owner: ME, holder: "watch-ci" }, leaseOpts());
    const ka = make();
    ka.touch(MR, ME);
    ka.touch(MR, ME);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.ms).toBe(KEEPALIVE_TICK_MS);
    expect(intervals[0]!.unrefs).toBe(1);
    expect(ka.size()).toBe(1);

    clockNow += KEEPALIVE_TICK_MS;
    intervals[0]!.fn();
    expect(heartbeatAt()).toBe(clockNow);
    expect(ka.size()).toBe(1);
  });

  test("an entry idle past the cap is dropped without a heartbeat and the interval clears", () => {
    claimCiLease({ mrUrl: MR, owner: ME, holder: "watch-ci" }, leaseOpts());
    const ka = make();
    ka.touch(MR, ME);
    const before = heartbeatAt();
    clockNow += KEEPALIVE_IDLE_MS + 1;
    ka.tick();
    expect(ka.size()).toBe(0);
    expect(heartbeatAt()).toBe(before);
    expect(intervals[0]!.cleared).toBe(true);
  });

  test("an entry just inside the idle cap survives", () => {
    claimCiLease({ mrUrl: MR, owner: ME, holder: "watch-ci", ttlSeconds: 900 }, leaseOpts());
    const ka = make();
    ka.touch(MR, ME);
    clockNow += KEEPALIVE_IDLE_MS;
    ka.tick();
    expect(ka.size()).toBe(1);
  });

  test("a foreign takeover drops the entry", () => {
    claimCiLease({ mrUrl: MR, owner: ME, holder: "watch-ci" }, leaseOpts());
    const ka = make();
    ka.touch(MR, ME);
    clockNow += 700_000;
    expect(claimCiLease({ mrUrl: MR, owner: OTHER, holder: "watch-ci" }, leaseOpts()).claimed).toBe(true);
    ka.tick();
    expect(ka.size()).toBe(0);
  });

  test("a missing lease drops the entry", () => {
    const ka = make();
    ka.touch(MR, ME);
    ka.tick();
    expect(ka.size()).toBe(0);
  });

  test("a heartbeat that throws keeps the entry", () => {
    const ka = make({ heartbeat: () => { throw new CiLeaseLockBusyError("busy"); } });
    ka.touch(MR, ME);
    ka.tick();
    expect(ka.size()).toBe(1);
    expect(intervals[0]!.cleared).toBe(false);
  });

  test("drop removes the entry and the last drop clears the interval", () => {
    const ka = make();
    ka.touch(MR, ME);
    ka.drop(MR, OTHER);
    expect(ka.size()).toBe(1);
    ka.drop(MR, ME);
    expect(ka.size()).toBe(0);
    expect(intervals[0]!.cleared).toBe(true);
  });

  test("a touch after the registry emptied starts a fresh interval", () => {
    const ka = make();
    ka.touch(MR, ME);
    ka.drop(MR, ME);
    ka.touch(MR, ME);
    expect(intervals).toHaveLength(2);
  });
});
