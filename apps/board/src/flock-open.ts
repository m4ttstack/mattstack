// src/flock-open.ts
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  listRuns,
  rtCommand,
  type Commands,
  type RunSummary,
  type WorktreeTreeRow,
} from '@mattstack/rt-client';
import { shellSingleQuote } from './shell-quote.ts';

export type FlockAction = 'shell' | 'claude' | 'resume' | 'command';

/** Mirrors the `icon` enum in rt-client's `board.flockCommands` schema;
    flock-open.test.ts holds the two together. */
export const FLOCK_COMMAND_ICONS = [
  'rt',
  'cd',
  'folder',
  'branch',
  'play',
  'pulse',
  'shell',
  'agent',
  'refresh',
  'file',
  'note',
] as const;

export type FlockCommandIcon = (typeof FLOCK_COMMAND_ICONS)[number];

export interface FlockCommand {
  label: string;
  command: string;
  icon?: FlockCommandIcon;
}

function isIcon(v: unknown): v is FlockCommandIcon {
  return (FLOCK_COMMAND_ICONS as readonly unknown[]).includes(v);
}

export interface FlockResume {
  session: string;
  worktree: string | null;
  /** herdr pane already running this run's agent, whatever its status. */
  livePane: string | null;
}

export interface FlockMenu {
  /** Either Flock flavor is on this Mac; without one the menu shows no rows. */
  installed: boolean;
  tree: string | null;
  repoRoot: string | null;
  resume: (FlockResume & { worktreeGone: boolean }) | null;
  commands: FlockCommand[];
}

/** Flock reads the same file; both sides create it if missing. */
export function flockTokenPath(home: string = homedir()): string {
  return join(home, '.mattstack', 'flock', 'open-token');
}

/** Created whole or not at all: written to a private temp file, then hard
    linked into place, which never replaces a token Flock made first. */
export function readFlockToken(path: string = flockTokenPath()): string {
  const existing = readToken(path);
  if (existing) return existing;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}`;
  writeFileSync(temp, `${token}\n`, { mode: 0o600 });
  try {
    linkSync(temp, path);
    return token;
  } catch {
    return readToken(path) ?? token;
  } finally {
    unlinkSync(temp);
  }
}

function readToken(path: string): string | null {
  if (!existsSync(path)) return null;
  chmodSync(path, 0o600);
  return readFileSync(path, 'utf8').trim() || null;
}

/** A Claude session id as the run store records it. The resume line is
    typed into a terminal, where quoting cannot stop a control character. */
const SESSION_ID = /^[A-Za-z0-9-]+$/;

/** The MR's checkout: any tree of the repo on its source branch, golden
    donors aside. A claimed tree beats the main checkout. */
export function pickMrTree(
  trees: readonly WorktreeTreeRow[],
  repoName: string,
  branch: string
): { tree: string | null; repoRoot: string | null } {
  const mine = trees.filter(t => t.repoName === repoName);
  const repoRoot = mine.find(t => t.kind === 'main')?.path ?? null;
  const onBranch = mine.filter(t => t.branch === branch && t.kind !== 'golden');
  const tree =
    onBranch.find(t => t.kind !== 'main')?.path ?? onBranch[0]?.path ?? null;
  return { tree, repoRoot };
}

/** The newest work run that recorded this MR and a Claude session. */
export function pickResumeRun(
  runs: readonly RunSummary[],
  mrUrl: string
): RunSummary | null {
  const norm = (u: string) => u.replace(/\/+$/, '');
  const target = norm(mrUrl);
  return (
    runs
      .filter(
        r =>
          r.work_type === 'work' &&
          !!r.session &&
          SESSION_ID.test(r.session) &&
          typeof r.mr === 'string' &&
          norm(r.mr) === target
      )
      .sort((a, b) => b.started_at - a.started_at)[0] ?? null
  );
}

export function parseFlockCommands(value: unknown): FlockCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(v => {
    const { label, command, icon } = (v ?? {}) as Record<string, unknown>;
    if (typeof label !== 'string' || typeof command !== 'string') return [];
    if (!label.trim() || !command.trim()) return [];
    return [
      {
        label: label.trim(),
        command: command.trim(),
        ...(isIcon(icon) ? { icon } : {}),
      },
    ];
  });
}

export interface FlockUrlParts {
  folder: string;
  repo: string;
  label: string;
  kind: FlockAction;
  run?: string;
  token: string;
}

/** Percent-encoded by hand: URLSearchParams writes a space as `+`, which
    Foundation's URLComponents keeps as a literal plus, so a command such as
    `rt sync` reached the pane as `rt+sync`. */
export function flockOpenUrl(p: FlockUrlParts): string {
  const parts: Array<[string, string | undefined]> = [
    ['folder', p.folder],
    ['repo', p.repo],
    ['label', p.label],
    ['kind', p.kind],
    ['run', p.run],
    ['token', p.token],
  ];
  return `flock://open?${parts
    .filter((e): e is [string, string] => !!e[1])
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')}`;
}

/** The pane command for an action; undefined is an empty shell. */
export function actionCommand(
  action: FlockAction,
  opts: { session?: string; command?: string }
): string | undefined {
  switch (action) {
    case 'shell':
      return undefined;
    case 'claude':
      return 'claude';
    case 'resume':
      return `claude --resume ${shellSingleQuote(opts.session ?? '')}`;
    case 'command':
      return opts.command;
  }
}

