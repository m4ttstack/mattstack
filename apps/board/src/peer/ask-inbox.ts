import type { AskKind, NudgeResult } from './envelope.ts';
import type { NudgeState } from './nudges.ts';

export const ASK_HISTORY_MS = 14 * 24 * 60 * 60_000;

export interface AskView {
  id: string;
  from: string;
  kind: AskKind;
  mrUrl: string;
  iid: number;
  title?: string;
  sourceBranch?: string;
  note?: string;
  receivedAt: number;
  handled?: {
    at: number;
    result: NudgeResult;
    reason?: string;
    note?: string;
    declined?: true;
  };
}

function view(n: NudgeState): AskView {
  return {
    id: n.id,
    from: n.from,
    kind: n.kind ?? 're-review',
    mrUrl: n.mrUrl,
    iid: n.iid,
    receivedAt: n.receivedAt,
    ...(n.title ? { title: n.title } : {}),
    ...(n.sourceBranch ? { sourceBranch: n.sourceBranch } : {}),
    ...(n.note ? { note: n.note } : {}),
    ...(n.handled ? { handled: n.handled } : {}),
  };
}

export function buildAskInbox(
  nudges: NudgeState[],
  now: number
): { pending: AskView[]; history: AskView[] } {
  const pending = nudges
    .filter(n => !n.handled)
    .sort((a, b) => a.receivedAt - b.receivedAt)
    .map(view);
  const history = nudges
    .filter(n => n.handled && now - n.handled.at <= ASK_HISTORY_MS)
    .sort((a, b) => b.handled!.at - a.handled!.at)
    .map(view);
  return { pending, history };
}
