import type { RunDecisionRow, RunStageRow } from '@mattstack/rt-client';

export type FieldKind = 'cleared' | 'url' | 'sha-list' | 'json' | 'gate-ref' | 'text';

const GATE_REF_KEYS = new Set(['waiting-gate', 'gate']);

function isJson(v: string): boolean {
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
}

export function fieldKind(key: string, value: string): FieldKind {
  const v = value.trim();
  if (v === '' || v === '-') return 'cleared';
  if (/^https?:\/\/\S+$/.test(v)) return 'url';
  if (/^[0-9a-f]{7,40}(\s+[0-9a-f]{7,40})*$/i.test(v)) return 'sha-list';
  if (/^[[{]/.test(v) && isJson(v)) return 'json';
  if (GATE_REF_KEYS.has(key)) return 'gate-ref';
  return 'text';
}

const HOLD_SCOPE = /^hold:([^:]+):(\d+)$/;

export function heldSpans(stages: RunStageRow[], decisions: RunDecisionRow[]) {
  const spans: { stage: string; from: number; to: number | null }[] = [];
  for (const d of decisions) {
    const m = HOLD_SCOPE.exec(d.scope);
    if (!m) continue;
    const [, stage, attempt] = m;
    const next = stages.find(s => s.name === stage && s.attempt === Number(attempt) + 1);
    spans.push({ stage: stage!, from: d.decided_at, to: next?.started_at ?? null });
  }
  return spans;
}
