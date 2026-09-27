import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptLegacyCiLease, boardDoctorOwner, ciLeaseDir, ciLeaseFileName, CiLeaseError, claimCiLease, heartbeatCiLease,
  leaseOwner, parseMrIid, readCiLease, readCiLeaseByBranch, releaseCiLease, type CiLease,
} from "../src/ci-lease.ts";

const MR = "https://gitlab.example.com/grp/proj/-/merge_requests/42";
let dir: string;
let t: number;
const opts = () => ({ dir, now: () => t });

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ci-lease-")); t = 1_000_000; });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function file(): string { return join(dir, ciLeaseFileName(MR)); }
function onDisk(): CiLease { return JSON.parse(readFileSync(file(), "utf8")); }

describe("naming", () => {
  test("file name matches the board and script slug rule", () => {
    expect(ciLeaseFileName(MR)).toBe("grp-proj-42.json");
  });
  test("iid and file name ignore URL suffixes", () => {
    for (const u of [`${MR}/`, `${MR}/diffs`, `${MR}?tab=pipelines`, `${MR}#note_1`]) {
      expect(parseMrIid(u)).toBe(42);
      expect(ciLeaseFileName(u)).toBe("grp-proj-42.json");
    }
    expect(parseMrIid("https://github.com/o/r/pull/7/files")).toBe(7);
    expect(ciLeaseFileName("https://github.com/o/r/pull/7")).toBe("o-r-pull-7-7.json");
  });
  test("a URL with no MR segment is refused", () => {
    expect(parseMrIid("https://gitlab.example.com/grp/proj")).toBeNull();
    expect(() => ciLeaseFileName("https://gitlab.example.com/grp/proj")).toThrow();
  });
  test("dir honors the override and HOME at call time", () => {
    expect(ciLeaseDir({ MATTSTACK_ATTENDANTS_DIR: "/x" })).toBe("/x");
    expect(ciLeaseDir({ HOME: "/h" })).toBe("/h/.mattstack/ci-attendants");
  });
  test("board owner is keyed by the lease file, so URL suffixes agree", () => {
    expect(boardDoctorOwner(`${MR}/diffs`)).toBe(boardDoctorOwner(MR));
    expect(boardDoctorOwner(MR)).toBe("board:doctor:grp-proj-42.json");
  });
});

describe("claim rules", () => {
  test("first claim wins and writes every field", () => {
    const r = claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci", branch: "b", sessionLabel: "alice" }, opts());
    expect(r.claimed).toBe(true);
    expect(onDisk()).toMatchObject({ mr: MR, owner: "session:a", holder: "watch-ci", branch: "b", sessionLabel: "alice", startedAt: t, heartbeatAt: t, ttlSeconds: 600 });
  });
  test("a fresh lease with another owner refuses, whatever the role", () => {
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, opts());
    const r = claimCiLease({ mrUrl: MR, owner: "session:b", holder: "watch-ci" }, opts());
    expect(r).toMatchObject({ claimed: false, holder: { owner: "session:a" } });
    expect(onDisk().owner).toBe("session:a");
  });
  test("same owner re-claims, refreshing heartbeat and keeping startedAt", () => {
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, opts());
    t += 5_000;
    const r = claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, opts());
    expect(r.claimed).toBe(true);
    expect(onDisk()).toMatchObject({ startedAt: 1_000_000, heartbeatAt: t });
  });
  test("a stale lease is taken over and its owner reported", () => {
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci", ttlSeconds: 60 }, opts());
    t += 61_000;
    const r = claimCiLease({ mrUrl: MR, owner: "session:b", holder: "doctor" }, opts());
    expect(r).toMatchObject({ claimed: true, previousOwner: "session:a" });
    expect(onDisk().owner).toBe("session:b");
  });
  test("malformed file is claimable", () => {
    writeFileSync(file(), "{not json");
    expect(claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, opts()).claimed).toBe(true);
  });
  test("a fresh legacy lease (no owner) is foreign to everyone", () => {
    writeFileSync(file(), JSON.stringify({ mr: MR, holder: "watch-ci", startedAt: t, heartbeatAt: t, ttlSeconds: 600 }));
    const r = claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, opts());
    expect(r.claimed).toBe(false);
    if (!r.claimed) expect(leaseOwner(r.holder)).toBe("legacy:watch-ci");
  });
  test("no lock or temp file is left behind", () => {
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, opts());
    expect(readdirSync(dir)).toEqual(["grp-proj-42.json"]);
  });
  test("a lock file mid write (empty, fresh mtime) is not broken while its writer is still busy", () => {
    writeFileSync(join(dir, "grp-proj-42.lock"), "");
    expect(() => claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, opts())).toThrow(CiLeaseError);
  }, 15_000);
  test("a genuinely stale empty lock (old mtime) is broken and the claim succeeds, leaving no lock or aside file", () => {
    const lockPath = join(dir, "grp-proj-42.lock");
    writeFileSync(lockPath, "");
    const old = new Date(Date.now() - 1_000);
    utimesSync(lockPath, old, old);
    const r = claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, { dir, now: () => t, lockStaleMs: 50 });
    expect(r.claimed).toBe(true);
    expect(readdirSync(dir)).toEqual(["grp-proj-42.json"]);
  });
});

