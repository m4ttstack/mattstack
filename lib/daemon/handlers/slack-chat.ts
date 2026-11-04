/**
 * lib/daemon/handlers/slack-chat.ts: the chat:slack-* commands that open,
 * watch and confirm a Slack support conversation.
 */

import { randomBytes } from "crypto";
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import { lazyChildLogger } from "../../daemon-logger.ts";
import { getSetting } from "../../settings/resolve.ts";
import { SLACK_SUPPORT_SCOPES } from "../../setup/slack-app.ts";
import { SlackError, type SlackClient, type SlackUser } from "../../slack/client.ts";
import { slackClientFromSecrets } from "../../slack/daemon-client.ts";
import {
  SlackConversationBusy,
  closedNoticeForAgent,
  conversationForAgent,
  conversationForSlackUser,
  dmRoomFor,
  ensureSlackIdentity,
  identityName,
  isValidChatName,
  listOpenConversations,
  markOpenItemDelivered,
  markWatcherSeen,
  openConversation,
  pendingItems,
  presenceForHandle,
  resolveHandle,
  type SlackConversation,
} from "../../state/index.ts";
import { chatViewerUrl, readChatViewerUrlSetting } from "../../chat-viewer-url.ts";
import { tsFromMs } from "../slack-bridge.ts";
import { finishClose, requestClose, slackDeskNotify } from "../slack-lifecycle.ts";
import { MAX_BODY_BYTES, isValidBody, sessionSeatedOn, slackRefusal, slackRoomPoster, type SlackRefusal } from "./chat.ts";
import { writeTicket } from "../../slack/support-ticket.ts";
import type { CommandResult } from "./types.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";

const CONNECT_STEP = "rt setup slack connect --support-chat";
const OPERATOR_FALLBACK = "the operator";
const DISPLAY_NAME_MAX = 40;
const TICKET_FIELD_MAX = 8000;
const TICKET_TITLE_MAX = 200;
const TICKET_ACCEPTANCE_MAX = 30;
const CANDIDATES_SHOWN = 8;
const FRAME_MARKER_BYTES = 8;

const SLACK_CHAT_COMMANDS = ["chat:slack-open", "chat:slack-close", "chat:slack-status", "chat:slack-pending", "chat:slack-delivered", "chat:slack-ticket"] as const;

const defaultLog = lazyChildLogger("slack-chat");

