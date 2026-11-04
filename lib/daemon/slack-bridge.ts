/**
 * lib/daemon/slack-bridge.ts: reads each open Slack support conversation and
 * posts the teammate's and the operator's messages into its chat room.
 */

import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import { decodeSlackText, hasPrefix } from "../slack/format.ts";
import { SlackError, type SlackClient, type SlackMessage } from "../slack/client.ts";
import {
  advanceCursor,
  enqueueItem,
  listOpenConversations,
  touchConversation,
  type SlackConversation,
} from "../state/slack-conversation-store.ts";

export interface SlackBridgeOptions {
  db: Database;
  client: () => Promise<SlackClient | null>;
  post: (args: { room: string; handle: string; body: string; fromSlack: true }) => { id: number } | undefined;
  /** The operator's chat handle; without one the operator's Slack messages are queued for the pane but not posted to the room. */
  operatorHandle?: () => string | undefined;
  log: Pick<Logger, "warn" | "debug">;
  now?: () => number;
}

/** Slack timestamps are "<seconds>.<micros>"; compared as digits, since the full value overflows a double's precision. */
function compareTs(a: string, b: string): number {
  const [ai = "0", af = ""] = a.split(".");
  const [bi = "0", bf = ""] = b.split(".");
  const whole = Number(ai) - Number(bi);
  if (whole !== 0) return whole;
  const fa = af.padEnd(6, "0");
  const fb = bf.padEnd(6, "0");
  return fa === fb ? 0 : fa < fb ? -1 : 1;
}

export function tsFromMs(ms: number): string {
  return `${Math.floor(ms / 1000)}.${String((ms % 1000) * 1000).padStart(6, "0")}`;
}

/** Edits, joins and bot posts are noise; a file_share is a teammate message with an attachment. */
const DELIVERABLE_SUBTYPES = new Set<string | undefined>([undefined, "file_share", "thread_broadcast"]);

function bodyOf(msg: SlackMessage): string {
  const note = msg.files && msg.files.length > 0 ? `[sent a file: ${msg.files.map((f) => f.name || "unnamed").join(", ")}]` : "";
  return [decodeSlackText(msg.text), note].filter(Boolean).join("\n");
}

/** Replies codes that mean the thread will never be readable, so its cursor may move past it. */
const GONE_THREAD_CODES = new Set(["thread_not_found", "message_not_found"]);

interface Candidate {
  msg: SlackMessage;
  parentTs?: string;
}

