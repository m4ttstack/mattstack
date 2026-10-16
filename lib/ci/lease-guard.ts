import {
  claimCiLease, heartbeatCiLease, leaseOwner, parseMrIid, readCiLease,
  type CiLease, type CiLeaseOpts,
} from "../../packages/rt-client/src/index.ts";
import { keepalive as processKeepalive, type LeaseKeepalive } from "./lease-keepalive.ts";

export function ownerFromEnv(env: NodeJS.ProcessEnv): string | null {
  return env.CLAUDE_CODE_SESSION_ID ? `session:${env.CLAUDE_CODE_SESSION_ID}` : null;
}

/** An https MR or PR URL. A scheme-less URL fails `new URL` and would slug from
    its whole text, naming a different lease file than the https form. */
export function isHttpsMrUrl(mrUrl: string): boolean {
  try {
    if (new URL(mrUrl).protocol !== "https:") return false;
  } catch {
    return false;
  }
  return parseMrIid(mrUrl) !== null;
}

export type GuardResult =
  | { ok: true; lease: CiLease; claimed: boolean }
  | { ok: false; refused: "lease_held"; holder: CiLease }
  | { ok: false; error: string };

export interface GuardOpts {
  branch?: string;
  leaseOpts?: CiLeaseOpts;
  keepalive?: LeaseKeepalive;
}

export const NO_SESSION = "CLAUDE_CODE_SESSION_ID is not set; the lease is owned by a Claude Code session";

export function ensureLease(mrUrl: string, env: NodeJS.ProcessEnv, opts: GuardOpts = {}): GuardResult {
  if (!isHttpsMrUrl(mrUrl)) return { ok: false, error: `not an https MR or PR URL: ${mrUrl}` };
  const owner = ownerFromEnv(env);
  if (!owner) return { ok: false, error: NO_SESSION };
  const leaseOpts = opts.leaseOpts ?? {};
  const keepalive = opts.keepalive ?? processKeepalive;
  try {
    const held = heartbeatCiLease(mrUrl, owner, leaseOpts);
    if (held.ok) {
      keepalive.touch(mrUrl, owner, held.lease.ttlSeconds);
      return { ok: true, lease: held.lease, claimed: false };
    }
    const { lease } = readCiLease(mrUrl, leaseOpts);
    // The board doctor's owner is not a session owner, so it refuses like any other fresh holder.
    if (lease && leaseOwner(lease) !== owner) return { ok: false, refused: "lease_held", holder: lease };
    const claim = claimCiLease(
      { mrUrl, owner, holder: "watch-ci", ...(opts.branch !== undefined && { branch: opts.branch }) },
      leaseOpts,
    );
    if (!claim.claimed) return { ok: false, refused: "lease_held", holder: claim.holder };
    keepalive.touch(mrUrl, owner, claim.lease.ttlSeconds);
    return { ok: true, lease: claim.lease, claimed: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
