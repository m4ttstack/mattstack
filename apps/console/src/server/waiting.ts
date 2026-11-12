import { join, relative } from 'node:path';

import type { RunGit } from './git-bin';

/** A source outside the pack (an installed plugin's skill or block) whose
    version moved since the skills that embed it were compiled. */
export interface OutsideSource {
  ref: string;
  builtVersion: string;
  version: string;
  skills: string[];
}

export interface WaitingForCompile {
  /** The skills rt reports as needing a compile. */
  skills: string[];
  /** Full shas, newest first, of the commits since the last compile that
      edited a source in the pack. */
  commits: string[];
  outside: OutsideSource[];
}

type StaleSkill = { name: string; dir: string };

type CheckRow = { name?: unknown; status?: unknown; base?: unknown };

/** The skills rt's check reports stale, with the pack folder each compiles
    into. A base pack's attachment compiles in the base, not here. */
export function staleSkillsOf(check: unknown): StaleSkill[] {
  const c = (check ?? {}) as { verbs?: CheckRow[]; attachments?: CheckRow[] };
  const pick = (rows: CheckRow[] | undefined, folder: string) =>
    (rows ?? [])
      .filter(
        r =>
          r.status === 'stale' && typeof r.name === 'string' && r.base == null
      )
      .map(r => ({ name: r.name as string, dir: `${folder}/${r.name}` }));
  return [...pick(c.verbs, 'skills'), ...pick(c.attachments, 'attachments')];
}

type AnatomySource = {
  ref?: unknown;
  version?: unknown;
  builtVersion?: unknown;
};

/** The outside sources whose change one skill's anatomy flags: a changed
    part, or the template when rt names the source as a cause. A version
    bump that left the text alone is not listed. */
export function movedSourcesOf(
  anatomy: unknown
): { ref: string; builtVersion: string; version: string }[] {
  const a = (anatomy ?? {}) as {
    template?: AnatomySource | null;
    staleBecause?: unknown;
    parts?: { source?: AnatomySource | null; changed?: unknown }[];
  };
  const causes = Array.isArray(a.staleBecause) ? a.staleBecause : [];
  const sources = [
    ...(causes.includes('source') ? [a.template] : []),
    ...(a.parts ?? []).filter(p => p.changed === true).map(p => p.source),
  ];
  const moved = new Map<
    string,
    { ref: string; builtVersion: string; version: string }
  >();
  for (const s of sources) {
    if (
      !s ||
      typeof s.ref !== 'string' ||
      typeof s.version !== 'string' ||
      typeof s.builtVersion !== 'string' ||
      s.version === s.builtVersion
    )
      continue;
    moved.set(s.ref, {
      ref: s.ref,
      builtVersion: s.builtVersion,
      version: s.version,
    });
  }
  return [...moved.values()];
}

/** rt's `LOCK_REL` (`lib/skills/compiled-lock.ts`); every compile rewrites
    it, and a version-only sync writes no other compiled file. */
const COMPILED_LOCK = 'pack/compiled.lock.json';

/** Every file a compile writes, relative to the pack: the pack's compiled
    lock, each compiled skill's SKILL.md and compiled.json, and the files its
    keys map. */
export function compiledOutputs(
  manifests: { dir: string; keys: Record<string, string> }[]
): Set<string> {
  const out = new Set<string>([COMPILED_LOCK]);
  for (const m of manifests) {
    out.add(`${m.dir}/SKILL.md`);
    out.add(`${m.dir}/compiled.json`);
    for (const path of Object.values(m.keys)) out.add(path);
  }
  return out;
}

/** Splits `git log --format=%x00%H --name-only` into sha → files. */
export function parseNameLog(stdout: string): Map<string, string[]> {
  const commits = new Map<string, string[]>();
  for (const chunk of stdout.split('\0').slice(1)) {
    const [sha, ...files] = chunk.split('\n');
    if (!sha) continue;
    commits.set(sha.trim(), files.map(f => f.trim()).filter(Boolean));
  }
  return commits;
}

export interface WaitingDeps {
  runRt: (argv: string[]) => Promise<{ stdout: string }>;
  parse: (stdout: string) => unknown;
  runGit: RunGit;
  readPackFile: (path: string) => Promise<string>;
}

/**
 * What a compile would pick up, read only when rt reports a skill stale (an
 * up-to-date pack marks nothing). A compile runs over the whole pack, so the
 * newest commit that wrote any compiled file is the last compile; every later
 * commit that edited a pack file a compile does not write is waiting on the
 * next one. Outside sources come from each stale skill's anatomy.
 */
