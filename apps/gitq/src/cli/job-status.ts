import { writeJobState, type JobStatus } from '../server/job-state.ts';

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

/**
 * The status writer the board hands to a spawned agent pane via --status-bin.
 * Deliberately outside the COMMANDS table: it writes a board job-state file by
 * absolute path and never needs a repo, so it must not go through the CLI
 * context that resolves one.
 */
export function runJobStatus(argv: string[]): number {
  const parsed = parseJobStatusArgs(argv);
  if (!parsed.path || !parsed.status || !VALID_STATUS.includes(parsed.status as JobStatus)) {
    console.error(`usage: ${JOB_STATUS_USAGE}`);
    return 1;
  }
  // The Claude Code session id reaches Bash tool commands via env; capture it
  // on every write so a resume from the board finds the latest known id.
  const sessionId = parsed.session || process.env.CLAUDE_CODE_SESSION_ID || undefined;
  writeJobState(parsed.path, {
    status: parsed.status as JobStatus,
    ...(parsed.detail ? { detail: parsed.detail } : {}),
    ...(sessionId ? { sessionId } : {}),
  });
  return 0;
}
