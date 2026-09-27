/**
 * The CI attendant lease as four MCP tools: claim, heartbeat,
 * release, read. Every tool acts only as this session: the owner comes from
 * CLAUDE_CODE_SESSION_ID via ownerFromEnv, never from input, so a caller
 * cannot claim, heartbeat or release on another session's behalf.
 */
import {
  claimCiLease, heartbeatCiLease, leaseOwner, parseMrIid, readCiLease, releaseCiLease,
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

/** Shared claim/heartbeat/release/read shape: validate mrUrl and the session
    owner, then run the lease op, turning any thrown error (a busy lock or an
    fs failure) into an ordinary tool error instead of a throw. */
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
    return err(e instanceof Error ? e.message : String(e));
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
        const branch = typeof input.branch === "string" && input.branch.trim() !== "" ? input.branch : undefined;
        return leaseCall(input, env, deps.owner, (mrUrl, owner) => {
          const label = deps.label(env);
          return claimCiLease({
            mrUrl, owner, holder,
            ...(branch !== undefined && { branch }),
            ...(label !== undefined && { sessionLabel: label }),
            ...(ttl !== undefined && { ttlSeconds: ttl }),
          }, deps.leaseOpts());
        });
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
      description: `Read the MR's CI attendant lease: {lease: <fresh lease or null>, stale: <a stale lease on disk or null>, mine: <true when the fresh lease is this session's>}. A lease with no owner field was written by the pack script and reads as owner legacy:<holder>. A stale lease of this session's own is revived by calling ci_lease_heartbeat, which checks ownership only, not freshness. ${LEASE_NOTE}`,
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
