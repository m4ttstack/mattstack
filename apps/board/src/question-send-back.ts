import { createHash } from 'crypto';

import type { GateRow } from '@mattstack/rt-client';
import type { FindingRevision, QuestionState } from './question-state.ts';
import { parseReportFinding, type ReportFinding } from './review-finding.ts';

/** What the questions agent sends back: the finding rewritten (same id), or
    a drop. */
export type RevisionInput = { finding: ReportFinding } | { drop: true };

export interface SendBackInput {
  /** The question row's handle, the state path the pane was given. */
  handle: string;
  revision: RevisionInput;
  /** sha-256 of the report json as the agent last read it. */
  reportSha: string;
  now: number;
}

export type SendBackResult =
  { kind: 'sent' } | { kind: 'refused'; message: string };

/** Everything the send-back touches outside itself, so each refusal is a test
    with a fake and the bin stays a thin shell. */
export interface SendBackIo {
  question(handle: string): QuestionState | undefined;
  /** The MR's review report json, derived from the board root the handle
      sits under (the pane's environment names no board). */
  reportJsonPath(mrUrl: string): string;
  readFile(path: string): string | null;
  writeFile(path: string, text: string): void;
  removeFile(path: string): void;
  /** The MR's open review-post gate, 'parked' when the only live one is
      parked, null when none is. */
  openReviewGate(mrUrl: string): Promise<GateRow | 'parked' | null>;
  gateClose(payload: {
    id: string;
    reason: 'revised';
  }): Promise<{ ok: boolean; error?: string }>;
  pendingRevision(mrUrl: string, now: number): FindingRevision | undefined;
  insertPendingRevision(r: Omit<FindingRevision, 'status' | 'newGate'>): void;
  deleteRevision(mrUrl: string, findingId: string, createdAt: number): void;
}

const refuse = (message: string): SendBackResult => ({
  kind: 'refused',
  message,
});

const ALREADY_CLOSED = 'the review was already submitted or closed';

/** Where the review agent reads the revision: beside the report json, under
    the same stem. */
export function revisionFilePath(reportJsonPath: string): string {
  return /\.json$/.test(reportJsonPath)
    ? reportJsonPath.replace(/\.json$/, '.revision.json')
    : `${reportJsonPath}.revision.json`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Whether a findings question of the gate offers this finding id. A chunked
    gate names them `findings-N`, an unchunked one `findings`. Options are
    either the bare id or `{ value, label }` with the id as the value. */
function gateHasFinding(gate: GateRow, findingId: string): boolean {
  return gate.questions.some(
    q =>
      /^findings(-\d+)?$/.test(q.id) &&
      q.options.some(o => (typeof o === 'string' ? o : o.value) === findingId)
  );
}

/** The report json's finding with this id, as the report holds it now. */
function reportFinding(json: string, findingId: string): ReportFinding | null {
  try {
    const findings = (JSON.parse(json) as { findings?: unknown }).findings;
    if (!Array.isArray(findings)) return null;
    for (const f of findings) {
      const parsed = parseReportFinding(f);
      if (parsed?.id === findingId) return parsed;
    }
  } catch {
    // An unreadable report has no finding to revise.
  }
  return null;
}

/** Sends a revised (or dropped) finding to the MR's review: writes the
    revision file for the review agent, records it as pending, and closes the
    current review gate as `revised`, which is what wakes the review agent to
    rebuild the gate. The gate is the MR's current one, not the one the
    question was asked from, because a question follows its MR across
    rebuilds. Every refusal happens before anything is written, except the
    close, which cleans up after itself. */
export async function sendBack(
  input: SendBackInput,
  io: SendBackIo
): Promise<SendBackResult> {
  const { revision, now } = input;
  const q = io.question(input.handle);
  if (!q) return refuse('this question is no longer tracked by the board');
  const { mrUrl, findingId } = q;
  if ('finding' in revision && revision.finding.id !== findingId)
    return refuse(`the revision must keep finding id ${findingId}`);

  const gate = await io.openReviewGate(mrUrl);
  if (gate === 'parked')
    return refuse(
      'the review is parked; resume it from the board, then send again'
    );
  if (!gate) return refuse(ALREADY_CLOSED);
  if (!gateHasFinding(gate, findingId))
    return refuse('this finding is no longer in the review');
  if (io.pendingRevision(mrUrl, now))
    return refuse('the review is being rebuilt; send again once it reopens');

  const reportPath = io.reportJsonPath(mrUrl);
  const report = io.readFile(reportPath);
  // A report that vanished has changed as far as the agent's read of it goes.
  if (report === null || sha256Hex(report) !== input.reportSha)
    return refuse(
      'the review report changed since you read it; re-read it and check the revision still holds'
    );
  const original = reportFinding(report, findingId);
  if (!original) return refuse('this finding is no longer in the review');

  const revised = 'finding' in revision ? revision.finding : null;
  const filePath = revisionFilePath(reportPath);
  const undo = () => {
    io.deleteRevision(mrUrl, findingId, now);
    io.removeFile(filePath);
  };
  io.writeFile(filePath, JSON.stringify({ findingId, revised, original }));
  try {
    io.insertPendingRevision({
      mrUrl,
      findingId,
      original,
      revised,
      closedGate: gate.id,
      createdAt: now,
    });
    const closed = await io.gateClose({ id: gate.id, reason: 'revised' });
    if (!closed.ok) {
      undo();
      return refuse(
        closed.error === 'already-answered' || closed.error === 'already-closed'
          ? ALREADY_CLOSED
          : `could not send the revision (${closed.error ?? 'unknown error'}); nothing was sent`
      );
    }
  } catch (err) {
    undo();
    return refuse(
      `could not send the revision (${err instanceof Error ? err.message : err}); nothing was sent`
    );
  }
  return { kind: 'sent' };
}
