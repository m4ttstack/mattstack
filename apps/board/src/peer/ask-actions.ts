import type { ReReviewLaunch } from '../review-launch.ts';
import type { ReviewState } from '../review-state.ts';
import type { TriageConfig } from '../triage/config.ts';
import { emptyMrMemory } from '../triage/memory.ts';
import { decideNudge, plainReason } from '../triage/nudge.ts';
import {
  DECLINE_REASONS,
  type AskKind,
  type DeclineReason,
  type NudgeOutcomePayload,
  type NudgeResult,
} from './envelope.ts';
import type { NudgeState } from './nudges.ts';

/** MRs with an accept in flight. The ask is only marked handled after the
    launch resolves, so a second click must be refused before the first await. */
const accepting = new Set<string>();

export interface AskActionDeps {
  asksOn(): boolean;
  readNudges(): NudgeState[];
  markNudgeHandled(
    id: string,
    result: NudgeResult,
    reason?: string,
    opts?: { note?: string; declined?: true }
  ): void;
  publishOutcome(to: string, p: NudgeOutcomePayload): void;
  readReviewStates(): Map<string, ReviewState>;
  readRespondStates(): Map<string, { status: string }>;
  isOwnMr(mrUrl: string): boolean;
  launchAsk(mrUrl: string, iid: number, kind: AskKind): Promise<ReReviewLaunch>;
  cfg: TriageConfig;
  now(): number;
}

type Fail<S extends number> = { ok: false; status: S; message: string };

function find(id: string, deps: AskActionDeps): NudgeState | Fail<404 | 409> {
  const n = deps.readNudges().find(x => x.id === id);
  if (!n) return { ok: false, status: 404, message: 'That ask is gone' };
  if (n.handled)
    return { ok: false, status: 409, message: 'That ask was already answered' };
  return n;
}

function outcome(
  n: NudgeState,
  result: NudgeResult,
  extra: Partial<NudgeOutcomePayload> = {}
): NudgeOutcomePayload {
  return { mrUrl: n.mrUrl, iid: n.iid, nudgeId: n.id, result, ...extra };
}

export async function acceptAsk(
  id: string,
  deps: AskActionDeps
): Promise<{ ok: true } | Fail<404 | 409 | 502>> {
  const n = find(id, deps);
  if ('ok' in n) return n;
  if (!deps.asksOn())
    return {
      ok: false,
      status: 409,
      message: plainReason('asks-off', deps.cfg),
    };
  const kind: AskKind = n.kind ?? 're-review';
  if (accepting.has(n.mrUrl))
    return {
      ok: false,
      status: 409,
      message: plainReason(
        kind === 'respond' ? 'respond-in-flight' : 'review-in-flight',
        deps.cfg
      ),
    };
  accepting.add(n.mrUrl);
  try {
    return await accept(n, kind, deps);
  } finally {
    accepting.delete(n.mrUrl);
  }
}

async function accept(
  n: NudgeState,
  kind: AskKind,
  deps: AskActionDeps
): Promise<{ ok: true } | Fail<409 | 502>> {
  const now = deps.now();
  // A person's go-ahead outranks the automatic limits, not the guards.
  const cfg = {
    ...deps.cfg,
    enabled: true,
    dailyAttemptBudget: Number.POSITIVE_INFINITY,
    cooldownMinutes: 0,
  };
  const decision = decideNudge(
    n,
    deps.readReviewStates().get(n.mrUrl),
    emptyMrMemory(new Date(now).toISOString().slice(0, 10)),
    cfg,
    now,
    deps.readRespondStates().get(n.mrUrl),
    deps.isOwnMr(n.mrUrl)
  );
  if (decision.action === 'expire' || decision.action === 'reject') {
    const result: NudgeResult =
      decision.action === 'expire' ? 'expired' : 'rejected';
    deps.markNudgeHandled(n.id, result, decision.reason);
    deps.publishOutcome(
      n.from,
      outcome(n, result, { reason: decision.reason })
    );
    return {
      ok: false,
      status: 409,
      message: plainReason(decision.reason, deps.cfg),
    };
  }
  const launch = await deps.launchAsk(n.mrUrl, n.iid, kind);
  if (launch.kind === 'error') {
    deps.markNudgeHandled(n.id, 'rejected', 'launch-failed');
    deps.publishOutcome(
      n.from,
      outcome(n, 'rejected', { reason: 'launch-failed' })
    );
    return { ok: false, status: 502, message: launch.message };
  }
  // Another answer may have landed while the launch was in flight.
  if (!deps.readNudges().find(x => x.id === n.id)?.handled) {
    deps.markNudgeHandled(n.id, 'launched', 'accepted');
    deps.publishOutcome(n.from, outcome(n, 'launched'));
  }
  return { ok: true };
}

export function declineAsk(
  id: string,
  input: { reason?: DeclineReason; note?: string },
  deps: AskActionDeps
): { ok: true } | Fail<404 | 409> {
  const n = find(id, deps);
  if ('ok' in n) return n;
  const words = input.reason ? DECLINE_REASONS[input.reason] : undefined;
  const note = input.note?.trim() || undefined;
  deps.markNudgeHandled(n.id, 'rejected', words, {
    declined: true,
    ...(note ? { note } : {}),
  });
  deps.publishOutcome(
    n.from,
    outcome(n, 'rejected', {
      ...(words ? { reason: words } : {}),
      declined: true,
      ...(note ? { declineNote: note } : {}),
    })
  );
  return { ok: true };
}

export function declineWhileOff(deps: AskActionDeps): number {
  let count = 0;
  for (const ask of deps.readNudges()) {
    if (ask.handled) continue;
    deps.markNudgeHandled(ask.id, 'rejected', 'asks-off');
    deps.publishOutcome(
      ask.from,
      outcome(ask, 'rejected', { reason: 'asks-off' })
    );
    count++;
  }
  return count;
}
