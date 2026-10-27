import type { FocusItem } from '../../graph/model/focusModel';
import { fileLabelOf, staleReason } from '../../graph/model/templateModel';
import { type SkillsCheck } from '../../outline';
import { baseLabel, ownerOf, type Owner } from '../../owner';
import type { SkillsAnatomy } from '../../useWiring';

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
  kind: 'template' | 'engine' | 'partial' | 'pack text' | 'team values';
  /** Owner and version the skill was built with; null when never built. */
  builtWith: string | null;
  installed: string;
  status: FileStatus;
  owner: Owner;
  /** The Layers strip's colour for whoever owns the file. */
  layer: 'mattstack' | 'org' | 'team';
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
    layer:
      owner.kind === 'base'
        ? 'org'
        : (owner.kind === 'pack' ? pack : owner.name) === 'mattstack'
          ? 'mattstack'
          : 'team',
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
    if (part.kind === 'section' && source && !seen.has(source.path)) {
      seen.add(source.path);
      rows.push({
        ...rowOf(
          source,
          'team values',
          statusOf(source, part.changed),
          anatomy.pack
        ),
        name: part.name ?? source.path,
      });
      continue;
    }
    if ((part.kind !== 'include' && part.kind !== 'prop') || !source) continue;
    if (seen.has(source.path)) continue;
    seen.add(source.path);
    const kind =
      part.kind === 'prop' &&
      ownerOf(source.ref, source, anatomy.pack).kind === 'pack'
        ? 'pack text'
        : 'partial';
    rows.push(
      rowOf(source, kind, statusOf(source, part.changed), anatomy.pack)
    );
  }
  return rows;
}

/**
 * One block's share of the build: an engine row for the block's own text,
 * which the template's version covers, then the files its props paste in
 * (rt names those parts `<block id>.<prop>`).
 */
export function blockBuiltFrom(
  anatomy: SkillsAnatomy,
  row: CheckRow | undefined,
  block: { id: string; path: string }
): BuiltFromRow[] {
  const [template, ...props] = builtFrom(
    {
      ...anatomy,
      parts: anatomy.parts.filter(
        part => part.kind === 'prop' && part.name?.startsWith(`${block.id}.`)
      ),
    },
    row
  );
  const file = fileLabelOf(block.path);
  return [
    {
      ...template!,
      path: block.path,
      name: file.split('/')[0] ?? file,
      file,
      kind: 'engine',
    },
    ...props,
  ];
}

/** Whether a skill's copy of one block is current, in one plain sentence. */
export function blockNote(rows: BuiltFromRow[], skill: string): string {
  const changed = rows.filter(row => row.status === 'changed');
  if (changed.length > 0)
    return `${changed.map(row => row.file).join(', ')} changed after ${skill} was built, so this block is out of date until a sync rebuilds it.`;
  if (rows.some(row => row.status === 'not built'))
    return `${skill} has never been built, so it holds no copy of this block yet.`;
  if (rows.some(row => row.status === 'unmeasured'))
    return `rt skills check said nothing about ${skill}, so whether this block is current is unmeasured.`;
  return `None of these files changed since ${skill} was built, so this block is current.`;
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
    return [
      {
        skill: step.skill,
        focus: step.key,
        reason: staleReason(row.staleBecause, { its: false }),
      },
    ];
  });
}
