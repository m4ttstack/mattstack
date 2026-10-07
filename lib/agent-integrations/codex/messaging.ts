/**
 * Codex's peer messaging on Mattstack's own control connection, through the
 * experimental native queue. `thread/queue/add` starts an idle thread and
 * waits for the next boundary on a working one, so every delivery is
 * submitted the same way, at once; nothing interrupts or steers a turn.
 *
 * Evidence, from weakest to strongest (spike G7, harness-gate-spike-report):
 * - the queue's acknowledgement (`queuedSubmission` naming the same
 *   `clientUserMessageId`) is a `queued` receipt only; it says nothing about
 *   persistence or deduplication;
 * - an owned `item/started` user message whose `clientId` is exactly the
 *   logical id, on the submission's thread, while its attachment generation is
 *   still current, is `consumed`, with that turn and item.
 * Anything else, including a reply in an unrecognised shape, is not evidence.
 * Consumption is never completed work, and a duplicate echo keeps the first.
 *
 * Records live in memory for this connection only; after a reconnect there is
 * nothing to reconcile and a caller keeps its own uncertainty. A delivery
 * already consumed on this thread is answered with that receipt and never
 * queued again, whatever attachment asks.
 *
 * Thread ownership is the session adapter's: messaging asks it to adopt the
 * submission's thread, so a thread the sessions released is not taken back.
 */

