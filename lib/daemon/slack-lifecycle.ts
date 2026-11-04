/**
 * lib/daemon/slack-lifecycle.ts: the timers on an open Slack support
 * conversation, and the close sequence every close ends in.
 */

import type { Database } from "bun:sqlite";
import { lazyChildLogger } from "../daemon-logger.ts";
import { CHAT_NOTIFICATION_CATEGORY, notifyEnabled } from "../notifier.ts";
import type { SlackClient } from "../slack/client.ts";
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
import { postHonouringRetryAfter } from "./handlers/chat.ts";

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

export function slackDeskNotify(title: string, message: string): void {
  notifyEnabled(CHAT_NOTIFICATION_CATEGORY, title, message);
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
): Promise<void> {
  const { db } = deps;
  const conv = conversationById(conversationId, db);
  if (!conv) return;
  const at = deps.now();
  const closedHere = db.transaction(() => {
    if (!closeConversation(conversationId, reason, at, db)) return false;
    enqueueItem({ conversationId, kind: "closed", fromHandle: null, text: `This Slack chat is closed (reason: ${reason}).`, createdAt: at }, db);
    return true;
  })();
  if (!closedHere) return;

  const wrapUp = withPrefix(redactSecrets((farewell ?? "").trimEnd()).text);
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
}

/** Holds the last tick in the db, so a daemon restarted across a sleep still sees the gap. */
function readWakeTime(hasOpenChats: boolean, deps: SlackLifecycleDeps): number {
  const { db } = deps;
  if (!hasOpenChats) {
    // With no chat open, an old tick would read the next chat's first tick as a sleep.
    if (hasKvValue(CLOCK_NS, CLOCK_KEY, db)) deleteKvValue(CLOCK_NS, CLOCK_KEY, db);
    return 0;
  }
  const now = deps.now();
  return db.transaction(() => {
    const last = getKvValue<TickClock | null>(CLOCK_NS, CLOCK_KEY, null, db);
    const gap = last ? now - last.lastTickAt : 0;
    const slept = gap > SLEEP_GAP_MS;
    if (slept) shiftOpenConversationClocks(gap, db);
    const wokeAt = slept ? now : (last?.wokeAt ?? 0);
    setKvValue<TickClock>(CLOCK_NS, CLOCK_KEY, { lastTickAt: now, wokeAt }, db);
    return wokeAt;
  })();
}

async function holdTeammate(conv: SlackConversation, deps: SlackLifecycleDeps): Promise<void> {
  markStalledNoted(conv.id, deps.now(), deps.db);
  tellOperator("Slack chat is waiting", `Claude hasn't picked up ${identityName(conv.slackHandle, deps.db)}'s message`, deps);
  await sendToSlack(conv, withPrefix(holdingLine(conv.operatorName)), deps);
}

async function tickConversation(conv: SlackConversation, wokeAt: number, deps: SlackLifecycleDeps): Promise<void> {
  const { db } = deps;
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
    }
  }

  const quiet = now - conv.lastActiveAt;
  if (quiet >= SLACK_IDLE_MS) {
    requestClose(conv.id, "idle", deps);
  } else if (quiet >= SLACK_CHECK_IN_MS && conv.checkedInAt === null) {
    db.transaction(() => {
      markCheckedIn(conv.id, now, db);
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

export async function tickSlackLifecycle(deps: SlackLifecycleDeps): Promise<void> {
  const hasOpenChats = listOpenConversations(deps.db).length > 0;
  const wokeAt = readWakeTime(hasOpenChats, deps);
  if (!hasOpenChats) return;
  for (const conv of listOpenConversations(deps.db)) {
    try {
      await tickConversation(conv, wokeAt, deps);
    } catch (err) {
      log.warn({ err, conversationId: conv.id }, "slack-lifecycle: a tick failed, retrying next tick");
    }
  }
}
