/**
 * What the daemon heard from Codex policy hooks: one receipt per hook run of
 * a bound thread, naming its session, turn, event, manifest revision and
 * the verdict the hook gave. Receipts are evidence that the installed hook
 * runs, never a decision: nothing here changes a gate, a run or a binding.
 *
 * A diagnostic nonce is issued in-process by whoever starts a diagnostic
 * turn, for the turn id Codex returned to it. A receipt carries that nonce
 * only when its own binding, generation and turn match the issue, so no
 * hook payload or model tool argument can mint one. Held in memory only.
 */

import { randomUUID } from "crypto";
import type { CallerContext, NativeSessionRef, Outcome, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import { CODEX_POLICY_EVENTS, validInstallationId, type CodexPolicyEvent } from "./hook-manifest.ts";

export type CodexHookVerdict = Commands["agent:policy-receipt"]["payload"]["verdict"];
/** Whether the turn a hook named is the one the live connection runs for its thread. */
export type CodexTurnMatch = Commands["agent:policy-receipt"]["data"]["turn"];

export type CodexPolicyReceipt = {
  sessionKey: string; generation: number; threadId: string; turnId: string;
  event: CodexPolicyEvent; tool?: string; verdict: CodexHookVerdict;
  installation: string; revision: string; turn: CodexTurnMatch; nonce?: string; at: number;
};
export type CodexReceiptInput = Omit<CodexPolicyReceipt, "nonce" | "at">;

export interface CodexPolicyReceipts {
  issueDiagnostic(sessionKey: string, generation: number, turnId: string): string;
  record(input: CodexReceiptInput): CodexPolicyReceipt;
  list(sessionKey: string, generation: number): CodexPolicyReceipt[];
}

/** Enough for a launch's diagnostic turn and the turns after it; older receipts prove nothing new. */
const KEPT_PER_SESSION = 32;
const SESSIONS_KEPT = 256;

export function createCodexPolicyReceipts(now: () => number = Date.now): CodexPolicyReceipts {
  const receipts = new Map<string, CodexPolicyReceipt[]>();
  const diagnostics = new Map<string, { generation: number; turnId: string; nonce: string }>();

  return {
    issueDiagnostic(sessionKey, generation, turnId) {
      const nonce = randomUUID();
      diagnostics.set(sessionKey, { generation, turnId, nonce });
      return nonce;
    },
    record(input) {
      const issued = diagnostics.get(input.sessionKey);
      const nonce = issued && issued.generation === input.generation && issued.turnId === input.turnId ? issued.nonce : undefined;
      const receipt: CodexPolicyReceipt = { ...input, ...(nonce !== undefined && { nonce }), at: now() };
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
    list(sessionKey, generation) {
      return (receipts.get(sessionKey) ?? []).filter((r) => r.generation === generation);
    },
  };
}

let shared: CodexPolicyReceipts | undefined;

/** The daemon's one store; a CLI process never holds receipts. */
export function codexPolicyReceipts(): CodexPolicyReceipts {
  return (shared ??= createCodexPolicyReceipts());
}

// ─── Accepting a receipt (the daemon's agent:policy-receipt) ─────────────────

export type ReceiptPayload = Commands["agent:policy-receipt"]["payload"];
export type ReceiptAnswer = Commands["agent:policy-receipt"]["data"];

export type AcceptReceiptDeps = {
  enabled?: () => boolean;
  resolve?: (native: NativeSessionRef) => Outcome<CallerContext>;
  activeTurn?: (binding: SessionBinding) => string | undefined;
  store?: CodexPolicyReceipts;
  attention?: (context: CallerContext, action: "ask" | "stop", detail: string) => void;
};

const RECEIPT_FIELDS: ReadonlySet<string> = new Set(["installation", "revision", "profile", "event", "tool", "sessionId", "turnId", "verdict", "detail"]);
const VERDICTS: readonly string[] = ["allow", "refused", "continue", "unavailable", "escaped"];
const REVISION = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_ID = 200;
const MAX_PATH = 4096;
const MAX_DETAIL = 2000;

const plain = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max && !CONTROL.test(v);

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
  if (!plain(p.profile, MAX_PATH)) return invalid("profile must be a non-empty string");
  if (!(CODEX_POLICY_EVENTS as readonly unknown[]).includes(p.event)) return invalid(`event must be one of ${CODEX_POLICY_EVENTS.join(", ")}`);
  if (p.tool !== undefined && !plain(p.tool, MAX_ID)) return invalid("tool must be a short non-empty string when present");
  if (!plain(p.sessionId, MAX_ID) || !plain(p.turnId, MAX_ID)) return invalid("sessionId and turnId must be short non-empty strings");
  if (!VERDICTS.includes(p.verdict as string)) return invalid(`verdict must be one of ${VERDICTS.join(", ")}`);
  if (p.detail !== undefined && (typeof p.detail !== "string" || p.detail.length > MAX_DETAIL)) {
    return invalid(`detail must be a string of at most ${MAX_DETAIL} characters`);
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
    attention: deps.attention ?? ((context, action, detail) => policyAttention(gateQuestionService(), context, action, detail)),
  };
}

/**
 * Records a hook's receipt against the binding the daemon itself resolves
 * from the exact thread id and profile, never a key the caller names. A
 * thread no attached binding holds records nothing.
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
    installation: p.installation, revision: p.revision, turn,
  });
  if (p.verdict === "unavailable") {
    deps.attention(context.data, p.event === "Stop" ? "stop" : "ask", p.detail ?? "the session's workflow policy could not decide");
  }
  return { ok: true, data: { turn, diagnostic: receipt.nonce !== undefined } };
}
