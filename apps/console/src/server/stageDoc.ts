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
  /** The run's pipeline; its own copy of the stage wins over the default. */
  pipeline: string | null;
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

/** Mirrors rt's pipeline-name rule, so a name never leaves the stage dir. */
const PIPELINE_NAME = /^[a-z][a-z0-9-]*$/;

/** The stage dirs to try, the run's pipeline copy first. */
function stageNames(input: StageDocInput): string[] {
  const { stage, pipeline } = input;
  return pipeline && PIPELINE_NAME.test(pipeline)
    ? [`${stage}--${pipeline}`, stage]
    : [stage];
}

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
  stages: string[],
  dirs: PackDir[]
): Promise<StageDocHit | null> {
  const ordered = [
    ...dirs.filter(d => d.name === token.pack),
    ...dirs.filter(d => d.name !== token.pack),
  ];
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
    const paths = tree.split('\n');
    const byStage = stages.map(stage =>
      paths.filter(p => docPath(stage).test(p))
    );
    const rel = d.dir.startsWith(root) ? d.dir.slice(root.length + 1) : '';
    // An org commit holds every team's packs, so another team's copy must
    // never beat this pack's own default.
    const ownPick = (hits: string[]) =>
      hits.find(p => rel && p.startsWith(rel + '/')) ??
      hits.find(p => p.includes(`/${token.pack}/`));
    const pick =
      byStage.map(ownPick).find(p => p !== undefined) ??
      byStage.find(h => h.length > 0)?.[0];
    if (pick === undefined) continue;
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
  const stages = stageNames(input);
  for (const t of ordered) {
    if (t.kind === 'sha') {
      const hit = await fromSha(deps, t, stages, dirs);
      if (hit) return hit;
    } else if (t.pack === 'mattstack') {
      for (const stage of stages) {
        const path = normalize(
          `${deps.pluginCacheDir}/${t.ref}/attachments/pipeline/stage-${stage}/SKILL.md`
        );
        if (!path.startsWith(normalize(deps.pluginCacheDir) + '/')) break;
        const text = await deps.readFile(path);
        if (text != null) return { text, pack: 'mattstack', sha: t.ref };
      }
    }
  }
  return null;
}
