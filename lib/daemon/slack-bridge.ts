/**
 * lib/daemon/slack-bridge.ts: reads each open Slack support conversation and
 * posts the teammate's and the operator's messages into its chat room.
 */

import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import { decodeSlackText, hasPrefix } from "../slack/format.ts";
import { resumeTrigger, slackPersona, slackTrigger, type SlackPersona } from "../slack/persona.ts";
import { isResumePhrase } from "../slack/resume-phrase.ts";
import type { ResumeOffer } from "../slack/resume.ts";
import type { TriggerHit, TriggerOffer } from "../slack/trigger-offer.ts";
import { SlackError, type SlackClient, type SlackMessage } from "../slack/client.ts";
import {
  advanceCursor,
  conversationForSlackUser,
  endGrace,
  enqueueItem,
  listExpiredGraceConversations,
  listGracedConversations,
  listOpenConversations,
  paneInUse,
  touchConversation,
  type SlackConversation,
} from "../state/slack-conversation-store.ts";
import { getKvValue, setKvValueCritical } from "../state/kv-blob.ts";

export interface SlackBridgeOptions {
  db: Database;
  client: () => Promise<SlackClient | null>;
  post: (args: { room: string; handle: string; body: string; fromSlack: true }) => { id: number } | undefined;
  /** The operator's chat handle; without one the operator's Slack messages are queued for the pane but not posted to the room. */
  operatorHandle?: () => string | undefined;
  log: Pick<Logger, "warn" | "debug">;
  now?: () => number;
  /** Real by default: the persona setting, read for each message. */
  persona?: () => SlackPersona;
  /** Real by default: the trigger setting, undefined while unset. */
  trigger?: () => string | undefined;
  /** Without it a closed chat's grace window is never read or ended. */
  grace?: {
    /** Records a trigger message on the chat's resume request; anything but `recorded` leaves the message to be offered again. */
    offer(conv: SlackConversation, text: string, triggerTs: string): Promise<ResumeOffer>;
    /** Closes the chat's resume request if one is still waiting. */
    closeResume(conv: SlackConversation): Promise<unknown>;
    closePane(pane: string | null): Promise<unknown>;
  };
  /** Without it the operator's DMs are never searched. */
  triggers?: {
    /** Anything but `failed` settles the message; `failed` leaves it to be offered again. */
    offer(hit: TriggerHit): Promise<TriggerOffer>;
  };
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

/** The newest ts older than this one, so a read that starts after it returns this message first. */
export function tsBefore(ts: string): string {
  const [whole = "0", fraction = ""] = ts.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  const before = micros > 0n ? micros - 1n : 0n;
  return `${before / 1_000_000n}.${String(before % 1_000_000n).padStart(6, "0")}`;
}

const NOTHING_READABLE = "[sent something with no readable text]";

/** Edits, joins and bot posts are noise; a file_share is a teammate message with an attachment. */
const DELIVERABLE_SUBTYPES = new Set<string | undefined>([undefined, "file_share", "thread_broadcast"]);

/** A forward carries its words in attachments, so an empty `text` doesn't mean nothing was said. */
function bodyOf(msg: SlackMessage): string {
  const fileNote = msg.files && msg.files.length > 0 ? `[sent a file: ${msg.files.map((f) => f.name || "unnamed").join(", ")}]` : "";
  const attached = (msg.attachments ?? []).map((a) => (a.text ? `[attached: ${decodeSlackText(a.text)}]` : ""));
  return [decodeSlackText(msg.text), fileNote, ...attached].filter(Boolean).join("\n") || NOTHING_READABLE;
}

/** Replies codes that mean the thread will never be readable, so its cursor may move past it. */
const GONE_THREAD_CODES = new Set(["thread_not_found", "message_not_found"]);

interface Candidate {
  msg: SlackMessage;
  parentTs?: string;
}

/** Slack search can lag, so each sweep reads back this far and leans on the handled set. */
const TRIGGER_LOOKBACK_MS = 10 * 60_000;
const HANDLED_NS = "slack-trigger-dm";
const HANDLED_KEY = "handled";
/** A handled ts is kept well past the lookback so a lagging search never revives it. */
const HANDLED_KEEP_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

export function createSlackBridge(opts: SlackBridgeOptions): { sweep(): Promise<void>; sweepGraced(at?: number): Promise<void>; sweepTriggers(at?: number): Promise<void> } {
  const { db, post, log } = opts;
  const now = opts.now ?? Date.now;
  const persona = opts.persona ?? slackPersona;
  const trigger = opts.trigger ?? slackTrigger;
  /** Slack limits per token, so one 429 holds every conversation. */
  let waitUntil = 0;
  const failing = new Set<number>();
  const unreadThreads = new Set<string>();
  let running = false;
  let gracing = false;
  let triggering = false;
  let operatorUserId: string | undefined;
  const triggerFailing = new Set<string>();
  const offerFailing = new Set<number>();

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
    const openedTs = tsFromMs(conv.openedAt);
    // A chat a teammate's trigger opened starts its cursor before that message, which predates the open.
    const sinceOpen = await client.history(conv.slackChannel, compareTs(conv.lastReadTs, openedTs) < 0 ? conv.lastReadTs : openedTs);
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
    const fromTeammate = msg.user === conv.slackUserId;
    if (!fromTeammate && msg.user !== conv.operatorUserId) return;
    // The pane posts on the operator's token, so only that account's prefix marks the pane's own echo.
    if (!fromTeammate && hasPrefix(msg.text, persona())) return;
    const body = bodyOf(msg);
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

  /** Only the teammate's own trigger messages after the close count; every other message stays an ordinary DM to the operator and is never posted. */
  async function sweepGracedConversation(client: SlackClient, conv: SlackConversation, grace: NonNullable<SlackBridgeOptions["grace"]>): Promise<void> {
    const closedTs = tsFromMs(conv.closedAt!);
    const since = compareTs(conv.lastReadTs, closedTs) > 0 ? conv.lastReadTs : closedTs;
    const hits = (await client.history(conv.slackChannel, since))
      .filter(
        (m) =>
          compareTs(m.ts, since) > 0 &&
          m.user === conv.slackUserId &&
          DELIVERABLE_SUBTYPES.has(m.subtype) &&
          isResumePhrase(decodeSlackText(m.text), persona(), trigger()),
      )
      .sort((a, b) => compareTs(a.ts, b.ts));
    for (const msg of hits) {
      const offered = await grace.offer(conv, bodyOf(msg).trim(), msg.ts);
      if (offered === "failed") {
        if (!offerFailing.has(conv.id)) {
          offerFailing.add(conv.id);
          log.warn({ conversationId: conv.id }, "slack-bridge: a resume request would not open, retrying next tick");
        }
        return;
      }
      offerFailing.delete(conv.id);
      if (offered === "held") return;
      advanceCursor(conv.id, msg.ts, conv.threadReadTs, db);
    }
  }

  /** Slack's `after:` takes a date and excludes it, so the query starts a day early and the ts filter does the exact cut. */
  function triggerQuery(trigger: string, at: number): string {
    const day = new Date(at - TRIGGER_LOOKBACK_MS - DAY_MS).toISOString().slice(0, 10);
    return `to:me "${trigger.replace(/"/g, "")}" after:${day}`;
  }

  async function sweepTriggerHits(client: SlackClient, triggers: NonNullable<SlackBridgeOptions["triggers"]>, at: number): Promise<void> {
    operatorUserId ??= (await client.authTest()).userId;
    const current = persona();
    const currentTrigger = trigger();
    const since = tsFromMs(at - TRIGGER_LOOKBACK_MS);
    const hits = (await client.searchDms(triggerQuery(resumeTrigger(current, currentTrigger), at)))
      .filter((h) => h.isIm && h.user !== undefined && h.user !== operatorUserId && DELIVERABLE_SUBTYPES.has(h.subtype) && compareTs(h.ts, since) > 0)
      .map((h) => ({ userId: h.user!, ts: h.ts, text: decodeSlackText(h.text).trim() }))
      .filter((h) => isResumePhrase(h.text, current, currentTrigger))
      .sort((a, b) => compareTs(a.ts, b.ts));
    if (hits.length === 0) return;

    const handled = Object.fromEntries(Object.entries(getKvValue<Record<string, number>>(HANDLED_NS, HANDLED_KEY, {}, db)).filter(([, handledAt]) => handledAt > at - HANDLED_KEEP_MS));
    const settle = (ts: string): boolean => {
      handled[ts] = at;
      return setKvValueCritical(HANDLED_NS, HANDLED_KEY, handled, db);
    };
    const graced = new Set(listGracedConversations(at, db).map((c) => c.slackUserId));
    for (const hit of hits) {
      if (handled[hit.ts] !== undefined) continue;
      if (conversationForSlackUser(hit.userId, db) || graced.has(hit.userId)) {
        if (!settle(hit.ts)) return;
        continue;
      }
      if ((await triggers.offer(hit)) === "failed") {
        if (!triggerFailing.has(hit.userId)) {
          triggerFailing.add(hit.userId);
          log.warn({ userId: hit.userId }, "slack-bridge: a teammate's trigger would not open a request, retrying next tick");
        }
        continue;
      }
      triggerFailing.delete(hit.userId);
      if (!settle(hit.ts)) return;
    }
  }

  return {
    async sweepTriggers(at = now()) {
      const { triggers } = opts;
      if (!triggers || triggering) return;
      triggering = true;
      try {
        if (waitUntil > now()) return;
        const client = await opts.client();
        if (!client) return;
        await sweepTriggerHits(client, triggers, at);
      } catch (err) {
        if (err instanceof SlackError && err.retryAfterMs !== undefined) waitUntil = Math.max(waitUntil, now() + err.retryAfterMs);
        log.warn({ err }, "slack-bridge: the search for teammates' triggers failed, retrying next tick");
      } finally {
        triggering = false;
      }
    },

    async sweepGraced(at = now()) {
      const { grace } = opts;
      if (!grace || gracing) return;
      gracing = true;
      try {
        for (const conv of listExpiredGraceConversations(at, db)) {
          endGrace(conv.id, db);
          await grace.closeResume(conv);
          if (conv.assignedPane !== null && paneInUse(conv.assignedPane, conv.id, db)) continue;
          await grace.closePane(conv.assignedPane);
        }
        if (waitUntil > now()) return;
        const graced = listGracedConversations(at, db).filter((c) => !conversationForSlackUser(c.slackUserId, db));
        if (graced.length === 0) return;
        const client = await opts.client();
        if (!client) return;
        for (const conv of graced) {
          if (waitUntil > now()) break;
          try {
            await sweepGracedConversation(client, conv, grace);
            failing.delete(conv.id);
          } catch (err) {
            noteFailure(conv, err);
          }
        }
      } finally {
        gracing = false;
      }
    },

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
