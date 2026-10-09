/**
 * Herd job attempts: which launch of a job's worker holds the job.
 *
 * An attempt is reserved in herds.db before its worker launches, carried on
 * the launch reservation (and so on the binding) in state.db, and activated
 * only once that binding is verified and, with agent.integrations.enabled
 * on, holds a current policy proof. Activation replaces the job's previous
 * attempt in one transaction, so at most one attempt per job is active.
 *
 * Authority needs both stores to agree: the job's active attempt in herds.db
 * names the binding and its generation, and that binding in state.db names
 * the attempt. A sequence interrupted between the two (a crash after bind,
 * before activation) leaves the replacement reserved and the predecessor as
 * it was, so neither gains authority. Recovery never launches a worker and
 * never activates one: it only ends a reservation whose launch provably made
 * nothing.
 */

import type { Database } from "bun:sqlite";
import type { CallerContext, FaultCode, Outcome, Selection, SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";
import { POLICY_CAPABILITIES, requirePolicyProof } from "../agent-integrations/policy-readiness.ts";
import {
  createSessionStore, isDetachedAttachment, launchClaimedForAttempt, readBindingReadiness,
} from "../agent-integrations/session-store.ts";
import { integrationsEnabled } from "../agent-integrations/switch.ts";
import { isBusyError } from "../state/busy.ts";
import type { HerdStore, JobAttempt } from "./herd-store.ts";

export type { JobAttempt, JobAttemptState } from "./herd-store.ts";

export type JobAttemptDeps = {
  herds: HerdStore;
  /** state.db, opened only when a step reads a binding; the switch-off path never does. */
  db: () => Database;
  /** agent.integrations.enabled, read on every decision. */
  enabled?: () => boolean;
};

export interface JobAttempts {
  reserveJobAttempt(input: { herd: string; job: string; selection: Selection; replaces?: string }): Outcome<JobAttempt>;
  /** Commits the attempt's authority to `binding`; a resumed binding of the same attempt refreshes its generation. */
  activateJobAttempt(attemptId: string, binding: SessionBinding): Outcome<JobAttempt>;
  /** A worker launched with the switch off: active with no binding, so it never authorizes a fenced report. */
  activateUnbound(attemptId: string): Outcome<JobAttempt>;
  authorizeJobReport(context: CallerContext, herd: string, job: string): Outcome<JobAttempt>;
  /** The recheck right before a worker's work is sent: the exact attempt is active for this binding generation. */
  authorizeAttemptWork(attemptId: string, binding: SessionBinding): Outcome<void>;
  /** A reserved attempt whose launch made nothing. */
  endJobAttempt(attemptId: string): boolean;
  /** The launch carrying this attempt has returned, whatever its outcome. */
  release(attemptId: string): void;
  reconcileJobAttempts(): Promise<void>;
}

/** Attempts whose launch is running in this process; recovery leaves them to it. */
const LAUNCHING = new Set<string>();

/** Tests simulate a process that died mid-launch by forgetting its launches. */
export const __test__ = { reset: (): void => LAUNCHING.clear() };

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });

function guarded<T>(op: () => Outcome<T>): Outcome<T> {
  try {
    return op();
  } catch (err) {
    if (isBusyError(err)) return fail("transient", "the herd database is busy; nothing was recorded");
    throw err;
  }
}

