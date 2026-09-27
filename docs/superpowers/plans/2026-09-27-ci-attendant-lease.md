# CI Attendant Lease and CI Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One per-MR CI attendant lease and one sha-keyed CI watch in rt, exposed as MCP tools, read by the board, so only one agent attends an MR's CI at a time.

**Architecture:** The lease is a sync, file-based module in `packages/rt-client` (per-MR JSON files, a per-MR lock file for compare-and-set, an owner token per claimant). The watch is a pure engine in `lib/ci/watch.ts` driven by injected reads, wrapped by an MCP tool that reads the daemon's MR cache and two new daemon verbs backed by two new optional glance provider methods. The board's triage wiring swaps its private lease copy for the rt-client one and claims before it launches a doctor.

**Tech Stack:** Bun, TypeScript, bun:test (rt, rt-client, glance, board), node:fs sync APIs, the low-level MCP SDK `Server` in `commands/mcp.ts`.

**Spec:** `docs/superpowers/specs/2026-09-27-ci-attendant-lease-design.md` (read it before any task).

## Global Constraints

- rt is PUBLIC: no employer names anywhere (code, tests, fixtures, docs, commits).
- No em dashes or en dashes anywhere. Use `...`, parens, or rephrase.
- Comments state only constraints the code cannot show (an ordering trap, an invariant, a parity anchor). No narration, no review history, no ticket ids in code comments.
- Write fence: `lib/`, `commands/`, `packages/rt-client/`, `packages/glance/`, `apps/board/`, `docs/`, their tests, `.superpowers/`.
- Lease dir: `MATTSTACK_ATTENDANTS_DIR` or `$HOME/.mattstack/ci-attendants`, HOME read at call time.
- Default TTL 600 s. MCP `ttlSeconds` range 60 to 900. Lock stale after 10 s.
- `ci_watch`: `maxWaitSeconds` default 300, cap 1800; `intervalSeconds` default 30, floor 10; head-lag grace 120 s.
- Terminal pipeline statuses: `success`, `success_with_warnings`, `failed`, `canceled`, `skipped`, `manual`.
- Board owner token: `board:doctor:<lease file name>` via `boardDoctorOwner(mrUrl)`.
- MCP owner token: `session:<CLAUDE_CODE_SESSION_ID>`; no session id means refuse.
- No `SCHEMA_VERSION` change. No `BASE_PERMISSIONS` change.
- Run `bun test` only from the repo root (bunfig preload), except glance (`bun run --cwd packages/glance test`) and board (`bun run --cwd apps/board test`, after building tui-kit if it complains).
- Tests never touch the real `~/.mattstack`: every lease test passes an explicit temp `dir`, and child processes are spawned with `childEnv()` from `lib/subprocess.ts` (or an explicit `env` for rt-client tests).
- After touching `packages/glance/src` run `bun run build` in `packages/glance`; after touching `packages/rt-client/src` run `bun run build` in `packages/rt-client`.
- Commit after each task with a short imperative message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A lease URL with a trailing slash, `/diffs`, a query string or `#note_1` must map to the same file and iid as the bare URL (Task 1 test `iid and file name ignore URL suffixes`).
2. A malformed lease file (truncated JSON, a hand edit) must read as absent and be claimable, never crash the board's cron (Task 1 test `malformed file is claimable`).
3. A lease dir that does not exist yet must not break read, heartbeat or release (Task 1 test `missing dir reads as none`).
4. `ci_watch` given a short sha in uppercase must still match a lowercase full pipeline sha (Task 7 test `short uppercase sha matches`).
5. The daemon being down during a watch must come back as a tool error, not a silent `waiting` forever (Task 8 test `daemon error surfaces`).

---

### Task 1: rt-client lease core

**Files:**
- Create: `packages/rt-client/src/ci-lease.ts`
- Modify: `packages/rt-client/src/index.ts` (export block), `packages/rt-client/package.json` (`exports["./ci-lease"]`)
- Test: `packages/rt-client/test/ci-lease.test.ts`

**Interfaces:**
- Produces (all sync):
  - `type CiLeaseHolder = "watch-ci" | "doctor"`
  - `interface CiLease { mr: string; branch?: string; holder: CiLeaseHolder; owner?: string; sessionLabel?: string; pid?: number; startedAt: number; heartbeatAt: number; ttlSeconds: number }`
  - `const DEFAULT_CI_LEASE_TTL_SECONDS = 600`
  - `interface CiLeaseOpts { dir?: string; now?: () => number; lockStaleMs?: number }`
  - `class CiLeaseError extends Error`
  - `ciLeaseDir(env?: NodeJS.ProcessEnv): string`
  - `parseMrIid(mrUrl: string): number | null`
  - `ciLeaseFileName(mrUrl: string): string` (throws `CiLeaseError` when no iid)
  - `leaseOwner(lease: CiLease): string` (`owner ?? "legacy:" + holder`)
  - `boardDoctorOwner(mrUrl: string): string`
  - `isLeaseFresh(lease: CiLease, now: number): boolean`
  - `readCiLease(mrUrl: string, opts?: CiLeaseOpts): { lease: CiLease | null; stale: CiLease | null }`
  - `readCiLeaseByBranch(branch: string, opts?: CiLeaseOpts): CiLease | null`
  - `type ClaimRequest = { mrUrl: string; owner: string; holder: CiLeaseHolder; branch?: string; sessionLabel?: string; ttlSeconds?: number; pid?: number }`
  - `type ClaimResult = { claimed: true; lease: CiLease; previousOwner?: string } | { claimed: false; holder: CiLease }`
  - `claimCiLease(req: ClaimRequest, opts?: CiLeaseOpts): ClaimResult`
  - `type HeartbeatResult = { ok: true; lease: CiLease } | { ok: false; reason: "lost"; holder: CiLease } | { ok: false; reason: "none" }`
  - `heartbeatCiLease(mrUrl: string, owner: string, opts?: CiLeaseOpts): HeartbeatResult`
  - `type ReleaseResult = { released: true } | { released: false; reason: "not-owner"; holder: CiLease } | { released: false; reason: "none" }`
  - `releaseCiLease(mrUrl: string, owner: string, opts?: CiLeaseOpts): ReleaseResult`
  - `adoptLegacyCiLease(mrUrl: string, owner: string, holder: CiLeaseHolder, opts?: CiLeaseOpts): { adopted: boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/rt-client/test/ci-lease.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptLegacyCiLease, boardDoctorOwner, ciLeaseDir, ciLeaseFileName, claimCiLease, heartbeatCiLease,
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test packages/rt-client/test/ci-lease.test.ts`
Expected: FAIL, cannot resolve `../src/ci-lease.ts`.

- [ ] **Step 3: Implement `packages/rt-client/src/ci-lease.ts`**

```ts
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CiLeaseHolder = "watch-ci" | "doctor";

export interface CiLease {
  mr: string;
  branch?: string;
  holder: CiLeaseHolder;
  owner?: string;
  sessionLabel?: string;
  pid?: number;
  startedAt: number;
  heartbeatAt: number;
  ttlSeconds: number;
}

export interface CiLeaseOpts {
  dir?: string;
  now?: () => number;
  lockStaleMs?: number;
}

export class CiLeaseError extends Error {}

export const DEFAULT_CI_LEASE_TTL_SECONDS = 600;
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;
const MR_IID = /\/(?:-\/merge_requests|pull)\/(\d+)(?=[/?#]|$)/;

export function ciLeaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MATTSTACK_ATTENDANTS_DIR || join(env.HOME ?? homedir(), ".mattstack", "ci-attendants");
}

export function parseMrIid(mrUrl: string): number | null {
  const m = MR_IID.exec(mrUrl);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Parity anchor: the slug rule is identical to the watch-ci pack's
// ci-attendant.sh, which reads and writes the same files until it is retired.
export function ciLeaseFileName(mrUrl: string): string {
  const iid = parseMrIid(mrUrl);
  if (iid === null) throw new CiLeaseError(`not an MR or PR URL: ${mrUrl}`);
  let project: string;
  try {
    project = new URL(mrUrl).pathname.split("/-/")[0] ?? "";
  } catch {
    project = mrUrl;
  }
  const slug = project.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug}-${iid}.json`;
}

export function leaseOwner(lease: CiLease): string {
  return lease.owner ?? `legacy:${lease.holder}`;
}

export function boardDoctorOwner(mrUrl: string): string {
  return `board:doctor:${ciLeaseFileName(mrUrl)}`;
}

export function isLeaseFresh(lease: CiLease, now: number): boolean {
  return now - lease.heartbeatAt <= lease.ttlSeconds * 1_000;
}

function parseLease(raw: string): CiLease | null {
  try {
    const l = JSON.parse(raw) as CiLease;
    if (typeof l !== "object" || l === null) return null;
    if (typeof l.heartbeatAt !== "number" || typeof l.ttlSeconds !== "number" || !l.holder) return null;
    return l;
  } catch {
    return null;
  }
}

