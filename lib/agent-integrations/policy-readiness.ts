/**
 * Session policy readiness: the proof a bound session earned, kept in
 * state.db on its binding (never in settings), and the one check every
 * managed step makes before relying on that session's policy: launch
 * readiness, each work submission, and job activation.
 *
 * A proof belongs to one session key, one attachment generation and one
 * policy revision, and its kind is its harness's own. Claude Code proves by
 * installation, since it loads the inspected plugin hooks at every start;
 * Codex proves by receipts from a controller-issued check turn, each
 * correlated with its native hook run under that turn's nonce. A proof of
 * another kind, for another session or generation, for an older revision,
 * or claiming a capability it has no evidence for, never enables policy.
 */

import type { Database } from "bun:sqlite";
import type { Capability, FaultCode, Outcome, SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";
import { getStateDb } from "../state/db.ts";
import type { PolicyProofKind } from "./contracts.ts";
import {
  createSessionStore, isDetachedAttachment, readBindingReadiness, recordBindingProof, type PolicyProofRecord,
} from "./session-store.ts";

export const POLICY_CAPABILITIES: readonly Capability[] = ["gate-policy", "continuation-policy"];

/** The proof each harness gives; a harness not listed names none, and any recorded kind is checked for shape only. */
const PROOF_KIND: Readonly<Record<string, PolicyProofKind>> = { claude: "installation", codex: "receipts" };
const KINDS: readonly string[] = ["installation", "receipts"];

const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const filled = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** The policy capabilities among `required`, once each. */
export function policyCapabilities(required: readonly Capability[]): Capability[] {
  return [...new Set(required.filter((c) => POLICY_CAPABILITIES.includes(c)))];
}

/** Why this proof cannot stand for this harness's session, or undefined when its shape is sound. */
function unsound(harness: string, proof: PolicyProofRecord): string | undefined {
  if (!filled(proof.sessionKey) || !Number.isInteger(proof.generation) || !filled(proof.revision) || !Number.isFinite(proof.observedAt)) {
    return "the policy proof is incomplete";
  }
  if (!Array.isArray(proof.verified) || proof.verified.some((c) => !POLICY_CAPABILITIES.includes(c))) {
    return "the policy proof claims something that is not a policy capability";
  }
  if (proof.cwd !== undefined && !filled(proof.cwd)) return "the policy proof names no working directory";
  const expected = PROOF_KIND[harness];
  if (expected !== undefined && proof.kind !== expected) {
    return `a ${harness} session proves its policy by ${expected}, not ${proof.kind ?? "an unnamed kind"}`;
  }
  if (proof.kind !== undefined && !KINDS.includes(proof.kind)) return "the policy proof is of an unknown kind";
  if (proof.kind === "receipts") {
    const e = proof.evidence;
    if (!e || !filled(e.turnId) || !filled(e.nonce) || !filled(e.sourcePath) || !filled(e.manifest) || !filled(e.runs?.PreToolUse) || !filled(e.runs?.Stop)) {
      return "the policy proof has no check turn, nonce and native hook run for every event";
    }
  }
  return undefined;
}

/** Keeps the proof `binding` earned for its own generation; a proof for anything else is refused, never stored. */
export function recordPolicyProof(binding: SessionBinding, proof: PolicyProofRecord, db: Database = getStateDb()): Outcome<void> {
  if (proof.sessionKey !== binding.key) return fail("invalid", `the policy proof names another session than ${binding.native.value}`);
  if (proof.generation !== binding.attachment.generation) return fail("invalid", `the policy proof is for another attachment than ${binding.attachment.generation}`);
  const why = unsound(binding.native.harness, proof);
  if (why) return fail("invalid", why);
  return recordBindingProof(db, binding.key, binding.attachment.generation, proof);
}

/**
 * Ok only when the binding is still at its generation and holds a proof for
 * that generation and policy `revision`, of its harness's kind, covering
 * every policy capability in `required`.
 */
export function requirePolicyProof(
  binding: SessionBinding, required: readonly Capability[], revision: string, db: Database = getStateDb(),
): Outcome<void> {
  const session = binding.native.value;
  const current = createSessionStore(db).get(binding.key);
  if (!current) return fail("invalid", "no session binding has that key");
  if (current.attachment.generation !== binding.attachment.generation || isDetachedAttachment(current)) {
    return fail("stale-binding", `session ${session} moved on from attachment ${binding.attachment.generation}`);
  }
  const proof = readBindingReadiness(db, binding.key)?.proof;
  if (!proof) return fail("not-ready", `session ${session} has not proved its policy`);
  if (proof.sessionKey !== binding.key) return fail("not-ready", `session ${session}'s policy proof names another session`);
  if (proof.generation !== binding.attachment.generation) {
    return fail("not-ready", `session ${session}'s policy proof is for attachment ${proof.generation}, not ${binding.attachment.generation}`);
  }
  if (proof.revision !== revision) return fail("not-ready", `session ${session} proved a policy that has changed since; it must prove the current one`);
  const why = unsound(binding.native.harness, proof);
  if (why) return fail("not-ready", `session ${session}'s policy proof is not usable: ${why}`);
  const missing = policyCapabilities(required).filter((c) => !proof.verified.includes(c));
  if (missing.length > 0) return fail("not-ready", `session ${session} never proved: ${missing.join(", ")}`);
  return { ok: true, data: undefined };
}