export function createSlackBridge(opts: SlackBridgeOptions): { sweep(): Promise<void> } {
  const { db, post, log } = opts;
  const now = opts.now ?? Date.now;
  /** Slack limits per token, so one 429 holds every conversation. */
  let waitUntil = 0;
  const failing = new Set<number>();
  const unreadThreads = new Set<string>();
  let running = false;

  function noteFailure(conv: SlackConversation, err: unknown): void {
    if (err instanceof SlackError && err.retryAfterMs !== undefined) waitUntil = Math.max(waitUntil, now() + err.retryAfterMs);
    if (failing.has(conv.id)) log.debug({ err, conversationId: conv.id }, "slack-bridge: still failing");
    else {
      failing.add(conv.id);
      log.warn({ err, conversationId: conv.id }, "slack-bridge: sweep failed, retrying next tick");
    }
  }

  /** `parents` holds only threads whose replies were read, or that Slack says are gone; a failed read keeps its cursor. */
  async function collect(client: SlackClient, conv: SlackConversation): Promise<{ candidates: Candidate[]; parents: SlackMessage[] }> {
    const sinceOpen = await client.history(conv.slackChannel, tsFromMs(conv.openedAt));
    const candidates: Candidate[] = sinceOpen.filter((m) => compareTs(m.ts, conv.lastReadTs) > 0).map((msg) => ({ msg }));
    const pending = sinceOpen.filter(
      (m) =>
        (m.replyCount ?? 0) > 0 &&
        m.latestReply !== undefined &&
        compareTs(m.latestReply, conv.threadReadTs[m.ts] ?? m.ts) > 0,
    );
    const parents: SlackMessage[] = [];
    for (const parent of pending) {
      const from = conv.threadReadTs[parent.ts] ?? parent.ts;
      const key = `${conv.id}:${parent.ts}`;
      try {
        const replies = await client.replies(conv.slackChannel, parent.ts, from);
        for (const msg of replies) {
          if (msg.ts !== parent.ts && compareTs(msg.ts, from) > 0) candidates.push({ msg, parentTs: parent.ts });
        }
        parents.push(parent);
        unreadThreads.delete(key);
      } catch (err) {
        if (err instanceof SlackError && err.retryAfterMs !== undefined) throw err;
        if (err instanceof SlackError && GONE_THREAD_CODES.has(err.code)) {
          parents.push(parent);
          continue;
        }
        if (unreadThreads.has(key)) log.debug({ err, conversationId: conv.id }, "slack-bridge: a thread is still unreadable");
        else {
          unreadThreads.add(key);
          log.warn({ err, conversationId: conv.id }, "slack-bridge: a thread could not be read, retrying next tick");
        }
      }
    }
    candidates.sort((a, b) => compareTs(a.msg.ts, b.msg.ts));
    return { candidates, parents };
  }

  function deliver(conv: SlackConversation, msg: SlackMessage, parentTs: string | undefined): void {
    if (!DELIVERABLE_SUBTYPES.has(msg.subtype)) return;
    // A thread_broadcast reply also lands in history, which delivers it.
    if (parentTs !== undefined && msg.subtype === "thread_broadcast") return;
    if (hasPrefix(msg.text)) return;
    const body = bodyOf(msg);
    if (!body) return;

    const fromTeammate = msg.user === conv.slackUserId;
    if (!fromTeammate && msg.user !== conv.operatorUserId) return;
    const handle = fromTeammate ? conv.slackHandle : opts.operatorHandle?.();
    if (handle) {
      if (!post({ room: conv.room, handle, body, fromSlack: true })) throw new Error("slack-bridge: the chat room refused the post");
    } else {
      log.debug({ conversationId: conv.id }, "slack-bridge: no operator chat handle, queued without a room post");
    }
    db.transaction(() => {
      enqueueItem(
        { conversationId: conv.id, kind: fromTeammate ? "message" : "operator-slack", fromHandle: handle ?? null, text: body, createdAt: now() },
        db,
      );
      touchConversation(conv.id, now(), db);
    })();
  }

  async function sweepConversation(client: SlackClient, conv: SlackConversation): Promise<void> {
    const { candidates, parents } = await collect(client, conv);
    let lastReadTs = conv.lastReadTs;
    const threads = { ...conv.threadReadTs };
    for (const { msg, parentTs } of candidates) {
      deliver(conv, msg, parentTs);
      if (parentTs === undefined) lastReadTs = msg.ts;
      else threads[parentTs] = msg.ts;
      advanceCursor(conv.id, lastReadTs, threads, db);
    }
    let moved = false;
    for (const parent of parents) {
      if (parent.latestReply !== undefined && compareTs(parent.latestReply, threads[parent.ts] ?? parent.ts) > 0) {
        threads[parent.ts] = parent.latestReply;
        moved = true;
      }
    }
    if (moved) advanceCursor(conv.id, lastReadTs, threads, db);
  }

  return {
    async sweep() {
      if (running) return;
      running = true;
      try {
        if (waitUntil > now()) return;
        const open = listOpenConversations(db);
        if (open.length === 0) return;
        const client = await opts.client();
        if (!client) return;
        for (const conv of open) {
          if (waitUntil > now()) break;
          try {
            await sweepConversation(client, conv);
            failing.delete(conv.id);
          } catch (err) {
            noteFailure(conv, err);
          }
        }
      } finally {
        running = false;
      }
    },
  };
}
