/**
 * `CONSOLE_FIXTURE=design`: the skills routes answer from the invented `acme`
 * pack the console design boards were drawn with, so the Graph tab can be
 * compared with the boards without rt, git or a real pack on the machine.
 * `CONSOLE_FIXTURE_SCENARIO=unsynced` serves the pack after a rebind that has
 * not been synced yet; `scenarios.ts` lists the others, each a state no board
 * draws.
 *
 * Files the routes read live under `files/`, at their path below `/fixture`.
 * Everything is read at call time, so nothing here is bundled into the app.
 */
import { readFile, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RunGit } from '../../git-bin';
import { GIT_LOG_FORMAT, type GitCommit } from '../../gitLog';
import type { RunRt } from '../../rt-bin';
import type { ReadPackFile } from '../../skills';
import {
  isFailure,
  isScenario,
  scenarioOf,
  SCENARIOS,
  type Failure,
  type FixtureScenario,
} from './scenarios';

export type { FixtureScenario } from './scenarios';

export interface FixtureRt {
  runRt: RunRt;
  runGit: RunGit;
  readPackFile: ReadPackFile;
  realpath: (path: string) => Promise<string>;
}

const FIXTURE_PACK = 'acme';
const FIXTURE_ROOT = '/fixture';
const PACK_DIR = `${FIXTURE_ROOT}/packs/${FIXTURE_PACK}`;
const SKILLS_WITH_ANATOMY = new Set(['work', 'stage-plan']);

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FILES = join(HERE, 'files');

type RunResult = Awaited<ReturnType<RunRt>>;

interface PendingFile {
  path: string;
  status: string;
  from?: string;
}

interface History {
  repoRoot: string;
  commits: GitCommit[];
  diffs: Record<string, string>;
}

/** Throws on a scenario it does not know, so a mistyped one never serves
    `clean` in its place. */
export function fixtureMode(
  env: Record<string, string | undefined>
): FixtureScenario | null {
  if (env.CONSOLE_FIXTURE !== 'design') return null;
  const scenario = env.CONSOLE_FIXTURE_SCENARIO || 'clean';
  if (!isScenario(scenario)) {
    throw new Error(
      `CONSOLE_FIXTURE_SCENARIO "${scenario}" is not a design fixture scenario; use one of ${SCENARIOS.join(', ')}`
    );
  }
  return scenario;
}

const answer = (stdout: string, code = 0): RunResult => ({
  code,
  stdout,
  stderr: '',
});

const fail = ({ code, stderr }: Failure): RunResult => ({
  code,
  stdout: '',
  stderr,
});

const refuse = (argv: string[]): RunResult => ({
  code: 1,
  stdout: '',
  stderr: `the design fixture has no answer for: ${argv.join(' ')}`,
});

const readJsonText = (name: string) => readFile(join(HERE, name), 'utf8');

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readJsonText(name)) as T;
}

