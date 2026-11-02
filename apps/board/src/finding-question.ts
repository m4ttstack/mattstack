import { optionValue, type GateOption } from '@mattstack/gate-kit';
import type {
  GateRow as FacilityGateRow,
  PaneSendResult,
} from '@mattstack/rt-client';
import { isFindingsQuestion } from './client/board/review-gate.ts';
import { hasQuestionForm } from './question-form.ts';

// `POST /review/finding-question`: the human's question about one finding
// of a review gate goes into the review agent's own pane as
// `/board:review-finding-question <gate> <finding> "<question>"`, so the
// session that wrote the finding answers it (skills-src/review-finding-question).
// server.ts is the shell; this module owns the checks and the delivery.

export const FINDING_ID_RE = /^[A-Za-z0-9._:-]+$/;
export const MAX_QUESTION_CHARS = 2000;
/** How long the pane gets to drop its gate form after the Escape. */
export const ESCAPE_SETTLE_MS = 600;
export const NO_REVIEW_PANE =
  "the review pane isn't running; resume the review from its row first";
/** The pane is blocked on something other than Claude Code's question form
    (a permission prompt, a trust dialog): an Escape there would answer it. */
export const PANE_AT_OTHER_PROMPT =
  'the review pane is waiting on a prompt; answer it there first';

export interface FindingQuestionIo {
  /** The MR's review-post gate in the board's gate cache, any status. */
  reviewGate(mrUrl: string): FacilityGateRow | undefined;
  /** The review lane's pane, herdr tab and Claude session on file
      (`readReviewStates()`). */
  reviewPane(
    mrUrl: string
  ): { paneId?: string; tabId?: string; sessionId?: string } | undefined;
  /** rt-client `paneSend`. `selfSession` has the daemon send to the pane
      running that Claude session, `paneId` being the fallback; the reply's
      `paneId` names the pane it went to. */
  paneSend(payload: {
    paneId: string;
    text: string;
    selfSession?: string;
  }): Promise<{ ok: boolean; data?: PaneSendResult; error?: string }>;
  /** `herdr pane read <paneId> --source visible`; throws when unreadable. */
  readScreen(paneId: string): Promise<string>;
  /** `herdr pane send-keys <paneId> escape`. */
  sendEscape(paneId: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  focusPane(state: { paneId: string; tabId?: string }): Promise<unknown>;
  logError?(message: string): void;
}

export interface FindingQuestionResult {
  status: number;
  body: string | { ok: true };
}

interface Body {
  mrUrl: string;
  iid: number;
  gateId: string;
  findingId: string;
  question: string;
  tabId?: string;
}

function readBody(x: unknown): Body | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (
    typeof o.mrUrl !== 'string' ||
    !o.mrUrl ||
    typeof o.iid !== 'number' ||
    typeof o.gateId !== 'string' ||
    !o.gateId ||
    typeof o.findingId !== 'string' ||
    typeof o.question !== 'string'
  )
    return null;
  if (o.tabId !== undefined && typeof o.tabId !== 'string') return null;
  return {
    mrUrl: o.mrUrl,
    iid: o.iid,
    gateId: o.gateId,
    findingId: o.findingId,
    question: o.question,
    ...(typeof o.tabId === 'string' && o.tabId ? { tabId: o.tabId } : {}),
  };
}

/** The question as one quoted argument: every run of whitespace (newlines
    included) becomes one space, then `\` and `"` are escaped, backslash
    first so a question ending in `\` cannot escape the closing quote. */
