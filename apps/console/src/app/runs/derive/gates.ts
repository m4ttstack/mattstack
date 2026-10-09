import { optionLabel, optionValue, stripRecommended } from '@mattstack/gate-kit';
import type { GateAnswer, GateQuestion, GateRow, RunStageRow } from '@mattstack/rt-client';

export function decisionLogForRun(gates: GateRow[], runId: string): GateRow[] {
  const subject = `run:${runId}`;
  return gates.filter(g => g.subject === subject).sort((a, b) => a.openedAt - b.openedAt);
}

export function gateStage(gate: GateRow, stages: RunStageRow[]): string | null {
  const stamped = gate.meta?.stage;
  if (typeof stamped === 'string' && stamped) return stamped;
  let found: string | null = null;
  for (const s of stages) {
    if (s.started_at == null || s.started_at > gate.openedAt) continue;
    if (s.ended_at == null || gate.openedAt < s.ended_at) found = s.name;
  }
  return found;
}

function pickedValues(raw: GateAnswer['answers'][string] | undefined): string[] {
  if (raw == null) return [];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw;
  const v = raw.value;
  return Array.isArray(v) ? v : [v];
}

export function tookRecommendation(question: GateQuestion, answer: GateAnswer | null): boolean | null {
  const recommended = question.options
    .filter(o => stripRecommended(optionLabel(o)).recommended)
    .map(optionValue);
  if (!answer || recommended.length === 0) return null;
  const picked = pickedValues(answer.answers[question.id]);
  if (picked.length === 0) return null;
  return picked.every(p => recommended.includes(p));
}

export function waitingOnYou(gates: GateRow[], now: number): number {
  const spans = gates
    .map(g => [g.openedAt, g.answer?.answeredAt ?? g.closedAt ?? now] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of spans) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else { if (cur) total += cur[1] - cur[0]; cur = [a, b]; }
  }
  return cur ? total + cur[1] - cur[0] : total;
}