import type {
  DeliveryReceipt, FaultCode, Outcome, PeerInput, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { wrapCrossSession } from "../../daemon/inbox.ts";
import { getStateDb } from "../../state/db.ts";
import type { MessageAdapter } from "../contracts.ts";
import { createSessionStore, isDetachedAttachment, type SessionStore } from "../session-store.ts";
import { CodexControlError, type CodexControl } from "./control.ts";
import { codexEventHub } from "./events.ts";
import { isRecord, type CodexEvent } from "./protocol.ts";

const HARNESS = "codex";
/** Submissions remembered per connection; the oldest settled ones go first. */
const KEPT_SUBMISSIONS = 1000;

export type CodexMessagingDeps = {
  /** The store's binding for this key now: an echo counts only while the submission's attachment is still the current one. */
  currentBinding(key: string): SessionBinding | null;
  /**
   * Takes ownership of the binding's thread on this connection, so its
   * events arrive. The loader routes it through the session adapter; on its
   * own, messaging adopts the thread directly.
   */
  adopt(binding: SessionBinding): Outcome<void>;
};

type Evidence = "pending" | "ambiguous" | "failed" | "queued" | "consumed";
type Submission = {
  id: string; sessionKey: string; generation: number; threadId: string; evidence: Evidence;
  turnId?: string; itemId?: string;
  /** An earlier attachment's attempt on this thread may still echo the same id, so no echo can be told apart. */
  contested: boolean;
};

const fail = <T>(code: FaultCode, message: string): Outcome<T> => ({ ok: false, error: { code, message } });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function defaultDeps(control: CodexControl): CodexMessagingDeps {
  let store: SessionStore | undefined;
  return {
    currentBinding: (key) => (store ??= createSessionStore(getStateDb())).get(key),
    adopt: (binding) => {
      control.adopt(binding.native.value);
      return { ok: true, data: undefined };
    },
  };
}

function acknowledged(result: unknown, id: string): boolean {
  if (!isRecord(result) || !isRecord(result.queuedSubmission)) return false;
  const queued = result.queuedSubmission;
  return typeof queued.id === "string" && queued.id !== "" && queued.clientUserMessageId === id;
}

function validInput(input: PeerInput): boolean {
  return typeof input?.id === "string" && input.id !== "" && typeof input.body === "string" && typeof input.sender === "string";
}

export function createCodexMessaging(control: CodexControl, overrides: Partial<CodexMessagingDeps> = {}): MessageAdapter {
  const deps: CodexMessagingDeps = { ...defaultDeps(control), ...overrides };
  const submissions = new Map<string, Submission>();

  function checkRef(binding: SessionBinding): Outcome<string> {
    const { native } = binding;
    if (native.harness !== HARNESS || native.kind !== "id" || typeof native.value !== "string" || native.value === "") {
      return fail("invalid", "only a Codex thread id takes peer input here");
    }
    if (native.profile !== control.profile) {
      return fail("invalid", `thread ${native.value} belongs to Codex profile ${native.profile}, and this connection serves ${control.profile}`);
    }
    return { ok: true, data: native.value };
  }

  function isCurrent(key: string, generation: number, threadId: string): boolean {
    let now: SessionBinding | null;
    try {
      now = deps.currentBinding(key);
    } catch {
      return false;
    }
    return now !== null && !isDetachedAttachment(now) && now.attachment.generation === generation
      && now.native.harness === HARNESS && now.native.profile === control.profile && now.native.value === threadId;
  }

  function receipt(s: Submission): DeliveryReceipt {
    if (s.evidence !== "consumed") return { id: s.id, evidence: "queued", nativeId: s.threadId };
    return { id: s.id, evidence: "consumed", nativeId: s.threadId, turnId: s.turnId!, itemId: s.itemId! };
  }

  function remember(s: Submission): void {
    submissions.delete(s.id);
    submissions.set(s.id, s);
    for (const [id, old] of submissions) {
      if (submissions.size <= KEPT_SUBMISSIONS) return;
      if (old.evidence !== "pending") submissions.delete(id);
    }
  }

  function observe(event: CodexEvent): void {
    if (event.method !== "item/started" || event.item.type !== "userMessage" || event.connection !== control.connection) return;
    const clientId = event.item.clientId;
    if (clientId === null) return;
    const s = submissions.get(clientId);
    if (!s || s.contested || s.threadId !== event.threadId) return;
    if (s.evidence === "consumed" || s.evidence === "failed") return;
    if (!isCurrent(s.sessionKey, s.generation, s.threadId)) return;
    s.evidence = "consumed";
    s.turnId = event.turnId;
    s.itemId = event.item.id;
  }

  codexEventHub(control).listen(observe);

  return {
    connection: control.connection,
    async submit(binding, input): Promise<Outcome<DeliveryReceipt>> {
      const ref = checkRef(binding);
      if (!ref.ok) return ref;
      const threadId = ref.data;
      if (!validInput(input)) return fail("invalid", "peer input needs an id, a sender and a body");
      if (control.closed) return fail("not-ready", "the Codex control connection is closed, so nothing was sent");
      if (!control.experimental) {
        return fail("unsupported", "this Codex connection did not negotiate the experimental queue, so nothing was sent");
      }
      const generation = binding.attachment.generation;
      if (!isCurrent(binding.key, generation, threadId)) {
        return fail("stale-binding", `session ${binding.key} is no longer attached at generation ${generation}, so nothing was sent`);
      }

      const prior = submissions.get(input.id);
      if (prior?.evidence === "consumed" && prior.sessionKey === binding.key && prior.threadId === threadId) {
        return { ok: true, data: receipt(prior) };
      }
      const sameAttempt = prior !== undefined && prior.sessionKey === binding.key && prior.generation === generation && prior.threadId === threadId;
      if (sameAttempt && prior.evidence === "pending") {
        return fail("ambiguous", `delivery ${input.id} is still being submitted to thread ${threadId}`);
      }
      if (sameAttempt && (prior.evidence === "queued" || prior.evidence === "consumed")) return { ok: true, data: receipt(prior) };
      const contested = prior !== undefined && (sameAttempt ? prior.contested
        : prior.threadId === threadId && prior.evidence !== "failed");
      const owned = deps.adopt(binding);
      if (!owned.ok) return owned;
      const s: Submission = { id: input.id, sessionKey: binding.key, generation, threadId, evidence: "pending", contested };
      remember(s);

      let result: unknown;
      try {
        result = await control.request("thread/queue/add", {
          threadId, clientUserMessageId: input.id,
          input: [{ type: "text", text: wrapCrossSession(input.sender, input.body, input.id) }],
        });
      } catch (err) {
        if (s.evidence === "consumed") return { ok: true, data: receipt(s) };
        if (err instanceof CodexControlError && (err.code === "refused" || err.code === "unsupported")) {
          s.evidence = "failed";
          return fail(err.code, `Codex did not queue delivery ${input.id}: ${messageOf(err)}`);
        }
        s.evidence = "ambiguous";
        return fail("ambiguous", `Codex may have queued delivery ${input.id} on thread ${threadId}: ${messageOf(err)}`);
      }
      if (s.evidence === "consumed") return { ok: true, data: receipt(s) };
      if (!acknowledged(result, input.id)) {
        s.evidence = "ambiguous";
        return fail("ambiguous", `Codex answered thread/queue/add for delivery ${input.id} in a form rt does not recognise`);
      }
      s.evidence = "queued";
      return { ok: true, data: receipt(s) };
    },

    async reconcile(binding, inputId): Promise<Outcome<DeliveryReceipt | null>> {
      const ref = checkRef(binding);
      if (!ref.ok) return ref;
      const s = submissions.get(inputId);
      if (!s || s.sessionKey !== binding.key || s.threadId !== ref.data) return { ok: true, data: null };
      if (s.generation !== binding.attachment.generation) {
        return fail("stale-binding", `delivery ${inputId} was submitted under attachment generation ${s.generation}, not ${binding.attachment.generation}`);
      }
      return { ok: true, data: s.evidence === "queued" || s.evidence === "consumed" ? receipt(s) : null };
    },
  };
}
