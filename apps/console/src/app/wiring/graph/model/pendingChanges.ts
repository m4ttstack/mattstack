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
    under `attachments/<name>`; a compile empties and rewrites that
    directory, and removes the compiled copy on the other side. */
const SIDE = { public: 'skills', internal: 'attachments' } as const;

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
 * The compiled output, pack-relative, that the reported changes rebuild:
 * `rebuilt` directories hold only compiled files, and in `removed`
 * directories only deletions are compiled output going away.
 *
 * A binding change rebuilds the skill its binder belongs to. A surface
 * change rebuilds every skill that links to the moved one by path, and,
 * when the moved skill is itself compiled, writes its output on the new
 * side and removes it from the old. Both sides come from the change, read
 * with the files; the composition can predate the move, so it only says
 * which skills are compiled. A hand-authored skill is moved as source, so
 * none of its files count. Empty until the composition has loaded, so
 * nothing is hidden on a guess.
 */
function compiledOutputOf(
  changes: SkillsChanges,
  composition: SkillsComposition | undefined
): { rebuilt: string[]; removed: string[] } {
  if (!composition) return { rebuilt: [], removed: [] };
  const root = `${composition.packDir}/`;
  const targets = (composition.targets ?? []).filter(target =>
    target.artifactPath.startsWith(root)
  );
  const outputOf = (target: (typeof targets)[number]) =>
    dirOf(target.artifactPath.slice(root.length));
  const names = new Set<string>();
  const moved = new Set<string>();
  const rebuilt: string[] = [];
  const removed: string[] = [];

  for (const change of changes.bindings)
    for (const binder of composition.binders ?? [])
      if (binder.ref === change.engineRef)
        names.add(binder.verb ?? suffixOf(binder.ref));

  for (const change of changes.surface) {
    for (const target of targets)
      if (
        target.placeholders.some(
          p => p.kind === 'verb.path' && p.arg === change.skill
        )
      )
        names.add(target.name);
    if (!targets.some(target => target.name === change.skill)) continue;
    moved.add(change.skill);
    rebuilt.push(`${SIDE[change.to]}/${change.skill}`);
    removed.push(`${SIDE[change.from]}/${change.skill}`);
  }

  for (const target of targets)
    if (names.has(target.name) && !moved.has(target.name))
      rebuilt.push(outputOf(target));

  return { rebuilt, removed };
}

/**
 * What the pack would share on a sync, as a person reads it: each binding
 * and surface change by the skill it changes, then every other pending file
 * in the pack by its path. A file is left out only when a reported change
 * accounts for it: the bindings or surface file it was read from, a file in
 * the output of a compiled skill it rebuilt, or the removal of a compiled
 * skill's old output after a surface move. A hand-authored skill's moved and
 * added files stay listed. rt reads only the bindings and the public list
 * from those two files, so another edit inside one of them rides along with
 * the change it sits beside rather than on a line of its own.
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
  const { rebuilt, removed } = compiledOutputOf(changes, composition);
  const within = (dirs: string[], path: string) =>
    dirs.some(dir => path.startsWith(`${dir}/`));
  const explained = ({ path, status }: SkillsChanges['files'][number]) =>
    (changes.bindings.length > 0 && path === BINDINGS_FILE) ||
    (changes.surface.length > 0 && SURFACE_FILES.has(path)) ||
    within(rebuilt, path) ||
    (status === 'D' && within(removed, path));

  return [
    ...named,
    ...changes.files
      .filter(file => !explained(file))
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

/** Whether two reads of the pack's changes describe the same pending work.
    Only rt's own signature sees a file's content, so a listed file edited
    again reads as a change too. */
export function sameChanges(a: SkillsChanges, b: SkillsChanges): boolean {
  return a.signature === b.signature && signatureOf(a) === signatureOf(b);
}
