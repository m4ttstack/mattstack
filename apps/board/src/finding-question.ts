import { optionValue, type GateOption } from '@mattstack/gate-kit';
import type {
  GateRow as FacilityGateRow,
  PaneSendResult,
} from '@mattstack/rt-client';
import { isFindingsQuestion } from './client/board/review-gate.ts';

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

export interface FindingQuestionIo {
  /** The MR's review-post gate in the board's gate cache, any status. */
  reviewGate(mrUrl: string): FacilityGateRow | undefined;
  /** The review lane's pane and herdr tab on file (`readReviewStates()`). */
  reviewPane(mrUrl: string): { paneId?: string; tabId?: string } | undefined;
  paneSend(payload: {
    paneId: string;
    text: string;
  }): Promise<{ ok: boolean; data?: PaneSendResult; error?: string }>;
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
    included) becomes one space, and `"` is escaped. */
export function quoteQuestion(question: string): string {
  return `"${question.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"')}"`;
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
}): 'ok' | 'at-prompt' | 'other' {
  const d = res.ok ? res.data?.delivered : undefined;
  if (d === 'accepted' || d === 'queued') return 'ok';
  if (d === 'refused' && res.data?.reason === 'at a prompt') return 'at-prompt';
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
  let res = await io.paneSend({ paneId, text });
  if (delivered(res) === 'at-prompt') {
    // The pane is showing the gate's own form: dismiss it and type again.
    await io.sendEscape(paneId);
    await io.sleep(ESCAPE_SETTLE_MS);
    res = await io.paneSend({ paneId, text });
  }
  if (delivered(res) !== 'ok') return { status: 409, body: failureReason(res) };

  // Flock comes forward on the pane; the tab is herdr's fallback.
  const tabId = body.tabId ?? lane.tabId;
  // The question is in; a focus that fails must not report it lost.
  try {
    await io.focusPane({ paneId, ...(tabId ? { tabId } : {}) });
  } catch (err) {
    io.logError?.(
      `finding question focus failed: ${err instanceof Error ? err.message : err}`
    );
  }
  return { status: 200, body: { ok: true } };
}