function readFileLease(path: string): CiLease | null {
  try {
    return parseLease(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function paths(mrUrl: string, opts: CiLeaseOpts) {
  const dir = opts.dir ?? ciLeaseDir();
  const name = ciLeaseFileName(mrUrl);
  return { dir, lease: join(dir, name), lock: join(dir, name.replace(/\.json$/, ".lock")) };
}

function clock(opts: CiLeaseOpts): number {
  return (opts.now ?? Date.now)();
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockToken(path: string): { token: string; at: number } | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as { token?: unknown; at?: unknown };
    return typeof v.token === "string" && typeof v.at === "number" ? { token: v.token, at: v.at } : null;
  } catch {
    return null;
  }
}

class LockLost extends Error {}

/** The holder of `lock` runs `body`; body must call `stillMine()` right before
    its final write so a holder whose lock was broken as stale never writes. */
function withLock<T>(lock: string, opts: CiLeaseOpts, body: (stillMine: () => void) => T): T {
  const staleMs = opts.lockStaleMs ?? LOCK_STALE_MS;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const token = randomUUID();
    try {
      writeFileSync(lock, JSON.stringify({ token, at: Date.now() }), { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      breakIfStale(lock, staleMs);
      if (Date.now() > deadline) throw new CiLeaseError(`lease lock busy: ${lock}`);
      sleepSync(15);
      continue;
    }
    const stillMine = () => {
      if (lockToken(lock)?.token !== token) throw new LockLost();
    };
    try {
      return body(stillMine);
    } catch (e) {
      if (!(e instanceof LockLost)) throw e;
      if (Date.now() > deadline) throw new CiLeaseError(`lease lock lost repeatedly: ${lock}`);
    } finally {
      if (lockToken(lock)?.token === token) {
        try { unlinkSync(lock); } catch { /* already gone */ }
      }
    }
  }
}

function breakIfStale(lock: string, staleMs: number): void {
  const seen = lockToken(lock);
  if (seen && Date.now() - seen.at <= staleMs) return;
  const aside = `${lock}.${randomUUID()}.broken`;
  try {
    renameSync(lock, aside);
  } catch {
    return;
  }
  const moved = lockToken(aside);
  if (seen && moved?.token !== seen.token) {
    // We moved a newer holder's lock: put it back, never over a third lock.
    try { linkSync(aside, lock); } catch { /* a newer lock exists */ }
  }
  try { unlinkSync(aside); } catch { /* already gone */ }
}

function writeReplace(path: string, lease: CiLease): void {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(lease, null, 2));
  renameSync(tmp, path);
}

/** Exclusive create: false when a lockless writer (the pack script) got there first. */
function writeCreate(path: string, lease: CiLease): boolean {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(lease, null, 2));
  try {
    linkSync(tmp, path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

export function readCiLease(mrUrl: string, opts: CiLeaseOpts = {}): { lease: CiLease | null; stale: CiLease | null } {
  const lease = readFileLease(paths(mrUrl, opts).lease);
  if (!lease) return { lease: null, stale: null };
  return isLeaseFresh(lease, clock(opts)) ? { lease, stale: null } : { lease: null, stale: lease };
}

export function readCiLeaseByBranch(branch: string, opts: CiLeaseOpts = {}): CiLease | null {
  if (!branch) return null;
  const dir = opts.dir ?? ciLeaseDir();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const lease = readFileLease(join(dir, name));
    if (lease && lease.branch === branch && isLeaseFresh(lease, clock(opts))) return lease;
  }
  return null;
}

export type ClaimRequest = {
  mrUrl: string;
  owner: string;
  holder: CiLeaseHolder;
  branch?: string;
  sessionLabel?: string;
  ttlSeconds?: number;
  pid?: number;
};

export type ClaimResult = { claimed: true; lease: CiLease; previousOwner?: string } | { claimed: false; holder: CiLease };

export function claimCiLease(req: ClaimRequest, opts: CiLeaseOpts = {}): ClaimResult {
  const p = paths(req.mrUrl, opts);
  mkdirSync(p.dir, { recursive: true });
  return withLock(p.lock, opts, (stillMine) => {
    for (;;) {
      const now = clock(opts);
      const existing = readFileLease(p.lease);
      if (existing && isLeaseFresh(existing, now) && leaseOwner(existing) !== req.owner) {
        return { claimed: false, holder: existing };
      }
      const lease: CiLease = {
        mr: req.mrUrl,
        ...(req.branch !== undefined && { branch: req.branch }),
        holder: req.holder,
        owner: req.owner,
        ...(req.sessionLabel !== undefined && { sessionLabel: req.sessionLabel }),
        pid: req.pid ?? process.pid,
        startedAt: existing && leaseOwner(existing) === req.owner ? existing.startedAt : now,
        heartbeatAt: now,
        ttlSeconds: req.ttlSeconds ?? DEFAULT_CI_LEASE_TTL_SECONDS,
      };
      stillMine();
      if (!fileExists(p.lease)) {
        if (!writeCreate(p.lease, lease)) continue;
      } else {
        writeReplace(p.lease, lease);
      }
      const previous = existing && leaseOwner(existing) !== req.owner ? leaseOwner(existing) : undefined;
      return previous ? { claimed: true, lease, previousOwner: previous } : { claimed: true, lease };
    }
  });
}

export type HeartbeatResult =
  | { ok: true; lease: CiLease }
  | { ok: false; reason: "lost"; holder: CiLease }
  | { ok: false; reason: "none" };

export function heartbeatCiLease(mrUrl: string, owner: string, opts: CiLeaseOpts = {}): HeartbeatResult {
  const p = paths(mrUrl, opts);
  if (!readFileLease(p.lease)) return { ok: false, reason: "none" };
  return withLock(p.lock, opts, (stillMine) => {
    const existing = readFileLease(p.lease);
    if (!existing) return { ok: false, reason: "none" };
    if (leaseOwner(existing) !== owner) return { ok: false, reason: "lost", holder: existing };
    const lease = { ...existing, heartbeatAt: clock(opts) };
    stillMine();
    writeReplace(p.lease, lease);
    return { ok: true, lease };
  });
}

export type ReleaseResult =
  | { released: true }
  | { released: false; reason: "not-owner"; holder: CiLease }
  | { released: false; reason: "none" };

export function releaseCiLease(mrUrl: string, owner: string, opts: CiLeaseOpts = {}): ReleaseResult {
  const p = paths(mrUrl, opts);
  if (!readFileLease(p.lease)) return { released: false, reason: "none" };
  return withLock(p.lock, opts, (stillMine) => {
    const existing = readFileLease(p.lease);
    if (!existing) return { released: false, reason: "none" };
    if (leaseOwner(existing) !== owner) return { released: false, reason: "not-owner", holder: existing };
    stillMine();
    try { unlinkSync(p.lease); } catch { /* already gone */ }
    return { released: true };
  });
}

export function adoptLegacyCiLease(mrUrl: string, owner: string, holder: CiLeaseHolder, opts: CiLeaseOpts = {}): { adopted: boolean } {
  const p = paths(mrUrl, opts);
  const first = readFileLease(p.lease);
  if (!first || first.owner !== undefined || first.holder !== holder) return { adopted: false };
  return withLock(p.lock, opts, (stillMine) => {
    const existing = readFileLease(p.lease);
    if (!existing || existing.owner !== undefined || existing.holder !== holder) return { adopted: false };
    stillMine();
    writeReplace(p.lease, { ...existing, owner });
    return { adopted: true };
  });
}
```

Note: lock timestamps use `Date.now()` (wall clock), never `opts.now`, because staleness of a lock is about real elapsed time between processes, while `opts.now` is the lease clock tests control.

- [ ] **Step 4: Export it**

In `packages/rt-client/src/index.ts` add near the other value exports:

```ts
export {
  adoptLegacyCiLease, boardDoctorOwner, ciLeaseDir, ciLeaseFileName, CiLeaseError, claimCiLease,
  DEFAULT_CI_LEASE_TTL_SECONDS, heartbeatCiLease, isLeaseFresh, leaseOwner, parseMrIid, readCiLease,
  readCiLeaseByBranch, releaseCiLease,
} from "./ci-lease.ts";
export type { CiLease, CiLeaseHolder, CiLeaseOpts, ClaimRequest, ClaimResult, HeartbeatResult, ReleaseResult } from "./ci-lease.ts";
```

In `packages/rt-client/package.json` `exports`, add after `"./gate"`:

```json
"./ci-lease": {
  "types": "./dist/ci-lease.d.ts",
  "bun": "./src/ci-lease.ts",
  "import": "./dist/ci-lease.js",
  "default": "./dist/ci-lease.js"
},
```

Check `packages/rt-client/package.json`'s `build` script: if it lists entry points explicitly, add `src/ci-lease.ts`.

- [ ] **Step 5: Run tests and build**

Run: `bun test packages/rt-client/test/ci-lease.test.ts packages/rt-client/test/index-surface.test.ts packages/rt-client/test/dist-freshness.test.ts` after `bun run --cwd packages/rt-client build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client
git commit -m "rt-client: add the CI attendant lease (claim, heartbeat, release, read, adopt)"
```

---

### Task 2: lease race, lock-break and pack interop tests

**Files:**
- Create: `packages/rt-client/test/ci-lease-race.test.ts`, `packages/rt-client/test/fixtures/ci-attendant.sh` (a verbatim copy of `/Users/matt/Documents/GitHub/mattstack-skills/attachments/pipeline/watch-ci/scripts/ci-attendant.sh`, `chmod +x`), `packages/rt-client/test/fixtures/ci-lease-claimer.ts`
- Modify: `packages/rt-client/src/ci-lease.ts` only if a test exposes a bug

**Interfaces:**
- Consumes: Task 1's exports.
- Produces: nothing new.

- [ ] **Step 1: Write the child claimer fixture**

```ts
// packages/rt-client/test/fixtures/ci-lease-claimer.ts
import { claimCiLease } from "../../src/ci-lease.ts";

const [dir, mrUrl, owner, holder = "watch-ci"] = process.argv.slice(2) as [string, string, string, ("watch-ci" | "doctor")?];
const r = claimCiLease({ mrUrl, owner, holder }, { dir });
process.stdout.write(JSON.stringify({ owner, claimed: r.claimed }));
```

- [ ] **Step 2: Write the tests**

```ts
// packages/rt-client/test/ci-lease-race.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciLeaseFileName, claimCiLease, heartbeatCiLease, readCiLease } from "../src/ci-lease.ts";

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
});

describe("stale lock breaking", () => {
  test("a stale lock is broken and the operation proceeds", () => {
    const lock = join(dir, ciLeaseFileName(MR).replace(/\.json$/, ".lock"));
    writeFileSync(lock, JSON.stringify({ token: "dead", at: Date.now() - 60_000 }));
    expect(claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, { dir }).claimed).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  test("a fresh lock blocks until its wait deadline", () => {
    const lock = join(dir, ciLeaseFileName(MR).replace(/\.json$/, ".lock"));
    writeFileSync(lock, JSON.stringify({ token: "live", at: Date.now() + 60_000 }));
    expect(() => claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, { dir })).toThrow(/busy/);
    expect(JSON.parse(readFileSync(lock, "utf8")).token).toBe("live");
  }, 15_000);

  test("a holder whose lock was broken neither writes nor deletes the next holder's lock", () => {
    claimCiLease({ mrUrl: MR, owner: "session:a", holder: "watch-ci" }, { dir });
    const lock = join(dir, ciLeaseFileName(MR).replace(/\.json$/, ".lock"));
    let t = 0;
    // The clock hook runs inside the lock: simulate a breaker replacing it.
    const r = (() => {
      try {
        return heartbeatCiLease(MR, "session:a", {
          dir,
          now: () => {
            if (t++ === 0) writeFileSync(lock, JSON.stringify({ token: "next-holder", at: Date.now() }));
            return 5;
          },
        });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(r).toBeInstanceOf(Error);
    expect(JSON.parse(readFileSync(lock, "utf8")).token).toBe("next-holder");
    expect(readCiLease(MR, { dir, now: () => 5 }).lease?.heartbeatAt).not.toBe(5);
  }, 15_000);
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
```

Note on the broken-lock test: the heartbeat retries after `LockLost` until the 5 s deadline and then throws; the simulated next holder never releases, so the retry sees a busy lock and throws `busy`. Both outcomes are an `Error`, which is what the test pins. The retry takes the full 5 s wait, hence the 15 s test timeouts; do not shorten `LOCK_WAIT_MS` for tests.

The script needs `jq`. If `jq` is missing, the interop tests must fail loudly, never skip (a skipped guard reads green).

- [ ] **Step 3: Run**

Run: `bun test packages/rt-client/test/ci-lease-race.test.ts`
Expected: PASS. If the lockless race test ever shows two winners, fix `claimCiLease` (the create path must only ever `link`), not the test.

- [ ] **Step 4: Commit**

```bash
git add packages/rt-client/test
git commit -m "rt-client: race, lock-break and pack interop tests for the CI lease"
```

---

### Task 3: glance pipeline sha, ref, event type, commit parents, failed jobs

**Files:**
- Modify: `packages/glance/src/types.ts` (`Pipeline`), `packages/glance/src/GitLabProvider.ts` (both `headPipeline` selections, `GQLPipeline`, `toPipeline`, two new methods), `packages/glance/src/GitHubProvider.ts` (`toPipeline` and its call at the PR builder), `packages/glance/src/GitProvider.ts` (two optional methods)
- Test: `packages/glance/tests/pipeline-sha.test.ts`

**Interfaces:**
- Produces:
  - `Pipeline` gains `sha: string | null; ref: string | null; mergeRequestEventType: "merged_result" | "detached" | "merge_train" | null`
  - `GitProvider.fetchCommitParents?(projectPath: string, sha: string): Promise<string[]>`
  - `GitProvider.fetchPipelineFailedJobs?(projectPath: string, pipelineId: number): Promise<PipelineJob[]>`

- [ ] **Step 1: Write failing tests**

Model the provider construction and GraphQL/REST stubbing on `packages/glance/tests/downstream-pipeline.test.ts` and `pr-merged-at.test.ts` (they already fake the transport). Cases:

```ts
// packages/glance/tests/pipeline-sha.test.ts  (shape; reuse the neighbours' fake transport helpers)
test("GitLab head pipeline carries sha, ref and lowercased event type", async () => {
  // fake headPipeline: { id: "gid://gitlab/Ci::Pipeline/9", status: "RUNNING", createdAt, path,
  //   sha: "abc123", ref: "refs/merge-requests/4/merge", mergeRequestEventType: "MERGED_RESULT", stages: {nodes: []} }
  // expect pr.pipeline toMatchObject { sha: "abc123", ref: "refs/merge-requests/4/merge", mergeRequestEventType: "merged_result" }
});
test("GitLab list-weight head pipeline carries sha and ref too", async () => { /* listWeight: true fetch */ });
test("GitLab missing fields read as null", async () => { /* headPipeline without sha/ref/type -> nulls */ });
test("GitHub pipeline sha is the checks' head sha and ref the PR head ref", async () => {
  // check runs with head_sha "def456", pr.head.ref "feat" -> { sha: "def456", ref: "feat", mergeRequestEventType: null }
});
test("fetchCommitParents returns parent_ids", async () => {
  // REST GET /projects/:id/repository/commits/<sha> -> { parent_ids: ["p1", "p2"] } -> ["p1", "p2"]
});
test("fetchPipelineFailedJobs maps failed jobs", async () => {
  // Jobs.all(projectPath, { pipelineId: 9, scope: ["failed"] }) -> [{ id: 5, name: "unit", stage: "test", status: "failed", allow_failure: false, duration: 3, web_url: "u" }]
  // -> [{ id: "gitlab:job:5", name: "unit", stage: "test", status: "failed", allowFailure: false, duration: 3, webUrl: "u" }]
});
```

Write each test fully against the neighbour files' helpers before implementing; a test must assert the exact values above.

- [ ] **Step 2: Run to verify they fail**

Run: `bun run --cwd packages/glance test tests/pipeline-sha.test.ts`
Expected: FAIL on the missing fields and methods.

- [ ] **Step 3: Implement**

`types.ts`, in `interface Pipeline` after `status`:

```ts
  /** The pipeline's commit. For a merged-results or merge-train pipeline this is the synthetic merge commit, not the MR head. */
  sha: string | null;
  ref: string | null;
  mergeRequestEventType: 'merged_result' | 'detached' | 'merge_train' | null;
```

`GitLabProvider.ts`:
- In the full fragment's `headPipeline {` selection change `id iid status` to `id iid status sha ref mergeRequestEventType`; in `MR_LIST_FRAGMENT`'s `headPipeline { id status }` change to `headPipeline { id status sha ref mergeRequestEventType }`. Also add `sha ref mergeRequestEventType` to any `downstreamPipeline` selection that feeds `toPipeline`, if GitLab accepts them there (it does: same `Pipeline` type).
- `interface GQLPipeline` add `sha?: string | null; ref?: string | null; mergeRequestEventType?: string | null;`
- `toPipeline` return adds:

```ts
    sha: p.sha ?? null,
    ref: p.ref ?? null,
    mergeRequestEventType: toEventType(p.mergeRequestEventType),
```

with

```ts
function toEventType(v: string | null | undefined): Pipeline['mergeRequestEventType'] {
  const t = v?.toLowerCase();
  return t === 'merged_result' || t === 'detached' || t === 'merge_train' ? t : null;
}
```

- New methods (next to `fetchJobTrace`):

```ts
  async fetchCommitParents(projectPath: string, sha: string): Promise<string[]> {
    try {
      const c: any = await this.gb.Commits.show(projectPath, sha);
      return Array.isArray(c?.parent_ids) ? c.parent_ids.map(String) : [];
    } catch (err) {
      throw this.legacyError('fetchCommitParents', err);
    }
  }

  async fetchPipelineFailedJobs(projectPath: string, pipelineId: number): Promise<PipelineJob[]> {
    try {
      const jobs: any[] = await this.gb.Jobs.all(projectPath, { pipelineId, scope: ['failed'] } as any);
      return jobs.map((j) => ({
        id: `gitlab:job:${j.id}`,
        name: String(j.name),
        stage: String(j.stage),
        status: String(j.status).toLowerCase(),
        allowFailure: Boolean(j.allow_failure),
        duration: typeof j.duration === 'number' ? Math.round(j.duration) : null,
        webUrl: typeof j.web_url === 'string' ? j.web_url : null,
      }));
    } catch (err) {
      throw this.legacyError('fetchPipelineFailedJobs', err);
    }
  }
```

Match the exact `Jobs.all` option shape the existing call near line 2116 uses (copy its argument style).

`GitProvider.ts`, beside `fetchJobTrace`:

```ts
  /** The commit's parent shas. GitLab only. */
  fetchCommitParents?(projectPath: string, sha: string): Promise<string[]>;
  /** The pipeline's failed jobs, independent of the MR cache's fragment weight. GitLab only. */
  fetchPipelineFailedJobs?(projectPath: string, pipelineId: number): Promise<PipelineJob[]>;
```

`GitHubProvider.ts`: change `toPipeline(checkRuns, prHtmlUrl)` to `toPipeline(checkRuns, prHtmlUrl, headRef: string | null)` returning `sha: checkRuns[0]?.head_sha ?? null, ref: headRef, mergeRequestEventType: null`; add `head_sha?: string` to `GHCheckRun` if absent; the call becomes `toPipeline(checkRuns, pr.html_url, pr.head?.ref ?? null)`. Any other place that builds a `Pipeline` literal (search `jobs:` in `packages/glance/src` and `status:` literals, and `tsc` will list them) gets `sha: null, ref: null, mergeRequestEventType: null`.

- [ ] **Step 4: Run tests, typecheck, build**

Run: `bun run --cwd packages/glance test` then `bun run --cwd packages/glance build` then `bun run --cwd packages/rt-client build` then `bunx tsc --noEmit` (repo root).
Expected: PASS; tsc shows no errors (fix every `Pipeline` literal it names, including fixtures in `lib/` and `apps/`, by adding the three null fields).

- [ ] **Step 5: Commit**

```bash
git add packages/glance lib apps
git commit -m "glance: pipeline sha, ref and MR event type; commit parents and failed jobs reads"
```

---

### Task 4: daemon verbs and mr_pipeline fields

**Files:**
- Modify: `lib/daemon/handlers/mr.ts` (two verbs in `createMRHandlers`), `packages/rt-client/src/commands.ts` (`Commands` entries and `COMMAND_NAMES`), `lib/mcp/mr-read-tools.ts` (description only)
- Test: `lib/daemon/handlers/__tests__/mr-ci-verbs.test.ts` (or the existing mr handler test file if one exists: `ls lib/daemon/handlers/__tests__ | grep mr`), `lib/mcp/__tests__/mr-read-tools.test.ts`

**Interfaces:**
- Produces daemon verbs:
  - `"mr:commit-parents": { payload: { repoName: string; iid: number; sha: string }; data: string[] }`
  - `"mr:pipeline-failed-jobs": { payload: { repoName: string; iid: number; pipelineId: number }; data: PipelineJob[] }`
  - Unsupported provider: `{ ok: false, error: "unsupported: <verb> needs a GitLab repo" }`.

- [ ] **Step 1: Failing tests**

Using `createMRHandlers(ctx, broadcast, { getContext })` with a fake context `{ provider, projectPath: "grp/proj" }` and a `repoIndex` that knows the repo (copy the setup the existing `mr:fetch-job-trace` tests use):

```ts
test("mr:commit-parents returns the provider's parents", async () => {
  const provider = { fetchCommitParents: async (_p: string, sha: string) => (sha === "m1" ? ["t", "h"] : []) };
  const h = handlers(provider);
  expect(await h["mr:commit-parents"]({ repoName: REPO, iid: 4, sha: "m1" })).toEqual({ ok: true, data: ["t", "h"] });
});
test("mr:commit-parents refuses a provider without the method", async () => {
  const h = handlers({});
  const r = await h["mr:commit-parents"]({ repoName: REPO, iid: 4, sha: "m1" });
  expect(r).toMatchObject({ ok: false });
  expect(String(r.error)).toContain("unsupported");
});
test("mr:commit-parents validates sha", async () => {
  expect(await handlers({})["mr:commit-parents"]({ repoName: REPO, iid: 4, sha: "" })).toMatchObject({ ok: false });
});
test("mr:pipeline-failed-jobs returns jobs", async () => {
  const job = { id: "gitlab:job:5", name: "unit", stage: "test", status: "failed", allowFailure: false, duration: 1, webUrl: null };
  const h = handlers({ fetchPipelineFailedJobs: async () => [job] });
  expect(await h["mr:pipeline-failed-jobs"]({ repoName: REPO, iid: 4, pipelineId: 9 })).toEqual({ ok: true, data: [job] });
});
```

And in `mr-read-tools.test.ts`, a case where the fake `projectMrs` returns a pipeline with `sha: "abc", ref: "feat", mergeRequestEventType: null` and `mr_pipeline` returns them unchanged in `body.pipeline`.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/daemon/handlers lib/mcp/__tests__/mr-read-tools.test.ts`
Expected: FAIL (verbs missing).

- [ ] **Step 3: Implement**

In `createMRHandlers`'s returned object, after `"mr:fetch-job-trace"`:

```ts
    "mr:commit-parents": async (payload) => {
      const p = payload as { iid?: number; sha?: string } | undefined;
      if (typeof p?.iid !== "number" || typeof p.sha !== "string" || !/^[0-9a-f]{7,40}$/i.test(p.sha)) {
        return { ok: false, error: "missing repoName/iid/sha" };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const { provider, projectPath } = await contextFor(decoded.repo);
        if (typeof provider.fetchCommitParents !== "function") return { ok: false, error: "unsupported: mr:commit-parents needs a GitLab repo" };
        return { ok: true, data: await provider.fetchCommitParents(projectPath, p.sha) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    "mr:pipeline-failed-jobs": async (payload) => {
      const p = payload as { iid?: number; pipelineId?: number } | undefined;
      if (typeof p?.iid !== "number" || typeof p.pipelineId !== "number") {
        return { ok: false, error: "missing repoName/iid/pipelineId" };
      }
      const decoded = decodeIndexedRepo(payload);
      if (!decoded.ok) return { ok: false, error: decoded.error };
      try {
        const { provider, projectPath } = await contextFor(decoded.repo);
        if (typeof provider.fetchPipelineFailedJobs !== "function") return { ok: false, error: "unsupported: mr:pipeline-failed-jobs needs a GitLab repo" };
        return { ok: true, data: await provider.fetchPipelineFailedJobs(projectPath, p.pipelineId) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
```

Extend the function's return type intersection with the two verbs the same way `mr:fetch-job-trace` is declared. In `packages/rt-client/src/commands.ts` add both to `Commands` (beside `"mr:fetch-job-trace"`, importing `PipelineJob` the way `MrJobDetail` is typed) and to `COMMAND_NAMES`. Check whether the daemon's command dispatch (`lib/daemon.ts` / handler registration) needs the names listed anywhere else (`grep -rn "mr:fetch-job-trace" lib packages/rt-client/src` and mirror every hit). Update `mr_pipeline`'s description to say the pipeline carries `sha`, `ref` and `mergeRequestEventType` (the merged-results `sha` is the merge commit).

- [ ] **Step 4: Run tests and build rt-client**

Run: `bun run --cwd packages/rt-client build && bun test lib/daemon packages/rt-client lib/mcp`
Expected: PASS (including `no-unlisted-command-call-sites`).

- [ ] **Step 5: Commit**

```bash
git add lib packages/rt-client
git commit -m "daemon: mr:commit-parents and mr:pipeline-failed-jobs; mr_pipeline carries sha and ref"
```

---

### Task 5: abort signal reaches MCP tool handlers

**Files:**
- Modify: `lib/mcp/shared.ts` (`McpToolDef.handler` signature), `lib/mcp/redact.ts` (`callTool` passes the signal), `commands/mcp.ts` (pass `extra.signal`)
- Test: `lib/mcp/__tests__/redact.test.ts` (or `tools.test.ts`)

**Interfaces:**
- Produces: `handler(input: Record<string, unknown>, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<ToolResult>`; `callTool(tool, input, env, signal?)`.

- [ ] **Step 1: Failing test**

```ts
test("callTool hands the abort signal to the handler", async () => {
  let seen: AbortSignal | undefined;
  const tool = { name: "x", description: "", inputSchema: {}, shellForms: { none: "test" }, async handler(_i: Record<string, unknown>, _e: NodeJS.ProcessEnv, s?: AbortSignal) { seen = s; return { ok: true, body: {} }; } };
  const ac = new AbortController();
  await callTool(tool as any, {}, {}, ac.signal);
  expect(seen).toBe(ac.signal);
});
```

- [ ] **Step 2: Verify failure**

Run: `bun test lib/mcp/__tests__/redact.test.ts`
Expected: FAIL (`seen` undefined).

- [ ] **Step 3: Implement**

In `shared.ts` add `signal?: AbortSignal` as the handler's third parameter. In `redact.ts` add a trailing `signal?: AbortSignal` to `callTool` and forward it to `tool.handler(input, env, signal)`. In `commands/mcp.ts`:

```ts
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
    const call = (async () => {
      const tool = toolByName.get(request.params.name);
      if (!tool) return { isError: true, content: [{ type: "text" as const, text: `unknown tool: ${request.params.name}` }] };

      return callTool(tool, (request.params.arguments ?? {}) as Record<string, unknown>, process.env, extra.signal);
    })();
```

- [ ] **Step 4: Run**

Run: `bun test lib/mcp && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp commands/mcp.ts
git commit -m "mcp: pass the request abort signal to tool handlers"
```

---

### Task 6: MCP lease tools

**Files:**
- Create: `lib/mcp/ci-tools.ts` (lease tools now; `ci_watch` joins in Task 8)
- Modify: `lib/mcp/tools.ts` (spread `...ciToolDefs()` after `...whoamiToolDefs()`)
- Test: `lib/mcp/__tests__/ci-tools.test.ts`

**Interfaces:**
- Consumes: Task 1 exports from `../../packages/rt-client/src/index.ts`; `readChatSession` from `../chat-session.ts`.
- Produces:
  - `interface CiLeaseToolDeps { leaseOpts: () => CiLeaseOpts; label: (env: NodeJS.ProcessEnv) => string | undefined; owner: (env: NodeJS.ProcessEnv) => string | null }`
  - `ciToolDefs(overrides?: Partial<CiLeaseToolDeps>): McpToolDef[]` (Task 8 widens `overrides` with `watch`)
  - `ownerFromEnv(env: NodeJS.ProcessEnv): string | null` (`session:<id>` or null)
  - Tool names: `ci_lease_claim`, `ci_lease_heartbeat`, `ci_lease_release`, `ci_lease_read`

- [ ] **Step 1: Failing tests**

```ts
// lib/mcp/__tests__/ci-tools.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciToolDefs } from "../ci-tools.ts";

const MR = "https://gitlab.example.com/grp/proj/-/merge_requests/42";
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ci-tools-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tool(name: string) {
  const t = ciToolDefs({ leaseOpts: () => ({ dir }), label: () => "alice" }).find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
}
const A = { CLAUDE_CODE_SESSION_ID: "aaa" };
const B = { CLAUDE_CODE_SESSION_ID: "bbb" };

describe("lease tools", () => {
  test("claim writes the caller's own session lease", async () => {
    const r = await tool("ci_lease_claim").handler({ mrUrl: MR, branch: "feat" }, A);
    expect(r).toMatchObject({ ok: true, body: { claimed: true, lease: { owner: "session:aaa", holder: "watch-ci", sessionLabel: "alice", branch: "feat" } } });
  });
  test("a second session is refused as a normal result", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR }, B)).toMatchObject({ ok: true, body: { claimed: false, holder: { owner: "session:aaa" } } });
  });
  test("heartbeat and release act only on the caller's lease", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    expect(await tool("ci_lease_heartbeat").handler({ mrUrl: MR }, B)).toMatchObject({ ok: true, body: { ok: false, reason: "lost" } });
    expect(await tool("ci_lease_release").handler({ mrUrl: MR }, B)).toMatchObject({ ok: true, body: { released: false } });
    expect(await tool("ci_lease_release").handler({ mrUrl: MR }, A)).toMatchObject({ ok: true, body: { released: true } });
  });
  test("read reports the lease and whether it is the caller's", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    expect(await tool("ci_lease_read").handler({ mrUrl: MR }, A)).toMatchObject({ ok: true, body: { lease: { owner: "session:aaa" }, mine: true } });
    expect(await tool("ci_lease_read").handler({ mrUrl: MR }, B)).toMatchObject({ ok: true, body: { mine: false } });
  });
  test("no session id is refused", async () => {
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR }, {})).toMatchObject({ ok: false });
  });
  test("owner is never taken from input", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR, owner: "session:bbb" } as any, A);
    expect(await tool("ci_lease_read").handler({ mrUrl: MR }, A)).toMatchObject({ body: { mine: true } });
  });
  test("ttlSeconds outside 60 to 900 is refused", async () => {
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR, ttlSeconds: 3600 }, A)).toMatchObject({ ok: false });
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR, ttlSeconds: 30 }, A)).toMatchObject({ ok: false });
  });
  test("holder must be watch-ci or doctor", async () => {
    expect(await tool("ci_lease_claim").handler({ mrUrl: MR, holder: "x" }, A)).toMatchObject({ ok: false });
  });
  test("a URL with no MR segment is refused", async () => {
    expect(await tool("ci_lease_claim").handler({ mrUrl: "https://gitlab.example.com/grp/proj" }, A)).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `bun test lib/mcp/__tests__/ci-tools.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/mcp/ci-tools.ts`**

```ts
import {
  CiLeaseError, claimCiLease, heartbeatCiLease, leaseOwner, parseMrIid, readCiLease, releaseCiLease,
  type CiLeaseHolder, type CiLeaseOpts,
} from "../../packages/rt-client/src/index.ts";
import { readChatSession } from "../chat-session.ts";
import { checkOptional, checkRequired, err, ok, type McpToolDef, type ToolResult } from "./shared.ts";

export interface CiLeaseToolDeps {
  leaseOpts: () => CiLeaseOpts;
  label: (env: NodeJS.ProcessEnv) => string | undefined;
  owner: (env: NodeJS.ProcessEnv) => string | null;
}

const TTL_MIN = 60;
const TTL_MAX = 900;
const HOLDERS: CiLeaseHolder[] = ["watch-ci", "doctor"];
const NO_SESSION = "CLAUDE_CODE_SESSION_ID is not set; the lease is owned by a Claude Code session";
const LEASE_NOTE = "One CI attendant per MR: a fresh lease held by another owner refuses the claim (reported, not an error); a lease goes stale ttlSeconds after its last heartbeat and can then be taken over. The owner is always this session; there is no owner input.";

export function ownerFromEnv(env: NodeJS.ProcessEnv): string | null {
  return env.CLAUDE_CODE_SESSION_ID ? `session:${env.CLAUDE_CODE_SESSION_ID}` : null;
}

const realLeaseDeps: CiLeaseToolDeps = {
  leaseOpts: () => ({}),
  label: (env) => readChatSession(env.CLAUDE_CODE_SESSION_ID)?.handle,
  owner: ownerFromEnv,
};

const MR_URL_PROP = { mrUrl: { type: "string", description: "The MR or PR https URL (.../-/merge_requests/<iid> or .../pull/<n>)." } };

function leaseCall(input: Record<string, unknown>, env: NodeJS.ProcessEnv, ownerOf: CiLeaseToolDeps["owner"], run: (mrUrl: string, owner: string) => unknown): ToolResult {
  const bad = checkRequired(input, [{ name: "mrUrl", type: "string" }]);
  if (bad) return err(bad);
  const mrUrl = (input.mrUrl as string).trim();
  if (parseMrIid(mrUrl) === null) return err('"mrUrl" must be an MR or PR URL ending in /-/merge_requests/<iid> or /pull/<n>');
  const owner = ownerOf(env);
  if (!owner) return err(NO_SESSION);
  try {
    return ok(run(mrUrl, owner));
  } catch (e) {
    if (e instanceof CiLeaseError) return err(e.message);
    throw e;
  }
}

export function ciToolDefs(overrides: Partial<CiLeaseToolDeps> = {}): McpToolDef[] {
  const deps = { ...realLeaseDeps, ...overrides };
  return [
    {
      name: "ci_lease_claim",
      description: `Claim this MR's CI attendant lease for this session. Returns {claimed: true, lease, previousOwner?} or {claimed: false, holder}. Re-claiming a lease this session holds refreshes it. holder is the role (watch-ci default, or doctor); ttlSeconds ${TTL_MIN} to ${TTL_MAX}, default 600. ${LEASE_NOTE}`,
      inputSchema: { type: "object", properties: { ...MR_URL_PROP, holder: { type: "string", enum: HOLDERS }, branch: { type: "string" }, ttlSeconds: { type: "number" } }, required: ["mrUrl"], additionalProperties: false },
      shellForms: ["rt ci lease claim"],
      async handler(input, env) {
        const bad = checkOptional(input, [{ name: "holder", type: "string" }, { name: "branch", type: "string" }, { name: "ttlSeconds", type: "number" }]);
        if (bad) return err(bad);
        const holder = (input.holder as CiLeaseHolder | undefined) ?? "watch-ci";
        if (!HOLDERS.includes(holder)) return err('"holder" must be watch-ci or doctor');
        const ttl = input.ttlSeconds as number | undefined;
        if (ttl !== undefined && !(Number.isInteger(ttl) && ttl >= TTL_MIN && ttl <= TTL_MAX)) return err(`"ttlSeconds" must be an integer from ${TTL_MIN} to ${TTL_MAX}`);
        const label = deps.label(env);
        return leaseCall(input, env, deps.owner, (mrUrl, owner) =>
          claimCiLease({
            mrUrl, owner, holder,
            ...(typeof input.branch === "string" && { branch: input.branch }),
            ...(label !== undefined && { sessionLabel: label }),
            ...(ttl !== undefined && { ttlSeconds: ttl }),
          }, deps.leaseOpts()));
      },
    },
    {
      name: "ci_lease_heartbeat",
      description: `Refresh this session's CI attendant lease on the MR. Returns {ok: true, lease}, or {ok: false, reason: "lost", holder} when another owner holds it now, or {ok: false, reason: "none"}. ci_watch heartbeats on every poll, so call this only between watches (during a long fix). ${LEASE_NOTE}`,
      inputSchema: { type: "object", properties: { ...MR_URL_PROP }, required: ["mrUrl"], additionalProperties: false },
      shellForms: ["rt ci lease heartbeat"],
      async handler(input, env) {
        return leaseCall(input, env, deps.owner, (mrUrl, owner) => heartbeatCiLease(mrUrl, owner, deps.leaseOpts()));
      },
    },
    {
      name: "ci_lease_release",
      description: `Release this session's CI attendant lease on the MR. Returns {released: true}, or {released: false, reason} when the lease is absent or another owner's. ${LEASE_NOTE}`,
      inputSchema: { type: "object", properties: { ...MR_URL_PROP }, required: ["mrUrl"], additionalProperties: false },
      shellForms: ["rt ci lease release"],
      async handler(input, env) {
        return leaseCall(input, env, deps.owner, (mrUrl, owner) => releaseCiLease(mrUrl, owner, deps.leaseOpts()));
      },
    },
    {
      name: "ci_lease_read",
      description: `Read the MR's CI attendant lease: {lease: <fresh lease or null>, stale: <a stale lease on disk or null>, mine: <true when the fresh lease is this session's>}. A lease with no owner field was written by the pack script and reads as owner legacy:<holder>. ${LEASE_NOTE}`,
      inputSchema: { type: "object", properties: { ...MR_URL_PROP }, required: ["mrUrl"], additionalProperties: false },
      shellForms: ["rt ci lease show"],
      async handler(input, env) {
        return leaseCall(input, env, deps.owner, (mrUrl, owner) => {
          const r = readCiLease(mrUrl, deps.leaseOpts());
          return { ...r, mine: r.lease !== null && leaseOwner(r.lease) === owner };
        });
      },
    },
  ];
}
```

In `lib/mcp/tools.ts`, import `ciToolDefs` and add `...ciToolDefs(),` after `...whoamiToolDefs(),`.

- [ ] **Step 4: Run**

Run: `bun test lib/mcp`
Expected: `ci-tools.test.ts` PASS; `tools-payload-hash.test.ts` FAILS with a refresh message (expected, handled in Task 10). Every other file PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp
git commit -m "mcp: ci_lease_claim, heartbeat, release and read tools"
```

---

### Task 7: the CI watch engine

**Files:**
- Create: `lib/ci/watch.ts`
- Test: `lib/ci/__tests__/watch.test.ts`

**Interfaces:**
- Consumes: `tailTrace` from `lib/mcp/mr-read-tools.ts` is NOT imported here (the tool supplies trace tails); `CiLease` type from rt-client.
- Produces:

```ts
export interface WatchPipeline { id: string; status: string; sha: string | null; ref: string | null; mergeRequestEventType: string | null; webUrl: string | null; createdAt: string | null; jobs: WatchJob[] }
export interface WatchJob { id: string; name: string; stage: string; status: string; allowFailure: boolean; webUrl: string | null }
export interface WatchMr { iid: number; sha: string | null; webUrl: string | null; pipeline: WatchPipeline | null }
export type LeaseCheck = { ok: true; lease: CiLease | null } | { ok: false; holder: CiLease | null };
export interface WatchDeps {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  leaseCheck(): LeaseCheck;
  readMr(): Promise<{ ok: true; mr: WatchMr } | { ok: false; error: string }>;
  commitParents(sha: string): Promise<string[] | null>;
  failedJobs(pipelineId: number): Promise<WatchJob[] | null>;
  traceTail(jobId: number): Promise<string | null>;
}
export interface WatchInput { sha: string; maxWaitSeconds: number; intervalSeconds: number; priorPipelineId?: number; signal?: AbortSignal }
export type WatchState = "success" | "success_with_warnings" | "failed" | "canceled" | "skipped" | "manual" | "running" | "waiting" | "superseded" | "lease_lost" | "aborted";
export interface WatchResult {
  state: WatchState; sha: string; headSha: string | null;
  pipeline: Omit<WatchPipeline, "jobs"> | null;
  failedJobs: Array<{ jobId: number; name: string; stage: string; allowFailure: boolean; webUrl: string | null; traceTail?: string }>;
  blockingFailures: number;
  lease: { owner: string; heartbeatAt: number; expiresAt: number } | null;
  holder?: CiLease | null;
  waitedSeconds: number; polls: number; next: string;
}
export const HEAD_LAG_GRACE_MS = 120_000;
export const TERMINAL: ReadonlySet<string>;
export function shaMatches(full: string | null, given: string): boolean;
export function isMergeRefPipeline(p: WatchPipeline, iid: number): boolean;
export function watchPipeline(input: WatchInput, deps: WatchDeps): Promise<WatchResult | { error: string }>;
```

- [ ] **Step 1: Failing tests**

Build a scripted fake: `readMr` returns successive `WatchMr` values from an array (repeat the last), `now` is a counter advanced by `sleep`, `leaseCheck` returns `{ ok: true, lease }` unless the test overrides it.

```ts
// lib/ci/__tests__/watch.test.ts
import { describe, expect, test } from "bun:test";
import { isMergeRefPipeline, shaMatches, watchPipeline, type WatchDeps, type WatchMr, type WatchPipeline } from "../watch.ts";

const SHA = "a".repeat(40);
const OLD = "b".repeat(40);
const LEASE = { mr: "u", holder: "watch-ci" as const, owner: "session:a", startedAt: 0, heartbeatAt: 0, ttlSeconds: 600 };

function pipe(over: Partial<WatchPipeline>): WatchPipeline {
  return { id: "gitlab:pipeline:10", status: "running", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [], ...over };
}
function mr(sha: string | null, pipeline: WatchPipeline | null): WatchMr {
  return { iid: 4, sha, webUrl: "u", pipeline };
}
function fake(seq: WatchMr[], over: Partial<WatchDeps> = {}) {
  let t = 0, i = 0;
  const calls = { heartbeats: 0, parents: 0 };
  const deps: WatchDeps = {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    leaseCheck: () => { calls.heartbeats++; return { ok: true, lease: LEASE }; },
    readMr: async () => ({ ok: true, mr: seq[Math.min(i++, seq.length - 1)]! }),
    commitParents: async () => { calls.parents++; return []; },
    failedJobs: async () => [],
    traceTail: async () => "tail",
    ...over,
  };
  return { deps, calls, clock: () => t };
}
const base = { sha: SHA, maxWaitSeconds: 300, intervalSeconds: 30 };

describe("sha matching", () => {
  test("short uppercase sha matches", () => { expect(shaMatches(SHA, "AAAAAAA")).toBe(true); });
  test("null never matches", () => { expect(shaMatches(null, SHA)).toBe(false); });
  test("merge-ref detection by event type or ref", () => {
    expect(isMergeRefPipeline(pipe({ mergeRequestEventType: "merged_result" }), 4)).toBe(true);
    expect(isMergeRefPipeline(pipe({ ref: "refs/merge-requests/4/train" }), 4)).toBe(true);
    expect(isMergeRefPipeline(pipe({ mergeRequestEventType: "detached" }), 4)).toBe(false);
  });
});

describe("watchPipeline", () => {
  test("the previous push's green pipeline is not reported (false-green fix)", async () => {
    const { deps } = fake([mr(SHA, pipe({ sha: OLD, status: "success", id: "gitlab:pipeline:9" })), mr(SHA, pipe({ status: "success" }))]);
    const r = await watchPipeline(base, deps);
    expect(r).toMatchObject({ state: "success", pipeline: { id: "gitlab:pipeline:10" } });
  });
  test("a stale-sha pipeline alone ends in waiting at maxWait", async () => {
    const { deps } = fake([mr(SHA, pipe({ sha: OLD, status: "success" }))]);
    expect(await watchPipeline({ ...base, maxWaitSeconds: 90 }, deps)).toMatchObject({ state: "waiting" });
  });
  test("running at maxWait returns running", async () => {
    const { deps } = fake([mr(SHA, pipe({ status: "running" }))]);
    expect(await watchPipeline({ ...base, maxWaitSeconds: 60 }, deps)).toMatchObject({ state: "running" });
  });
  for (const s of ["success", "success_with_warnings", "failed", "canceled", "skipped", "manual"]) {
    test(`terminal ${s} returns`, async () => {
      const { deps } = fake([mr(SHA, pipe({ status: s }))]);
      expect(await watchPipeline(base, deps)).toMatchObject({ state: s });
    });
  }
  test("head lag inside the grace window reads waiting, then the new head is watched", async () => {
    const { deps } = fake([mr(OLD, pipe({ sha: OLD, status: "success" })), mr(OLD, null), mr(SHA, pipe({ status: "success" }))]);
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "success" });
  });
  test("a head that stays different past the grace window is superseded", async () => {
    const other = "c".repeat(40);
    const { deps } = fake([mr(other, pipe({ sha: other }))]);
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "superseded", headSha: other });
  });
  test("merged-results pipeline matched through its merge commit's parents", async () => {
    const { deps } = fake([mr(SHA, pipe({ sha: "m".repeat(40), mergeRequestEventType: "merged_result", status: "failed" }))], {
      commitParents: async () => ["t".repeat(40), SHA],
    });
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "failed" });
  });
  test("fast-forward merge train: fallback with priorPipelineId", async () => {
    const { deps } = fake([mr(SHA, pipe({ id: "gitlab:pipeline:12", sha: "m".repeat(40), mergeRequestEventType: "merge_train", status: "success" }))]);
    expect(await watchPipeline({ ...base, priorPipelineId: 11 }, deps)).toMatchObject({ state: "success" });
  });
  test("fast-forward merge train: the prior pipeline itself never matches", async () => {
    const { deps } = fake([mr(SHA, pipe({ id: "gitlab:pipeline:11", sha: "m".repeat(40), mergeRequestEventType: "merge_train", status: "success" }))]);
    expect(await watchPipeline({ ...base, priorPipelineId: 11, maxWaitSeconds: 60 }, deps)).toMatchObject({ state: "waiting" });
  });
  test("fast-forward merge train without priorPipelineId: a pipeline new since the head was first seen matches", async () => {
    const train = (id: string, status: string) => pipe({ id, sha: "m".repeat(40), mergeRequestEventType: "merge_train", status });
    const { deps } = fake([mr(SHA, train("gitlab:pipeline:11", "success")), mr(SHA, train("gitlab:pipeline:12", "success"))]);
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "success", pipeline: { id: "gitlab:pipeline:12" } });
  });
  test("without priorPipelineId, a pipeline already there when the head was first seen stays waiting with a hint", async () => {
    const { deps } = fake([mr(SHA, pipe({ sha: "m".repeat(40), mergeRequestEventType: "merge_train", status: "success" }))]);
    const r = await watchPipeline({ ...base, maxWaitSeconds: 60 }, deps);
    expect(r).toMatchObject({ state: "waiting" });
    expect((r as { next: string }).next).toContain("priorPipelineId");
  });
  test("a failed parent fetch is retried, not cached as no match", async () => {
    let n = 0;
    const { deps, calls } = fake([mr(SHA, pipe({ sha: "m".repeat(40), mergeRequestEventType: "merged_result", status: "success" }))], {
      commitParents: async () => { calls.parents++; return n++ === 0 ? null : [SHA]; },
    });
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "success" });
    expect(calls.parents).toBe(2);
  });
  test("lease lost ends the watch with the holder", async () => {
    const other = { ...LEASE, owner: "session:b" };
    const { deps } = fake([mr(SHA, pipe({}))], { leaseCheck: () => ({ ok: false, holder: other }) });
    expect(await watchPipeline(base, deps)).toMatchObject({ state: "lease_lost", holder: { owner: "session:b" } });
  });
  test("the lease is checked on every poll", async () => {
    const { deps, calls } = fake([mr(SHA, pipe({ status: "running" }))]);
    const r = await watchPipeline({ ...base, maxWaitSeconds: 90 }, deps);
    expect(calls.heartbeats).toBe((r as { polls: number }).polls);
  });
  test("abort returns aborted at once and stops polling", async () => {
    const ac = new AbortController();
    const { deps, calls } = fake([mr(SHA, pipe({ status: "running" }))], {
      sleep: async () => { ac.abort(); },
    });
    const r = await watchPipeline({ ...base, signal: ac.signal }, deps);
    expect(r).toMatchObject({ state: "aborted" });
    expect(calls.heartbeats).toBe(1);
  });
  test("failed pipeline: blocking failures get trace tails, capped at five", async () => {
    const jobs = Array.from({ length: 7 }, (_, i) => ({ id: `gitlab:job:${i + 1}`, name: `j${i}`, stage: "test", status: "failed", allowFailure: i === 0, webUrl: null }));
    const { deps } = fake([mr(SHA, pipe({ status: "failed", jobs }))]);
    const r = await watchPipeline(base, deps) as { failedJobs: Array<{ traceTail?: string; allowFailure: boolean }>; blockingFailures: number };
    expect(r.blockingFailures).toBe(6);
    expect(r.failedJobs.filter((j) => j.traceTail !== undefined)).toHaveLength(5);
    expect(r.failedJobs.find((j) => j.allowFailure)?.traceTail).toBeUndefined();
  });
  test("list-weight pipeline with no jobs fetches failed jobs once", async () => {
    let fetched = 0;
    const { deps } = fake([mr(SHA, pipe({ status: "failed", jobs: [] }))], {
      failedJobs: async () => { fetched++; return [{ id: "gitlab:job:5", name: "unit", stage: "test", status: "failed", allowFailure: false, webUrl: null }]; },
    });
    const r = await watchPipeline(base, deps) as { failedJobs: Array<{ jobId: number }> };
    expect(fetched).toBe(1);
    expect(r.failedJobs[0]!.jobId).toBe(5);
  });
  test("a read error is returned as an error", async () => {
    const { deps } = fake([], { readMr: async () => ({ ok: false, error: "daemon down" }) });
    expect(await watchPipeline(base, deps)).toEqual({ error: "daemon down" });
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `bun test lib/ci/__tests__/watch.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/ci/watch.ts`**

```ts
import type { CiLease } from "../../packages/rt-client/src/index.ts";

export interface WatchJob { id: string; name: string; stage: string; status: string; allowFailure: boolean; webUrl: string | null }
export interface WatchPipeline { id: string; status: string; sha: string | null; ref: string | null; mergeRequestEventType: string | null; webUrl: string | null; createdAt: string | null; jobs: WatchJob[] }
export interface WatchMr { iid: number; sha: string | null; webUrl: string | null; pipeline: WatchPipeline | null }
export type LeaseCheck = { ok: true; lease: CiLease | null } | { ok: false; holder: CiLease | null };

export interface WatchDeps {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  leaseCheck(): LeaseCheck;
  readMr(): Promise<{ ok: true; mr: WatchMr } | { ok: false; error: string }>;
  commitParents(sha: string): Promise<string[] | null>;
  failedJobs(pipelineId: number): Promise<WatchJob[] | null>;
  traceTail(jobId: number): Promise<string | null>;
}

export interface WatchInput { sha: string; maxWaitSeconds: number; intervalSeconds: number; priorPipelineId?: number; signal?: AbortSignal }

export type WatchState =
  | "success" | "success_with_warnings" | "failed" | "canceled" | "skipped" | "manual"
  | "running" | "waiting" | "superseded" | "lease_lost" | "aborted";

export interface WatchResult {
  state: WatchState;
  sha: string;
  headSha: string | null;
  pipeline: Omit<WatchPipeline, "jobs"> | null;
  failedJobs: Array<{ jobId: number; name: string; stage: string; allowFailure: boolean; webUrl: string | null; traceTail?: string }>;
  blockingFailures: number;
  lease: { owner: string; heartbeatAt: number; expiresAt: number } | null;
  holder?: CiLease | null;
  waitedSeconds: number;
  polls: number;
  next: string;
}

export const HEAD_LAG_GRACE_MS = 120_000;
export const TERMINAL: ReadonlySet<string> = new Set(["success", "success_with_warnings", "failed", "canceled", "skipped", "manual"]);
const TRACE_JOBS = 5;
const MERGE_REF = /^refs\/merge-requests\/(\d+)\/(merge|train)$/;

export function shaMatches(full: string | null, given: string): boolean {
  if (!full) return false;
  return full.toLowerCase().startsWith(given.toLowerCase());
}

export function isMergeRefPipeline(p: WatchPipeline, iid: number): boolean {
  if (p.mergeRequestEventType === "merged_result" || p.mergeRequestEventType === "merge_train") return true;
  const m = p.ref ? MERGE_REF.exec(p.ref) : null;
  return m !== null && Number(m[1]) === iid;
}

function idNumber(id: string | null | undefined): number | null {
  const m = /:(\d+)$/.exec(id ?? "");
  return m ? Number(m[1]) : null;
}

function leaseView(lease: CiLease | null): WatchResult["lease"] {
  if (!lease) return null;
  return { owner: lease.owner ?? `legacy:${lease.holder}`, heartbeatAt: lease.heartbeatAt, expiresAt: lease.heartbeatAt + lease.ttlSeconds * 1_000 };
}

function stripJobs(p: WatchPipeline | null): WatchResult["pipeline"] {
  if (!p) return null;
  const { jobs: _jobs, ...rest } = p;
  return rest;
}

export async function watchPipeline(input: WatchInput, deps: WatchDeps): Promise<WatchResult | { error: string }> {
  const start = deps.now();
  const deadline = start + input.maxWaitSeconds * 1_000;
  const parents = new Map<string, string[]>();
  let polls = 0;
  let mismatchSince: number | null = null;
  let firstSeenPipelineId: number | null | undefined;
  let lease: CiLease | null = null;
  let last: { state: WatchState; mr: WatchMr | null; hint: string } = { state: "waiting", mr: null, hint: "call again" };

  const result = (state: WatchState, mr: WatchMr | null, next: string, extra: Partial<WatchResult> = {}): WatchResult => ({
    state,
    sha: input.sha,
    headSha: mr?.sha ?? null,
    pipeline: stripJobs(mr?.pipeline ?? null),
    failedJobs: [],
    blockingFailures: 0,
    lease: leaseView(lease),
    waitedSeconds: Math.round((deps.now() - start) / 1_000),
    polls,
    next,
    ...extra,
  });

  async function matches(mr: WatchMr, p: WatchPipeline): Promise<boolean | "undetermined" | "unprovable"> {
    if (!isMergeRefPipeline(p, mr.iid)) return shaMatches(p.sha, input.sha);
    if (p.sha) {
      let ps = parents.get(p.id);
      if (!ps) {
        const fetched = await deps.commitParents(p.sha);
        if (fetched === null) return "undetermined";
        parents.set(p.id, fetched);
        ps = fetched;
      }
      if (ps.some((x) => shaMatches(x, input.sha))) return true;
    }
    const pid = idNumber(p.id);
    if (pid === null) return false;
    if (input.priorPipelineId !== undefined) return pid > input.priorPipelineId;
    if (firstSeenPipelineId === undefined) return false;
    if (pid !== firstSeenPipelineId) return true;
    return "unprovable";
  }

  async function failures(p: WatchPipeline, withTraces: boolean): Promise<Pick<WatchResult, "failedJobs" | "blockingFailures">> {
    let jobs = p.jobs;
    const pid = idNumber(p.id);
    if (jobs.length === 0 && pid !== null && p.status !== "success") jobs = (await deps.failedJobs(pid)) ?? [];
    const failed = jobs.filter((j) => j.status === "failed");
    const out: WatchResult["failedJobs"] = [];
    let traced = 0;
    for (const j of failed) {
      const jobId = idNumber(j.id);
      if (jobId === null) continue;
      const row: WatchResult["failedJobs"][number] = { jobId, name: j.name, stage: j.stage, allowFailure: j.allowFailure, webUrl: j.webUrl };
      if (withTraces && !j.allowFailure && traced < TRACE_JOBS) {
        traced++;
        const tail = await deps.traceTail(jobId);
        if (tail !== null) row.traceTail = tail;
      }
      out.push(row);
    }
    return { failedJobs: out, blockingFailures: failed.filter((j) => !j.allowFailure).length };
  }

  for (;;) {
    if (input.signal?.aborted) return result("aborted", last.mr, "the call was cancelled; call again to resume");
    const lc = deps.leaseCheck();
    polls++;
    if (!lc.ok) return result("lease_lost", last.mr, "another owner attends this MR now; stand down", { holder: lc.holder });
    lease = lc.lease;

    const read = await deps.readMr();
    if (!read.ok) return { error: read.error };
    const mr = read.mr;

    if (!shaMatches(mr.sha, input.sha)) {
      mismatchSince ??= deps.now();
      if (deps.now() - mismatchSince >= HEAD_LAG_GRACE_MS) {
        return result("superseded", mr, "the MR head moved past the pushed sha; watch the new head");
      }
      last = { state: "waiting", mr, hint: "the MR head has not reached the pushed sha yet; call again" };
    } else {
      mismatchSince = null;
      if (firstSeenPipelineId === undefined) firstSeenPipelineId = idNumber(mr.pipeline?.id);
      const p = mr.pipeline;
      const m = p ? await matches(mr, p) : false;
      if (p && m === true) {
        if (TERMINAL.has(p.status)) {
          const f = await failures(p, p.status === "failed");
          const next = p.status === "failed" ? "read more of a job's log with mr_job_trace" : "done";
          return result(p.status as WatchState, mr, next, f);
        }
        last = { state: "running", mr, hint: "the pipeline for the pushed sha is still running; call again" };
      } else {
        const hint = m === "unprovable"
          ? "cannot prove this merge-train pipeline is new since the push; call again with priorPipelineId (the head pipeline id read before the push)"
          : "no pipeline for the pushed sha yet; call again";
        last = { state: "waiting", mr, hint };
      }
    }

    const remaining = deadline - deps.now();
    if (remaining <= 0) return result(last.state, last.mr, last.hint);
    await deps.sleep(Math.min(input.intervalSeconds * 1_000, remaining), input.signal);
    if (input.signal?.aborted) return result("aborted", last.mr, "the call was cancelled; call again to resume");
  }
}
```

Check the tests' expectations against this code once more before running; where a test and this code disagree, the spec wins, and the fix goes in the code.

- [ ] **Step 4: Run**

Run: `bun test lib/ci/__tests__/watch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ci
git commit -m "ci: sha-keyed pipeline watch engine"
```

---

### Task 8: the `ci_watch` MCP tool

**Files:**
- Modify: `lib/mcp/ci-tools.ts` (add `ci_watch`), `lib/mcp/__tests__/ci-tools.test.ts`

**Interfaces:**
- Consumes: `watchPipeline`, `WatchDeps`, `WatchMr` (Task 7); `resolveMrTarget` (`lib/mcp/mr-target.ts`); `readProjectMRs`, `rtCommand` (rt-client); `tailTrace` (`lib/mcp/mr-read-tools.ts`); `boardDoctorOwner`, `heartbeatCiLease`, `readCiLease` (Task 1); daemon verbs from Task 4.
- Produces: `interface CiWatchToolDeps { projectMrs: typeof readProjectMRs; command: typeof rtCommand; resolve: typeof resolveMrTarget; now: () => number; sleep: (ms: number, signal?: AbortSignal) => Promise<void> }`; `ciToolDefs(overrides?: Partial<CiLeaseToolDeps & { watch: Partial<CiWatchToolDeps> }>)`.

- [ ] **Step 1: Failing tests** (append to `ci-tools.test.ts`)

```ts
describe("ci_watch", () => {
  const SHA = "a".repeat(40);
  function watchTool(over: Record<string, unknown> = {}, pipeline: Record<string, unknown> = { id: "gitlab:pipeline:10", status: "success", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] }) {
    const t = ciToolDefs({
      leaseOpts: () => ({ dir }),
      label: () => undefined,
      watch: {
        resolve: async () => ({ ok: true, identity: "remote:x", iid: 42 }),
        projectMrs: (async () => ({ ok: true, data: { mrs: { a: { pr: { iid: 42, sha: SHA, webUrl: MR, pipeline }, fetchedAt: 0 } }, syncedAt: 1 } })) as any,
        command: (async () => ({ ok: true, data: [] })) as any,
        now: () => 0,
        sleep: async () => {},
        ...over,
      },
    }).find((x) => x.name === "ci_watch")!;
    return t;
  }

  test("watches under the caller's lease and heartbeats it", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const r = await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success", lease: { owner: "session:aaa" } } });
  });
  test("without the lease it returns lease_lost", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, B);
    expect(await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA }, A)).toMatchObject({ ok: true, body: { state: "lease_lost" } });
  });
  test("underBoardLease continues under a fresh board doctor lease and never writes it", async () => {
    const { claimCiLease, boardDoctorOwner, readCiLease } = await import("../../../packages/rt-client/src/index.ts");
    const claimed = claimCiLease({ mrUrl: MR, owner: boardDoctorOwner(MR), holder: "doctor" }, { dir });
    const before = claimed.claimed ? claimed.lease.heartbeatAt : -1;
    await Bun.sleep(5);
    const r = await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, underBoardLease: true }, A);
    expect(r).toMatchObject({ ok: true, body: { state: "success" } });
    expect(readCiLease(MR, { dir }).lease?.heartbeatAt).toBe(before);
  });
  test("underBoardLease returns lease_lost when another owner holds the MR", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, B);
    expect(await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, underBoardLease: true }, A)).toMatchObject({ body: { state: "lease_lost" } });
  });
  test("underBoardLease returns lease_lost when no lease exists", async () => {
    expect(await watchTool().handler({ repoName: "remote:x", iid: 42, sha: SHA, underBoardLease: true }, A)).toMatchObject({ body: { state: "lease_lost" } });
  });
  test("daemon error surfaces", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const r = await watchTool({ projectMrs: (async () => ({ ok: false, error: "daemon down" })) as any }).handler({ repoName: "remote:x", iid: 42, sha: SHA }, A);
    expect(r.ok).toBe(false);
  });
  test("input bounds", async () => {
    const t = watchTool();
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: "xyz" }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA, maxWaitSeconds: 1801 }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA, intervalSeconds: 5 }, A)).ok).toBe(false);
    expect((await t.handler({ repoName: "remote:x", iid: 42, sha: SHA }, {})).ok).toBe(false);
  });
  test("the abort signal ends the call", async () => {
    await tool("ci_lease_claim").handler({ mrUrl: MR }, A);
    const ac = new AbortController();
    const running = { id: "gitlab:pipeline:10", status: "running", sha: SHA, ref: "feat", mergeRequestEventType: null, webUrl: null, createdAt: null, jobs: [] };
    const r = await watchTool({ sleep: async () => { ac.abort(); } }, running).handler({ repoName: "remote:x", iid: 42, sha: SHA }, A, ac.signal);
    expect(r).toMatchObject({ ok: true, body: { state: "aborted" } });
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `bun test lib/mcp/__tests__/ci-tools.test.ts`
Expected: FAIL (`ci_watch` missing).

- [ ] **Step 3: Implement**

Add to `ci-tools.ts`:

```ts
import { readProjectMRs, rtCommand, boardDoctorOwner, heartbeatCiLease, readCiLease } from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { watchPipeline, type WatchDeps, type WatchMr } from "../ci/watch.ts";
import { explainError } from "../explain-error.ts";
import { resolveMrTarget } from "./mr-target.ts";
import { tailTrace } from "./mr-read-tools.ts";
import { MR_TARGET_PROPS, REPO_NAME_RULE, checkPositiveInts } from "./shared.ts";

export interface CiWatchToolDeps {
  projectMrs: typeof readProjectMRs;
  command: typeof rtCommand;
  resolve: typeof resolveMrTarget;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal?.removeEventListener("abort", done); resolve(); }
    signal?.addEventListener("abort", done, { once: true });
  });
}

const realWatchDeps: CiWatchToolDeps = { projectMrs: readProjectMRs, command: rtCommand, resolve: resolveMrTarget, now: Date.now, sleep: abortableSleep };

const WATCH_LIVE_MAX_AGE_MS = 5_000;
const TRACE_TAIL = 40;
```

Change the factory signature to `ciToolDefs(overrides: Partial<CiLeaseToolDeps> & { watch?: Partial<CiWatchToolDeps> } = {})`, build `const w = { ...realWatchDeps, ...overrides.watch }`, and append:

```ts
    {
      name: "ci_watch",
      description: `GitLab only. Watch the MR's pipeline for the pushed commit sha until it settles or maxWaitSeconds (default 300, cap 1800) passes, polling every intervalSeconds (default 30, floor 10). Only a pipeline for sha counts: a branch pipeline by its sha, a merged-results or merge-train pipeline by its merge commit's parents, or (fast-forward trains) by being new since the push; pass priorPipelineId (the head pipeline id read before pushing) so that proof never stalls. Every poll heartbeats this session's CI lease and returns state lease_lost the moment another owner holds the MR; with underBoardLease (a doctor the board launched) it only reads the lease and needs a fresh board doctor lease. Returns state (success, success_with_warnings, failed, canceled, skipped, manual when settled; running or waiting means call again; superseded, lease_lost or aborted end the watch), the pipeline with sha and ref, failedJobs with a trace tail for up to five blocking failures, blockingFailures, lease and next. Chat messages reach you only between calls, so a long maxWaitSeconds delays them. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS,
          sha: { type: "string", description: "The pushed commit, 7 to 40 hex characters." },
          maxWaitSeconds: { type: "number" },
          intervalSeconds: { type: "number" },
          priorPipelineId: { type: "number", description: "The MR's head pipeline id read before the push." },
          underBoardLease: { type: "boolean" },
        },
        required: ["sha"],
        additionalProperties: false,
      },
      shellForms: ["rt ci watch"],
      async handler(input, env, signal) {
        const bad = checkRequired(input, [{ name: "sha", type: "string" }])
          ?? checkOptional(input, [{ name: "maxWaitSeconds", type: "number" }, { name: "intervalSeconds", type: "number" }, { name: "priorPipelineId", type: "number" }, { name: "underBoardLease", type: "boolean" }])
          ?? checkPositiveInts(input, ["priorPipelineId"]);
        if (bad) return err(bad);
        const sha = (input.sha as string).trim();
        if (!/^[0-9a-f]{7,40}$/i.test(sha)) return err('"sha" must be 7 to 40 hex characters');
        const maxWait = (input.maxWaitSeconds as number | undefined) ?? 300;
        if (!(Number.isInteger(maxWait) && maxWait >= 0 && maxWait <= 1800)) return err('"maxWaitSeconds" must be an integer from 0 to 1800');
        const interval = (input.intervalSeconds as number | undefined) ?? 30;
        if (!(Number.isInteger(interval) && interval >= 10)) return err('"intervalSeconds" must be an integer of at least 10');
        const owner = deps.owner(env);
        if (!owner) return err(NO_SESSION);
        const target = await w.resolve(input);
        if (!target.ok) return err(target.error);

        let mrUrl: string | null = null;
        const underBoard = input.underBoardLease === true;
        const watchDeps: WatchDeps = {
          now: w.now,
          sleep: w.sleep,
          leaseCheck: () => {
            if (!mrUrl) return { ok: false, holder: null };
            if (underBoard) {
              const { lease } = readCiLease(mrUrl, deps.leaseOpts());
              return lease && lease.owner === boardDoctorOwner(mrUrl) ? { ok: true, lease } : { ok: false, holder: lease };
            }
            const hb = heartbeatCiLease(mrUrl, owner, deps.leaseOpts());
            return hb.ok ? { ok: true, lease: hb.lease } : { ok: false, holder: hb.reason === "lost" ? hb.holder : null };
          },
          readMr: async () => {
            const res = await w.projectMrs(target.identity, WATCH_LIVE_MAX_AGE_MS);
            if (!res.ok || !res.data) return { ok: false, error: explainError(res.error ?? "failed to read MRs") };
            const entry = Object.values(res.data.mrs).find((e) => e.pr.iid === target.iid);
            if (!entry) return { ok: false, error: `no MR !${target.iid} in the daemon's open-MR cache for ${target.identity}` };
            const pr = entry.pr;
            return { ok: true, mr: { iid: pr.iid, sha: pr.sha ?? null, webUrl: pr.webUrl ?? null, pipeline: (pr.pipeline ?? null) as WatchMr["pipeline"] } };
          },
          commitParents: async (s) => {
            const r = await w.command<Commands["mr:commit-parents"]["data"]>("mr:commit-parents", { repoName: target.identity, iid: target.iid, sha: s }, { timeoutMs: 30_000 });
            return r.ok && Array.isArray(r.data) ? r.data : null;
          },
          failedJobs: async (pipelineId) => {
            const r = await w.command<Commands["mr:pipeline-failed-jobs"]["data"]>("mr:pipeline-failed-jobs", { repoName: target.identity, iid: target.iid, pipelineId }, { timeoutMs: 30_000 });
            return r.ok && Array.isArray(r.data) ? r.data : null;
          },
          traceTail: async (jobId) => {
            const r = await w.command<Commands["mr:fetch-job-trace"]["data"]>("mr:fetch-job-trace", { repoName: target.identity, iid: target.iid, jobId }, { timeoutMs: 60_000 });
            return r.ok ? tailTrace(r.data ?? "", TRACE_TAIL).trace : null;
          },
        };

        const first = await watchDeps.readMr();
        if (!first.ok) return err(first.error);
        mrUrl = first.mr.webUrl;
        if (!mrUrl) return err(`MR !${target.iid} has no web URL in the cache; retry once the daemon has synced it`);

        const r = await watchPipeline({ sha, maxWaitSeconds: maxWait, intervalSeconds: interval, ...(typeof input.priorPipelineId === "number" && { priorPipelineId: input.priorPipelineId }), ...(signal && { signal }) }, watchDeps);
        return "error" in r ? err(r.error) : ok(r);
      },
    },
