/**
 * lib/daemon/slack-lifecycle.ts: the timers on an open Slack support
 * conversation, and the close sequence every close ends in.
 */

import type { Database } from "bun:sqlite";
import { lazyChildLogger } from "../daemon-logger.ts";
import { CHAT_NOTIFICATION_CATEGORY, notify } from "../notifier.ts";
import { postHonouringRetryAfter, type SlackClient } from "../slack/client.ts";
import { SLACK_PREFIX, closingLine, holdingLine, redactSecrets, withPrefix } from "../slack/format.ts";
import {
  closeConversation,
  conversationById,
  deleteKvValue,
  enqueueItem,
  getKvValue,
  hasKvValue,
  identityName,
  lastDeliveredAt,
  listOpenConversations,
  markCheckedIn,
  markCloseAsked,
  markStalledNoted,
  pendingItems,
  setKvValue,
  shiftOpenConversationClocks,
  type SlackCloseReason,
  type SlackConversation,
} from "../state/index.ts";

export const SLACK_CHECK_IN_MS = 30 * 60_000;
export const SLACK_IDLE_MS = 60 * 60_000;
export const SLACK_FAREWELL_MS = 2 * 60_000;
export const SLACK_PANE_GONE_MS = 5 * 60_000;
export const SLACK_STALLED_MS = 10 * 60_000;

const SLEEP_GAP_MS = 2 * 60_000;
const CLOCK_NS = "slack-lifecycle";
const CLOCK_KEY = "clock";

const log = lazyChildLogger("slack-lifecycle");

export interface SlackLifecycleDeps {
  db: Database;
  client: () => Promise<SlackClient | null>;
  notify: (title: string, message: string) => void;
  post: (args: { room: string; handle: string; body: string; fromSlack: true }) => { id: number } | undefined;
  now: () => number;
}

interface TickClock {
  lastTickAt: number;
  wokeAt: number;
}

/** Ignores the chat notification preference, because the holding line tells a teammate the operator has been told. */
export function slackDeskNotify(title: string, message: string): void {
  notify(title, message, undefined, CHAT_NOTIFICATION_CATEGORY);
}

async function sendToSlack(conv: SlackConversation, text: string, deps: SlackLifecycleDeps): Promise<boolean> {
  try {
    const client = await deps.client();
    if (!client) {
      log.warn({ conversationId: conv.id }, "slack-lifecycle: Slack is not connected, a line was not sent");
      return false;
    }
    await postHonouringRetryAfter(client, conv.slackChannel, text, (ms) => Bun.sleep(ms));
    return true;
  } catch (err) {
    log.warn({ err, conversationId: conv.id }, "slack-lifecycle: Slack did not take a line");
    return false;
  }
}

function tellOperator(title: string, message: string, deps: SlackLifecycleDeps): void {
  try {
    deps.notify(title, message);
  } catch (err) {
    log.warn({ err }, "slack-lifecycle: desk notify threw");
  }
}

function recordInRoom(conv: SlackConversation, body: string, deps: SlackLifecycleDeps): void {
  try {
    if (!deps.post({ room: conv.room, handle: conv.agentHandle, body, fromSlack: true })) {
      log.warn({ conversationId: conv.id }, "slack-lifecycle: the chat room refused a closing line");
    }
  } catch (err) {
    log.warn({ err, conversationId: conv.id }, "slack-lifecycle: a closing line could not be recorded");
  }
}

/** Nothing happens for a chat already closing, so the first reason stands. */
export function requestClose(conversationId: number, reason: SlackCloseReason, deps: Pick<SlackLifecycleDeps, "db" | "now">): void {
  const { db } = deps;
  const at = deps.now();
  db.transaction(() => {
    if (!markCloseAsked(conversationId, reason, at, db)) return;
    enqueueItem(
      {
        conversationId,
        kind: "close-request",
        fromHandle: null,
        text: `This chat is closing (reason: ${reason}). Write your farewell and call chat_slack_close within 2 minutes.`,
        createdAt: at,
      },
      db,
    );
  })();
}

/**
 * Marks the row before sending, so a daemon that dies mid-send can't send twice.
 * The teammate may then hear nothing, which is why a failed send tells the operator.
 */
export async function finishClose(
  conversationId: number,
  reason: SlackCloseReason,
  farewell: string | undefined,
  deps: SlackLifecycleDeps,
): Promise<{ redacted: boolean }> {
  const { db } = deps;
  const conv = conversationById(conversationId, db);
  if (!conv) return { redacted: false };
  const at = deps.now();
  const closedHere = db.transaction(() => {
    if (!closeConversation(conversationId, reason, at, db)) return false;
    enqueueItem({ conversationId, kind: "closed", fromHandle: null, text: `This Slack chat is closed (reason: ${reason}).`, createdAt: at }, db);
    return true;
  })();
  if (!closedHere) return { redacted: false };

  const cleaned = redactSecrets((farewell ?? "").trimEnd());
  const wrapUp = withPrefix(cleaned.text);
  const hasWrapUp = wrapUp !== SLACK_PREFIX;
  const lines = [...(hasWrapUp ? [wrapUp] : []), withPrefix(closingLine(conv.operatorName, reason === "pane-gone"))];
  let allSent = true;
  for (const line of lines) {
    if (await sendToSlack(conv, line, deps)) recordInRoom(conv, line.slice(SLACK_PREFIX.length), deps);
    else allSent = false;
  }

  const name = identityName(conv.slackHandle, db);
  if (!allSent) tellOperator("Slack chat closed", `The closing message to ${name} did not reach Slack, so check the DM`, deps);
  else if (reason === "pane-gone") tellOperator("Slack chat closed", `Claude stopped responding to ${name}, who is waiting to hear from you`, deps);
  else if (!hasWrapUp) tellOperator("Slack chat closed", `The chat with ${name} closed with no farewell (${reason})`, deps);
  return { redacted: cleaned.redacted };
}

