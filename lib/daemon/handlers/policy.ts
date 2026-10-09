/**
 * policy:authorize and policy:stop: the shared workflow policy, asked by the
 * mattstack-mods `policy` and `stop-gate` blocks over their session's link.
 *
 * rt.sock does not say who calls, so the caller is only ever what the live
 * link recorded: the link must be `sessionId`'s current one and carry the
 * asking block, and the fork-check sees the link's session id, the bound
 * pane and the link's directory, never a cwd or id the payload names. An
 * `ask` files under the binding's own gate subject. A session with no bound
 * binding gets no decision, so the mod passes and the mattstack plugin's
 * shell hooks decide as they do without the mod.
 *
 * These verbs decide only. Their one effect is the shared policy's own on an
 * unavailable verdict: the binding's readiness withdrawn and an attention
 * condition raised.
 */

import type { Database } from "bun:sqlite";
import type { CallerContext, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import { bindingGateSubject, resolveCallerContextNow } from "../../agent-integrations/context.ts";
import { modContext } from "../../agent-integrations/claude/mod-path.ts";
import { UNKNOWN_LINK, type ModLinks, type ModLinkView } from "../../agent-integrations/claude/mod-links.ts";
import {
  authorizeWorkflowAction, inspectStop, POLICY_UNAVAILABLE, type ForkCheckPayload, type ForkCheckResponse,
  type PolicyDeps, type WorkflowAction,
} from "../../agent-integrations/policy.ts";

type Verb = "policy:authorize" | "policy:stop";
/** CommandResult's shape, spelled here because ./types.ts reaches setup modules through the daemon's snapshot types. */
type Result<K extends Verb> =
  | { ok: true; data: Commands[K]["data"] }
  | { ok: false; error: string; failure: { code: string; message: string } };

export type PolicyHandlerDeps = {
  links: ModLinks;
  db: Database;
  /** The daemon's own gate:fork-check handler, so the question rule runs in-process. */
  forkCheck: (payload: ForkCheckPayload) => Promise<ForkCheckResponse>;
  subjectOf?: (binding: SessionBinding) => string | undefined;
  /** Run readers and the unavailable record, for tests; the caller is never taken from here. */
  policy?: Omit<PolicyDeps, "caller" | "forkCheck">;
};

const ACTIONS: readonly WorkflowAction[] = ["ask", "continue", "complete"];

const declined = (code: string, message: string, error = message) => ({ ok: false as const, error, failure: { code, message } });
const invalid = (message: string) => declined("invalid", message);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const record = (payload: unknown): Record<string, unknown> =>
  payload !== null && typeof payload === "object" ? payload as Record<string, unknown> : {};

type Caller = { link: ModLinkView; context: CallerContext | null; unbound?: string };

export function createPolicyHandlers(deps: PolicyHandlerDeps): { [K in Verb]: (payload: unknown) => Promise<Result<K>> } {
  const { links, db } = deps;

  /** The live link `linkId` of `sessionId` carrying `block`, and the session's bound caller context when it has one. */
  function callerOf(linkId: string, sessionId: string, block: "policy" | "stop-gate"): Caller | ReturnType<typeof declined> {
    const link = links.view(linkId);
    if (!link) return declined("unknown-link", UNKNOWN_LINK, "unknown link");
    if (link.sessionId !== sessionId) return declined("refused", `link ${linkId} belongs to another session than ${sessionId}`);
    if (!link.blocks.includes(block)) return declined("refused", `link ${linkId} carries no live ${block} block`);
    const resolved = resolveCallerContextNow(
      { native: { harness: "claude", kind: "id", value: link.sessionId } },
      { db, modContext: (id) => modContext(id, links) },
    );
    return resolved.ok ? { link, context: resolved.data } : { link, context: null, unbound: resolved.error.message };
  }

  const policyFor = (link: ModLinkView): PolicyDeps => ({ ...deps.policy, forkCheck: deps.forkCheck, caller: { cwd: link.cwd } });

  return {
    "policy:authorize": async (payload) => {
      const { linkId, sessionId, action, subject } = record(payload);
      if (!isText(linkId)) return invalid("linkId must be a non-empty string");
      if (!isText(sessionId)) return invalid("sessionId must be a non-empty string");
      if (!ACTIONS.includes(action as WorkflowAction)) return invalid(`action must be one of ${ACTIONS.join(", ")}`);
      if (action !== "ask" && !isText(subject)) return invalid(`${String(action)} needs subject, the run store it acts on`);
      const caller = callerOf(linkId, sessionId, "policy");
      if ("failure" in caller) return caller;
      if (!caller.context) return { ok: true, data: { decision: "none", reason: caller.unbound } };
      const asked = action === "ask"
        ? (deps.subjectOf ?? ((b) => bindingGateSubject(b, db)))(caller.context.binding) ?? ""
        : subject as string;
      const outcome = await authorizeWorkflowAction(caller.context, action as WorkflowAction, asked, policyFor(caller.link));
      if (outcome.ok) return { ok: true, data: { decision: "allow" } };
      if (outcome.error.code === "refused") return { ok: true, data: { decision: "refuse", reason: outcome.error.message } };
      if (outcome.error.code === POLICY_UNAVAILABLE) return declined(POLICY_UNAVAILABLE, outcome.error.message);
      // An unowned or unreadable run store is the run tools' own to refuse.
      return { ok: true, data: { decision: "none", reason: outcome.error.message } };
    },

    "policy:stop": async (payload) => {
      const { linkId, sessionId } = record(payload);
      if (!isText(linkId)) return invalid("linkId must be a non-empty string");
      if (!isText(sessionId)) return invalid("sessionId must be a non-empty string");
      const caller = callerOf(linkId, sessionId, "stop-gate");
      if ("failure" in caller) return caller;
      if (!caller.context) return { ok: true, data: { decision: "none", reason: caller.unbound } };
      const verdict = await inspectStop(caller.context, policyFor(caller.link));
      if (!verdict.ok) return declined(verdict.error.code, verdict.error.message);
      return { ok: true, data: verdict.data };
    },
  };
}
