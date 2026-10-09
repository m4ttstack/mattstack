import type { GateRow } from '@mattstack/rt-client';

import { isMine } from '../../../shared/gate-waiting';
import { formatClock } from './clock';

export type AnsweredBy =
  | { you: true; via: 'console' | 'pane' | 'board' }
  | { you: false; via: 'shepherd' };

export function answeredBy(g: GateRow): AnsweredBy | null {
  switch (g.answer?.by) {
    case 'console':
    case 'pane':
    case 'board':
      return { you: true, via: g.answer.by };
    case 'shepherd':
      return { you: false, via: 'shepherd' };
    default:
      return null;
  }
}

const SCHEMA_LABEL: Record<string, string> = {
  'findings@1': 'findings',
  'carryover@1': 'carried over',
  'skipped@1': 'skipped',
};

/** A context parsed as JSON: an object, an array, or null for prose,
    invalid JSON and scalars. */
function parseStructured(
  context: string | null | undefined
): Record<string, unknown> | unknown[] | null {
  if (!context) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(context);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  return parsed as Record<string, unknown> | unknown[];
}

function schemaOf(obj: Record<string, unknown>): string | null {
  const schema = obj['gate-ctx'] ?? obj['schema'];
  return typeof schema === 'string' ? schema : null;
}

/** The schema name a structured context declares (`findings@1`), or null for
    prose and for JSON that names none. */
export function contextSchema(
  context: string | null | undefined
): string | null {
  const parsed = parseStructured(context);
  return parsed && !Array.isArray(parsed) ? schemaOf(parsed) : null;
}

export function structuredContextSummary(
  context: string | null | undefined
): string | null {
  const parsed = parseStructured(context);
  if (!parsed) return null;
  if (Array.isArray(parsed)) return 'structured context';
  const schema = schemaOf(parsed);
  const label = schema ? SCHEMA_LABEL[schema] : undefined;
  if (!label) return 'structured context';
  const list = Object.values(parsed).find(Array.isArray);
  return `${list?.length ?? 0} ${label}`;
}

/** What a collapsed context says beside its label: the structured summary
    ("2 findings"), else its line count ("6 lines"). */
export function contextMeta(context: string): string {
  const summary = structuredContextSummary(context);
  if (summary) return summary;
  const lines = context.trimEnd().split('\n').length;
  return `${lines} ${lines === 1 ? 'line' : 'lines'}`;
}

/** A structured context as indented JSON; prose as it is. */
export function prettyContext(context: string): string {
  try {
    return JSON.stringify(JSON.parse(context), null, 2);
  } catch {
    return context;
  }
}

/** "you · 1:41 PM" or "shepherd · 1:41 PM"; the time alone when `by` is
    missing; null while the gate has no answer. */
export function answerStamp(g: GateRow): string | null {
  if (!g.answer) return null;
  const time = formatClock(g.answer.answeredAt);
  const by = answeredBy(g);
  if (!by) return time;
  return `${by.you ? 'you' : 'shepherd'} · ${time}`;
}

const SURFACE_LABEL = {
  console: 'Answered in the console',
  pane: 'Answered in the pane',
  board: 'Answered in the board',
  shepherd: 'Answered by a shepherd',
} as const;

/** Where the answer came from, for a tooltip; null when `by` is missing. */
export function answerSurface(g: GateRow): string | null {
  const by = answeredBy(g);
  return by ? SURFACE_LABEL[by.via] : null;
}

const RANGE_COUNT = /^\S+\.\.\S+\s+\((\d+)\)/;

export function countCommits(value: string | null): number {
  if (!value) return 0;
  const range = RANGE_COUNT.exec(value.trim());
  if (range) return Number(range[1]);
  return value.split(/[\s,]+/).filter(Boolean).length;
}

const SHA = /^[0-9a-f]{7,40}$/i;

/** The newest sha the `commits` field names, cut to seven characters: the
    range's end, the last of a list, or the single sha. */
export function headSha(value: string | null): string | null {
  if (!value) return null;
  const range = /^\S+\.\.(\S+)/.exec(value.trim());
  const candidate = range
    ? range[1]!
    : value
        .split(/[\s,]+/)
        .filter(Boolean)
        .at(-1);
  return candidate && SHA.test(candidate) ? candidate.slice(0, 7) : null;
}

export function myGateSpans(
  gates: GateRow[],
  now: number
): { from: number; to: number }[] {
  return gates
    .filter(isMine)
    .map(g => ({
      from: g.openedAt,
      to: g.answer?.answeredAt ?? g.closedAt ?? now,
    }))
    .filter(s => s.to > s.from);
}