/** Profile fields are written by their owner, and these reach the support rules and the closing lines. */
function cleanDisplayName(raw: string): string {
  return raw.replace(/[^\p{L}\p{M}\p{N} ._'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, DISPLAY_NAME_MAX).trim();
}

function shownName(user: SlackUser): string {
  return [user.displayName, user.realName, user.name].map(cleanDisplayName).find(Boolean) ?? "";
}

function firstName(user: SlackUser): string {
  return shownName(user).split(" ")[0] ?? "";
}

function comparableNames(user: SlackUser): string[] {
  return [user.displayName, user.realName].map((n) => n.trim().toLowerCase()).filter(Boolean);
}

/** An exact name wins over a whole word, so a teammate called just "Alex" stays reachable beside "Alex Example". */
function findPerson(users: SlackUser[], person: string): SlackUser | SlackRefusal {
  const wanted = person.trim().toLowerCase();
  const exact = users.filter((u) => comparableNames(u).includes(wanted));
  const matches = exact.length > 0 ? exact : users.filter((u) => comparableNames(u).some((n) => n.split(/\s+/).includes(wanted)));
  if (matches.length === 1) return matches[0]!;
  const listed = (found: SlackUser[]) => found.slice(0, CANDIDATES_SHOWN).map(shownName).join(", ");
  const asked = cleanDisplayName(person);
  if (matches.length > 1) return slackRefusal(`More than one person matches ${asked}: ${listed(matches)}. Use their full name`);
  const near = users.filter((u) => comparableNames(u).some((n) => n.includes(wanted)));
  return slackRefusal(near.length > 0 ? `No one matches ${asked}. Did you mean ${listed(near)}?` : `No one in this Slack workspace matches ${asked}`);
}

function isRefusal(found: SlackUser | SlackRefusal): found is SlackRefusal {
  return "ok" in found;
}

function validTicket(p: Partial<Commands["chat:slack-ticket"]["payload"]>): boolean {
  const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  return (
    (p.kind === "bug" || p.kind === "feature") &&
    text(p.title, TICKET_TITLE_MAX) &&
    text(p.problem, TICKET_FIELD_MAX) &&
    text(p.idea, TICKET_FIELD_MAX) &&
    Array.isArray(p.acceptance) &&
    p.acceptance.length <= TICKET_ACCEPTANCE_MAX &&
    p.acceptance.every((a) => text(a, TICKET_TITLE_MAX))
  );
}

export function createSlackChatHandlers(opts: {
  db: Database;
  emitEvent: (topic: string, payload?: unknown) => unknown;
  log?: Logger;
  /** Resolves null when no Slack token is set; real by default, fakeable the same way chat's is. */
  slackClient?: () => Promise<SlackClient | null>;
  notify?: (title: string, message: string) => void;
  now?: () => number;
}): { [K in (typeof SLACK_CHAT_COMMANDS)[number]]: (payload: unknown) => Promise<CommandResult<K>> } {
  const { db } = opts;
  const log = opts.log ?? defaultLog;
  const slackClient = opts.slackClient ?? slackClientFromSecrets;
  const now = opts.now ?? Date.now;
  const closeDeps = { db, client: slackClient, notify: opts.notify ?? slackDeskNotify, post: slackRoomPoster(db, opts.emitEvent, log), now };

  function conversationForClose(agentHandle: string | undefined, pane: string | undefined): SlackConversation | undefined {
    if (pane !== undefined) return listOpenConversations(db).find((c) => presenceForHandle(c.agentHandle, db)?.pane === pane);
    return agentHandle === undefined ? undefined : conversationForAgent(resolveHandle(agentHandle, db), db);
  }

  function forWatcher(c: SlackConversation) {
    return { id: c.id, handle: c.slackHandle, name: identityName(c.slackHandle, db), operator: c.operatorName, marker: c.frameMarker };
  }

  function heldRefusal(holder: string, agentId: string, teammate: string): SlackRefusal {
    if (holder === agentId) return slackRefusal(`This pane already has a Slack chat open with ${teammate}`);
    return slackRefusal(`${teammate} already has a Slack chat open in ${presenceForHandle(holder, db)?.pane ?? identityName(holder, db)}`);
  }

  /** Everything Slack has to say before the open, so a refusal leaves nothing behind. */
  async function readSlack(agentId: string, person: string) {
    const client = await slackClient();
    if (!client) return slackRefusal(`Slack isn't connected on this machine. To connect it, run ${CONNECT_STEP}`);
    const { userId: operatorUserId, scopes } = await client.authTest();
    if (!SLACK_SUPPORT_SCOPES.every((s) => scopes.includes(s))) {
      return slackRefusal(`This Slack connection can't reach direct messages yet. To add that, run ${CONNECT_STEP}`);
    }
    const everyone = await client.listUsers();
    const operator = everyone.find((u) => u.id === operatorUserId);
    const found = findPerson(everyone.filter((u) => !u.deleted && !u.isBot && u.id !== operatorUserId), person);
    if (isRefusal(found)) return found;
    const busy = conversationForSlackUser(found.id, db);
    if (busy) return heldRefusal(busy.agentHandle, agentId, shownName(found));
    const slackChannel = await client.openDm(found.id);
    return {
      user: found,
      slackChannel,
      operatorUserId,
      operatorName: (operator && firstName(operator)) || OPERATOR_FALLBACK,
      newestTs: await client.newestTs(slackChannel),
    };
  }

  return {
    "chat:slack-open": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-open">> => {
      const { agentHandle, sessionId, person } = rawPayload as Commands["chat:slack-open"]["payload"];
      if (!isValidChatName(agentHandle)) return { ok: false, error: `invalid handle "${agentHandle}"` };
      if (typeof person !== "string" || !person.trim()) return { ok: false, error: "chat: a Slack chat needs a person" };
      const agentId = resolveHandle(agentHandle, db);
      const presence = presenceForHandle(agentId, db);
      if (!presence || presence.signedOutAt !== undefined || sessionId === undefined || presence.sessionId !== sessionId) {
        return slackRefusal("This pane isn't signed in to rt chat, so a Slack chat can't open");
      }
      const held = conversationForAgent(agentId, db);
      if (held) return heldRefusal(agentId, agentId, identityName(held.slackHandle, db));
      const humanHandle = getSetting<string>("chat.humanHandle").value;
      if (!isValidChatName(humanHandle)) return { ok: false, error: `chat: chat.humanHandle setting is empty or invalid ("${humanHandle}")` };

      let slack: Awaited<ReturnType<typeof readSlack>>;
      try {
        slack = await readSlack(agentId, person);
      } catch (err) {
        log.warn({ err }, "chat: Slack chat could not open");
        return slackRefusal(`Slack did not answer (${err instanceof SlackError ? err.code : "the token could not be read"}), so the chat did not open`);
      }
      if ("ok" in slack) return slack;

      const { user, slackChannel, operatorUserId, operatorName, newestTs } = slack;
      const openedAt = now();
      const frameMarker = randomBytes(FRAME_MARKER_BYTES).toString("hex");
      const open = db.transaction(() => {
        const identity = ensureSlackIdentity(user.id, firstName(user), db);
        const { room } = dmRoomFor(agentId, identity.id, humanHandle, db);
        const conversation = openConversation(
          {
            room,
            agentHandle: agentId,
            slackHandle: identity.id,
            slackUserId: user.id,
            slackChannel,
            operatorUserId,
            operatorName,
            frameMarker,
            lastReadTs: newestTs ?? tsFromMs(openedAt),
            openedAt,
          },
          db,
        );
        return { conversationId: conversation.id, handle: identity.id, name: identity.name, frameMarker, room };
      });
      try {
        return { ok: true, data: open.immediate() };
      } catch (err) {
        if (err instanceof SlackConversationBusy) return heldRefusal(err.holderAgent, agentId, shownName(user));
        throw err;
      }
    },

    "chat:slack-close": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-close">> => {
      const { agentHandle, sessionId, pane, farewell } = rawPayload as Commands["chat:slack-close"]["payload"];
      if (agentHandle !== undefined && !isValidChatName(agentHandle)) return { ok: false, error: `invalid handle "${agentHandle}"` };
      // A pane id proves nothing about the caller, and a farewell reaches the teammate under the prefix.
      if (pane !== undefined && farewell !== undefined) return slackRefusal("A close by pane can't carry a farewell, because only the session holding the chat can speak to the teammate");
      if (pane === undefined && agentHandle !== undefined && !sessionSeatedOn(resolveHandle(agentHandle, db), sessionId, db)) {
        return slackRefusal("Only the session signed in as this pane can close its Slack chat, so sign in and try again");
      }
      if (farewell !== undefined && !isValidBody(farewell)) return { ok: false, error: `chat: a farewell must be non-empty text under ${MAX_BODY_BYTES} bytes` };
      const conversation = conversationForClose(agentHandle, pane);
      if (!conversation) return slackRefusal(pane === undefined ? "This pane has no Slack chat open" : `No Slack chat is open in ${pane}`);
      const conversationId = conversation.id;
      if (pane !== undefined) {
        requestClose(conversationId, "operator", closeDeps);
        return { ok: true, data: { conversationId, closed: false } };
      }
      const { redacted } = await finishClose(conversationId, conversation.closeReasonAsked ?? "closed-by-pane", farewell, closeDeps);
      return { ok: true, data: { conversationId, closed: true, ...(redacted ? { redacted: true as const } : {}) } };
    },

    "chat:slack-status": async (): Promise<CommandResult<"chat:slack-status">> => {
      const conversations = listOpenConversations(db).map((c) => {
        const pane = presenceForHandle(c.agentHandle, db)?.pane;
        return {
          id: c.id,
          room: c.room,
          ...(pane ? { pane } : {}),
          name: identityName(c.slackHandle, db),
          openedAt: c.openedAt,
          lastActiveAt: c.lastActiveAt,
        };
      });
      return { ok: true, data: { conversations } };
    },

    "chat:slack-pending": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-pending">> => {
      const { agentHandle } = rawPayload as Commands["chat:slack-pending"]["payload"];
      if (!isValidChatName(agentHandle)) return { ok: false, error: `invalid handle "${agentHandle}"` };
      const agentId = resolveHandle(agentHandle, db);
      const conversation = conversationForAgent(agentId, db);
      if (conversation) markWatcherSeen(conversation.id, now(), db);
      const notice = closedNoticeForAgent(agentId, db);
      if (notice) return { ok: true, data: { items: [notice.item], open: true, conversation: forWatcher(notice.conversation) } };
      if (!conversation) return { ok: true, data: { items: [], open: false } };
      return { ok: true, data: { items: pendingItems(conversation.id, db), open: true, conversation: forWatcher(conversation) } };
    },

    "chat:slack-delivered": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-delivered">> => {
      const { id } = rawPayload as Commands["chat:slack-delivered"]["payload"];
      if (!Number.isSafeInteger(id)) return { ok: false, error: "chat: an item id must be a whole number" };
      return { ok: true, data: { delivered: markOpenItemDelivered(id, now(), db) } };
    },

    "chat:slack-ticket": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-ticket">> => {
      const payload = rawPayload as Commands["chat:slack-ticket"]["payload"];
      if (!isValidChatName(payload.agentHandle)) return { ok: false, error: `invalid handle "${payload.agentHandle}"` };
      const agentId = resolveHandle(payload.agentHandle, db);
      if (!sessionSeatedOn(agentId, payload.sessionId, db)) {
        return slackRefusal("Only the session signed in as this pane can write a ticket, so sign in and try again");
      }
      const conversation = conversationForAgent(agentId, db);
      if (!conversation) return slackRefusal("This pane has no Slack chat open, so a ticket can't be written");
      if (!validTicket(payload)) return { ok: false, error: "chat: a ticket needs a kind of bug or feature, a title, a problem, an idea and acceptance points" };
      const { kind, title, problem, idea, acceptance } = payload;
      const link = chatViewerUrl(readChatViewerUrlSetting(), conversation.room);
      const source = { person: identityName(conversation.slackHandle, db), date: new Date(now()).toISOString().slice(0, 10), room: conversation.room, link };
      return { ok: true, data: { path: writeTicket({ kind, title, problem, idea, acceptance }, source) } };
    },
  };
}