function flagValue(argv: string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

function notFound(path: string): Error {
  return Object.assign(
    new Error(`ENOENT: no such file in the design fixture, ${path}`),
    {
      code: 'ENOENT',
    }
  );
}

/** Where a `/fixture/...` path lives on disk; anything outside `/fixture` is absent. */
function onDisk(path: string): string {
  const clean = posix.normalize(path);
  if (!clean.startsWith(`${FIXTURE_ROOT}/`)) throw notFound(path);
  return join(FILES, clean.slice(FIXTURE_ROOT.length + 1));
}

function porcelain(files: PendingFile[], scope: string): string {
  return files
    .filter(
      f => scope === '.' || f.path === scope || f.path.startsWith(`${scope}/`)
    )
    .map(
      f => `${f.status.padStart(2)} ${f.from ? `${f.from} -> ` : ''}${f.path}\n`
    )
    .join('');
}

/** What `git log --format=GIT_LOG_FORMAT --name-only` prints for these commits. */
function formatLog(commits: GitCommit[]): string {
  return commits
    .map(c => {
      const field: Record<string, string> = {
        H: c.sha,
        h: c.shortSha,
        aI: c.authoredAt,
        an: c.author,
        s: c.subject,
      };
      const head = GIT_LOG_FORMAT.replace(
        /%(H|h|aI|an|s)/g,
        (_, key: string) => field[key]!
      );
      return `${head}\n\n${c.files.join('\n')}\n`;
    })
    .join('\n');
}

/** An unedited payload is the file's own bytes, never parsed and printed
    again, so a scenario with no edit answers exactly what its file holds. */
async function payload<T>(
  name: string,
  edit: ((value: T) => T) | undefined
): Promise<string> {
  if (!edit) return readJsonText(name);
  return JSON.stringify(edit(await readJson<T>(name)), null, 2);
}

export function fixtureRt(scenario: FixtureScenario): FixtureRt {
  const def = scenarioOf(scenario);
  const unsynced = scenario === 'unsynced';
  const changesFile = `changes.${unsynced ? 'unsynced' : 'clean'}.json`;
  const pendingFiles = async () =>
    (await readJson<{ files: PendingFile[] }>(changesFile)).files;

  const runRt: RunRt = async argv => {
    const [group, verb] = argv;
    if (group !== 'skills') return refuse(argv);
    if (verb === 'packs' && argv.includes('--json')) {
      return answer(await readJsonText('packs.json'));
    }
    if (flagValue(argv, '--pack') !== FIXTURE_PACK) return refuse(argv);

    if (verb === 'bind' && argv.length === 7) return answer('');
    if (!argv.includes('--json')) return refuse(argv);
    switch (verb) {
      case 'composition':
        return answer(
          await payload(
            unsynced ? 'composition.unsynced.json' : 'composition.json',
            def.composition
          )
        );
      case 'check':
        if (isFailure(def.check)) return fail(def.check);
        // rt exits 1 whenever any skill has drifted, with the report still on stdout.
        return answer(await payload('check.json', def.check), 1);
      case 'anatomy': {
        const skill = flagValue(argv, '--skill');
        const own = skill ? def.anatomy?.[skill] : undefined;
        if (isFailure(own)) return fail(own);
        if (own) return answer(await payload(own.file, own.edit));
        if (!skill || !SKILLS_WITH_ANATOMY.has(skill)) return refuse(argv);
        const variant = unsynced && skill === 'stage-plan' ? '.unsynced' : '';
        return answer(await readJsonText(`anatomy.${skill}${variant}.json`));
      }
      case 'changes':
        if (def.changes) return fail(def.changes);
        return answer(await readJsonText(changesFile));
      case 'discard':
        return answer(
          JSON.stringify({
            pack: FIXTURE_PACK,
            packDir: PACK_DIR,
            discarded: await pendingFiles(),
          })
        );
      case 'sync':
        return answer(await readJsonText('sync.json'));
      default:
        return refuse(argv);
    }
  };

  const runGit: RunGit = async argv => {
    const [dashC, dir, command, ...rest] = argv;
    if (dashC !== '-C' || dir !== PACK_DIR) {
      return {
        code: 128,
        stdout: '',
        stderr: `fatal: not a git repository: ${dir}`,
      };
    }
    const history = await readJson<History>('history.json');
    const dashDash = rest.indexOf('--');
    const scope = dashDash === -1 ? '.' : (rest[dashDash + 1] ?? '.');
    switch (command) {
      case 'rev-parse':
        return rest[0] === '--show-toplevel'
          ? answer(`${history.repoRoot}\n`)
          : refuse(argv);
      case 'log': {
        const max = Number(
          rest.find(a => a.startsWith('--max-count='))?.split('=')[1]
        );
        const inScope = history.commits.filter(
          c =>
            scope === '.' ||
            c.files.some(f => f === scope || f.startsWith(`${scope}/`))
        );
        return answer(
          formatLog(Number.isFinite(max) ? inScope.slice(0, max) : inScope)
        );
      }
      case 'status':
        return answer(porcelain(await pendingFiles(), scope));
      case 'diff': {
        const revs = rest.find(a => a.includes('..'));
        const [from, to] = (revs ?? '').split('..');
        const full = (rev: string | undefined) =>
          rev
            ? history.commits.find(c => c.sha.startsWith(rev))?.sha
            : undefined;
        const [a, b] = [full(from), full(to)];
        if (!a || !b) {
          return {
            code: 128,
            stdout: '',
            stderr: `fatal: bad revision '${revs}'`,
          };
        }
        return answer(history.diffs[`${a}..${b}`] ?? '');
      }
      default:
        return refuse(argv);
    }
  };

  const edits = def.files ?? {};
  const absent = (path: string) => edits[posix.normalize(path)] === null;

  const readPackFile: ReadPackFile = async path => {
    if (absent(path)) throw notFound(path);
    const text = await readFile(onDisk(path), 'utf8');
    return edits[posix.normalize(path)]?.(text) ?? text;
  };

  const realpath = async (path: string) => {
    if (absent(path)) throw notFound(path);
    await stat(onDisk(path));
    return posix.normalize(path);
  };

  return { runRt, runGit, readPackFile, realpath };
}
