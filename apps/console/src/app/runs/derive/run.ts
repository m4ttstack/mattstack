import type {
  RunDecisionRow,
  RunFieldRow,
  RunStageRow,
} from '@mattstack/rt-client';

export type FieldKind =
  'cleared' | 'url' | 'sha-list' | 'json' | 'gate-ref' | 'path' | 'text';

const GATE_REF_KEYS = new Set(['waiting-gate', 'gate']);

/** One file path with at least one folder and an extension, nothing else. */
const FILE_PATH = /^\/?[\w.@-]+(\/[\w.@-]+)*\/[\w@-][\w.@-]*\.\w+$/;

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
  if (FILE_PATH.test(v)) return 'path';
  return 'text';
}

const HOLD_SCOPE = /^hold:([^:]+):(\d+)$/;

/** A hold ends at the first sign the run moved on: the hold field cleared
 * (rt keeps only its latest value), the held attempt ending, or the stage's
 * next attempt starting. A hold can be lifted inside the same attempt. */
export function heldSpans(
  stages: RunStageRow[],
  decisions: RunDecisionRow[],
  fields: RunFieldRow[] = []
) {
  const holdField = fields.find(f => f.key === 'hold');
  const clearedAt =
    holdField && fieldKind('hold', holdField.value) === 'cleared'
      ? holdField.at
      : null;
  const spans: { stage: string; from: number; to: number | null }[] = [];
  for (const d of decisions) {
    const m = HOLD_SCOPE.exec(d.scope);
    if (!m) continue;
    const [, stage, attempt] = m;
    const n = Number(attempt);
    const ends = [
      stages.find(s => s.name === stage && s.attempt === n)?.ended_at,
      stages.find(s => s.name === stage && s.attempt === n + 1)?.started_at,
      clearedAt,
    ].filter((t): t is number => t != null && t >= d.decided_at);
    spans.push({
      stage: stage!,
      from: d.decided_at,
      to: ends.length > 0 ? Math.min(...ends) : null,
    });
  }
  return spans;
}
