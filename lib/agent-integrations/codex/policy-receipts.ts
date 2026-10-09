/**
 * What the daemon heard from Codex policy hooks: one receipt per hook run of
 * a bound thread, naming its session, turn, event, manifest revision and
 * the verdict the hook gave. Receipts are evidence that the installed hook
 * runs, never a decision: nothing here changes a gate, a run or a binding.
 *
 * Anything on the machine can send a receipt (rt.sock does not say who
 * calls), including a model running `rt agent policy-hook` from its own
 * shell, and that shell call fires rt's real PreToolUse hook too. So a
 * receipt alone proves nothing, and neither does a receipt next to a native
 * run. Proof is a diagnostic nonce for one controller-issued turn, named by
 * the turn id Codex returned and the exact hooks file inspected for it. For
 * each event, that turn must hold exactly one receipt and exactly one native
 * `hook/completed` from that file, a project command hook whose status
 * agrees with the receipt's verdict. Any extra receipt, any extra or
 * unreceipted run, or an overflow leaves the event unproven. A model that
 * sabotages its own check turn can only make it unproven, never proven.
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
  /** Set only on the one receipt that proves its event in an issued diagnostic turn. */
  nonce?: string;
  /** The native hook run that proved it. */
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
  /** `sourcePath` is the hooks file the policy adapter inspected for this session; only its runs count. */
  issueDiagnostic(sessionKey: string, generation: number, turnId: string, sourcePath: string): string;
  record(input: CodexReceiptInput): CodexPolicyReceipt;
  /** A native `hook/completed` the live connection saw. */
  observe(run: CodexHookRun): void;
  list(sessionKey: string, generation: number): CodexPolicyReceipt[];
}

/** Enough for a launch's diagnostic turn and the turns after it; older receipts prove nothing new. */
const KEPT_PER_SESSION = 32;
const SESSIONS_KEPT = 256;
/** A clean check turn has one receipt and one run per event; past this many the turn is unproven anyway. */
const DIAGNOSTIC_EVIDENCE_KEPT = 16;

const NATIVE_EVENT: Record<CodexPolicyEvent, string> = { PreToolUse: "preToolUse", Stop: "stop" };
/** A hook that blocked shows as `blocked`; one that let the call or the stop through, as `completed`. */
const BLOCKING: ReadonlySet<CodexHookVerdict> = new Set(["refused", "continue"]);

type Diagnostic = {
  generation: number; turnId: string; sourcePath: string; nonce: string;
  receipts: CodexPolicyReceipt[]; runs: CodexHookRun[]; overflow: boolean;
};

/** Whether rt's own installed hook, and nothing else, produced this receipt's native run. */
function confirms(run: CodexHookRun, receipt: CodexPolicyReceipt, sourcePath: string): boolean {
  return run.threadId === receipt.threadId && run.turnId === receipt.turnId
    && run.eventName === NATIVE_EVENT[receipt.event]
    && run.status === (BLOCKING.has(receipt.verdict) ? "blocked" : "completed")
    && run.sourcePath === sourcePath && run.source === "project" && run.handlerType === "command"
    && receipt.turn === "current" && receipt.threadEnv !== "other";
}

/** The receipt each event's proof rests on, with its run; an event whose evidence is not exactly one-to-one is absent. */
function proofs(d: Diagnostic): Map<CodexPolicyReceipt, string> {
  const proven = new Map<CodexPolicyReceipt, string>();
  if (d.overflow) return proven;
  for (const event of CODEX_POLICY_EVENTS) {
    const receipts = d.receipts.filter((r) => r.event === event);
    const runs = d.runs.filter((r) => r.eventName === NATIVE_EVENT[event]);
    if (receipts.length !== 1 || runs.length !== 1) continue;
    if (confirms(runs[0]!, receipts[0]!, d.sourcePath)) proven.set(receipts[0]!, runs[0]!.id);
  }
  return proven;
}

export function createCodexPolicyReceipts(now: () => number = Date.now): CodexPolicyReceipts {
  const receipts = new Map<string, CodexPolicyReceipt[]>();
  const diagnostics = new Map<string, Diagnostic>();

  function hold<T>(d: Diagnostic, list: T[], item: T): void {
    if (list.length >= DIAGNOSTIC_EVIDENCE_KEPT) d.overflow = true;
    else list.push(item);
  }

  function shown(receipt: CodexPolicyReceipt, proven: Map<CodexPolicyReceipt, string>, nonce: string | undefined): CodexPolicyReceipt {
    const run = proven.get(receipt);
    return run === undefined || nonce === undefined ? { ...receipt } : { ...receipt, nonce, hookRun: run };
  }

  return {
    issueDiagnostic(sessionKey, generation, turnId, sourcePath) {
      const nonce = randomUUID();
      diagnostics.set(sessionKey, { generation, turnId, sourcePath, nonce, receipts: [], runs: [], overflow: false });
      return nonce;
    },
    record(input) {
      const receipt: CodexPolicyReceipt = { ...input, at: now() };
      const d = diagnostics.get(input.sessionKey);
      if (d && d.generation === input.generation && d.turnId === input.turnId) hold(d, d.receipts, receipt);
      const held = receipts.get(input.sessionKey) ?? [];
      receipts.delete(input.sessionKey);
      receipts.set(input.sessionKey, [...held, receipt].slice(-KEPT_PER_SESSION));
      for (const key of receipts.keys()) {
        if (receipts.size <= SESSIONS_KEPT) break;
        receipts.delete(key);
        diagnostics.delete(key);
      }
      return d ? shown(receipt, proofs(d), d.nonce) : { ...receipt };
    },
    observe(run) {
      for (const d of diagnostics.values()) {
        if (d.turnId === run.turnId && run.sourcePath === d.sourcePath) hold(d, d.runs, run);
      }
    },
    list(sessionKey, generation) {
      const d = diagnostics.get(sessionKey);
      const proven = d && d.generation === generation ? proofs(d) : new Map<CodexPolicyReceipt, string>();
      return (receipts.get(sessionKey) ?? []).filter((r) => r.generation === generation).map((r) => shown(r, proven, d?.nonce));
    },
  };
}

let shared: CodexPolicyReceipts | undefined;

/** The daemon's one store; a CLI process never holds receipts. */
export function codexPolicyReceipts(): CodexPolicyReceipts {
  return (shared ??= createCodexPolicyReceipts());
}

/** Feeds the shared store from a live connection's events; only `hook/completed` in an issued check turn is kept. */
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
