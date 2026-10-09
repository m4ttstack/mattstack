/**
 * What the daemon heard from Codex policy hooks: one receipt per hook run of
 * a bound thread, naming its session, turn, event, manifest revision and
 * the verdict the hook gave. Receipts are evidence that the installed hook
 * runs, never a decision: nothing here changes a gate, a run or a binding.
 *
 * Anything on the machine can send a receipt (rt.sock does not say who
 * calls), including a model running `rt agent policy-hook` from its own
 * shell. So a receipt alone proves nothing. Proof is a diagnostic nonce,
 * issued in-process by whoever starts a diagnostic turn for the turn id
 * Codex returned to it, and it is attached only once the live connection
 * has also seen Codex's own `hook/completed` for that thread, turn and
 * event, from a project command hook, with a status that agrees with the
 * receipt's verdict. Each native run confirms one receipt. Until then, and
 * forever if no such run arrives, the receipt is not diagnostic.
 *
 * The turn a receipt names is recorded against the live turn (`current`,
 * `other`, `unknown`), and whether the hook process's own CODEX_THREAD_ID
 * agreed with it. Neither ever weakens the hook's decision, which keys on
 * the exact session binding; a proof requires `current` and an agreeing
 * thread. Held in memory only.
 */

import { randomUUID } from "crypto";
import type { CallerContext, NativeSessionRef, Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import {
  CODEX_POLICY_EVENTS, MAX_ID_LENGTH, MAX_PATH_LENGTH, plainText, validInstallationId, type CodexPolicyEvent,
} from "./hook-manifest.ts";

export type CodexHookVerdict = Commands["agent:policy-receipt"]["payload"]["verdict"];
/** Whether the turn a hook named is the one the live connection runs for its thread. */
export type CodexTurnMatch = Commands["agent:policy-receipt"]["data"]["turn"];
export type CodexThreadEnv = NonNullable<Commands["agent:policy-receipt"]["payload"]["threadEnv"]>;

export type CodexPolicyReceipt = {
  sessionKey: string; generation: number; threadId: string; turnId: string;
  event: CodexPolicyEvent; tool?: string; verdict: CodexHookVerdict;
  installation: string; revision: string; turn: CodexTurnMatch; threadEnv: CodexThreadEnv;
  /** Set only once a native hook run confirmed this receipt in an issued diagnostic turn. */
  nonce?: string;
  /** The native hook run that confirmed it. */
  hookRun?: string;
  at: number;
};
export type CodexReceiptInput = Omit<CodexPolicyReceipt, "nonce" | "hookRun" | "at">;

/** What `hook/completed` said about one native hook run. */
export type CodexHookRun = {
  threadId: string; turnId: string | null; id: string; eventName: string; status: string;
  sourcePath?: string; source?: string; handlerType?: string;
};

export interface CodexPolicyReceipts {
  issueDiagnostic(sessionKey: string, generation: number, turnId: string): string;
  record(input: CodexReceiptInput): CodexPolicyReceipt;
  /** A native `hook/completed` the live connection saw. */
  observe(run: CodexHookRun): void;
  list(sessionKey: string, generation: number): CodexPolicyReceipt[];
}

/** Enough for a launch's diagnostic turn and the turns after it; older receipts prove nothing new. */
const KEPT_PER_SESSION = 32;
const SESSIONS_KEPT = 256;
const RUNS_KEPT = 64;

const NATIVE_EVENT: Record<CodexPolicyEvent, string> = { PreToolUse: "preToolUse", Stop: "stop" };
/** A hook that blocked shows as `blocked`; one that let the call or the stop through, as `completed`. */
const BLOCKING: ReadonlySet<CodexHookVerdict> = new Set(["refused", "continue"]);

/**
 * Whether a native run is the installed hook producing this receipt. Codex's
 * run summary names its definition by source file and kind, not by command,
 * so the run must come from a project `.codex/hooks.json` command hook.
 */
function confirms(run: CodexHookRun, receipt: CodexPolicyReceipt): boolean {
  if (run.threadId !== receipt.threadId || run.turnId !== receipt.turnId) return false;
  if (run.eventName !== NATIVE_EVENT[receipt.event]) return false;
  if (run.status !== (BLOCKING.has(receipt.verdict) ? "blocked" : "completed")) return false;
  if (run.source !== undefined && run.source !== "project") return false;
  if (run.handlerType !== undefined && run.handlerType !== "command") return false;
  return typeof run.sourcePath === "string" && run.sourcePath.endsWith("/.codex/hooks.json");
}

export function createCodexPolicyReceipts(now: () => number = Date.now): CodexPolicyReceipts {
  const receipts = new Map<string, CodexPolicyReceipt[]>();
  const diagnostics = new Map<string, { generation: number; turnId: string; nonce: string }>();
  /** Runs no receipt has claimed yet, newest last; a run used once is gone. */
  const runs: CodexHookRun[] = [];

  /** A receipt waits for a run only while it sits in its session's issued diagnostic turn and its thread agreed. */
  function nonceFor(receipt: CodexPolicyReceipt): string | undefined {
    const issued = diagnostics.get(receipt.sessionKey);
    if (!issued || issued.generation !== receipt.generation || issued.turnId !== receipt.turnId) return undefined;
    if (receipt.turn !== "current" || receipt.threadEnv === "other") return undefined;
    return issued.nonce;
  }

  function claim(receipt: CodexPolicyReceipt, run: CodexHookRun): boolean {
    const nonce = nonceFor(receipt);
    if (nonce === undefined || receipt.nonce !== undefined || !confirms(run, receipt)) return false;
    receipt.nonce = nonce;
    receipt.hookRun = run.id;
    return true;
  }

  return {
    issueDiagnostic(sessionKey, generation, turnId) {
      const nonce = randomUUID();
      diagnostics.set(sessionKey, { generation, turnId, nonce });
      return nonce;
    },
    record(input) {
      const receipt: CodexPolicyReceipt = { ...input, at: now() };
      const waiting = runs.findIndex((run) => claim(receipt, run));
      if (waiting >= 0) runs.splice(waiting, 1);
      const held = receipts.get(input.sessionKey) ?? [];
      receipts.delete(input.sessionKey);
      receipts.set(input.sessionKey, [...held, receipt].slice(-KEPT_PER_SESSION));
      for (const key of receipts.keys()) {
        if (receipts.size <= SESSIONS_KEPT) break;
        receipts.delete(key);
        diagnostics.delete(key);
      }
      return receipt;
    },
    observe(run) {
      for (const held of receipts.values()) {
        if (held.some((receipt) => claim(receipt, run))) return;
      }
      runs.push(run);
      if (runs.length > RUNS_KEPT) runs.shift();
    },
    list(sessionKey, generation) {
      return (receipts.get(sessionKey) ?? []).filter((r) => r.generation === generation).map((r) => ({ ...r }));
    },
  };
}

let shared: CodexPolicyReceipts | undefined;

/** The daemon's one store; a CLI process never holds receipts. */
export function codexPolicyReceipts(): CodexPolicyReceipts {
  return (shared ??= createCodexPolicyReceipts());
}

/** Feeds the shared store from a live connection's events; only `hook/completed` with a turn is kept. */
export function observeCodexHookEvent(
  event: { method: string; threadId: string; turnId?: string | null; run?: Omit<CodexHookRun, "threadId" | "turnId"> },
  store: CodexPolicyReceipts = codexPolicyReceipts(),
): void {
  if (event.method !== "hook/completed" || !event.run || typeof event.turnId !== "string") return;
  store.observe({ ...event.run, threadId: event.threadId, turnId: event.turnId });
}

// ─── Accepting a receipt (the daemon's agent:policy-receipt) ─────────────────

export type ReceiptPayload = Commands["agent:policy-receipt"]["payload"];
export type ReceiptAnswer = Commands["agent:policy-receipt"]["data"];

export type AttentionReason = "policy-unavailable" | "policy-escaped";

export type AcceptReceiptDeps = {
  enabled?: () => boolean;
  resolve?: (native: NativeSessionRef) => Outcome<CallerContext>;
  activeTurn?: (binding: SessionBinding) => string | undefined;
  store?: CodexPolicyReceipts;
  attention?: (context: CallerContext, action: "ask" | "stop", detail: string, reason: AttentionReason) => void;
};

const RECEIPT_FIELDS: ReadonlySet<string> = new Set([
  "installation", "revision", "profile", "event", "tool", "sessionId", "turnId", "threadEnv", "verdict", "detail",
]);
const VERDICTS: readonly string[] = ["allow", "refused", "continue", "unavailable", "escaped"];
const THREAD_ENVS: readonly string[] = ["same", "other", "absent"];
const REVISION = /^[0-9a-f]{64}$/;
const MAX_DETAIL = 2000;

function invalid<T>(message: string): Outcome<T> {
  return { ok: false, error: { code: "invalid", message } };
}

/** The payload's fields exactly, or why not; a field it does not know is refused, not ignored. */
export function checkReceiptPayload(raw: unknown): Outcome<ReceiptPayload> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return invalid("a receipt is an object");
  const p = raw as Record<string, unknown>;
  const extra = Object.keys(p).find((k) => !RECEIPT_FIELDS.has(k));
  if (extra !== undefined) return invalid(`a receipt has no ${extra} field`);
  if (!validInstallationId(p.installation)) return invalid("installation is not an installation id");
  if (typeof p.revision !== "string" || !REVISION.test(p.revision)) return invalid("revision is not a manifest revision");
  if (!plainText(p.profile, MAX_PATH_LENGTH)) return invalid("profile must be a non-empty string");
  if (!(CODEX_POLICY_EVENTS as readonly unknown[]).includes(p.event)) return invalid(`event must be one of ${CODEX_POLICY_EVENTS.join(", ")}`);
  if (p.tool !== undefined && !plainText(p.tool, MAX_ID_LENGTH)) return invalid("tool must be a short non-empty string when present");
  if (!plainText(p.sessionId, MAX_ID_LENGTH) || !plainText(p.turnId, MAX_ID_LENGTH)) return invalid("sessionId and turnId must be short non-empty strings");
  if (p.threadEnv !== undefined && !THREAD_ENVS.includes(p.threadEnv as string)) return invalid(`threadEnv must be one of ${THREAD_ENVS.join(", ")}`);
  if (!VERDICTS.includes(p.verdict as string)) return invalid(`verdict must be one of ${VERDICTS.join(", ")}`);
  if (p.detail !== undefined && !plainText(p.detail, MAX_DETAIL)) {
    return invalid(`detail must be plain text of at most ${MAX_DETAIL} characters`);
  }
  return { ok: true, data: p as ReceiptPayload };
}

