import { pluginOf, type SkillsCheck } from '../../outline';
import type { SkillsAnatomy } from '../../useWiring';
import type { FocusItem } from '../model/focusModel';
import {
  fileLabelOf,
  staleCause,
  type DriftCause,
} from '../model/templateModel';

type CheckRow = SkillsCheck['verbs'][number];
type AnatomySource = SkillsAnatomy['template'];

/** `unmeasured` is check having no row for the skill, which says nothing
    about its files. */
export type FileStatus =
  'unchanged' | 'current' | 'changed' | 'not built' | 'unmeasured';

export type BuiltFromRow = {
  path: string;
  /** The folder that names the file: `gate-protocol`. */
  name: string;
  file: string;
  kind: 'template' | 'partial' | 'pack text';
  /** Owner and version the skill was built with; null when never built. */
  builtWith: string | null;
  installed: string;
  status: FileStatus;
};

export type StaleStep = {
  skill: string;
  focus: string;
  /** What changed, in words; null for an rt that names no cause. */
  reason: string | null;
};

const CHANGED: Record<DriftCause, string> = {
  source: 'template changed',
  include: 'a pasted file changed',
  fill: 'pack text changed',
  frontmatter: 'header changed',
  structure: 'files changed',
  vendored: 'files changed',
};

function rowOf(
  source: AnatomySource,
  kind: BuiltFromRow['kind'],
  status: FileStatus
): BuiltFromRow {
  const file = fileLabelOf(source.path);
  return {
    path: source.path,
    name: file.split('/')[0] ?? file,
    file,
    kind,
    builtWith:
      source.builtVersion === null
        ? null
        : `${pluginOf(source.ref)} ${source.builtVersion}`,
    installed: source.version,
    status,
  };
}

/**
 * The template and each file pasted into it, with the version the skill was
 * built with and the one installed now. Whether a file changed is check's
 * answer, never a comparison of the two versions: a file built with an older
 * stamp whose content never changed is `unchanged`.
 */
export function builtFrom(
  anatomy: SkillsAnatomy,
  row: CheckRow | undefined
): BuiltFromRow[] {
  const stale = row?.status === 'stale';
  const causes = row?.staleBecause ?? anatomy.staleBecause;
  const statusOf = (source: AnatomySource, changed: boolean): FileStatus => {
    if (!row) return 'unmeasured';
    if (row.status === 'never-compiled' || source.builtVersion === null)
      return 'not built';
    if (stale && changed) return 'changed';
    return source.builtVersion === source.version ? 'current' : 'unchanged';
  };

  const rows = [
    rowOf(
      anatomy.template,
      'template',
      statusOf(anatomy.template, causes.includes('source'))
    ),
  ];
  const seen = new Set([anatomy.template.path]);
  for (const part of anatomy.parts) {
    const { source } = part;
    if ((part.kind !== 'include' && part.kind !== 'slot') || !source) continue;
    if (seen.has(source.path)) continue;
    seen.add(source.path);
    const kind =
      part.kind === 'slot' && pluginOf(source.ref) === anatomy.pack
        ? 'pack text'
        : 'partial';
    rows.push(rowOf(source, kind, statusOf(source, part.changed)));
  }
  return rows;
}

/** The plain answer to an old version stamp on a skill check calls in sync;
    null whenever the stamp needs no explaining. */
export function stampNote(
  rows: BuiltFromRow[],
  row: CheckRow | undefined
): string | null {
  const template = rows[0];
  if (row?.status !== 'in-sync' || template?.status !== 'unchanged')
    return null;
  return `Its version stamp says ${template.builtWith}, but none of these files changed since. The text the agent reads is current; a rebuild would only update the stamp.`;
}

/** The pipeline's other steps check calls stale, in run order. */
export function staleSteps(
  pipeline: FocusItem,
  check: SkillsCheck | undefined,
  current: string
): StaleStep[] {
  const rows = new Map((check?.verbs ?? []).map(row => [row.name, row]));
  return pipeline.children.flatMap(step => {
    const row = rows.get(step.skill);
    if (step.skill === current || row?.status !== 'stale') return [];
    const cause = staleCause(row.staleBecause);
    return [
      {
        skill: step.skill,
        focus: step.key,
        reason: cause ? CHANGED[cause] : null,
      },
    ];
  });
}
