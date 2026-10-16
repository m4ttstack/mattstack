import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardDoctorOwner, claimCiLease, readCiLease, type CiLeaseOpts } from "../../../packages/rt-client/src/index.ts";
import { ensureLease, isHttpsMrUrl, ownerFromEnv } from "../lease-guard.ts";
import { LeaseKeepalive } from "../lease-keepalive.ts";

const MR = "https://gitlab.example.com/group/proj/-/merge_requests/7";
const ME = "session:me";
const ENV = { CLAUDE_CODE_SESSION_ID: "me" } as NodeJS.ProcessEnv;

let dir: string;
let clockNow: number;
let ka: LeaseKeepalive;
let touched: string[];

function leaseOpts(): CiLeaseOpts {
  return { dir, now: () => clockNow };
}

function guard(mrUrl = MR, env = ENV, branch?: string) {
  return ensureLease(mrUrl, env, { leaseOpts: leaseOpts(), keepalive: ka, ...(branch !== undefined && { branch }) });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lease-guard-"));
  clockNow = 1_000_000;
  touched = [];
  ka = new LeaseKeepalive({
    now: () => clockNow,
    leaseOpts,
    setInterval: () => ({}),
    clearInterval: () => {},
  });
  const touch = ka.touch.bind(ka);
  ka.touch = (mrUrl, owner) => { touched.push(`${owner} ${mrUrl}`); touch(mrUrl, owner); };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ensureLease", () => {
  test("refreshes a lease this session holds", () => {
    claimCiLease({ mrUrl: MR, owner: ME, holder: "watch-ci" }, leaseOpts());
    clockNow += 120_000;
    const r = guard();
    expect(r).toMatchObject({ ok: true, claimed: false });
    if (r.ok) expect(r.lease.heartbeatAt).toBe(clockNow);
    expect(touched).toEqual([`${ME} ${MR}`]);
    expect(ka.size()).toBe(1);
  });

  test("claims when no lease exists, storing holder and branch", () => {
    const r = guard(MR, ENV, "feat/x");
    expect(r).toMatchObject({ ok: true, claimed: true });
    const { lease } = readCiLease(MR, leaseOpts());
    expect(lease).toMatchObject({ holder: "watch-ci", owner: ME, branch: "feat/x" });
    expect(touched).toEqual([`${ME} ${MR}`]);
  });

  test("takes over a stale foreign lease", () => {
    claimCiLease({ mrUrl: MR, owner: "session:other", holder: "watch-ci" }, leaseOpts());
    clockNow += 601_000;
    const r = guard();
    expect(r).toMatchObject({ ok: true, claimed: true });
    expect(readCiLease(MR, leaseOpts()).lease?.owner).toBe(ME);
  });

  test("refuses a fresh foreign lease with the holder and never touches the keepalive", () => {
    claimCiLease({ mrUrl: MR, owner: "session:other", holder: "watch-ci" }, leaseOpts());
    const r = guard();
    expect(r).toMatchObject({ ok: false, refused: "lease_held", holder: { owner: "session:other" } });
    expect(touched).toEqual([]);
    expect(readCiLease(MR, leaseOpts()).lease?.owner).toBe("session:other");
  });

  test("refuses a fresh board doctor lease", () => {
    claimCiLease({ mrUrl: MR, owner: boardDoctorOwner(MR), holder: "doctor" }, leaseOpts());
    expect(guard()).toMatchObject({ ok: false, refused: "lease_held", holder: { holder: "doctor" } });
    expect(touched).toEqual([]);
  });

  test("errors without a session id", () => {
    expect(guard(MR, {} as NodeJS.ProcessEnv)).toEqual({ ok: false, error: expect.stringContaining("CLAUDE_CODE_SESSION_ID") });
    expect(touched).toEqual([]);
  });

  test("errors on a URL that is not an https MR or PR", () => {
    expect(guard("gitlab.example.com/group/proj/-/merge_requests/7")).toMatchObject({ ok: false, error: expect.any(String) });
    expect(guard("https://gitlab.example.com/group/proj")).toMatchObject({ ok: false, error: expect.any(String) });
  });

  test("works for a GitHub pull URL", () => {
    expect(guard("https://github.com/o/r/pull/7")).toMatchObject({ ok: true, claimed: true });
  });

  test("a claim that throws is an error result and touches nothing", () => {
    const r = ensureLease(MR, ENV, { leaseOpts: { dir: "/dev/null/nope", now: () => clockNow }, keepalive: ka });
    expect(r).toMatchObject({ ok: false, error: expect.any(String) });
    expect(touched).toEqual([]);
  });
});

describe("owner and URL helpers", () => {
  test("ownerFromEnv", () => {
    expect(ownerFromEnv(ENV)).toBe(ME);
    expect(ownerFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });
  test("isHttpsMrUrl", () => {
    expect(isHttpsMrUrl(MR)).toBe(true);
    expect(isHttpsMrUrl("http://gitlab.example.com/g/p/-/merge_requests/7")).toBe(false);
  });
});