```

Check `Commands["mr:fetch-job-trace"]`'s wrapper usage matches the one in `mr-read-tools.ts` (same `rtCommand<...>(name, payload, { timeoutMs })` shape). Note the first `readMr` is an extra read to learn the MR URL; that is intended (one read, not a poll).

- [ ] **Step 4: Run**

Run: `bun test lib/mcp lib/ci && bunx tsc --noEmit`
Expected: all PASS except the pinned `tools-payload-hash` (Task 10).

- [ ] **Step 5: Commit**

```bash
git add lib/mcp lib/ci
git commit -m "mcp: ci_watch, sha-keyed and lease-checked on every poll"
```

---

### Task 9: `rt ci` CLI group

**Files:**
- Create: `commands/ci.ts`
- Modify: `lib/command-tree-def.ts` (new `ci` group), `lib/module-registry.ts` (`"./commands/ci.ts": () => import("../commands/ci.ts")`)
- Test: `commands/__tests__/ci.test.ts` (check the folder name used by neighbours: `ls commands/__tests__ | head`)

**Interfaces:**
- Consumes: Task 1 exports; `ciToolDefs` (Task 8) for `rt ci watch`, invoked in-process so the CLI and the tool share one code path.
- Produces: `ciLeaseClaim(args)`, `ciLeaseHeartbeat(args)`, `ciLeaseRelease(args)`, `ciLeaseShow(args)`, `ciWatch(args)`, all `(args: string[]) => Promise<void>`; `cliOwner(env: NodeJS.ProcessEnv): string` (`session:<id>` or `user:<login>`).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { cliOwner } from "../ci.ts";

describe("cliOwner", () => {
  test("uses the Claude session when present", () => {
    expect(cliOwner({ CLAUDE_CODE_SESSION_ID: "x", USER: "u" })).toBe("session:x");
  });
  test("falls back to the login", () => {
    expect(cliOwner({ USER: "u" })).toBe("user:u");
  });
});
```

