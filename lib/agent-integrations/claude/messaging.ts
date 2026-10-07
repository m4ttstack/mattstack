/**
 * Claude Code's peer messaging: today's inbox writer, unchanged in what it
 * writes or when. One frame per delivery, `priority: "next"`, so an idle
 * session starts a turn and a working one reads it between tool calls.
 * Whether a session accepts it is Claude Code's own configured inbound
 * behaviour; nothing here changes it.
 *
 * The writer reports success once the frame is written and never awaits a
 * receiver, so a receipt here is only ever `submitted`, and there is no later
 * evidence to reconcile. The logical delivery id rides inside the envelope and
 * derives the frame's transport id, so a retry carries the same ids.
 */

import { createHash } from "crypto";
import type {
  DeliveryReceipt, FaultCode, Outcome, PeerInput, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { resolveLiveInbox } from "../../claude-registry.ts";
import { deliverToInbox, wrapCrossSession } from "../../daemon/inbox.ts";
import { getStateDb } from "../../state/db.ts";
import type { MessageAdapter } from "../contracts.ts";
import { createSessionStore, isDetachedAttachment, type SessionStore } from "../session-store.ts";

const HARNESS = "claude";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ClaudeMessagingDeps = {
  /** The session's live inbox socket, or null when it has none. */
  inbox(sessionId: string): { socketPath: string } | null;
  deliver: typeof deliverToInbox;
  /** The store's binding for this key now, to fence a replaced or detached attachment. */
  currentBinding(key: string): SessionBinding | null;
};

const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });

/** The frame's `msg_id`: the logical id when it is already a uuid, else a version-8 uuid derived from it. */
export function claudeTransportId(logicalId: string): string {
  if (UUID_RE.test(logicalId)) return logicalId.toLowerCase();
  const hex = createHash("sha256").update(logicalId).digest("hex").slice(0, 32).split("");
  hex[12] = "8";
  hex[16] = "89ab"[parseInt(hex[16]!, 16) & 3]!;
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function defaultDeps(): ClaudeMessagingDeps {
  let store: SessionStore | undefined;
  return {
    inbox: (sessionId) => resolveLiveInbox(sessionId),
    deliver: deliverToInbox,
    currentBinding: (key) => (store ??= createSessionStore(getStateDb())).get(key),
  };
}

function validInput(input: PeerInput): boolean {
  return typeof input?.id === "string" && input.id !== "" && typeof input.body === "string" && typeof input.sender === "string";
}

export function createClaudeMessaging(overrides: Partial<ClaudeMessagingDeps> = {}): MessageAdapter {
  const deps: ClaudeMessagingDeps = { ...defaultDeps(), ...overrides };

  function attached(binding: SessionBinding): boolean {
    const now = deps.currentBinding(binding.key);
    return now !== null && !isDetachedAttachment(now) && now.attachment.generation === binding.attachment.generation
      && now.native.value === binding.native.value;
  }

  return {
    async submit(binding, input): Promise<Outcome<DeliveryReceipt>> {
      const { native } = binding;
      if (native.harness !== HARNESS || native.kind !== "id") return fail("invalid", "only a Claude Code session id takes peer input here");
      if (!validInput(input)) return fail("invalid", "peer input needs an id, a sender and a body");
      if (!attached(binding)) {
        return fail("stale-binding", `session ${binding.key} is no longer attached at generation ${binding.attachment.generation}, so nothing was sent`);
      }
      const inbox = deps.inbox(native.value);
      if (!inbox) return fail("not-ready", `Claude session ${native.value} has no live inbox, so nothing was sent`);
      const content = wrapCrossSession(input.sender, input.body, input.id);
      const written = await deps.deliver(inbox.socketPath, content, { msgId: claudeTransportId(input.id) });
      // The writer settles before it writes or never writes at all, so a failure here sent nothing.
      if (!written.ok) return fail("transient", `the frame for ${input.id} was not written to Claude's inbox: ${written.error}`);
      return { ok: true, data: { id: input.id, evidence: "submitted", nativeId: native.value } };
    },
  };
}