export async function waitingForCompile(
  pack: string,
  packDir: string,
  repoRoot: string,
  deps: WaitingDeps
): Promise<WaitingForCompile> {
  const check = deps.parse(
    (await deps.runRt(['skills', 'check', '--pack', pack, '--json'])).stdout
  );
  const stale = staleSkillsOf(check);
  if (stale.length === 0) return { skills: [], commits: [], outside: [] };

  const outputs = compiledOutputs(await compiledManifests(packDir, deps));
  const packPrefix = relative(repoRoot, packDir);
  const inPack = (file: string) =>
    packPrefix === '' ? file : file.slice(packPrefix.length + 1);

  const log = await deps.runGit([
    '-C',
    packDir,
    'log',
    '--no-color',
    `--max-count=${MAX_SCAN}`,
    '--format=%x00%H',
    '--name-only',
    '--',
    '.',
  ]);
  const commits: string[] = [];
  if (log.code === 0) {
    for (const [sha, files] of parseNameLog(log.stdout)) {
      const rel = files.map(inPack);
      if (rel.some(f => outputs.has(f))) break;
      if (rel.length > 0) commits.push(sha);
    }
  }

  const outside = new Map<string, OutsideSource>();
  for (const skill of stale) {
    if (!skill.dir.startsWith('skills/')) continue;
    const anatomy = deps.parse(
      (
        await deps.runRt([
          'skills',
          'anatomy',
          '--pack',
          pack,
          '--skill',
          skill.name,
          '--json',
        ])
      ).stdout
    );
    for (const moved of movedSourcesOf(anatomy)) {
      const entry = outside.get(moved.ref) ?? { ...moved, skills: [] };
      entry.skills.push(skill.name);
      outside.set(moved.ref, entry);
    }
  }
  return {
    skills: stale.map(s => s.name),
    commits,
    outside: [...outside.values()],
  };
}

/** How far back the log is read for the last compile. */
const MAX_SCAN = 200;

/** The compiled.json of every skill and attachment in the pack. */
async function compiledManifests(
  packDir: string,
  deps: WaitingDeps
): Promise<{ dir: string; keys: Record<string, string> }[]> {
  const listed = await deps.runGit([
    '-C',
    packDir,
    'ls-files',
    '--',
    'skills/*/compiled.json',
    'attachments/*/compiled.json',
  ]);
  if (listed.code !== 0) return [];
  const files = listed.stdout.split('\n').filter(Boolean);
  const manifests = await Promise.all(
    files.map(async file => {
      try {
        const raw = JSON.parse(
          await deps.readPackFile(join(packDir, file))
        ) as { dir?: unknown; keys?: unknown; files?: unknown };
        const dir =
          typeof raw.dir === 'string'
            ? raw.dir
            : file.replace(/\/compiled\.json$/, '');
        const keys: Record<string, string> =
          raw.keys && typeof raw.keys === 'object'
            ? { ...(raw.keys as Record<string, string>) }
            : {};
        // A base copy lists the files it vendored, relative to its folder.
        if (Array.isArray(raw.files))
          for (const f of raw.files)
            if (typeof f === 'string') keys[f] = `${dir}/${f}`;
        return { dir, keys };
      } catch {
        return null;
      }
    })
  );
  return manifests.filter(m => m !== null);
}

export interface CompileDiffDeps {
  runRt: (argv: string[]) => Promise<{ code?: number; stdout: string }>;
  parse: (stdout: string) => unknown;
  runGit: RunGit;
  /** Writes `content` to a scratch file and returns its path. */
  scratch: (content: string) => Promise<{ path: string; drop: () => void }>;
}

/**
 * What the next compile would rewrite: for each stale skill, a unified diff
 * of its committed SKILL.md against the compile preview, with paths named
 * from the pack like a commit's diff.
 */
export async function compileDiff(
  pack: string,
  packDir: string,
  deps: CompileDiffDeps
): Promise<{ diff: string; skills: string[] }> {
  const check = deps.parse(
    (await deps.runRt(['skills', 'check', '--pack', pack, '--json'])).stdout
  );
  const stale = staleSkillsOf(check).filter(s => s.dir.startsWith('skills/'));
  const parts: string[] = [];
  for (const skill of stale) {
    const preview = await deps.runRt([
      'skills',
      'compile',
      '--pack',
      pack,
      '--verb',
      skill.name,
      '--preview',
    ]);
    if (preview.code !== undefined && preview.code !== 0) continue;
    const file = await deps.scratch(preview.stdout);
    try {
      const path = `${skill.dir}/SKILL.md`;
      const out = await deps.runGit([
        '-C',
        packDir,
        'diff',
        '--no-index',
        '--no-color',
        '--',
        path,
        file.path,
      ]);
      // --no-index exits 1 when the files differ.
      if (out.code > 1 || !out.stdout) continue;
      parts.push(relabel(out.stdout, file.path, path));
    } finally {
      file.drop();
    }
  }
  return { diff: parts.join(''), skills: stale.map(s => s.name) };
}

/** Names the preview's scratch file as the skill's own path, so the diff
    reads as an edit of that file. */
function relabel(diff: string, scratch: string, path: string): string {
  const bare = scratch.replace(/^\//, '');
  return diff
    .split('\n')
    .map(line => {
      if (line.startsWith('diff --git '))
        return `diff --git a/${path} b/${path}`;
      if (line.startsWith('+++ ')) return `+++ b/${path}`;
      return line.includes(bare) ? line.split(bare).join(path) : line;
    })
    .join('\n');
}
