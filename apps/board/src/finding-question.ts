import {
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { optionValue, type GateOption } from '@mattstack/gate-kit';
import type {
  GateRow as FacilityGateRow,
  PaneSendResult,
} from '@mattstack/rt-client';
import { isFindingsQuestion } from './client/board/review-gate.ts';
import { hasQuestionForm } from './question-form.ts';

// `POST /review/finding-question`: the human's question about one finding
// of a review gate goes into the review agent's own pane as
// `/board:review-finding-question <gate> <finding> "<question-file>"`, so the
// session that wrote the finding answers it (skills-src/review-finding-question).
// A parked gate's pane was closed on park, so its question resumes the
// session with that line as the prompt instead.
// server.ts is the shell; this module owns the checks and the delivery.

export const FINDING_ID_RE = /^[A-Za-z0-9._:-]+$/;
export const MAX_QUESTION_CHARS = 2000;
/** How long the pane gets to drop its gate form after the Escape. */
export const ESCAPE_SETTLE_MS = 600;
export const NO_REVIEW_PANE = 'Resume the review from its row first';
/** A parked gate whose resume tab is already open: the pane is on its way
    up, and a second resume would only focus it. */
export const REVIEW_RESUMING =
  'Review pane is reopening. Ask again once it is up';
/** The pane is blocked on something other than Claude Code's question form
    (a permission prompt, a trust dialog): an Escape there would answer it. */
export const PANE_AT_OTHER_PROMPT =
  'Review pane is at a prompt. Answer it there first';
const QUESTION_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The review-finding-question skill's own forms, whose question lines must
    match its SKILL.md: an Escape there would drop a pending revision. */
const OWN_FORM_RE = /What should happen to \S+\?|Apply this revision to \S+\?/;

export interface FindingQuestionIo {
  /** The MR's review-post gate in the board's gate cache, any status. */
  reviewGate(mrUrl: string): FacilityGateRow | undefined;
  /** The review lane's herdr tab, Claude session and rt agent on file
      (`readReviewStates()`). */
  reviewPane(
    mrUrl: string
  ): { tabId?: string; sessionId?: string; agentId?: string } | undefined;
  /** The pane running that Claude session, or null when none runs it
      (rt-client `paneSelf` with no pane given, so a stale pane on file is
      never the answer); throws when the daemon cannot say. */
  sessionPane(sessionId: string): Promise<string | null>;
  /** Resumes the review's agent with `prompt` as its first message, the way
      a parked gate's answer resumes it (`resumeAgentPane` under the same
      tab label, so a resume tab already open is only focused). */
  resumeReview(
    mrUrl: string,
    prompt: string
  ): Promise<{ focusedExisting: boolean; paneId: string; tabId: string }>;
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
  /** Saves the question where the review pane can read it; returns the path. */
  writeQuestion(gateId: string, findingId: string, question: string): string;
  focusPane(state: { paneId: string; tabId?: string }): Promise<unknown>;
  logError?(message: string): void;
}

export interface FindingQuestionResult {
  status: number;
  body: string | { ok: true; resumed?: true };
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

/** Saves the question for the review pane and returns its path. A slash
    command over rt's paste limit never reaches the pane, so the line typed
    there carries this path and the question lives in the file. Files past
    `QUESTION_FILE_MAX_AGE_MS` are pruned on each write. */
export function writeQuestionFile(
  dir: string,
  gateId: string,
  findingId: string,
  question: string,
  now: number = Date.now()
): string {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    const old = join(dir, name);
    try {
      if (now - statSync(old).mtimeMs > QUESTION_FILE_MAX_AGE_MS) rmSync(old);
    } catch {
      // Another board's prune got there first.
    }
  }
  const path = join(dir, `${gateId}-${findingId}-${now}.md`);
  writeFileSync(path, `${question}\n`, { mode: 0o600 });
  return path;
}

/** The line typed into the review pane. */
export function findingQuestionText(
  gateId: string,
  findingId: string,
  questionPath: string
): string {
  return `/board:review-finding-question ${gateId} ${findingId} "${questionPath}"`;
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
    return `Review pane didn't take the question: ${res.error ?? 'unknown error'}`;
  return `Review pane didn't take the question: ${res.data?.delivered ?? 'no answer'}${res.data?.reason ? ` (${res.data.reason})` : ''}`;
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** Brings the pane forward. The question is in; a focus that fails must not
    report it lost. */
async function focusQuietly(
  io: FindingQuestionIo,
  state: { paneId: string; tabId?: string }
): Promise<void> {
  try {
    await io.focusPane(state);
  } catch (err) {
    io.logError?.(`finding question focus failed: ${message(err)}`);
  }
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
  if (!question) return { status: 400, body: 'Question is empty' };
  if (body.question.length > MAX_QUESTION_CHARS)
    return {
      status: 400,
      body: `Question is over ${MAX_QUESTION_CHARS} characters`,
    };

  const gate = io.reviewGate(body.mrUrl);
  if (
    !gate ||
    gate.id !== body.gateId ||
    (gate.status !== 'open' && gate.status !== 'parked')
  )
    return {
      status: 409,
      body: 'This review gate is no longer open',
    };
  if (!gateFindingIds(gate).has(body.findingId))
    return { status: 409, body: 'This review gate has no such finding' };
  const lane = io.reviewPane(body.mrUrl);

  // The pane on file can be stale (herdr renumbers panes across restarts)
  // and can belong to another agent by now, so the session is resolved
  // first and nothing is typed anywhere when no pane runs it.
  let paneId: string | null = null;
  if (lane?.sessionId) {
    try {
      paneId = await io.sessionPane(lane.sessionId);
    } catch (err) {
      return {
        status: 409,
        body: `Couldn't find the review pane: ${message(err)}`,
      };
    }
  }
  if (!paneId && (gate.status !== 'parked' || !lane?.agentId))
    return { status: 409, body: NO_REVIEW_PANE };

  let text: string;
  try {
    text = findingQuestionText(
      body.gateId,
      body.findingId,
      io.writeQuestion(body.gateId, body.findingId, question)
    );
  } catch (err) {
    return {
      status: 409,
      body: `Couldn't save the question: ${message(err)}`,
    };
  }

  if (!paneId) {
    let resumed;
    try {
      resumed = await io.resumeReview(body.mrUrl, text);
    } catch (err) {
      return {
        status: 409,
        body: `Review didn't resume: ${message(err)}`,
      };
    }
    if (resumed.focusedExisting) return { status: 409, body: REVIEW_RESUMING };
    await focusQuietly(io, {
      paneId: resumed.paneId,
      ...(resumed.tabId ? { tabId: resumed.tabId } : {}),
    });
    return { status: 200, body: { ok: true, resumed: true } };
  }

  // Every later step uses the pane the send went to.
  const send = (target: string) =>
    io.paneSend({
      paneId: target,
      text,
      ...(lane?.sessionId ? { selfSession: lane.sessionId } : {}),
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
      io.logError?.(`finding question screen read failed: ${message(err)}`);
    }
    if (screen === null || !hasQuestionForm(screen) || OWN_FORM_RE.test(screen))
      return { status: 409, body: PANE_AT_OTHER_PROMPT };
    try {
      await io.sendEscape(livePane);
    } catch (err) {
      return {
        status: 409,
        body: `Review pane didn't take the question: ${message(err)}`,
      };
    }
    await io.sleep(ESCAPE_SETTLE_MS);
    res = await send(livePane);
    livePane = (res.ok && res.data?.paneId) || livePane;
    if (delivered(res) === 'gone') return { status: 409, body: NO_REVIEW_PANE };
  }
  if (delivered(res) !== 'ok') return { status: 409, body: failureReason(res) };

  // Flock comes forward on the pane; the tab is herdr's fallback.
  const tabId = body.tabId ?? lane?.tabId;
  await focusQuietly(io, { paneId: livePane, ...(tabId ? { tabId } : {}) });
  return { status: 200, body: { ok: true } };
}
