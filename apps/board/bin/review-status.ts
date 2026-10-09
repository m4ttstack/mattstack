import { existsSync } from 'fs';

import { agentHarness } from '../src/agent-launch.ts';
import {
  boardRootFromStatePath,
  emitAgentStatus,
} from '../src/agent-status/emit.ts';
import { integrationsOn, resolveCallerSession } from '../src/caller-session.ts';
import type {
  ReviewOutcome,
  ReviewState,
  ReviewStatus,
} from '../src/review-state.ts';
import {
  dbPathForRoot,
  ingestReport,
  openStateDb,
  readByHandle,
  updateByHandle,
} from '../src/state/index.ts';

const VALID_STATUS: ReviewStatus[] = ['queued', 'reviewing', 'done', 'error'];
const VALID_OUTCOME: ReviewOutcome[] = ['comment', 'approve'];

/** Parse ARGV into positional args and a --outcome flag. Keeps the shape
    backward-compatible: existing `<path> <status> [message]` still works. */
function parseArgs(argv: string[]): {
  path?: string;
  status?: string;
  message: string;
  outcome?: string;
  session?: string;
} {
  let outcome: string | undefined;
  let session: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--outcome') {
      outcome = argv[++i];
    } else if (a.startsWith('--outcome=')) {
      outcome = a.slice('--outcome='.length);
    } else if (a === '--session') {
      session = argv[++i];
    } else if (a.startsWith('--session=')) {
      session = a.slice('--session='.length);
    } else {
      rest.push(a);
    }
  }
  const [path, status, ...msg] = rest;
  return { path, status, message: msg.join(' ').trim(), outcome, session };
}

const parsed = parseArgs(process.argv.slice(2));

if (
  !parsed.path ||
  !parsed.status ||
  !VALID_STATUS.includes(parsed.status as ReviewStatus)
) {
  console.error(
    `usage: review-status <statePath> <${VALID_STATUS.join('|')}> [message] [--outcome ${VALID_OUTCOME.join('|')}]`
  );
  process.exit(1);
}
if (
  parsed.outcome !== undefined &&
  !VALID_OUTCOME.includes(parsed.outcome as ReviewOutcome)
) {
  console.error(`--outcome must be one of ${VALID_OUTCOME.join('|')}`);
  process.exit(1);
}

const status = parsed.status as ReviewStatus;
const outcome = parsed.outcome as ReviewOutcome | undefined;
const dbPath = dbPathForRoot(boardRootFromStatePath(parsed.path));
if (!existsSync(dbPath)) {
  console.error(`no board db at ${dbPath}; stale pre-upgrade handle?`);
  process.exit(1);
}
const db = openStateDb(dbPath, 'cli');
// The pane's own session is exposed to its shell commands via env; capture
// it on every write so a resume from the board finds the latest known id.
const caller =
  parsed.session === undefined
    ? await resolveCallerSession(
        process.env,
        integrationsOn(),
        'status',
        () =>
          (readByHandle(parsed.path!, db) as { agentId?: string } | null)
            ?.agentId,
        agentHarness
      )
    : {};
if (caller.problem) console.error(caller.problem);
const sessionId = parsed.session ?? caller.sessionId;
const sessionHarness = caller.harness;
const merged = updateByHandle(
  parsed.path,
  {
    status,
    ...(parsed.message ? { message: parsed.message } : {}),
    ...(outcome ? { outcome } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionId && sessionHarness ? { sessionHarness } : {}),
  },
  Date.now(),
  db
) as (ReviewState & { mrUrl: string; iid: number }) | null;
if (!merged) {
  console.error(
    `no state row for ${parsed.path}; was this pane launched by a board on this machine?`
  );
  process.exit(1);
}

ingestReport(parsed.path, db);

await emitAgentStatus(
  {
    mrUrl: merged.mrUrl,
    iid: merged.iid,
    kind: 'review',
    status,
    outcome,
  },
  boardRootFromStatePath(parsed.path)
);
