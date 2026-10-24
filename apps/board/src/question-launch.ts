import type { AgentLaunchResult } from './agent-launch.ts';
import type { AgentSettings, BoardConfig } from './config.ts';
import type { BoardMR } from './data.ts';
import type { launchQuestion } from './herdr.ts';
import { dedupInFlight, QUESTION_IN_FLIGHT } from './launch-dedup.ts';
import { launchErrorMessage } from './launch-error.ts';
import {
  questionHandle,
  type QuestionPatch,
  type QuestionState,
} from './question-state.ts';
import { parseReportFinding } from './review-finding.ts';

/** What a question launch needs of an MR. */
export type QuestionMr = Pick<BoardMR, 'iid' | 'rtRepo'> & {
  author: Pick<BoardMR['author'], 'username' | 'name'>;
};

/** Everything the route touches outside itself, so each behaviour is a test
    with a fake and server.ts stays a thin shell. */
export interface QuestionLaunchIo {
  findMr(mrUrl: string): Promise<QuestionMr | undefined>;
  /** The review's structured report (`readReviewReportJson`), null when none. */
  readReportJson(mrUrl: string): string | null;
  /** Where that report lives, for the pane to read the finding from. */
  reportJsonPath(mrUrl: string): string;
  config: Pick<BoardConfig, 'reviewCwd' | 'questionsWorkspace'>;
  readQuestion(mrUrl: string, findingId: string): QuestionState | undefined;
  writeQuestion(mrUrl: string, findingId: string, patch: QuestionPatch): void;
  launch: typeof launchQuestion;
  focusPane(pane: { paneId?: string; tabId?: string }): Promise<unknown>;
  resolveRepo(mr: QuestionMr, mrUrl: string): string;
  agentSettings(): AgentSettings;
  pack(boardTabId: string | undefined): string | undefined;
}

export interface QuestionLaunchResult {
  status: number;
  body: string | object;
}

const BAD_BODY = 'expected { mrUrl, iid, gateId, findingId }';

function parseBody(body: unknown): {
  mrUrl: string;
  iid: number;
  gateId: string;
  findingId: string;
  focusOnly: boolean;
  boardTabId: string | undefined;
} | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.mrUrl !== 'string' ||
    !b.mrUrl ||
    typeof b.iid !== 'number' ||
    !Number.isInteger(b.iid) ||
    typeof b.gateId !== 'string' ||
    !b.gateId ||
    typeof b.findingId !== 'string' ||
    !b.findingId
  )
    return null;
  return {
    mrUrl: b.mrUrl,
    iid: b.iid,
    gateId: b.gateId,
    findingId: b.findingId,
    focusOnly: b.focus === true,
    boardTabId:
      typeof b.boardTabId === 'string' && b.boardTabId
        ? b.boardTabId
        : undefined,
  };
}

/** Whether the review's report json lists a finding with this id. A report
    that does not parse, or has no such finding, has nothing to ask about. */
function reportHasFinding(json: string | null, findingId: string): boolean {
  if (json === null) return false;
  try {
    const findings = (JSON.parse(json) as { findings?: unknown }).findings;
    return (
      Array.isArray(findings) &&
      findings.some(f => parseReportFinding(f)?.id === findingId)
    );
  } catch {
    return false;
  }
}

/** POST /question: opens a read-only question pane for one review finding in
    the questions workspace and brings it forward. A finding with a live pane
    is focused instead of launched a second time. The launch is not awaited:
    the row is `queued` and the route has answered by the time the pane is up. */
export async function handleQuestionLaunch(
  body: unknown,
  io: QuestionLaunchIo
): Promise<QuestionLaunchResult> {
  const parsed = parseBody(body);
  if (!parsed) return { status: 400, body: BAD_BODY };
  const { mrUrl, iid, gateId, findingId, focusOnly, boardTabId } = parsed;
  const mr = await io.findMr(mrUrl);
  if (!mr) return { status: 400, body: `unknown MR "${mrUrl}"` };
  if (mr.iid !== iid)
    return { status: 400, body: `iid ${iid} does not match ${mrUrl}` };
  const cwd = io.config.reviewCwd;
  if (!cwd) return { status: 400, body: 'reviewCwd not configured' };
  if (!reportHasFinding(io.readReportJson(mrUrl), findingId))
    return {
      status: 409,
      body: 'this review has no findings report to ask about',
    };

  const dedup = await dedupInFlight(
    io.readQuestion(mrUrl, findingId),
    QUESTION_IN_FLIGHT,
    focusOnly,
    { focusPane: pane => io.focusPane(pane) }
  );
  if (dedup.kind === 'focused')
    return { status: 200, body: { ok: true, focused: true } };
  if (dedup.kind === 'refused') return { status: 409, body: dedup.reason };

  io.writeQuestion(mrUrl, findingId, { status: 'queued', iid, gateId });
  // Two-argument then: a failure to record or focus a pane that did come up
  // is not a launch failure, and must not turn the row into an error.
  void io
    .launch({
      mrUrl,
      iid,
      cwd,
      repo: io.resolveRepo(mr, mrUrl),
      workspaceLabel: io.config.questionsWorkspace,
      statePath: questionHandle(mrUrl, findingId),
      pack: io.pack(boardTabId),
      author: mr.author.name ?? mr.author.username,
      ...io.agentSettings(),
      findingId,
      gateId,
      reportJsonPath: io.reportJsonPath(mrUrl),
    })
    .then(
      async (result: AgentLaunchResult) => {
        if (result.focusedExisting) return;
        io.writeQuestion(mrUrl, findingId, {
          status: 'live',
          agentId: result.agentId,
          paneId: result.paneId,
          tabId: result.tabId,
          workspaceId: result.workspaceId,
        });
        try {
          await io.focusPane({ paneId: result.paneId, tabId: result.tabId });
        } catch (err) {
          console.error(
            `question pane focus failed: ${err instanceof Error ? err.message : err}`
          );
        }
      },
      err => {
        console.error(
          `question launch failed: ${err instanceof Error ? err.message : err}`
        );
        io.writeQuestion(mrUrl, findingId, {
          status: 'error',
          message: launchErrorMessage('question', err),
        });
      }
    )
    .catch(err =>
      console.error(
        `question state write failed: ${err instanceof Error ? err.message : err}`
      )
    );
  return { status: 200, body: { ok: true } };
}
