import { suffixOf, type SkillsComposition } from '../../outline';
import type { SkillsChanges } from '../../useWiring';
import { stepLabel } from './focusModel';

export type PendingChange = {
  key: string;
  name: string;
  detail: string | null;
};

/** Where rt writes a binding and a surface change, pack-relative. */
const BINDINGS_FILE = 'pack/skills.jsonc';
const SURFACE_FILES = new Set(['pack/surface.jsonc', 'surface.jsonc']);
/** rt compiles a public skill under `skills/<name>` and an internal one
    under `attachments/<name>`, so a surface change moves it between them. */
const OUTPUT_ROOTS = ['skills', 'attachments'];

const FILE_STATUS: Record<string, string> = {
  M: 'edited',
  A: 'added',
  '??': 'added',
  D: 'deleted',
};

const fillName = (binding: string | null) =>
  binding === null ? 'nothing' : suffixOf(binding);

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'));

/**
 * The compiled output directories, pack-relative, that the reported changes
 * rebuild. A binding change rebuilds the skill its binder belongs to. A
 * surface change moves its skill between its two output directories and
 * rebuilds every skill that links to it by path. Empty until the
 * composition has loaded, so nothing is hidden on a guess.
 */
function rebuiltDirsOf(
  changes: SkillsChanges,
  composition: SkillsComposition | undefined
): string[] {
  if (!composition) return [];
  const root = `${composition.packDir}/`;
  const targets = composition.targets ?? [];
  const rebuilt = new Set<string>();
  const dirs: string[] = [];

  for (const change of changes.bindings)
    for (const binder of composition.binders ?? [])
      if (binder.ref === change.engineRef)
        rebuilt.add(binder.verb ?? suffixOf(binder.ref));

  for (const change of changes.surface) {
    for (const outputRoot of OUTPUT_ROOTS)
      dirs.push(`${outputRoot}/${change.skill}`);
    for (const target of targets)
      if (
        target.placeholders.some(
          p => p.kind === 'verb.path' && p.arg === change.skill
        )
      )
        rebuilt.add(target.name);
  }

  for (const target of targets)
    if (rebuilt.has(target.name) && target.artifactPath.startsWith(root))
      dirs.push(dirOf(target.artifactPath.slice(root.length)));

  return dirs;
}

/**
 * What the pack would share on a sync, as a person reads it: each binding
 * and surface change by the skill it changes, then every other pending file
 * in the pack by its path. A file is left out only when a reported change
 * accounts for it: the bindings or surface file it was read from, or the
 * compiled output of a skill it rebuilt. rt reads only the bindings and the
 * public list from those two files, so another edit inside one of them
 * rides along with the change it sits beside rather than on a line of its
 * own.
 */
export function pendingChangesOf(
  changes: SkillsChanges,
  composition: SkillsComposition | undefined
): PendingChange[] {
  const named: PendingChange[] = [
    ...changes.bindings.map(change => ({
      key: `binding:${change.engineRef}:${change.slot}`,
      name: stepLabel(suffixOf(change.engineRef)),
      detail: `${change.slot} slot: ${fillName(change.from)} → ${fillName(change.to)}`,
    })),
    ...changes.surface.map(change => ({
      key: `surface:${change.skill}`,
      name: change.skill,
      detail: `${change.from} → ${change.to}`,
    })),
  ];
  const rebuilt = rebuiltDirsOf(changes, composition);
  const explained = (path: string) =>
    (changes.bindings.length > 0 && path === BINDINGS_FILE) ||
    (changes.surface.length > 0 && SURFACE_FILES.has(path)) ||
    rebuilt.some(dir => path.startsWith(`${dir}/`));

  return [
    ...named,
    ...changes.files
      .filter(file => !explained(file.path))
      .map(file => ({
        key: `file:${file.path}`,
        name: file.path,
        detail: file.from
          ? `renamed from ${file.from}`
          : (FILE_STATUS[file.status] ?? null),
      })),
  ];
}

/** Everything a sync or discard acts on, in a fixed order: the pending
    files in the pack and the binding and surface changes rt reads. */
function signatureOf(changes: SkillsChanges): string {
  const sorted = (rows: string[]) => [...rows].sort();
  return JSON.stringify([
    sorted(changes.files.map(f => `${f.status} ${f.from ?? ''} ${f.path}`)),
    sorted(
      changes.bindings.map(
        b => `${b.engineRef} ${b.slot} ${b.from ?? ''} ${b.to ?? ''}`
      )
    ),
    sorted(changes.surface.map(s => `${s.skill} ${s.from} ${s.to}`)),
  ]);
}

/** Whether two reads of the pack's changes describe the same pending work. */
export function sameChanges(a: SkillsChanges, b: SkillsChanges): boolean {
  return signatureOf(a) === signatureOf(b);
}