export function quoteQuestion(question: string): string {
  const flat = question.replace(/\s+/g, ' ').trim();
  return `"${flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The line typed into the review pane. */
export function findingQuestionText(
  gateId: string,
  findingId: string,
  question: string
): string {
  return `/board:review-finding-question ${gateId} ${findingId} ${quoteQuestion(question)}`;
}

/** The finding ids a review-post gate offers, from its findings questions'
    options (chunked `findings-N` included). */
export function gateFindingIds(row: FacilityGateRow): Set<string> {
  const ids = new Set<string>();
  for (const q of row.questions)
    if (isFindingsQuestion(q))
      for (const o of q.options as GateOption[]) ids.add(optionValue(o));
  return ids;
}

function delivered(res: {
  ok: boolean;
  data?: PaneSendResult;
}): 'ok' | 'at-prompt' | 'gone' | 'other' {
  const d = res.ok ? res.data?.delivered : undefined;
  if (d === 'accepted' || d === 'queued') return 'ok';
  if (d === 'refused' && res.data?.reason === 'at a prompt') return 'at-prompt';
  // The daemon's answer for a pane herdr no longer has (agent_not_found) or
  // that no longer runs Claude.
  if (d === 'refused' && res.data?.reason === 'not a claude pane')
    return 'gone';
  return 'other';
}

function failureReason(res: {
  ok: boolean;
  data?: PaneSendResult;
  error?: string;
}): string {
  if (!res.ok)
    return `the review pane didn't take the question: ${res.error ?? 'unknown error'}`;
  return `the review pane didn't take the question: ${res.data?.delivered ?? 'no answer'}${res.data?.reason ? ` (${res.data.reason})` : ''}`;
}

export async function handleFindingQuestion(
  raw: unknown,
  io: FindingQuestionIo
): Promise<FindingQuestionResult> {
  const body = readBody(raw);
  if (!body)
    return {
      status: 400,
      body: 'expected { mrUrl, iid, gateId, findingId, question, tabId? }',
    };
  if (!FINDING_ID_RE.test(body.findingId))
    return {
      status: 400,
      body: 'finding id has a character the prompt cannot carry',
    };
  const question = body.question.trim();
  if (!question) return { status: 400, body: 'the question is empty' };
  if (body.question.length > MAX_QUESTION_CHARS)
    return {
      status: 400,
      body: `the question is longer than ${MAX_QUESTION_CHARS} characters`,
    };

  const gate = io.reviewGate(body.mrUrl);
  if (!gate || gate.status !== 'open' || gate.id !== body.gateId)
    return {
      status: 409,
      body: "that gate isn't this MR's open review gate any more",
    };
  if (!gateFindingIds(gate).has(body.findingId))
    return { status: 409, body: "the review gate doesn't list that finding" };
  const lane = io.reviewPane(body.mrUrl);
  const paneId = lane?.paneId;
  if (!paneId) return { status: 409, body: NO_REVIEW_PANE };

  const text = findingQuestionText(body.gateId, body.findingId, question);
  // The pane on file can be stale (herdr renumbers panes across restarts),
  // so the send names the review's Claude session and the daemon resolves
  // the pane running it. Every later step uses the pane the send went to.
  const send = (target: string) =>
    io.paneSend({
      paneId: target,
      text,
      ...(lane.sessionId ? { selfSession: lane.sessionId } : {}),
    });
  let res = await send(paneId);
  let livePane = (res.ok && res.data?.paneId) || paneId;
  if (delivered(res) === 'gone') return { status: 409, body: NO_REVIEW_PANE };
  if (delivered(res) === 'at-prompt') {
    // Only Claude Code's question form (the gate's own) is dismissed. Any
    // other prompt, or a screen herdr cannot read, is left for the human:
    // an Escape there would answer it.
    let screen: string | null = null;
    try {
      screen = await io.readScreen(livePane);
    } catch (err) {
      io.logError?.(
        `finding question screen read failed: ${err instanceof Error ? err.message : err}`
      );
    }
    if (screen === null || !hasQuestionForm(screen))
      return { status: 409, body: PANE_AT_OTHER_PROMPT };
    await io.sendEscape(livePane);
    await io.sleep(ESCAPE_SETTLE_MS);
    res = await send(livePane);
    livePane = (res.ok && res.data?.paneId) || livePane;
    if (delivered(res) === 'gone') return { status: 409, body: NO_REVIEW_PANE };
  }
  if (delivered(res) !== 'ok') return { status: 409, body: failureReason(res) };

  // Flock comes forward on the pane; the tab is herdr's fallback.
  const tabId = body.tabId ?? lane.tabId;
  // The question is in; a focus that fails must not report it lost.
  try {
    await io.focusPane({ paneId: livePane, ...(tabId ? { tabId } : {}) });
  } catch (err) {
    io.logError?.(
      `finding question focus failed: ${err instanceof Error ? err.message : err}`
    );
  }
  return { status: 200, body: { ok: true } };
}
