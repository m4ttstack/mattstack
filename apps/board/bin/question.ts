import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';

import { gateClose, gateList, type GateRow } from '@mattstack/rt-client';
import { boardRootFromStatePath } from '../src/agent-status/emit.ts';
import {
  sendBack,
  type RevisionInput,
  type SendBackIo,
} from '../src/question-send-back.ts';
import {
  claimPendingRevision,
  deleteRevision,
  pendingRevision,
  readQuestionByHandle,
  writeQuestionStateByHandle,
  type QuestionStatus,
} from '../src/question-state.ts';
import { parseReportFinding } from '../src/review-finding.ts';
import { reviewReportJsonPath } from '../src/review-state.ts';
import { dbPathForRoot, mintHandle, openStateDb } from '../src/state/index.ts';

/** The statuses the questions agent reports. `queued` is the board's own
    first write, never the pane's. */
const PANE_STATUSES: QuestionStatus[] = ['live', 'done', 'error'];

const USAGE = `usage:
  question status <state> <${PANE_STATUSES.join('|')}> [message]
  question send-back <state> --revision <file> --report-sha <hex>`;

/** Exit codes: 0 done, 1 the work failed, 2 bad usage or an unknown row, 3 the
    board refused the send-back (the skill tells the user why). */
function usage(message?: string): never {
  console.error(message ? `${message}\n${USAGE}` : USAGE);
  process.exit(2);
}

function flag(argv: string[], name: string): string | undefined {
  const eq = argv.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

/** The revision file is `{ "finding": <report finding> }` or `{ "drop": true }`. */
function readRevision(path: string): RevisionInput {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    usage(
      `cannot read revision file ${path}: ${err instanceof Error ? err.message : err}`
    );
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  if (o.drop === true) return { drop: true };
  const finding = parseReportFinding(o.finding);
  if (!finding)
    usage(
      `${path} must be { "finding": <report finding> } or { "drop": true }`
    );
  return { finding };
}

/** The board's db, opened from the root the handle sits under. A pane has no
    server and none of its environment, so the handle is the only thing that
    says whose board this is. */
function openBoard(handle: string) {
  const root = boardRootFromStatePath(handle);
  const dbPath = dbPathForRoot(root);
  if (!existsSync(dbPath)) {
    console.error(`no board db at ${dbPath}; stale pre-upgrade handle?`);
    process.exit(2);
  }
  return { root, db: openStateDb(dbPath, 'cli') };
}

/** The MR's open review-post gate. `gateList` filtered to open and parked
    rows, so a gate the board or the review agent already closed never shows;
    the newest open one wins over any parked one. */
async function openReviewGate(
  mrUrl: string
): Promise<GateRow | 'parked' | null> {
  const res = await gateList({
    subject: `mr:${mrUrl}`,
    kind: 'review-post',
    status: ['open', 'parked'],
  });
  if (!res.ok || !res.data)
    throw new Error(`gate list failed: ${res.error ?? 'no data'}`);
  const rows = res.data.gates.filter(
    g => g.status === 'open' || g.status === 'parked'
  );
  const open = rows
    .filter(g => g.status === 'open')
    .sort((a, b) => b.openedAt - a.openedAt)[0];
  if (open) return open;
  return rows.length > 0 ? 'parked' : null;
}

const [verb, handle, ...rest] = process.argv.slice(2);

if (verb === 'status') {
  const [status, ...msg] = rest;
  if (!handle || !PANE_STATUSES.includes(status as QuestionStatus)) usage();
  const { db } = openBoard(handle);
  const message = msg.join(' ').trim();
  const written = writeQuestionStateByHandle(
    handle,
    { status: status as QuestionStatus, ...(message ? { message } : {}) },
    Date.now(),
    db
  );
  if (!written) {
    console.error(
      `no question row for ${handle}; was this pane launched by a board on this machine?`
    );
    process.exit(2);
  }
} else if (verb === 'send-back') {
  const revisionFile = flag(rest, '--revision');
  const reportSha = flag(rest, '--report-sha');
  if (!handle || !revisionFile || !reportSha) usage();
  const revision = readRevision(revisionFile);
  const { root, db } = openBoard(handle);
  const io: SendBackIo = {
    question: h => readQuestionByHandle(h, db),
    // The root comes from the handle, not boardStateRoot(): that reads the
    // pane's environment, which names no board.
    reportJsonPath: mrUrl =>
      reviewReportJsonPath(mintHandle('review', mrUrl, root)),
    readFile: path => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    writeFile: (path, text) => writeFileSync(path, text),
    removeFile: path => rmSync(path, { force: true }),
    openReviewGate,
    gateClose,
    pendingRevision: (mrUrl, now) => pendingRevision(mrUrl, now, db),
    claimPendingRevision: (r, now) => claimPendingRevision(r, now, db),
    deleteRevision: (mrUrl, findingId, createdAt) =>
      deleteRevision(mrUrl, findingId, createdAt, db),
  };
  try {
    const result = await sendBack(
      { handle, revision, reportSha, now: Date.now() },
      io
    );
    if (result.kind === 'refused') {
      console.error(result.message);
      process.exit(3);
    }
    console.log('sent: the review gate is closed and the review will rebuild');
  } catch (err) {
    console.error(
      `send-back failed: ${err instanceof Error ? err.message : err}`
    );
    process.exit(1);
  }
} else {
  usage();
}
