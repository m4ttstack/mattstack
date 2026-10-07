import { dirname, isAbsolute, relative, sep } from 'node:path';

import { pluginRootOf } from '../shared/pluginRoot';

/** One org base fill folder a verb binds, outside the pack's own folder. */
export interface BaseScope {
  base: string;
  /** The base pack's root, realpath'd. */
  root: string;
  /** The fill's folder relative to the repo top: the body of a `:(top,literal)`
      pathspec. */
  top: string;
}

interface ScopeSlot {
  fillSourcePath?: string | null;
  origin?: 'base';
  base?: string;
}
interface ScopeComposition {
  packDir: string;
  verbs?: { name: string; slots: ScopeSlot[] }[];
}

const inside = (child: string, parent: string) =>
  child === parent || child.startsWith(`${parent}${sep}`);

const outsideRepo = (top: string) =>
  top === '' || top === '..' || top.startsWith(`..${sep}`) || isAbsolute(top);

/** A team-pack copy of a base fill is already in the pack's own scope, so
    only a fill outside the pack adds one. A pipeline stage's slots carry no
    `fillSourcePath`, so a stage adds none. */
export async function baseScopesFor(
  composition: ScopeComposition,
  verb: string | null,
  repoRoot: string,
  realpath: (path: string) => Promise<string>
): Promise<BaseScope[]> {
  const scopes = new Map<string, BaseScope>();
  const packDir = await realpath(composition.packDir).catch(
    () => composition.packDir
  );
  for (const v of composition.verbs ?? []) {
    if (verb !== null && v.name !== verb) continue;
    for (const slot of v.slots ?? []) {
      if (slot.origin !== 'base' || !slot.base || !slot.fillSourcePath)
        continue;
      if (inside(slot.fillSourcePath, composition.packDir)) continue;
      const pluginRoot = pluginRootOf(slot.fillSourcePath);
      if (!pluginRoot) continue;
      const dir = await realpath(dirname(slot.fillSourcePath)).catch(
        () => null
      );
      const root = await realpath(pluginRoot).catch(() => null);
      if (!dir || !root) continue;
      if (inside(dir, packDir)) continue;
      const top = relative(repoRoot, dir);
      if (outsideRepo(top)) continue;
      scopes.set(top, { base: slot.base, root, top });
    }
  }
  return [...scopes.values()];
}

/** Literal, so a `*`, `?`, `[` or `\` in a folder name is not glob magic. */
export const basePathspec = (scope: BaseScope) => `:(top,literal)${scope.top}`;

/** A repo-top-relative path under a scope's base root, in the
    `base:<name>/<path inside the base pack>` coordinate; any other path is
    returned unchanged. */
export function toBaseCoordinate(
  path: string,
  scopes: BaseScope[],
  repoRoot: string
): string {
  for (const scope of scopes) {
    const rootTop = relative(repoRoot, scope.root);
    if (path.startsWith(`${rootTop}/`))
      return `base:${scope.base}/${path.slice(rootTop.length + 1)}`;
  }
  return path;
}

const FILE_PAIR = 'diff --git ';
const PREFIXED_HEADER = /^(--- a\/|\+\+\+ b\/)(.*)$/;

/** Rewrites the file headers of a repo-path diff (`diff --git`, `--- a/`,
    `+++ b/`) into the base coordinate. Only lines between a `diff --git` and
    its first `@@` are headers: a body line can carry the same text. */
export function rewriteDiffPaths(
  diff: string,
  scopes: BaseScope[],
  repoRoot: string
): string {
  if (scopes.length === 0) return diff;
  let inHeader = false;
  return diff
    .split('\n')
    .map(line => {
      if (line.startsWith(FILE_PAIR)) {
        inHeader = true;
        return FILE_PAIR + rewriteFilePair(line.slice(FILE_PAIR.length));
      }
      if (!inHeader) return line;
      if (line.startsWith('@@')) {
        inHeader = false;
        return line;
      }
      const header = PREFIXED_HEADER.exec(line);
      return header
        ? header[1] + toBaseCoordinate(header[2], scopes, repoRoot)
        : line;
    })
    .join('\n');

  function rewriteFilePair(pair: string): string {
    for (const scope of scopes) {
      const from = relative(repoRoot, scope.root);
      const to = `base:${scope.base}`;
      if (pair.startsWith(`a/${from}/`))
        pair = `a/${to}/${pair.slice(from.length + 3)}`;
      pair = pair.replace(` b/${from}/`, ` b/${to}/`);
    }
    return pair;
  }
}