Plus one spawn test that runs `bun cli.ts ci lease claim <MR> --json` then `bun cli.ts ci lease show <MR> --json` with `childEnv()` and `HOME` + `MATTSTACK_ATTENDANTS_DIR` set to a temp dir and `CLAUDE_CODE_SESSION_ID=cli-test`, asserting `{claimed: true}` then `{lease: {owner: "session:cli-test"}, mine: true}`; and a second claim with `CLAUDE_CODE_SESSION_ID=other` exits 3 with `{claimed: false}`. Name this file `commands/__tests__/no-ci-cli.test.ts` if it spawns `cli.ts` (AGENTS.md: spawning tests must be `no-*` to run on PRs).

- [ ] **Step 2: Verify failure**

Run: `bun test commands/__tests__/ci.test.ts commands/__tests__/no-ci-cli.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`commands/ci.ts`:

```ts
import { userInfo } from "node:os";
import {
  CiLeaseError, claimCiLease, heartbeatCiLease, leaseOwner, parseMrIid, readCiLease, releaseCiLease,
  type CiLeaseHolder,
} from "../packages/rt-client/src/index.ts";
import { ciToolDefs } from "../lib/mcp/ci-tools.ts";

export function cliOwner(env: NodeJS.ProcessEnv): string {
  if (env.CLAUDE_CODE_SESSION_ID) return `session:${env.CLAUDE_CODE_SESSION_ID}`;
  return `user:${env.USER || userInfo().username}`;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args: string[]): string | undefined {
  return args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--") && args[i - 1] !== "--json"));
}

