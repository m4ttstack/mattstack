/**
 * Reads layer sizing from `boxscore.pen` so the harness can tell a layer that
 * hugs its content (Pencil measured it in the canvas font) from one with a
 * fixed or fill width.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface PenNode {
  type?: string;
  name?: string;
  enabled?: boolean;
  width?: number | string;
  children?: PenNode[];
}

export const PEN_PATH = fileURLToPath(
  new URL('../../../../docs/apps/design/boxscore/boxscore.pen', import.meta.url)
);

export function readPen(path = PEN_PATH): PenNode {
  return JSON.parse(readFileSync(path, 'utf8')) as PenNode;
}

/** A frame without a width, or with a fit_content one, hugs its children. */
export function hugsWidth(n: PenNode): boolean {
  if (n.type !== 'frame') return false;
  return (
    n.width === undefined ||
    (typeof n.width === 'string' && n.width.startsWith('fit_content'))
  );
}

/**
 * Every layer path under the layer named `root`, keyed the way collect.js keys
 * design layers: names joined by `/`, a name that repeats among siblings
 * suffixed `[i]`, disabled layers left out (the export omits them). The root
 * itself is the empty path. `frame` scopes the search to one board, since
 * content layer names (`Standings`, `Stat Leaders`) repeat across boards.
 */
export function penPaths(
  pen: PenNode,
  root: string,
  frame?: string
): Map<string, PenNode> {
  const out = new Map<string, PenNode>();
  const walk = (n: PenNode, path: string) => {
    out.set(path, n);
    const kids = (n.children ?? []).filter(k => k.enabled !== false);
    const counts = new Map<string, number>();
    for (const k of kids)
      counts.set(k.name ?? '', (counts.get(k.name ?? '') ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const k of kids) {
      const name = k.name ?? '';
      const i = seen.get(name) ?? 0;
      seen.set(name, i + 1);
      const own = counts.get(name)! > 1 ? `${name}[${i}]` : name;
      walk(k, path ? `${path}/${own}` : own);
    }
  };
  const find = (n: PenNode, name: string): PenNode | null => {
    if (n.name === name && n.enabled !== false) return n;
    for (const k of n.children ?? []) {
      const r = find(k, name);
      if (r) return r;
    }
    return null;
  };
  const scope = frame === undefined ? pen : find(pen, frame);
  if (!scope) throw new Error(`no frame named "${frame}" in the pen`);
  const top = find(scope, root);
  if (!top) {
    throw new Error(
      `no layer named "${root}" in ${frame ? `"${frame}"` : 'the pen'}`
    );
  }
  walk(top, '');
  return out;
}

/** Paths (relative to `root`) of the layers whose width hugs their content. */
export function hugWidthPaths(
  pen: PenNode,
  root: string,
  frame?: string
): string[] {
  return [...penPaths(pen, root, frame)]
    .filter(([path, n]) => path !== '' && hugsWidth(n))
    .map(([path]) => path);
}
