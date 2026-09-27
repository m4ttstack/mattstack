import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
  lockWaitMs?: number;
  /** Test seam: fires once per contested-lock retry iteration, before the wait sleep. */
  onLockWait?: () => void;
  /** Test seam: fires inside breakIfStale after a lock is judged stale, before it is renamed aside. */
  onStaleLockObserved?: () => void;
  /** Test seam: fires in claimCiLease right after the lease file's one read, before the write. */
  onLeaseRead?: () => void;
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
  const deadline = Date.now() + (opts.lockWaitMs ?? LOCK_WAIT_MS);
  for (;;) {
    const token = randomUUID();
    try {
      writeFileSync(lock, JSON.stringify({ token, at: Date.now() }), { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      breakIfStale(lock, staleMs, opts);
      if (Date.now() > deadline) throw new CiLeaseError(`lease lock busy: ${lock}`);
      opts.onLockWait?.();
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

/** Age of the file at `path` in ms, or null when it cannot be stat'd (gone). */
function fileAgeMs(path: string, now: number): number | null {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function breakIfStale(lock: string, staleMs: number, opts: CiLeaseOpts): void {
  const now = Date.now();
  const seen = lockToken(lock);
  // `wx` create is open-then-write, not atomic: a lock mid-creation reads with
  // no token, and its own freshness can only be judged by mtime, never assumed stale.
  if (seen ? now - seen.at <= staleMs : (fileAgeMs(lock, now) ?? 0) <= staleMs) return;
  opts.onStaleLockObserved?.();
  const aside = `${lock}.${randomUUID()}.broken`;
  try {
    renameSync(lock, aside);
  } catch {
    return;
  }
  // Discard the aside file only on a positive match to what was judged stale: the
  // same token, or (when the token was unreadable) an mtime still past staleMs.
  // Anything else means a live write raced the judgment, so it goes back.
  const stillStale = seen ? lockToken(aside)?.token === seen.token : (fileAgeMs(aside, Date.now()) ?? 0) > staleMs;
  if (!stillStale) {
    try { linkSync(aside, lock); } catch { /* a newer lock exists */ }
  }
  try { unlinkSync(aside); } catch { /* already gone */ }
}

/** Writes `lease` to a sibling temp file only; the caller commits it (rename or link) after re-checking `stillMine()`, to keep that window minimal. */
function writeTmp(path: string, lease: CiLease): string {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(lease, null, 2));
  return tmp;
}

function commitReplace(tmp: string, path: string): void {
  try {
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

/** Runs `stillMine`, cleaning up `tmp` first when the lock was lost so a retry never leaves it orphaned. */
function checkStillMine(tmp: string, stillMine: () => void): void {
  try {
    stillMine();
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

/** Exclusive create: false when a lockless writer (the pack script) got there first. */
function commitCreate(tmp: string, path: string): boolean {
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

/** One read of the lease file: only ENOENT means the create route is safe; a file that exists, parseable or not, takes the replace route; any other read failure throws, since an unreadable file would make the create route's link fail EEXIST forever. Both fields must come from this single read, or a lockless creator landing in the gap between two separate reads can make `absent` say create while `existing` still says the file was absent. */
function readLeaseState(path: string): { existing: CiLease | null; absent: boolean } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { existing: null, absent: true };
    throw new CiLeaseError(`lease file unreadable: ${path} (${code ?? String(e)})`);
  }
  return { existing: parseLease(raw), absent: false };
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
      const { existing, absent } = readLeaseState(p.lease);
      opts.onLeaseRead?.();
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
      const tmp = writeTmp(p.lease, lease);
      checkStillMine(tmp, stillMine);
      if (absent) {
        if (!commitCreate(tmp, p.lease)) continue;
      } else {
        commitReplace(tmp, p.lease);
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
  const seen = readFileLease(p.lease);
  if (!seen) return { ok: false, reason: "none" };
  // Only this owner writes its own owner token, so a foreign lease seen here cannot become ours under the lock.
  if (leaseOwner(seen) !== owner) return { ok: false, reason: "lost", holder: seen };
  return withLock(p.lock, opts, (stillMine) => {
    const existing = readFileLease(p.lease);
    if (!existing) return { ok: false, reason: "none" };
    if (leaseOwner(existing) !== owner) return { ok: false, reason: "lost", holder: existing };
    const lease = { ...existing, heartbeatAt: clock(opts) };
    const tmp = writeTmp(p.lease, lease);
    checkStillMine(tmp, stillMine);
    commitReplace(tmp, p.lease);
    return { ok: true, lease };
  });
}

export type ReleaseResult =
  | { released: true }
  | { released: false; reason: "not-owner"; holder: CiLease }
  | { released: false; reason: "none" };

export function releaseCiLease(mrUrl: string, owner: string, opts: CiLeaseOpts = {}): ReleaseResult {
  const p = paths(mrUrl, opts);
  const seen = readFileLease(p.lease);
  if (!seen) return { released: false, reason: "none" };
  if (leaseOwner(seen) !== owner) return { released: false, reason: "not-owner", holder: seen };
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
    const tmp = writeTmp(p.lease, { ...existing, owner });
    checkStillMine(tmp, stillMine);
    commitReplace(tmp, p.lease);
    return { adopted: true };
  });
}
