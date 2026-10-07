/**
 * Typed pane input (an invite's join command, `rt pane send`) for a session
 * whose harness takes such input as peer input rather than typed keys.
 *
 * With agent.integrations.enabled on, the pane's current session is the
 * binding most recently attached at that pane ref, and it counts only when
 * herdr shows that same harness running there now: a binding left behind by
 * an earlier session never captures input meant for a later one. Its
 * integration decides the path. One with typed pane input (Claude Code)
 * keeps herdr's prompt, which preserves a composer draft; any other gets the
 * text as one-shot peer input through its messaging. A session blocked on a
 * question is refused, never typed into: the input would land in the
 * question form.
 */

import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import type { Observation, SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";
import type { IntegrationRegistry } from "../agent-integrations/contracts.ts";
import { oneShotInput, type DeliveryService } from "../agent-integrations/delivery.ts";
import { listBindingsAtPane } from "../agent-integrations/session-store.ts";
import type { herdrRequest } from "../herdr/client.ts";
import type { InjectResult } from "./inject.ts";
import { resolvePaneRef } from "./pane-ref-socket.ts";

export type PaneInputRoute = {
  db: Database;
  herdr: typeof herdrRequest;
  integrations: IntegrationRegistry;
  delivery?: DeliveryService;
  enabled: () => boolean;
  observe: (binding: SessionBinding) => Promise<Observation | null>;
  log?: Pick<Logger, "warn">;
};

/** The pane as the caller addressed it (`ref`) and as herdr knows it (`paneId` on `sockPath`'s server). */
export type PaneTarget = { ref: string; paneId: string; sockPath?: string };

/** One piece of input; each gets its own logical delivery id under `idPrefix`. */
export type PaneInput = { idPrefix: string; sender: string; body: string };

/** The session at `target` that takes typed input as peer input, or null when herdr's prompt (or nothing) applies. */
export async function messagingTarget(route: PaneInputRoute, target: PaneTarget): Promise<SessionBinding | null> {
  if (!route.delivery || !route.enabled()) return null;
  const binding = listBindingsAtPane(route.db, target.ref)[0];
  if (!binding) return null;
  const integration = route.integrations.get(binding.native.harness);
  if (!integration || integration.typedPaneInput) return null;
  return (await paneRunsHarness(route.herdr, target, binding.native.harness)) ? binding : null;
}

/** Whether herdr shows `harness` running in the pane now; false when the pane is gone or herdr cannot say. */
export async function paneRunsHarness(
  herdr: typeof herdrRequest, target: Pick<PaneTarget, "paneId" | "sockPath">, harness: string,
): Promise<boolean> {
  const shown = await herdr<{ agent: { agent: string } }>("agent.get", { target: target.paneId }, { sockPath: target.sockPath });
  return shown.ok && shown.result?.agent?.agent === harness;
}

/** Whether herdr shows the binding's own harness in the pane its attachment names; false for an attachment with no pane. */
export async function bindingPaneRuns(herdr: typeof herdrRequest, binding: SessionBinding): Promise<boolean> {
  const pane = binding.attachment.pane;
  if (!pane) return false;
  const { paneId, sockPath } = resolvePaneRef(pane);
  return paneRunsHarness(herdr, { paneId, sockPath: binding.attachment.socket ?? sockPath }, binding.native.harness);
}

/** Sends `inputs` in order to a session messagingTarget found; the first refusal stops the rest. */
export async function sendAsPeerInput(
  route: PaneInputRoute, target: PaneTarget, binding: SessionBinding, inputs: readonly PaneInput[],
): Promise<{ ok: true; data: InjectResult }> {
  const refused = (reason: string) => ({ ok: true as const, data: { paneId: target.ref, delivered: "refused" as const, reason } });
  if (route.delivery!.connection(binding.native.harness) === null) return refused("not connected");
  let seen: Observation | null = null;
  try {
    seen = await route.observe(binding);
  } catch (err) {
    route.log?.warn({ err, harness: binding.native.harness }, "pane input: the session could not be observed; sending anyway");
  }
  if (seen?.execution === "blocked") return refused("at a prompt");
  let evidence: string | undefined;
  for (const input of inputs) {
    const sent = await route.delivery!.deliverPeerInput(binding, oneShotInput({
      id: `${input.idPrefix}-${crypto.randomUUID()}`, sender: input.sender, body: input.body, recipient: binding.identity,
    }));
    if (!sent.ok) return refused(sent.error.message);
    evidence ??= sent.data.evidence;
  }
  return { ok: true, data: { paneId: target.ref, delivered: evidence === "queued" ? "queued" : "accepted" } };
}

/** A bound session's state from its own integration's observation; null when it has none. */
export function observeThroughIntegration(integrations: IntegrationRegistry): (binding: SessionBinding) => Promise<Observation | null> {
  return async (binding) => {
    const sessions = await integrations.get(binding.native.harness)?.loadSessions?.();
    const seen = sessions ? await sessions.observe(binding) : null;
    return seen?.ok ? seen.data : null;
  };
}