export function createJobAttempts(deps: JobAttemptDeps): JobAttempts {
  const { herds } = deps;
  const enabled = deps.enabled ?? integrationsEnabled;

  /** The binding as state.db holds it now, still at the caller's generation and attached. */
  function currentBinding(binding: SessionBinding): Outcome<SessionBinding> {
    const current = createSessionStore(deps.db()).get(binding.key);
    if (!current) return fail("invalid", `no session binding has key ${binding.key}`);
    if (current.attachment.generation !== binding.attachment.generation || isDetachedAttachment(current)) {
      return fail("stale-binding", `session ${current.native.value} moved on from attachment ${binding.attachment.generation}`);
    }
    return ok(current);
  }

  /** With the switch on, a worker takes its job only after proving the policy every herd worker requires. */
  function policyProven(binding: SessionBinding): Outcome<void> {
    if (!enabled()) return ok(undefined);
    const db = deps.db();
    const readiness = readBindingReadiness(db, binding.key);
    if (readiness?.generation !== binding.attachment.generation) {
      return fail("not-ready", `session ${binding.native.value} has not been verified ready for this attachment`);
    }
    return requirePolicyProof(binding, POLICY_CAPABILITIES, readiness.proof?.revision ?? "", db);
  }

  function heldBy(attempt: JobAttempt | null, binding: SessionBinding): Outcome<JobAttempt> {
    if (!attempt || attempt.state !== "active") return fail("refused", "this attempt does not hold its job");
    if (attempt.bindingKey !== binding.key || attempt.generation !== binding.attachment.generation) {
      return fail("stale-binding", `job ${attempt.job}'s attempt ${attempt.id} is held by another session or attachment`);
    }
    return ok(attempt);
  }

  return {
    reserveJobAttempt(input) {
      return guarded(() => {
        const id = `att-${crypto.randomUUID()}`;
        const attempt = herds.reserveAttempt({ id, ...input });
        LAUNCHING.add(id);
        return ok(attempt);
      });
    },

    activateJobAttempt(attemptId, binding) {
      const current = currentBinding(binding);
      if (!current.ok) return current;
      if (current.data.attemptId !== attemptId) {
        return fail("refused", `session ${current.data.native.value} was not launched for attempt ${attemptId}`);
      }
      const proven = policyProven(current.data);
      if (!proven.ok) return proven;
      const activated = guarded(() => herds.activateAttempt(attemptId, current.data.key, current.data.attachment.generation));
      if (activated.ok) LAUNCHING.delete(attemptId);
      return activated;
    },

    activateUnbound(attemptId) {
      const activated = guarded(() => herds.activateAttempt(attemptId, null, 0));
      if (activated.ok) LAUNCHING.delete(attemptId);
      return activated;
    },

    authorizeJobReport(context, herd, job) {
      const current = currentBinding(context.binding);
      if (!current.ok) return current;
      const own = current.data.attemptId;
      if (own === undefined) return fail("refused", `session ${current.data.native.value} is not a herd worker`);
      const attempt = herds.getAttempt(own);
      if (!attempt || attempt.herd !== herd || attempt.job !== job) {
        return fail("refused", `session ${current.data.native.value} does not work job ${job} in herd ${herd}`);
      }
      if (attempt.state === "replaced" || attempt.state === "ended") {
        return fail("stale-binding", `attempt ${attempt.id} no longer holds job ${job}; a newer worker replaced it`);
      }
      if (attempt.state === "reserved") return fail("refused", `attempt ${attempt.id} has not taken job ${job} yet`);
      return heldBy(herds.activeAttempt(herd, job), current.data);
    },

    authorizeAttemptWork(attemptId, binding) {
      const current = currentBinding(binding);
      if (!current.ok) return current;
      if (current.data.attemptId !== attemptId) return fail("refused", `session ${current.data.native.value} was not launched for attempt ${attemptId}`);
      const held = heldBy(herds.getAttempt(attemptId), current.data);
      return held.ok ? ok(undefined) : held;
    },

    endJobAttempt(attemptId) {
      LAUNCHING.delete(attemptId);
      return herds.endAttempt(attemptId, ["reserved"]);
    },

    release(attemptId) {
      LAUNCHING.delete(attemptId);
    },

    async reconcileJobAttempts() {
      for (const attempt of herds.attemptsIn("reserved")) {
        if (LAUNCHING.has(attempt.id)) continue;
        // A session that may exist stays reserved and unassigned: it holds no authority, and only a new spawn replaces it.
        if (launchClaimedForAttempt(deps.db(), attempt.id)) continue;
        herds.endAttempt(attempt.id, ["reserved"]);
      }
    },
  };
}