/**
 * Holds the last tick in the db, so a daemon restarted across a sleep still sees
 * the gap. Read before each chat, since a slow send can carry a tick across a sleep.
 */
function readWakeTime(deps: SlackLifecycleDeps): number {
  const { db } = deps;
  const now = deps.now();
  return db.transaction(() => {
    const last = getKvValue<TickClock>(CLOCK_NS, CLOCK_KEY, { lastTickAt: now, wokeAt: 0 }, db);
    const gap = now - last.lastTickAt;
    const slept = gap > SLEEP_GAP_MS;
    if (slept) shiftOpenConversationClocks(gap, now, db);
    const wokeAt = slept ? now : last.wokeAt;
    setKvValue<TickClock>(CLOCK_NS, CLOCK_KEY, { lastTickAt: now, wokeAt }, db);
    return wokeAt;
  })();
}

/** The clock runs only while a chat is open: an old tick would read the next chat's first tick as a sleep. */
function resetTickClock(open: SlackConversation[], db: Database): void {
  const hasClock = hasKvValue(CLOCK_NS, CLOCK_KEY, db);
  if (open.length === 0 && hasClock) deleteKvValue(CLOCK_NS, CLOCK_KEY, db);
  if (open.length > 0 && !hasClock) {
    setKvValue<TickClock>(CLOCK_NS, CLOCK_KEY, { lastTickAt: Math.max(...open.map((c) => c.openedAt)), wokeAt: 0 }, db);
  }
}

async function holdTeammate(conv: SlackConversation, deps: SlackLifecycleDeps): Promise<void> {
  if (!markStalledNoted(conv.id, deps.now(), deps.db)) return;
  tellOperator("Slack chat is waiting", `Claude hasn't picked up ${identityName(conv.slackHandle, deps.db)}'s message`, deps);
  await sendToSlack(conv, withPrefix(holdingLine(conv.operatorName)), deps);
}

async function tickConversation(conversationId: number, deps: SlackLifecycleDeps): Promise<void> {
  const { db } = deps;
  const wokeAt = readWakeTime(deps);
  const conv = conversationById(conversationId, db);
  if (!conv || conv.closedAt !== null) return;
  const now = deps.now();

  if (conv.closeAskedAt !== null) {
    if (now - conv.closeAskedAt >= SLACK_FAREWELL_MS) await finishClose(conv.id, conv.closeReasonAsked!, undefined, deps);
    return;
  }

  const oldest = pendingItems(conv.id, db).find((i) => i.kind === "message");
  if (oldest) {
    const waitingSince = Math.max(oldest.createdAt, wokeAt);
    if (now - Math.max(waitingSince, conv.watcherSeenAt ?? conv.openedAt) >= SLACK_PANE_GONE_MS) {
      await finishClose(conv.id, "pane-gone", undefined, deps);
      return;
    }
    if (conv.stalledNotedAt === null && now - Math.max(waitingSince, lastDeliveredAt(conv.id, db) ?? 0) >= SLACK_STALLED_MS) {
      await holdTeammate(conv, deps);
      return;
    }
  }

  const quiet = now - conv.lastActiveAt;
  if (quiet >= SLACK_IDLE_MS) {
    requestClose(conv.id, "idle", deps);
  } else if (quiet >= SLACK_CHECK_IN_MS && conv.checkedInAt === null) {
    db.transaction(() => {
      if (!markCheckedIn(conv.id, now, db)) return;
      enqueueItem(
        {
          conversationId: conv.id,
          kind: "check-in",
          fromHandle: null,
          text: "This chat has gone quiet. Ask if they still need help, and say you will close it soon.",
          createdAt: now,
        },
        db,
      );
    })();
  }
}

/** Keyed by db rather than held in a flag, so one daemon's tick can't block a test's or another db's. */
const ticking = new WeakSet<Database>();

export async function tickSlackLifecycle(deps: SlackLifecycleDeps): Promise<void> {
  const { db } = deps;
  if (ticking.has(db)) return;
  ticking.add(db);
  try {
    const open = listOpenConversations(db);
    resetTickClock(open, db);
    for (const { id } of open) {
      try {
        await tickConversation(id, deps);
      } catch (err) {
        log.warn({ err, conversationId: id }, "slack-lifecycle: a tick failed, retrying next tick");
      }
    }
  } finally {
    ticking.delete(db);
  }
}
