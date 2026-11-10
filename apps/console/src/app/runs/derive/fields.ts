import type { RunFieldRow } from '@mattstack/rt-client';

import type { StageAttempt } from './stages';

export const PLUMBING_KEYS: ReadonlySet<string> = new Set([
  'hold',
  'gate',
  'waiting-gate',
  'claude-session',
  'claude-sessions',
  'herdr-pane',
  'agent',
  'pipeline-stages',
]);

export const SIDE_KEYS: ReadonlySet<string> = new Set([
  'ticket',
  'branch',
  'worktree',
  'mr',
  'commits',
]);

/** `evidence-cleared:<board>` is the evidence step's own check that a board
    is safe to attach; nothing a person reads. */
function isPlumbing(key: string): boolean {
  return (
    PLUMBING_KEYS.has(key) ||
    key.startsWith('extra.') ||
    key.startsWith('evidence-cleared:')
  );
}

/** The boards the evidence step cleared for redaction, as one line a person
    reads, placed where the last one was cleared. */
function redactionField(fields: RunFieldRow[]): RunFieldRow | null {
  const cleared = fields.filter(
    f => f.key.startsWith('evidence-cleared:') && hasValue(f)
  );
  const last = cleared.reduce<RunFieldRow | null>(
    (latest, f) => (!latest || f.at > latest.at ? f : latest),
    null
  );
  if (!last) return null;
  const n = cleared.length;
  return {
    ...last,
    key: 'redaction',
    value: `${n} ${n === 1 ? 'board' : 'boards'} cleared`,
  };
}

/** A `-` or empty value is rt clearing the field: nothing to tell. */
const hasValue = (f: RunFieldRow) =>
  f.value.trim() !== '' && f.value.trim() !== '-';

export function storyFields(fields: RunFieldRow[]): RunFieldRow[] {
  const shown = fields.filter(
    f =>
      !isPlumbing(f.key) &&
      !SIDE_KEYS.has(f.key) &&
      f.key !== 'evidence' &&
      hasValue(f)
  );
  const redaction = redactionField(fields);
  return redaction ? [...shown, redaction] : shown;
}

const LABELS: Readonly<Record<string, string>> = {
  ci: 'CI',
  mr: 'MR',
  shiptarget: 'Ship target',
};

/** A field key as a row label: `evidence-plan` and `EvidencePlan` both read
    "Evidence plan". Keys in `LABELS` compare lowercased, separators dropped. */
export function fieldLabel(key: string): string {
  const known = LABELS[key.toLowerCase().replace(/[-_.\s]+/g, '')];
  if (known) return known;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A long path cut to its last three folders: `…/worktrees/acme-web/molly`. */
export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : path;
}

/** Where a file path a field names lives: as it is when absolute, else
    under the run's worktree; null when there is no worktree to read from. */
export function filePath(path: string, worktree: string | null): string | null {
  if (path.startsWith('/')) return path;
  return worktree ? `${worktree.replace(/\/+$/, '')}/${path}` : null;
}

export function placeFields(
  fields: RunFieldRow[],
  attempts: StageAttempt[]
): Map<string, RunFieldRow[]> {
  const started = attempts
    .filter(a => a.startedAt != null)
    .sort((a, b) => a.startedAt! - b.startedAt!);
  const placed = new Map<string, RunFieldRow[]>();
  for (const f of fields) {
    const i = started.findLastIndex(a => a.startedAt! <= f.at);
    if (i < 0) continue;
    const a = started[i]!;
    const key = `${a.stage}#${a.attempt}`;
    const list = placed.get(key);
    if (list) list.push(f);
    else placed.set(key, [f]);
  }
  return placed;
}
