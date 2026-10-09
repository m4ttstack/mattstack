import { normalize } from 'node:path';

import type { RunGit } from './git-bin';

export interface PackToken {
  pack: string;
  ref: string;
  kind: 'sha' | 'version';
}
export interface PackDir {
  name: string;
  dir: string;
}
export interface StageDocDeps {
  runGit: RunGit;
  packDirs: () => Promise<PackDir[]>;
  readFile: (path: string) => Promise<string | null>;
  pluginCacheDir: string;
}
export interface StageDocInput {
  packCommits: string | null;
  stage: string;
}
export interface StageDocHit {
  text: string;
  pack: string;
  sha: string;
}

export function parsePackTokens(s: string | null): PackToken[] {
  if (!s) return [];
  const out: PackToken[] = [];
  for (const token of s.split(/[\s,]+/)) {
    const m = /^([^=]+)=(.+)$/.exec(token);
    if (!m) continue;
    const [, pack, ref] = m;
    if (/^[0-9a-f]{7,40}$/i.test(ref)) out.push({ pack, ref, kind: 'sha' });
    else if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(ref))
      out.push({ pack, ref, kind: 'version' });
  }
  return out;
}

const docPath = (stage: string) =>
  new RegExp(`(^|/)attachments/(pipeline/)?stage-${stage}/SKILL\\.md$`);

async function git(deps: StageDocDeps, args: string[]): Promise<string | null> {
  try {
    const r = await deps.runGit(args);
    return r.code === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

async function fromSha(
  deps: StageDocDeps,
  token: PackToken,
  stage: string,
  dirs: PackDir[]
): Promise<StageDocHit | null> {
  const ordered = [
    ...dirs.filter(d => d.name === token.pack),
    ...dirs.filter(d => d.name !== token.pack),
  ];
  const want = docPath(stage);
  const seenRoots = new Set<string>();
  for (const d of ordered) {
    const root = (
      await git(deps, ['-C', d.dir, 'rev-parse', '--show-toplevel'])
    )?.trim();
    if (!root || seenRoots.has(root)) continue;
    seenRoots.add(root);
    const kind = (
      await git(deps, ['-C', root, 'cat-file', '-t', token.ref])
    )?.trim();
    if (kind !== 'commit') continue;
    const tree =
      (await git(deps, [
        '-C',
        root,
        'ls-tree',
        '-r',
        '--name-only',
        token.ref,
      ])) ?? '';
    const hits = tree.split('\n').filter(p => want.test(p));
    if (hits.length === 0) continue;
    const rel = d.dir.startsWith(root) ? d.dir.slice(root.length + 1) : '';
    const pick =
      hits.find(p => rel && p.startsWith(rel + '/')) ??
      hits.find(p => p.includes(`/${token.pack}/`)) ??
      hits[0];
    const text = await git(deps, ['-C', root, 'show', `${token.ref}:${pick}`]);
    if (text != null) {
      return {
        text,
        pack: token.pack === 'plugin' ? d.name : token.pack,
        sha: token.ref,
      };
    }
  }
  return null;
}

export async function resolveStageDoc(
  deps: StageDocDeps,
  input: StageDocInput
): Promise<StageDocHit | null> {
  const tokens = parsePackTokens(input.packCommits);
  if (tokens.length === 0) return null;
  const ordered = [
    ...tokens.filter(t => t.pack !== 'mattstack'),
    ...tokens.filter(t => t.pack === 'mattstack'),
  ];
  const dirs = await deps.packDirs().catch((): PackDir[] => []);
  for (const t of ordered) {
    if (t.kind === 'sha') {
      const hit = await fromSha(deps, t, input.stage, dirs);
      if (hit) return hit;
    } else if (t.pack === 'mattstack') {
      const path = normalize(
        `${deps.pluginCacheDir}/${t.ref}/attachments/pipeline/stage-${input.stage}/SKILL.md`
      );
      if (!path.startsWith(normalize(deps.pluginCacheDir) + '/')) continue;
      const text = await deps.readFile(path);
      if (text != null) return { text, pack: 'mattstack', sha: t.ref };
    }
  }
  return null;
}
