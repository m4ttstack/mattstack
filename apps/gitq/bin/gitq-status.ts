#!/usr/bin/env bun
import { writeJobState, type JobStatus } from '../src/server/job-state.ts';

const VALID_STATUS: JobStatus[] = ['starting', 'working', 'conflict', 'done', 'error'];

/** Parse ARGV into positionals plus a --session flag: <path> <status> [detail...]. */
function parseArgs(argv: string[]): { path?: string; status?: string; detail: string; session?: string } {
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

const parsed = parseArgs(process.argv.slice(2));

if (!parsed.path || !parsed.status || !VALID_STATUS.includes(parsed.status as JobStatus)) {
  console.error(`usage: gitq-status <statePath> <${VALID_STATUS.join('|')}> [detail] [--session <id>]`);
  process.exit(1);
}

// The Claude Code session id reaches Bash tool commands via env; capture it on
// every write so a resume from the board finds the latest known id.
const sessionId = parsed.session || process.env.CLAUDE_CODE_SESSION_ID || undefined;
writeJobState(parsed.path, {
  status: parsed.status as JobStatus,
  ...(parsed.detail ? { detail: parsed.detail } : {}),
  ...(sessionId ? { sessionId } : {}),
});
