import { DEFAULT_CI_LEASE_TTL_SECONDS, heartbeatCiLease, type CiLeaseOpts, type HeartbeatResult } from "../../packages/rt-client/src/index.ts";

export const KEEPALIVE_TICK_MS = 60_000;
const MIN_TICK_MS = 1_000;
export const KEEPALIVE_IDLE_MS = 3_600_000;

export interface KeepaliveDeps {
  now(): number;
  setInterval(fn: () => void, ms: number): { unref?(): void };
  clearInterval(h: unknown): void;
  heartbeat(mrUrl: string, owner: string): HeartbeatResult;
  leaseOpts(): CiLeaseOpts;
}

interface Entry {
  mrUrl: string;
  owner: string;
  lastTouch: number;
  ttlSeconds: number;
}

export class LeaseKeepalive {
  private readonly deps: KeepaliveDeps;
  private readonly entries = new Map<string, Entry>();
  private handle: { unref?(): void } | null = null;
  private handleMs = 0;

  constructor(deps: Partial<KeepaliveDeps> = {}) {
    const leaseOpts = deps.leaseOpts ?? (() => ({}));
    this.deps = {
      now: Date.now,
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
      heartbeat: (mrUrl, owner) => heartbeatCiLease(mrUrl, owner, leaseOpts()),
      ...deps,
      leaseOpts,
    };
  }

  touch(mrUrl: string, owner: string, ttlSeconds: number = DEFAULT_CI_LEASE_TTL_SECONDS): void {
    this.entries.set(key(mrUrl, owner), { mrUrl, owner, lastTouch: this.deps.now(), ttlSeconds });
    this.rearm();
  }

  drop(mrUrl: string, owner: string): void {
    this.entries.delete(key(mrUrl, owner));
    this.rearm();
  }

  tick(): void {
    const now = this.deps.now();
    for (const [k, e] of [...this.entries]) {
      if (now - e.lastTouch > KEEPALIVE_IDLE_MS) {
        this.entries.delete(k);
        continue;
      }
      try {
        const hb = this.deps.heartbeat(e.mrUrl, e.owner);
        if (hb.ok) e.ttlSeconds = hb.lease.ttlSeconds;
        else this.entries.delete(k);
      } catch {
        // A busy lock or an unreadable file is not a verdict: the next tick retries.
      }
    }
    this.rearm();
  }

  /** The interval the registry runs at now: half the smallest held TTL, at most KEEPALIVE_TICK_MS; 0 when idle. */
  tickMs(): number {
    if (this.entries.size === 0) return 0;
    let ms = KEEPALIVE_TICK_MS;
    for (const e of this.entries.values()) ms = Math.min(ms, Math.max(MIN_TICK_MS, Math.floor((e.ttlSeconds * 1_000) / 2)));
    return ms;
  }

  size(): number {
    return this.entries.size;
  }

  private rearm(): void {
    const ms = this.tickMs();
    if (this.handle && ms === this.handleMs) return;
    if (this.handle) this.deps.clearInterval(this.handle);
    this.handle = null;
    this.handleMs = 0;
    if (ms === 0) return;
    // An unref'd timer is what lets a short-lived CLI process exit with entries still registered.
    this.handle = this.deps.setInterval(() => this.tick(), ms);
    this.handle.unref?.();
    this.handleMs = ms;
  }
}

function key(mrUrl: string, owner: string): string {
  return `${owner}\u0000${mrUrl}`;
}

export const keepalive = new LeaseKeepalive();