async function withDefaults(deps: AcceptReceiptDeps): Promise<Required<AcceptReceiptDeps>> {
  const [{ resolveCallerContextNow }, { integrationsEnabled }, { codexActiveTurn }, { policyAttention }, { gateQuestionService }] = await Promise.all([
    import("../context.ts"), import("../switch.ts"), import("./link.ts"), import("../policy.ts"), import("../questions.ts"),
  ]);
  return {
    enabled: deps.enabled ?? integrationsEnabled,
    resolve: deps.resolve ?? ((native) => resolveCallerContextNow({ native })),
    activeTurn: deps.activeTurn ?? codexActiveTurn,
    store: deps.store ?? codexPolicyReceipts(),
    attention: deps.attention ?? ((context, action, detail, reason) => policyAttention(gateQuestionService(), context, action, detail, reason)),
  };
}

/**
 * Records a hook's receipt against the binding the daemon itself resolves
 * from the exact thread id and profile, never a key the caller names. A
 * thread no attached binding holds records nothing. `diagnostic` is true
 * only when a native run already confirmed it; a confirmation that arrives
 * later shows in the store's list, not in this answer.
 */
export async function acceptCodexPolicyReceipt(raw: unknown, overrides: AcceptReceiptDeps = {}): Promise<Outcome<ReceiptAnswer>> {
  const checked = checkReceiptPayload(raw);
  if (!checked.ok) return checked;
  const p = checked.data;
  const deps = await withDefaults(overrides);
  if (!deps.enabled()) return { ok: false, error: { code: "unsupported", message: "agent integrations are switched off on this Mac" } };
  const context = deps.resolve({ harness: "codex", profile: p.profile, kind: "id", value: p.sessionId });
  if (!context.ok) return context;
  const { binding } = context.data;
  const active = deps.activeTurn(binding);
  const turn: CodexTurnMatch = active === undefined ? "unknown" : active === p.turnId ? "current" : "other";
  const receipt = deps.store.record({
    sessionKey: binding.key, generation: binding.attachment.generation, threadId: p.sessionId, turnId: p.turnId,
    event: p.event, ...(p.tool !== undefined && { tool: p.tool }), verdict: p.verdict,
    installation: p.installation, revision: p.revision, turn, threadEnv: p.threadEnv ?? "absent",
  });
  const action = p.event === "Stop" ? "stop" : "ask";
  if (p.verdict === "unavailable") deps.attention(context.data, action, p.detail ?? "the session's workflow policy could not decide", "policy-unavailable");
  if (p.verdict === "escaped") deps.attention(context.data, action, p.detail ?? "a stop was let through after repeated continuations", "policy-escaped");
  return { ok: true, data: { turn, diagnostic: receipt.nonce !== undefined } };
}
