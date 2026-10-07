import { type SkillsCheck } from '../../outline';
import { baseLabel, ownerOf, type Owner } from '../../owner';
import type { SkillsAnatomy } from '../../useWiring';
import type { FocusItem } from '../model/focusModel';
import { fileLabelOf, staleReason } from '../model/templateModel';

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
  owner: Owner;
};

export type StaleStep = {
  skill: string;
  focus: string;
  /** What changed, in words; null for an rt that names no cause. */
  reason: string | null;
};

function rowOf(
  source: AnatomySource,
  kind: BuiltFromRow['kind'],
  status: FileStatus,
  pack: string
): BuiltFromRow {
  const file = fileLabelOf(source.path);
  const owner = ownerOf(source.ref, source, pack);
  const builtWith = (): string =>
    owner.kind === 'base'
      ? baseLabel(owner)
      : `${owner.kind === 'pack' ? pack : owner.name} ${source.builtVersion}`;
  return {
    path: source.path,
    name: file.split('/')[0] ?? file,
    file,
    kind,
    builtWith: source.builtVersion === null ? null : builtWith(),
    installed: owner.kind === 'base' ? 'org base' : source.version,
    status,
    owner,
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
    if (source.builtVersion === null) return 'not built';
    if (!row) return 'unmeasured';
    if (row.status === 'never-compiled') return 'not built';
    if (stale && changed) return 'changed';
    if (ownerOf(source.ref, source, anatomy.pack).kind === 'base')
      return 'unchanged';
    return source.builtVersion === source.version ? 'current' : 'unchanged';
  };

  const rows = [
    rowOf(
      anatomy.template,
      'template',
      statusOf(anatomy.template, causes.includes('source')),
      anatomy.pack
    ),
  ];
  const seen = new Set([anatomy.template.path]);
  for (const part of anatomy.parts) {
    const { source } = part;
    if ((part.kind !== 'include' && part.kind !== 'slot') || !source) continue;
    if (seen.has(source.path)) continue;
    seen.add(source.path);
    const kind =
      part.kind === 'slot' &&
      ownerOf(source.ref, source, anatomy.pack).kind === 'pack'
        ? 'pack text'
        : 'partial';
    rows.push(
      rowOf(source, kind, statusOf(source, part.changed), anatomy.pack)
    );
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

/** Whether the copy of one file in a skill is current, in a plain sentence
    named for that skill. */
export function fileNote(row: BuiltFromRow, skill: string): string {
  if (
    row.owner.kind === 'base' &&
    row.status !== 'not built' &&
    row.status !== 'unmeasured'
  )
    return `${skill} was built from the org's ${row.owner.name} base pack. rt check says whether it is current.`;
  switch (row.status) {
    case 'unchanged':
      return `This ${row.kind} has not changed since ${skill} was built with ${row.builtWith}, so the copy in ${skill} is current.`;
    case 'current':
      return `${skill} was built with the installed copy, ${row.builtWith}, so the copy in ${skill} is current.`;
    case 'changed':
      return `This ${row.kind} changed after ${skill} was built with ${row.builtWith}, so the copy in ${skill} is out of date until a sync rebuilds it.`;
    case 'not built':
      return `${skill} has never been built, so it holds no copy of this ${row.kind} yet.`;
    case 'unmeasured':
      return `rt skills check said nothing about ${skill}, so whether its copy of this ${row.kind} is current is unmeasured.`;
  }
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
    return [
      {
        skill: step.skill,
        focus: step.key,
        reason: staleReason(row.staleBecause, { its: false }),
      },
    ];
  });
}