export interface FlockIo {
  listTrees(): Promise<WorktreeTreeRow[]>;
  listRuns(): Promise<RunSummary[]>;
  runWorktree(run: RunSummary): Promise<string | null>;
  exists(path: string): boolean;
  flockInstalled(): Promise<boolean>;
}

const FLOCK_BUNDLE_QUERY =
  "kMDItemCFBundleIdentifier == 'dev.mattstack.Flock' || kMDItemCFBundleIdentifier == 'dev.mattstack.Flock.dev'";

export function flockInstalledFrom(mdfindOut: string): boolean {
  return mdfindOut.trim().length > 0;
}

export const defaultFlockIo: FlockIo = {
  async listTrees() {
    const res = await rtCommand<Commands['worktree:list']['data']>(
      'worktree:list',
      {},
      { timeoutMs: 20_000 }
    );
    if (!res.ok || !res.data)
      throw new Error(res.error ?? 'worktree list failed');
    return res.data.trees;
  },
  async listRuns() {
    const res = await listRuns();
    return res.ok && res.data ? res.data.runs : [];
  },
  async runWorktree(run) {
    const res = await rtCommand<Commands['runs:get']['data']>(
      'runs:get',
      { runId: run.id, repo: run.repo },
      { timeoutMs: 10_000 }
    );
    if (!res.ok || !res.data) return null;
    const rows = res.data.fields.filter(f => f.key === 'worktree');
    return rows.sort((a, b) => b.at - a.at)[0]?.value ?? null;
  },
  exists: existsSync,
  async flockInstalled() {
    const proc = Bun.spawn(['/usr/bin/mdfind', FLOCK_BUNDLE_QUERY], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return flockInstalledFrom(out);
  },
};

export async function buildFlockMenu(
  mr: { webUrl: string; sourceBranch: string },
  repoName: string,
  commands: FlockCommand[],
  io: FlockIo = defaultFlockIo
): Promise<FlockMenu> {
  if (!(await io.flockInstalled()))
    return {
      installed: false,
      tree: null,
      repoRoot: null,
      resume: null,
      commands: [],
    };
  const [trees, runs] = await Promise.all([io.listTrees(), io.listRuns()]);
  const { tree, repoRoot } = pickMrTree(trees, repoName, mr.sourceBranch);
  const run = pickResumeRun(runs, mr.webUrl);
  let resume: FlockMenu['resume'] = null;
  if (run?.session) {
    const worktree = await io.runWorktree(run);
    resume = {
      session: run.session,
      worktree,
      livePane: run.agent?.pane ?? null,
      worktreeGone: !worktree || !io.exists(worktree),
    };
  }
  return { installed: true, tree, repoRoot, resume, commands };
}

export async function provisionMrTree(
  repoName: string,
  branch: string
): Promise<string> {
  const res = await rtCommand<Commands['worktree:provision']['data']>(
    'worktree:provision',
    { repoName, branch },
    { timeoutMs: 5 * 60_000 }
  );
  if (!res.ok || !res.data)
    throw new Error(res.error ?? 'could not create a worktree');
  return res.data.path;
}

/** Both flavors claim flock://, and every build folder holds another copy
    with the same bundle id, so neither the default handler nor a bundle id
    names the Flock that is running: `open -b` started a second instance from
    a build folder. The link goes to the running app by its path. */
export const FLOCK_EXECUTABLES = ['Flock-dev', 'Flock'] as const;

/** The `.app` folder holding a running executable's path, or null. */
export function appBundleOf(executablePath: string): string | null {
  const m = /^(.*?\.app)\/Contents\/MacOS\//.exec(
    executablePath.replace(/^-/, '')
  );
  return m ? m[1]! : null;
}

export function openArgs(url: string, runningApp: string | null): string[] {
  return runningApp ? ['-a', runningApp, url] : [url];
}

async function stdoutOf(argv: string[]): Promise<string> {
  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'ignore' });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

/** The oldest process of the executable is the app: its pane bridges run
    the same executable, started after it. Flock Dev first: the two never
    run at once. */
async function runningFlockApp(): Promise<string | null> {
  for (const executable of FLOCK_EXECUTABLES) {
    const pid = (
      await stdoutOf(['/usr/bin/pgrep', '-o', '-x', executable])
    ).split('\n')[0];
    if (!pid) continue;
    const app = appBundleOf(
      await stdoutOf(['/bin/ps', '-o', 'comm=', '-p', pid])
    );
    if (app) return app;
  }
  return null;
}

export async function openInFlock(url: string): Promise<void> {
  const args = openArgs(url, await runningFlockApp());
  const proc = Bun.spawn(['/usr/bin/open', ...args], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  if ((await proc.exited) !== 0)
    throw new Error(
      `could not open flock: ${redactToken((await new Response(proc.stderr).text()).trim())}`
    );
}

/** `open` echoes the URL it failed on, token included, into its stderr. */
export function redactToken(text: string): string {
  return text.replace(/token=[^&\s'"]*/g, 'token=…');
}