describe("heartbeat, release, read, adopt", () => {
  test("missing dir reads as none", () => {
    const o = { dir: join(dir, "absent"), now: () => t };
    expect(readCiLease(MR, o)).toEqual({ lease: null, stale: null });
    expect(heartbeatCiLease(MR, "session:a", o)).toEqual({ ok: false, reason: "none" });
    expect(releaseCiLease(MR, "session:a", o)).toEqual({ released: false, reason: "none" });
  });
  test("heartbeat refreshes only the owner's lease, fresh or stale", () => {
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci", ttlSeconds: 60 }, opts());
    t += 120_000;
    expect(heartbeatCiLease(MR, "session:a", opts())).toMatchObject({ ok: true, lease: { heartbeatAt: t } });
    expect(heartbeatCiLease(MR, "session:b", opts())).toMatchObject({ ok: false, reason: "lost", holder: { owner: "session:a" } });
  });
  test("release deletes only the owner's lease", () => {
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, opts());
    expect(releaseCiLease(MR, "session:b", opts())).toMatchObject({ released: false, reason: "not-owner" });
    expect(existsSync(file())).toBe(true);
    expect(releaseCiLease(MR, "session:a", opts())).toEqual({ released: true });
    expect(existsSync(file())).toBe(false);
  });
  test("read returns fresh leases and reports stale ones separately", () => {
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci", ttlSeconds: 60 }, opts());
    expect(readCiLease(MR, opts()).lease?.owner).toBe("session:a");
    t += 61_000;
    expect(readCiLease(MR, opts())).toMatchObject({ lease: null, stale: { owner: "session:a" } });
  });
  test("read by branch finds a fresh lease and skips lock files", () => {
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci", branch: "feat" }, opts());
    writeFileSync(join(dir, "grp-proj-42.lock"), "{}");
    expect(readCiLeaseByBranch("feat", opts())?.owner).toBe("session:a");
    expect(readCiLeaseByBranch("other", opts())).toBeNull();
  });
  test("adopt rewrites a legacy lease of the same holder and keeps its times", () => {
    writeFileSync(file(), JSON.stringify({ mr: MR, holder: "doctor", startedAt: 5, heartbeatAt: t, ttlSeconds: 600 }));
    expect(adoptLegacyCiLease(MR, boardDoctorOwner(MR), "doctor", opts())).toEqual({ adopted: true });
    expect(onDisk()).toMatchObject({ owner: boardDoctorOwner(MR), startedAt: 5, heartbeatAt: t });
  });
  test("adopt leaves an owned lease or another holder alone", () => {
    writeFileSync(file(), JSON.stringify({ mr: MR, holder: "watch-ci", startedAt: t, heartbeatAt: t, ttlSeconds: 600 }));
    expect(adoptLegacyCiLease(MR, boardDoctorOwner(MR), "doctor", opts())).toEqual({ adopted: false });
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "doctor" }, { dir, now: () => t + 700_000 });
    expect(adoptLegacyCiLease(MR, boardDoctorOwner(MR), "doctor", opts())).toEqual({ adopted: false });
  });
});