function emit(json: boolean, body: unknown, text: string, code = 0): never {
  process.stdout.write(json ? `${JSON.stringify(body)}\n` : `${text}\n`);
  process.exit(code);
}

function mrArg(args: string[], json: boolean): string {
  const mr = positional(args);
  if (!mr || parseMrIid(mr) === null) emit(json, { error: "usage: rt ci lease <verb> <mr-url>" }, "usage: rt ci lease <verb> <mr-url> (an MR or PR URL)", 2);
  return mr;
}

function guard<T>(json: boolean, run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof CiLeaseError) emit(json, { error: e.message }, e.message, 1);
    throw e;
  }
}

export async function ciLeaseClaim(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const mrUrl = mrArg(args, json);
  const holder = (flag(args, "--holder") ?? "watch-ci") as CiLeaseHolder;
  if (holder !== "watch-ci" && holder !== "doctor") emit(json, { error: "--holder must be watch-ci or doctor" }, "--holder must be watch-ci or doctor", 2);
  const branch = flag(args, "--branch");
  const r = guard(json, () => claimCiLease({ mrUrl, owner: cliOwner(process.env), holder, ...(branch && { branch }) }));
  if (r.claimed) emit(json, r, `claimed ${mrUrl}${r.previousOwner ? ` (took over from ${r.previousOwner})` : ""}`);
  emit(json, r, `held by ${leaseOwner(r.holder)} (${r.holder.holder})`, 3);
}

