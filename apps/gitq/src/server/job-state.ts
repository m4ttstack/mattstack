import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { APP_ROOT } from '../core/app-root.ts';

export type JobStatus = 'starting' | 'working' | 'conflict' | 'done' | 'error';
export type JobAction = 'sync' | 'publish' | 'absorb' | 'restructure';

export interface JobState {
  /** Absolute repo path; '' until the server seeds it at spawn time. */
  repoPath: string;
  /** Stack name; '' until seeded. */
  stack: string;
  /** Which board action this job runs; '' until seeded. */
  action: JobAction | '';
  status: JobStatus;
  /** Free text the board shows verbatim, e.g. "resolving 2 conflicts on api (commit 3/5)". */
  detail?: string;
  tabId?: string;
  workspaceId?: string;
  /** Claude Code session id, captured by the status CLI on any write so the
      board can relaunch the same conversation via `claude --resume`. */
  sessionId?: string;
  startedAt: number;
  updatedAt: number;
}

/** Per-job JSON files live here; the server owns naming, the agent just writes. */
export const JOBS_DIR = join(APP_ROOT, 'state', 'jobs');

/** Deterministic file path for a (repo, stack, action) triple, so a repeat
    launch resolves the same file. */
export function jobFilePath(repoPath: string, stack: string, action: JobAction, dir: string = JOBS_DIR): string {
  const slug = `${repoPath}-${stack}-${action}`
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
  return join(dir, `${slug}.json`);
}

/** Read-merge-write a job state file. First write stamps startedAt; every
    write stamps updatedAt. Atomic via tmp file + rename. */
export function writeJobState(
  path: string,
  patch: Partial<JobState> & { status: JobStatus },
  now: number = Date.now(),
): JobState {
  let prev: Partial<JobState> = {};
  try {
    prev = JSON.parse(readFileSync(path, 'utf8')) as JobState;
  } catch {
    // no prior file, or unreadable: start fresh
  }
  const next: JobState = {
    repoPath: patch.repoPath ?? prev.repoPath ?? '',
    stack: patch.stack ?? prev.stack ?? '',
    action: patch.action ?? prev.action ?? '',
    status: patch.status,
    detail: patch.detail ?? prev.detail,
    tabId: patch.tabId ?? prev.tabId,
    workspaceId: patch.workspaceId ?? prev.workspaceId,
    sessionId: patch.sessionId ?? prev.sessionId,
    startedAt: prev.startedAt ?? now,
    updatedAt: now,
  };
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  renameSync(tmp, path);
  return next;
}

/** All job states in the dir; unreadable files are skipped. */
export function readJobStates(dir: string = JOBS_DIR): JobState[] {
  const out: JobState[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const state = JSON.parse(readFileSync(join(dir, name), 'utf8')) as JobState;
      if (state.status) out.push(state);
    } catch {
      continue;
    }
  }
  return out;
}

/** Delete job states not touched in maxAgeMs (default 24h). Pruning is by
    age AND terminal status; a job parked at a human gate or mid-conflict
    keeps its file until it finishes. */
export function pruneJobStates(
  maxAgeMs: number = 24 * 60 * 60 * 1000,
  dir: string = JOBS_DIR,
  now: number = Date.now(),
): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    let state: Partial<JobState> | undefined;
    try {
      state = JSON.parse(readFileSync(path, 'utf8')) as JobState;
    } catch {
      continue;
    }
    const isTerminal = state.status === 'done' || state.status === 'error';
    if (
      isTerminal &&
      typeof state.updatedAt === 'number' &&
      now - state.updatedAt > maxAgeMs
    ) {
      rmSync(path, { force: true });
    }
  }
}
