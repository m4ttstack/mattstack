import { integrationsSwitchOn, nativeCallerFromEnv } from '@mattstack/rt-client';
import { readJobState, writeJobState, type JobLaunch, type JobState, type JobStatus } from '../server/job-state.ts';

export const VALID_STATUS: JobStatus[] = ['starting', 'working', 'conflict', 'done', 'error'];

export const JOB_STATUS_USAGE = `gitq job-status <statePath> <${VALID_STATUS.join('|')}> [detail] [--session <id>]`;

interface ParsedJobStatus {
  path?: string;
  status?: string;
  detail: string;
  session?: string;
}

/** Parse ARGV into positionals plus a --session flag: <path> <status> [detail...]. */
export function parseJobStatusArgs(argv: string[]): ParsedJobStatus {
  let session: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--session') {
      session = argv[++i];
    } else if (a.startsWith('--session=')) {
      session = a.slice('--session='.length);
    } else {
      rest.push(a);
    }
  }
  const [path, status, ...detail] = rest;
  return { path, status, detail: detail.join(' ').trim(), session };
}

/** How long a report waits for the board to record the session its launch started. */
export const LAUNCH_WAIT_MS = 10_000;
const LAUNCH_POLL_MS = 250;

export interface JobStatusDeps {
  env?: Record<string, string | undefined>;
  switchOn?: () => boolean;
  /** Synchronous: the status CLI also runs under node, with no event loop work to yield to. */
  sleep?: (ms: number) => void;
  launchWaitMs?: number;
  stderr?: (line: string) => void;
}

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** The job's launch once it names a session, waiting out the moment between
    the agent's first report and the board recording what its launch returned. */
function boundLaunch(path: string, launch: JobLaunch, deps: Required<Pick<JobStatusDeps, 'sleep' | 'launchWaitMs'>>): JobLaunch | undefined {
  let current: JobLaunch | undefined = launch;
  for (let waited = 0; !current?.sessionId && waited < deps.launchWaitMs; waited += LAUNCH_POLL_MS) {
    deps.sleep(LAUNCH_POLL_MS);
    current = readJobState(path)?.launch;
    if (!current) return undefined;
  }
  return current?.sessionId ? current : undefined;
}

/** Why the caller may not report this job, or the session to record when it may. */
function authorize(
  path: string,
  state: JobState | undefined,
  env: Record<string, string | undefined>,
  deps: Required<Pick<JobStatusDeps, 'sleep' | 'launchWaitMs'>>,
): { refused: string } | { sessionId?: string; unbound: boolean } {
  const caller = nativeCallerFromEnv(env, true);
  if (!state?.launch) return { sessionId: caller.sessionId, unbound: true };
  const launch = boundLaunch(path, state.launch, deps);
  if (!launch) return { refused: 'gitq has not recorded which agent session runs this job yet, so it did not save this status.' };
  const own = caller.both
    ? { sessionId: launch.harness === 'codex' ? caller.both.codex : launch.harness === 'claude' ? caller.both.claude : undefined, harness: launch.harness }
    : caller;
  if (!own.sessionId) {
    return { refused: 'This command names no agent session, so gitq cannot tell it runs this job and did not save this status.' };
  }
  if (own.harness !== launch.harness || own.sessionId !== launch.sessionId) {
    return { refused: 'Another agent session runs this job, so gitq did not save this status.' };
  }
  return { sessionId: own.sessionId, unbound: false };
}

/**
 * The status writer the board hands to a spawned agent pane via --status-bin.
 * Deliberately outside the COMMANDS table: it writes a board job-state file by
 * absolute path and never needs a repo, so it must not go through the CLI
 * context that resolves one.
 *
 * With the harness integrations switch on, a job the board launched through
 * rt takes reports only from the session that launch started, named by the
 * calling environment; --session never names the caller.
 */
export function runJobStatus(argv: string[], deps: JobStatusDeps = {}): number {
  const stderr = deps.stderr ?? ((line: string) => console.error(line));
  const parsed = parseJobStatusArgs(argv);
  if (!parsed.path || !parsed.status || !VALID_STATUS.includes(parsed.status as JobStatus)) {
    stderr(`usage: ${JOB_STATUS_USAGE}`);
    return 1;
  }
  const env = deps.env ?? process.env;
  let sessionId: string | undefined;
  if ((deps.switchOn ?? integrationsSwitchOn)()) {
    const verdict = authorize(parsed.path, readJobState(parsed.path), env, {
      sleep: deps.sleep ?? sleepSync,
      launchWaitMs: deps.launchWaitMs ?? LAUNCH_WAIT_MS,
    });
    if ('refused' in verdict) {
      stderr(verdict.refused);
      return 1;
    }
    sessionId = verdict.unbound ? parsed.session || verdict.sessionId : verdict.sessionId;
  } else {
    // The Claude Code session id reaches Bash tool commands via env; capture it
    // on every write so a resume from the board finds the latest known id.
    sessionId = parsed.session || env.CLAUDE_CODE_SESSION_ID || undefined;
  }
  writeJobState(parsed.path, {
    status: parsed.status as JobStatus,
    ...(parsed.detail ? { detail: parsed.detail } : {}),
    ...(sessionId ? { sessionId } : {}),
  });
  return 0;
}