export async function ciLeaseHeartbeat(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const mrUrl = mrArg(args, json);
  const r = guard(json, () => heartbeatCiLease(mrUrl, cliOwner(process.env)));
  if (r.ok) emit(json, r, "heartbeat recorded");
  emit(json, r, r.reason === "lost" ? `lost: held by ${leaseOwner(r.holder)}` : "no lease", 3);
}

export async function ciLeaseRelease(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const mrUrl = mrArg(args, json);
  const r = guard(json, () => releaseCiLease(mrUrl, cliOwner(process.env)));
  emit(json, r, r.released ? "released" : r.reason === "not-owner" ? `not yours: held by ${leaseOwner(r.holder)}` : "no lease");
}

export async function ciLeaseShow(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const mrUrl = mrArg(args, json);
  const r = guard(json, () => readCiLease(mrUrl));
  const mine = r.lease !== null && leaseOwner(r.lease) === cliOwner(process.env);
  emit(json, { ...r, mine }, r.lease ? `${leaseOwner(r.lease)} (${r.lease.holder}), heartbeat ${new Date(r.lease.heartbeatAt).toISOString()}` : "none", r.lease ? 0 : 1);
}

export async function ciWatch(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const mrUrl = positional(args);
  const sha = flag(args, "--sha");
  if (!mrUrl || !sha) emit(json, { error: "usage: rt ci watch <mr-url> --sha <sha>" }, "usage: rt ci watch <mr-url> --sha <sha>", 2);
  const tool = ciToolDefs({ owner: cliOwner }).find((t) => t.name === "ci_watch")!;
  const input: Record<string, unknown> = { mrUrl, sha };
  for (const [f, k] of [["--max-wait", "maxWaitSeconds"], ["--interval", "intervalSeconds"], ["--prior-pipeline", "priorPipelineId"]] as const) {
    const v = flag(args, f);
    if (v !== undefined) input[k] = Number(v);
  }
  const r = await tool.handler(input, process.env);
  if (!r.ok) emit(json, { error: r.error }, r.error ?? "watch failed", 1);
  const body = r.body as { state: string; next: string };
  emit(json, body, `${body.state}: ${body.next}`, body.state === "success" || body.state === "success_with_warnings" ? 0 : 1);
}
```

`rt ci watch` passes `owner: cliOwner`, so a human's watch heartbeats the same `user:<login>` lease the human claimed with `rt ci lease claim`.

`lib/command-tree-def.ts`, beside `mr:`:

```ts
  ci: {
    description: "CI attendant lease and pipeline watch",
    subcommands: {
      lease: {
        description: "The one-attendant-per-MR CI lease",
        subcommands: {
          claim: {
            description: "Claim the MR's CI lease for this session",
            module: "./commands/ci.ts",
            fn: "ciLeaseClaim",
            omitBehavior: { exempt: "a free-text MR URL" },
            args: [
              { name: "MR", type: "text", placeholder: "https://host/group/project/-/merge_requests/1", hint: "MR or PR URL" },
              { name: "Holder", flag: "--holder", type: "text", placeholder: "watch-ci", hint: "watch-ci (default) or doctor" },
              { name: "Branch", flag: "--branch", type: "text", placeholder: "feat", hint: "Source branch, recorded on the lease" },
              { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Emit the result as JSON" },
            ],
          },
          heartbeat: { description: "Refresh this session's CI lease", module: "./commands/ci.ts", fn: "ciLeaseHeartbeat", omitBehavior: { exempt: "a free-text MR URL" }, args: [{ name: "MR", type: "text", placeholder: "https://host/group/project/-/merge_requests/1", hint: "MR or PR URL" }, { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Emit the result as JSON" }] },
          release: { description: "Release this session's CI lease", module: "./commands/ci.ts", fn: "ciLeaseRelease", omitBehavior: { exempt: "a free-text MR URL" }, args: [{ name: "MR", type: "text", placeholder: "https://host/group/project/-/merge_requests/1", hint: "MR or PR URL" }, { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Emit the result as JSON" }] },
          show: { description: "Show the MR's CI lease", module: "./commands/ci.ts", fn: "ciLeaseShow", omitBehavior: { exempt: "a free-text MR URL" }, args: [{ name: "MR", type: "text", placeholder: "https://host/group/project/-/merge_requests/1", hint: "MR or PR URL" }, { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Emit the result as JSON" }] },
        },
      },
      watch: {
        description: "Watch the MR's pipeline for a pushed sha",
        module: "./commands/ci.ts",
        fn: "ciWatch",
        omitBehavior: { exempt: "a free-text MR URL" },
        args: [
          { name: "MR", type: "text", placeholder: "https://host/group/project/-/merge_requests/1", hint: "MR URL" },
          { name: "Sha", flag: "--sha", type: "text", placeholder: "abc1234", hint: "The pushed commit" },
          { name: "Max wait", flag: "--max-wait", type: "text", placeholder: "300", hint: "Seconds, up to 1800" },
          { name: "Interval", flag: "--interval", type: "text", placeholder: "30", hint: "Seconds, at least 10" },
          { name: "Prior pipeline", flag: "--prior-pipeline", type: "text", placeholder: "123", hint: "Head pipeline id before the push" },
          { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Emit the result as JSON" },
        ],
      },
    },
  },
```

Match the arg object shape to what `CommandNode.args` accepts (read `lib/command-tree.ts:145-200`; if `placeholder` or `type: "text"` differ, copy a neighbour's exact shape). None of these leaves sets `agentSafe`.

- [ ] **Step 4: Run**

Run: `bun test commands/__tests__/ci.test.ts commands/__tests__/no-ci-cli.test.ts lib/__tests__ && bun run picker:check && bunx tsc --noEmit`
Expected: PASS (the lint-hash test in `lib/skills/__tests__` may fail; Task 10).

- [ ] **Step 5: Commit**

```bash
git add commands lib
git commit -m "rt ci lease and rt ci watch verbs"
```

---

### Task 10: lint rules, pinned hashes, no-Bash flow test

**Files:**
- Modify: `lib/skills/__tests__/mcp-lint-rules-hash.test.ts` (`RULES_SHA256`), `lib/mcp/__tests__/tools-payload-hash.test.ts` (`PAYLOAD_SHA256`)
- Create: `lib/skills/__tests__/ci-lint.test.ts`

**Interfaces:**
- Consumes: `deriveRules`, `lintSkillText` (`lib/skills/mcp-lint.ts`), `mcpTools` (`lib/mcp/tools.ts`), `listAgentSafe` + `TREE`.

- [ ] **Step 1: Write the tests**

```ts
// lib/skills/__tests__/ci-lint.test.ts
import { describe, expect, test } from "bun:test";
import { TREE } from "../../command-tree-def.ts";
import { listAgentSafe } from "../../command-tree-resolve.ts";
import { mcpTools } from "../../mcp/tools.ts";
import { deriveRules, lintSkillText } from "../mcp-lint.ts";

const rules = deriveRules(mcpTools(), listAgentSafe(TREE).map((l) => ({ path: l.path, deniedFlags: l.node.agentDeniedFlags, noCwd: l.node.agentNoCwd })));

describe("new CI verbs are flagged on Bash", () => {
  const cases: Array<[string, string]> = [
    ["rt ci lease claim https://h/g/p/-/merge_requests/1", "ci_lease_claim"],
    ["rt ci lease heartbeat https://h/g/p/-/merge_requests/1", "ci_lease_heartbeat"],
    ["rt ci lease release https://h/g/p/-/merge_requests/1", "ci_lease_release"],
    ["rt ci lease show https://h/g/p/-/merge_requests/1", "ci_lease_read"],
    ["rt ci watch https://h/g/p/-/merge_requests/1 --sha abc1234", "ci_watch"],
  ];
  for (const [line, tool] of cases) {
    test(line, () => {
      const hits = lintSkillText(`\`\`\`bash\n${line}\n\`\`\`\n`, "SKILL.md", rules);
      expect(hits.map((h) => h.tool)).toContain(tool);
    });
  }
});

describe("the attendant flow needs no Bash rt call", () => {
  test("claim, watch, heartbeat and release are all MCP tools", () => {
    const names = new Set(mcpTools().map((t) => t.name));
    for (const n of ["ci_lease_claim", "ci_watch", "ci_lease_heartbeat", "ci_lease_release", "ci_lease_read", "mr_pipeline"]) expect(names.has(n)).toBe(true);
  });
  test("a flow written only with tool calls produces no lint hits", () => {
    const flow = [
      "ci_lease_claim {mrUrl}",
      "mr_pipeline {repoName, iid} (the prior pipeline id)",
      "git_push {tree}",
      "ci_watch {repoName, iid, sha, priorPipelineId}",
      "ci_lease_heartbeat {mrUrl}",
      "ci_lease_release {mrUrl}",
    ].map((l) => `\`${l}\``).join("\n");
    expect(lintSkillText(flow, "SKILL.md", rules)).toEqual([]);
  });
});
```

Check the `LintHit` field name for the tool (`tool` vs `rule.tool`) in `lib/skills/mcp-lint.ts` and adjust the map.

- [ ] **Step 2: Run, then refresh the pinned hashes**

Run: `bun test lib/skills lib/mcp`
Expected: `ci-lint.test.ts` PASS; the two hash tests FAIL printing new hashes and refresh steps.

Follow `mcp-lint-rules-hash`'s refresh steps: run `bun cli.ts skills check --pack-dir /Users/matt/Documents/GitHub/mattstack-skills --strict` (read-only on that repo) and confirm no NEW strict hit names a `ci_*` tool (the packs use `ci-attendant.sh`, not `rt ci`). Record the command output summary for the report. Then set both constants to the printed hashes. The payload hash also feeds mattstack-skills' generated `reference.md`; regenerating it is the follow-up job's work (out of scope here), so note it in the report.

- [ ] **Step 3: Run again**

Run: `bun test lib/skills lib/mcp`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/skills lib/mcp
git commit -m "mcp lint: flag Bash forms of the rt ci verbs; refresh pinned hashes"
```

---

### Task 11: board reads and claims through rt-client

**Files:**
- Modify: `apps/board/src/triage/attendant.ts` (replace the private implementation with a port factory over rt-client), `apps/board/bin/triage.ts` (use the factory), `apps/board/src/triage/run.ts` (claim before the queued write; release on launch failure)
- Test: `apps/board/src/__tests__/triage-attendant.test.ts` (rewrite for the factory), `apps/board/src/__tests__/triage-run.test.ts` (new cases)

**Interfaces:**
- Consumes: Task 1 exports via `@mattstack/rt-client` (or the `./ci-lease` subpath; use whichever import specifier the board already uses for rt-client values).
- Produces: `createBoardAttendants(opts?: CiLeaseOpts): AttendantsPort` in `apps/board/src/triage/attendant.ts`; `AttendantsPort` unchanged in shape (`claim` returns boolean).

- [ ] **Step 1: Failing tests**

`triage-attendant.test.ts` (temp dir, fixed clock):

```ts
test("claim uses the board doctor owner and refuses a live watch-ci lease", () => {
  claimCiLease({ mrUrl: MR, owner: "session:w", holder: "watch-ci" }, { dir, now: () => t });
  const port = createBoardAttendants({ dir, now: () => t });
  expect(port.claim(MR, 42, "feat")).toBe(false);
});
test("claim then heartbeat and release through the port", () => {
  const port = createBoardAttendants({ dir, now: () => t });
  expect(port.claim(MR, 42, "feat")).toBe(true);
  expect(readCiLease(MR, { dir, now: () => t }).lease).toMatchObject({ owner: boardDoctorOwner(MR), holder: "doctor", branch: "feat", sessionLabel: "mr-board-triage" });
  t += 1_000;
  port.heartbeat(MR, 42);
  expect(readCiLease(MR, { dir, now: () => t }).lease?.heartbeatAt).toBe(t);
  port.release(MR, 42);
  expect(readCiLease(MR, { dir, now: () => t }).lease).toBeNull();
});
test("heartbeat adopts a legacy doctor lease so an in-flight doctor does not lapse", () => {
  writeFileSync(join(dir, ciLeaseFileName(MR)), JSON.stringify({ mr: MR, holder: "doctor", startedAt: t, heartbeatAt: t, ttlSeconds: 600 }));
  const port = createBoardAttendants({ dir, now: () => t + 1 });
  port.heartbeat(MR, 42);
  expect(readCiLease(MR, { dir, now: () => t + 1 }).lease).toMatchObject({ owner: boardDoctorOwner(MR), heartbeatAt: t + 1 });
});
test("heartbeat never touches a watch-ci lease", () => {
  claimCiLease({ mrUrl: MR, owner: "session:w", holder: "watch-ci" }, { dir, now: () => t });
  createBoardAttendants({ dir, now: () => t + 5 }).heartbeat(MR, 42);
  expect(readCiLease(MR, { dir, now: () => t + 5 }).lease?.heartbeatAt).toBe(t);
});
test("read and readByBranch return fresh leases", () => { /* claim with branch "feat"; port.read -> holder watch-ci; port.readByBranch("feat") -> mr MR */ });
```

`triage-run.test.ts` (use the file's existing fake-deps builder; record call order in an array):

```ts
test("the lease is claimed before the queued state is written", async () => {
  // deps.attendants.claim pushes "claim"; deps.writeDoctorState pushes `state:${status}`
  // expect order: ["claim", "state:queued", ...]
});
test("a refused claim skips as attended and writes no state row", async () => {
  // attendants.read -> null (lease appeared between read and claim), claim -> false
  // expect result.skipped 1, writeDoctorState never called, launchDoctor never called, audit reason "attended"
});
test("a launch that throws releases the claim", async () => {
  // launchDoctor rejects; expect attendants.release called with (mrUrl, iid)
});
```

- [ ] **Step 2: Verify failure**

Run: `bun run --cwd apps/board test src/__tests__/triage-attendant.test.ts src/__tests__/triage-run.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/board/src/triage/attendant.ts` becomes:

```ts
import {
  adoptLegacyCiLease, boardDoctorOwner, claimCiLease, DEFAULT_CI_LEASE_TTL_SECONDS, heartbeatCiLease,
  readCiLease, readCiLeaseByBranch, releaseCiLease, type CiLeaseOpts,
} from '@mattstack/rt-client';
import type { AttendantsPort } from './run.ts';

/** The board's doctor holds the MR's CI lease on the doctor pane's behalf: the
    pane never claims, and this port's heartbeat, called every cron pass while
    the doctor is in flight, is its pulse. The cron interval must stay under the
    TTL. */
export function createBoardAttendants(opts: CiLeaseOpts = {}): AttendantsPort {
  return {
    read: (mrUrl) => readCiLease(mrUrl, opts).lease,
    readByBranch: (branch) => readCiLeaseByBranch(branch, opts),
    claim: (mrUrl, _iid, branch) =>
      claimCiLease(
        {
          mrUrl,
          owner: boardDoctorOwner(mrUrl),
          holder: 'doctor',
          sessionLabel: 'mr-board-triage',
          ttlSeconds: DEFAULT_CI_LEASE_TTL_SECONDS,
          ...(branch !== undefined && { branch }),
        },
        opts
      ).claimed,
    heartbeat: (mrUrl) => {
      const owner = boardDoctorOwner(mrUrl);
      adoptLegacyCiLease(mrUrl, owner, 'doctor', opts);
      heartbeatCiLease(mrUrl, owner, opts);
    },
    release: (mrUrl) => {
      releaseCiLease(mrUrl, boardDoctorOwner(mrUrl), opts);
    },
  };
}
```

If `run.ts` importing from `attendant.ts` (or the reverse) creates a cycle, move `AttendantsPort` into `attendant.ts` and import it into `run.ts` instead. Wrap each port method body in `try { ... } catch { ... }` only where a `CiLeaseError` (lock busy) must not abort the whole cron pass: `claim` returns `false` on `CiLeaseError`, `heartbeat` and `release` swallow it and log nothing extra (the next pass retries); any other error propagates.

`apps/board/bin/triage.ts`: replace the `attendants: { ... }` literal with `attendants: createBoardAttendants(),` and drop the old imports.

`apps/board/src/triage/run.ts`, in the dispatch block: move the claim above `deps.writeDoctorState(statePath, { ... status: 'queued' ... })`:

```ts
    // dispatch
    if (deps.attendants && !deps.attendants.claim(edge.mrUrl, edge.iid, byUrl.get(edge.mrUrl)?.sourceBranch)) {
      result.skipped++;
      deps.appendAudit({
        ts: now,
        mrUrl: edge.mrUrl,
        iid: edge.iid,
        event: edge.kind,
        decision: 'skip',
        reason: 'attended',
        pipelineId: edge.pipelineId,
      });
      continue;
    }
```

delete the old post-launch `deps.attendants?.claim(...)` call, and in the launch `catch (err)` add `deps.attendants?.release(edge.mrUrl, edge.iid);` before the error state write. Keep the existing read-based `attended` skip above (it avoids spending a decide() on an obviously held MR); the claim is the authoritative check.

Delete the now-unused board-private lease functions and their old tests; `grep -rn "claimLease\|readLeaseByBranch\|defaultAttendantsDir\|leaseFileName" apps/board` must return nothing outside the new code.

- [ ] **Step 4: Run**

Run: `bun run --cwd apps/board test` and `bunx tsc --noEmit` (root) and whatever typecheck the board uses (`bun run --cwd apps/board typecheck` if it exists).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board
git commit -m "board: read and claim the CI lease through rt-client; claim before queueing a doctor"
```

---

### Task 12: end-to-end over MCP stdio, docs, verification

**Files:**
- Create: `e2e/tests/mcp-ci-lease.test.ts` is OUTSIDE the write fence, so instead create `lib/mcp/__tests__/no-ci-lease-stdio.test.ts` (runs `bun cli.ts mcp serve` from source; `no-` prefix so PR CI runs it), `docs/ci-attendant-lease.md`
- Modify: `.superpowers/report-draft.md` (milestones)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the stdio e2e**

Model the JSON-RPC framing on `e2e/tests/mcp-serve.test.ts` (newline-delimited JSON over stdin/stdout; `initialize`, `notifications/initialized`, then `tools/call`). Spawn two servers from source, each with `childEnv()`-based env plus `HOME=<temp>`, `MATTSTACK_ATTENDANTS_DIR=<temp>/att`, `RT_SKIP_SETUP=1`, and `CLAUDE_CODE_SESSION_ID` = `sess-a` / `sess-b`. No daemon is needed (lease tools are file-only).

```ts
test("second session is refused, then takes over after the lease lapses", async () => {
  const a = await startServer("sess-a");
  const b = await startServer("sess-b");
  expect(await call(a, "ci_lease_claim", { mrUrl: MR })).toMatchObject({ claimed: true });
  expect(await call(b, "ci_lease_claim", { mrUrl: MR })).toMatchObject({ claimed: false, holder: { owner: "session:sess-a" } });
  // lapse: backdate heartbeatAt past the TTL on disk
  const path = join(attDir, "grp-proj-42.json");
  const lease = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...lease, heartbeatAt: Date.now() - 700_000 }));
  expect(await call(b, "ci_lease_claim", { mrUrl: MR })).toMatchObject({ claimed: true, previousOwner: "session:sess-a" });
  expect(await call(a, "ci_lease_heartbeat", { mrUrl: MR })).toMatchObject({ ok: false, reason: "lost" });
  await stop(a); await stop(b);
});
```

`call` parses `result.content[0].text` as JSON. Write `startServer`, `call` and `stop` fully in the file (stdin EOF then await exit, falling back to kill, as the model file does).

- [ ] **Step 2: Run it**

Run: `bun test lib/mcp/__tests__/no-ci-lease-stdio.test.ts`
Expected: PASS.

- [ ] **Step 3: Write `docs/ci-attendant-lease.md`**

Sections: what the lease is and where it lives (dir, file name rule, fields table, `owner`); claim rules (the four cases); owner tokens (session, user, board doctor); the lock (exclusive create, stale break, token checks); the tools (`ci_lease_claim`, `ci_lease_heartbeat`, `ci_lease_release`, `ci_lease_read`, `ci_watch` with its inputs and states) and the CLI equivalents; the doctor's lease (`underBoardLease`); the watch-ci flow in tool calls (claim, `mr_pipeline` for `priorPipelineId`, push, `ci_watch` until settled, `ci_lease_heartbeat` during a long fix, `ci_lease_release`); pack script interop and what the retirement follow-up must do (switch to the tools, regenerate `reference.md`, drop `ci-attendant.sh`). No em or en dashes.

- [ ] **Step 4: Full verification (capture each output to a file in the scratchpad and grep it)**

Run, from the repo root:
- `bun install` (A0, if not yet done this session)
- `bun run --cwd packages/glance build && bun run --cwd packages/rt-client build`
- `bun run test`
- `bun run --cwd packages/glance test`
- `bun run --cwd apps/board test`
- `bun test --preload ./e2e/setup.ts e2e/tests/mcp-serve.test.ts` (the existing MCP e2e; needs `RT_BINARY` per its harness, build it as `bun run build` documents into a scratch path; skip only with a stated reason in the report)
- `bunx tsc --noEmit`
- `bun run picker:check`
- `bash scripts/repo-purity.sh`
- `env -i HOME=$(mktemp -d) PATH=$PATH bun cli.ts mcp tools --json | grep -c '"ci_'` (expect 5)
- Manual isolated-HOME check: with `H=$(mktemp -d)`, `env -i HOME=$H PATH=$PATH CLAUDE_CODE_SESSION_ID=one bun cli.ts ci lease claim https://gitlab.example.com/g/p/-/merge_requests/1 --json` (claimed), the same with `CLAUDE_CODE_SESSION_ID=two` (exit 3, refused), backdate the file's `heartbeatAt` with `jq`, then `two` again (claimed, `previousOwner: session:one`). Paste the three JSON lines into the report notes.

Expected: every command green. Fix any failure at its cause before moving on; a failure that also fails on clean `main` is recorded as pre-existing with the evidence.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/__tests__ docs
git commit -m "ci lease: stdio end-to-end test and docs"
```
