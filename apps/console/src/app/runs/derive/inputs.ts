import type { RunDecisionRow } from '@mattstack/rt-client';

import type {
  EffectiveInputsPayload,
  PackVersionRow,
} from '../../../server/effectiveInputs';
import { shortValue } from '../../config/chain';
import { formatClock } from './clock';
import { fieldLabel } from './fields';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The side card's two lines about what the run was told: its pack at the
    recorded sha and whether the source still matches, then how many
    settings and stage docs it read. */
export function inputsSummary(payload: EffectiveInputsPayload): {
  pack: string;
  counts: string;
} {
  const first = payload.packVersions?.[0];
  let pack: string;
  if (payload.packVersions === null) pack = 'pack version not recorded';
  else if (!first) pack = 'no pack recorded';
  else {
    const state =
      first.drifted === false
        ? 'in sync'
        : first.drifted
          ? 'source has moved'
          : 'pack not found here';
    pack = `${first.pack} pack ${first.recordedSha.slice(0, 7)} · ${state}`;
  }
  return {
    pack: payload.packDirty ? `${pack} · uncommitted` : pack,
    counts: `${plural(payload.config.length, 'setting')} · ${plural(payload.stages.length, 'stage doc')}`,
  };
}

/** A setting's value on one line: a string bare, anything else as JSON. */
export function settingValue(value: unknown): string {
  return typeof value === 'string' ? value : shortValue(value);
}

/** A pack's pill: whether today's source still matches the recorded sha. */
export function packState(pack: PackVersionRow): {
  label: string;
  tone: 'ok' | 'warn' | 'quiet';
} {
  if (pack.drifted === false) return { label: 'matches source', tone: 'ok' };
  if (pack.drifted === null)
    return { label: 'pack not found here', tone: 'quiet' };
  const n = pack.commitsSince;
  return {
    label:
      typeof n === 'number'
        ? `moved since · ${plural(n, 'commit')}`
        : 'moved since',
    tone: 'warn',
  };
}

const FRONTMATTER =
  /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/;

/** A compiled skill doc without its leading YAML block. */
export function stripFrontmatter(md: string): string {
  return md.replace(FRONTMATTER, '');
}

// A fenced block is matched first so a comment inside one is kept as text.
const FENCE_OR_COMMENT =
  /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$|^[ \t]*<!--[\s\S]*?-->[ \t]*(?:\r?\n|$)|<!--[\s\S]*?-->/gm;

/** Markdown without its HTML comments (a compile banner, part markers); a
    line holding only a comment goes whole. */
export function stripComments(md: string): string {
  return md.replace(FENCE_OR_COMMENT, (match, fence?: string) =>
    fence ? match : ''
  );
}

/** What a stage doc shows: no comments and no frontmatter. */
export function stageDocBody(md: string): string {
  return stripFrontmatter(stripComments(md).replace(/^\s+/, ''));
}

const isList = (block: string) => /^\s*(?:[-*+]|\d+[.)])\s/.test(block);

/** What a stage doc's row shows before "Open the full doc": its first
    paragraph and its first list, headings left out. */
export function docPreview(md: string): string {
  const blocks = stageDocBody(md)
    .split(/\r?\n\s*\r?\n/)
    .map(b => b.trim())
    .filter(b => b && !b.startsWith('#'));
  const paragraph = blocks.find(b => !isList(b));
  const list = blocks.find(isList);
  return [paragraph, list].filter(Boolean).join('\n\n');
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function selectionWords(selection: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(selection);
  } catch {
    return selection;
  }
  if (typeof parsed === 'string') return capitalize(parsed);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return selection;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') parts.push(value);
    else if (typeof value === 'number')
      parts.push(`${value} ${value === 1 ? key.replace(/s$/, '') : key}`);
    else if (value === true) parts.push(key);
    else if (value !== false && value !== null)
      parts.push(`${key} ${JSON.stringify(value)}`);
  }
  return capitalize(parts.join(', '));
}

/** A decision in force as a sentence: what it decided, in words, and the
    stage, decider and time it was made. */
export function decisionSentence(row: RunDecisionRow): {
  label: string;
  value: string;
  meta: string;
} {
  const contract = row.contract.replace(/@\d+$/, '');
  const stage = row.scope.replace(/:.*$/, '');
  return {
    label: fieldLabel(contract),
    value: selectionWords(row.selection),
    meta: `${stage} · ${row.decided_by} · ${formatClock(row.decided_at)}`,
  };
}
