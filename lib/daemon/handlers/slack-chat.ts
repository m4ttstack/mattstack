/**
 * lib/daemon/handlers/slack-chat.ts: the chat:slack-* commands that open,
 * watch and confirm a Slack support conversation.
 */

import { randomBytes } from "crypto";
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import { lazyChildLogger } from "../../daemon-logger.ts";
import { getSetting } from "../../settings/resolve.ts";
import { SLACK_SUPPORT_CHAT_SCOPES } from "../../setup/slack-app.ts";
import { createSlackAvatars, pictureVersion } from "../../slack/avatars.ts";
import { SlackError, type SlackClient, type SlackUser } from "../../slack/client.ts";
import { slackClientFromSecrets } from "../../slack/daemon-client.ts";
import { slackPrefix } from "../../slack/format.ts";
import { slackPersona } from "../../slack/persona.ts";
import {
  SlackConversationBusy,
  closedNoticeForAgent,
  conversationForAgent,
  conversationForSlackUser,
  dmRoomFor,
  ensureSlackIdentity,
  identityName,
  isValidChatName,
  listLatestClosedConversations,
  listOpenConversations,
  markOpenItemDelivered,
  markWatcherSeen,
  openConversation,
  pendingItems,
  presenceForHandle,
  resolveHandle,
  type SlackConversation,
} from "../../state/index.ts";
import { conversationById, conversationForAssignedSession, gracedConversationForSession, recordSupportTicket, ticketsForChain } from "../../state/slack-conversation-store.ts";
import { tsFromMs } from "../slack-bridge.ts";
import { finishClose, requestClose, slackDeskNotify } from "../slack-lifecycle.ts";
import { MAX_BODY_BYTES, isValidBody, sessionSeatedOn, slackRefusal, slackRoomPoster, type SlackRefusal } from "./chat.ts";
import { findOrgIds, orgIdContext } from "../../linear/org-ids.ts";
import { SUPPORT_KEY_NAME, readSupportApiKey } from "../../linear/support-key.ts";
import { createSupportIssue } from "../../linear/support.ts";
import { sendMilestone, type MilestoneDeps } from "../../slack/milestones.ts";
import { realHerdrRunnerFor } from "../../slack/support-pane.ts";
import { approveSlackOpen, approveSlackResume, expireSlackOpenGates, requestSlackOpen, type SlackOpenDeps } from "../../slack/request.ts";
import { requestResume } from "../../slack/resume.ts";
import { realMilestoneDeps } from "./slack-milestones.ts";
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
const SLACKBOT_ID = "USLACKBOT";
// Slack's ids hold a digit, which keeps a capitalised name such as WILL out of this.
const SLACK_ID_SHAPE = /^[UW][A-Z0-9]*[0-9][A-Z0-9]*$/;

const SLACK_CHAT_COMMANDS = ["chat:slack-open", "chat:slack-close", "chat:slack-status", "chat:slack-people", "chat:slack-avatars", "chat:slack-dm", "chat:slack-avatar-file", "chat:slack-pending", "chat:slack-delivered", "chat:slack-ticket", "chat:slack-request", "chat:slack-start", "chat:slack-assignment", "chat:slack-resume", "chat:slack-expire"] as const;

const defaultLog = lazyChildLogger("slack-chat");

/** Profile fields are written by their owner, and these reach the support rules and the closing lines. */
function cleanDisplayName(raw: string): string {
  const cleaned = raw.replace(/[^\p{L}\p{M}\p{N} ._'-]/gu, " ").replace(/\s+/g, " ").trim();
  // Cut by code point: a lone surrogate from a unit cut is JSON serde_json rejects, which fails herdr-chat's whole read.
  return Array.from(cleaned).slice(0, DISPLAY_NAME_MAX).join("").trim();
}

function shownName(user: SlackUser): string {
  return [user.displayName, user.realName, user.name].map(cleanDisplayName).find(Boolean) ?? "";
}

/** A picker lists full names, so two people with short display names read apart. */
function fullName(user: SlackUser): string {
  return [user.realName, user.displayName, user.name].map(cleanDisplayName).find(Boolean) ?? "";
}

function firstName(user: SlackUser): string {
  return shownName(user).split(" ")[0] ?? "";
}

function comparableNames(user: SlackUser): string[] {
  return [user.displayName, user.realName].map((n) => n.trim().toLowerCase()).filter(Boolean);
}

function matchPeople(users: SlackUser[], person: string): SlackUser[] {
  const wanted = person.trim().toLowerCase();
  const exact = users.filter((u) => comparableNames(u).includes(wanted));
  return exact.length > 0 ? exact : users.filter((u) => comparableNames(u).some((n) => n.split(/\s+/).includes(wanted)));
}

/** An id first, as two people can share a name. Then an exact name wins over a whole word, so a teammate called just "Alex" stays reachable beside "Alex Example". */
function findPerson(users: SlackUser[], person: string): SlackUser | SlackRefusal {
  const byId = users.find((u) => u.id === person.trim());
  if (byId) return byId;
  // A display name is its owner's to set, so one that copies an ineligible id must not win that id's chat.
  if (SLACK_ID_SHAPE.test(person.trim()) || person.trim() === SLACKBOT_ID) return slackRefusal(`No one in this Slack workspace matches ${cleanDisplayName(person)}`);
  const matches = matchPeople(users, person);
  if (matches.length === 1) return matches[0]!;
  const listed = (found: SlackUser[]) => found.slice(0, CANDIDATES_SHOWN).map(shownName).join(", ");
  const wanted = person.trim().toLowerCase();
  const asked = cleanDisplayName(person);
  if (matches.length > 1) return slackRefusal(`More than one person matches ${asked}: ${listed(matches)}. Use their full name`);
  const near = users.filter((u) => comparableNames(u).some((n) => n.includes(wanted)));
  return slackRefusal(near.length > 0 ? `No one matches ${asked}. Did you mean ${listed(near)}?` : `No one in this Slack workspace matches ${asked}`);
}

function isRefusal(found: SlackUser | SlackRefusal): found is SlackRefusal {
  return "ok" in found;
}

function slackFailureCode(err: unknown): string {
  return err instanceof SlackError ? err.code : "the token could not be read";
}

function byShownName(a: { name: string; person: string }, b: { name: string; person: string }): number {
  return a.name.localeCompare(b.name) || a.person.localeCompare(b.person);
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

/** The people a chat can open with. The open and the list both read this, so they can't disagree. */
async function readSlackPeople(slackClient: () => Promise<SlackClient | null>) {
  const client = await slackClient();
  if (!client) return slackRefusal(`Slack isn't connected on this machine. To connect it, run ${CONNECT_STEP}`);
  const { userId: operatorUserId, scopes } = await client.authTest();
  if (!SLACK_SUPPORT_CHAT_SCOPES.every((s) => scopes.includes(s))) {
    return slackRefusal(`This Slack connection can't reach direct messages yet. To add that, run ${CONNECT_STEP}`);
  }
  const everyone = await client.listUsers();
  return {
    client,
    operatorUserId,
    operator: everyone.find((u) => u.id === operatorUserId),
    people: everyone.filter((u) => !u.deleted && !u.isBot && u.id !== operatorUserId && u.id !== SLACKBOT_ID),
  };
}

export type SlackOpenSeams = Pick<SlackOpenDeps, "repoPath" | "startAgent" | "stopAgent" | "agentAlive" | "repoOf" | "closePane" | "presencePane" | "gates">;

const unwiredSeams: SlackOpenSeams = {
  repoPath: () => null,
  startAgent: async () => ({ ok: false, error: "the daemon has no agent launcher here" }),
  stopAgent: async () => {},
  agentAlive: async () => false,
  repoOf: () => null,
  closePane: async () => {},
  presencePane: () => null,
  gates: {
    open: async () => ({ ok: false, error: "the daemon has no gate store here" }),
    close: async () => {},
    listOpen: () => [],
    appendContext: () => {},
  },
};

/** The Slack side of a support request: who a name means, what Slack says before an open, and the shared milestone delivery. */
export function createSlackOpenDeps(
  opts: {
    db: Database;
    log: Logger;
    slackClient?: () => Promise<SlackClient | null>;
    now?: () => number;
    milestones: MilestoneDeps;
    humanHandle?: () => string;
  },
  seams: SlackOpenSeams = unwiredSeams,
): SlackOpenDeps {
  const slackClient = opts.slackClient ?? slackClientFromSecrets;
  const unreachable = (err: unknown) => `Slack did not answer (${slackFailureCode(err)})`;
  return {
    db: opts.db,
    log: opts.log,
    now: opts.now ?? Date.now,
    milestones: opts.milestones,
    humanHandle: opts.humanHandle ?? (() => getSetting<string>("chat.humanHandle").value),
    ...seams,
    async findPerson(person) {
      try {
        const directory = await readSlackPeople(slackClient);
        if ("ok" in directory) return { ok: false, reason: directory.failure?.message ?? directory.error };
        const found = findPerson(directory.people, person);
        if (!isRefusal(found)) return { ok: true, person: { id: found.id, displayName: shownName(found) } };
        const matches = SLACK_ID_SHAPE.test(person.trim()) ? [] : matchPeople(directory.people, person);
        const candidates = matches.length > 1 ? matches.slice(0, CANDIDATES_SHOWN).map((u) => ({ name: fullName(u), person: u.id })) : undefined;
        return { ok: false, reason: found.failure?.message ?? found.error, refused: true, ...(candidates ? { candidates } : {}) };
      } catch (err) {
        return { ok: false, reason: unreachable(err), error: err };
      }
    },
    async connect(userId) {
      try {
        const directory = await readSlackPeople(slackClient);
        if ("ok" in directory) return { ok: false, reason: directory.failure?.message ?? directory.error };
        const user = directory.people.find((u) => u.id === userId);
        if (!user) return { ok: false, reason: `No one in this Slack workspace matches ${cleanDisplayName(userId)}` };
        const channel = await directory.client.openDm(user.id);
        return {
          ok: true,
          target: {
            userId: user.id,
            displayName: shownName(user),
            firstName: firstName(user),
            channel,
            operatorUserId: directory.operatorUserId,
            operatorName: (directory.operator && firstName(directory.operator)) || OPERATOR_FALLBACK,
            newestTs: await directory.client.newestTs(channel),
          },
        };
      } catch (err) {
        return { ok: false, reason: unreachable(err) };
      }
    },
  };
}

export type SlackLinearSeam = {
  apiKey(): Promise<string | null>;
  create: typeof createSupportIssue;
  context: typeof orgIdContext;
};

const realLinear: SlackLinearSeam = { apiKey: readSupportApiKey, create: createSupportIssue, context: orgIdContext };

export function createSlackChatHandlers(opts: {
  db: Database;
  emitEvent: (topic: string, payload?: unknown) => unknown;
  log?: Logger;
  /** Resolves null when no Slack token is set; real by default, fakeable the same way chat's is. */
  slackClient?: () => Promise<SlackClient | null>;
  avatarFetch?: typeof fetch;
  avatarDir?: () => string;
  notify?: (title: string, message: string) => void;
  now?: () => number;
  /** Where a ticket is filed; real by default, fakeable the same way slackClient is. */
  linear?: SlackLinearSeam;
  /** How a milestone reaches its requester; real by default, shared by every task that sends one. */
  milestones?: MilestoneDeps;
  /** The request and open logic's deps, built once by the router so the gate handlers share them; unwired by default. */
  open?: SlackOpenDeps;
}): { [K in (typeof SLACK_CHAT_COMMANDS)[number]]: (payload: unknown) => Promise<CommandResult<K>> } {
  const { db } = opts;
  const log = opts.log ?? defaultLog;
  const slackClient = opts.slackClient ?? slackClientFromSecrets;
  const now = opts.now ?? Date.now;
  const notify = opts.notify ?? slackDeskNotify;
  const linear = opts.linear ?? realLinear;
  const milestones = opts.milestones ?? realMilestoneDeps({ db, emitEvent: opts.emitEvent, log, notify });
  const closeDeps = { db, client: slackClient, notify, post: slackRoomPoster(db, opts.emitEvent, log), now, milestones, herdrRunnerFor: realHerdrRunnerFor };
  const openDeps = opts.open ?? createSlackOpenDeps({ db, log, slackClient, now, milestones });

  const avatars = createSlackAvatars({
    client: slackClient,
    log,
    now,
    ...(opts.avatarFetch ? { fetchImpl: opts.avatarFetch } : {}),
    ...(opts.avatarDir ? { dir: opts.avatarDir } : {}),
  });

  function slackPerson(c: SlackConversation) {
    const version = avatars.version(c.slackUserId);
    return { handle: c.slackHandle, ...(version ? { avatarId: c.slackUserId, avatarVersion: version } : {}) };
  }

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

  const readPeople = () => readSlackPeople(slackClient);

  /** Everything Slack has to say before the open, so a refusal leaves nothing behind. */
  async function readSlack(agentId: string, person: string) {
    const directory = await readPeople();
    if ("ok" in directory) return directory;
    const { client, operatorUserId, operator, people } = directory;
    const found = findPerson(people, person);
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
        return slackRefusal(`Slack did not answer (${slackFailureCode(err)}), so the chat did not open`);
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
            slackDisplayName: shownName(user),
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

    "chat:slack-status": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-status">> => {
      const caller = (rawPayload ?? {}) as Commands["chat:slack-status"]["payload"];
      const conversations = listOpenConversations(db).map((c) => {
        const pane = presenceForHandle(c.agentHandle, db)?.pane;
        const holds = c.agentHandle === caller.agentHandle && sessionSeatedOn(c.agentHandle, caller.sessionId, db);
        const requested = c.requesterSession !== null && c.requesterSession === caller.sessionId
          && c.requesterHandle !== null && sessionSeatedOn(c.requesterHandle, caller.sessionId, db);
        const own = holds || requested;
        return {
          id: c.id,
          room: c.room,
          ...slackPerson(c),
          ...(pane ? { pane } : {}),
          name: identityName(c.slackHandle, db),
          agentName: identityName(c.agentHandle, db),
          displayName: c.slackDisplayName,
          openedAt: c.openedAt,
          lastActiveAt: c.lastActiveAt,
          ...(c.requesterHandle ? { requester: identityName(c.requesterHandle, db) } : {}),
          ...(c.requesterPane ? { requesterPane: c.requesterPane } : {}),
          ...(c.resumedFrom !== null ? { resumedFrom: c.resumedFrom } : {}),
          ...(c.graceUntil !== null ? { graceUntil: c.graceUntil } : {}),
          ...(c.assignedSession ? { assignedSession: c.assignedSession } : {}),
          ...(c.assignedPane ? { assignedPane: c.assignedPane } : {}),
          tickets: ticketsForChain(c.id, db),
          ...(own && c.brief ? { brief: c.brief } : {}),
        };
      });
      const closed = listLatestClosedConversations(db).map((c) => ({
        id: c.id,
        room: c.room,
        ...slackPerson(c),
        agentName: identityName(c.agentHandle, db),
        displayName: c.slackDisplayName,
        closedAt: c.closedAt ?? c.lastActiveAt,
        ...(c.graceUntil !== null ? { graceUntil: c.graceUntil } : {}),
        tickets: ticketsForChain(c.id, db),
      }));
      return { ok: true, data: { conversations, closed } };
    },

    "chat:slack-people": async (): Promise<CommandResult<"chat:slack-people">> => {
      try {
        const directory = await readPeople();
        if ("ok" in directory) return directory;
        const people = directory.people.map((u) => {
          const title = cleanDisplayName(u.title);
          return { name: fullName(u), person: u.id, ...(title ? { title } : {}), ...(u.avatar ? { avatarId: u.id, avatarVersion: pictureVersion(u.avatar) } : {}) };
        });
        return { ok: true, data: { people: people.sort(byShownName) } };
      } catch (err) {
        log.warn({ err }, "chat: Slack people could not be read");
        return slackRefusal(`Slack did not answer (${slackFailureCode(err)})`);
      }
    },

    "chat:slack-dm": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-dm">> => {
      const { userId, text } = rawPayload as Commands["chat:slack-dm"]["payload"];
      if (typeof userId !== "string" || !SLACK_ID_SHAPE.test(userId)) return { ok: false, error: "chat: a Slack user id looks like U0ABC123" };
      if (typeof text !== "string" || !text.trim()) return { ok: false, error: "chat: a Slack message needs some text" };
      try {
        const client = await slackClient();
        if (!client) return slackRefusal(`Slack isn't connected on this machine. To connect it, run ${CONNECT_STEP}`);
        const channel = await client.openDm(userId);
        const { ts } = await client.post(channel, slackPrefix(slackPersona()) + text);
        return { ok: true, data: { ts } };
      } catch (err) {
        log.warn({ err }, "chat: the Slack DM could not be sent");
        return slackRefusal(`Slack did not answer (${slackFailureCode(err)})`);
      }
    },

    "chat:slack-avatars": async (): Promise<CommandResult<"chat:slack-avatars">> => {
      return { ok: true, data: { people: await avatars.people() } };
    },

    "chat:slack-avatar-file": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-avatar-file">> => {
      const { person } = rawPayload as Commands["chat:slack-avatar-file"]["payload"];
      const file = typeof person === "string" ? await avatars.picture(person) : null;
      return { ok: true, data: file ? { file } : {} };
    },

    "chat:slack-pending": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-pending">> => {
      const { agentHandle } = rawPayload as Commands["chat:slack-pending"]["payload"];
      if (!isValidChatName(agentHandle)) return { ok: false, error: `invalid handle "${agentHandle}"` };
      const agentId = resolveHandle(agentHandle, db);
      const conversation = conversationForAgent(agentId, db);
      if (conversation) markWatcherSeen(conversation.id, now(), db);
      const notice = closedNoticeForAgent(agentId, db);
      if (notice) return { ok: true, data: { items: [notice.item], open: true, conversation: forWatcher(notice.conversation) } };
      if (!conversation) {
        const session = presenceForHandle(agentId, db)?.sessionId;
        const graced = session !== undefined && gracedConversationForSession(agentId, session, now(), db) !== undefined;
        return { ok: true, data: { items: [], open: false, ...(graced ? { graced: true as const } : {}) } };
      }
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
      if (!conversation) return slackRefusal("This pane has no Slack chat open, so a ticket can't be filed");
      if (!validTicket(payload)) return { ok: false, error: "chat: a ticket needs a kind of bug or feature, a title, a problem, an idea and acceptance points" };
      const { kind, title, problem, idea, acceptance } = payload;
      const orgIds = findOrgIds([title, problem, idea, ...acceptance], linear.context());
      if (!orgIds.ok) {
        return slackRefusal(orgIds.hit ? `The ticket ${orgIds.reason}: ${orgIds.hit}. Take it out and try again` : `The ticket was not filed: ${orgIds.reason}`);
      }
      let apiKey: string | null;
      try {
        apiKey = await linear.apiKey();
      } catch (err) {
        log.warn({ err }, "chat: the Linear support key could not be read");
        return slackRefusal(`The ticket was not filed: ${SUPPORT_KEY_NAME} could not be read from the secrets store`);
      }
      if (!apiKey) return slackRefusal(`The ticket was not filed: ${SUPPORT_KEY_NAME} is not set in the secrets store`);
      const source = { person: conversation.slackDisplayName, date: new Date(now()).toISOString().slice(0, 10), room: conversation.room };
      let issue: { id: string; title: string; url: string };
      try {
        issue = await linear.create({ kind, title, problem, idea, acceptance, source }, { apiKey });
      } catch (err) {
        log.warn({ err }, "chat: Linear did not take a ticket");
        return slackRefusal(err instanceof Error ? err.message : String(err));
      }
      try {
        recordSupportTicket(conversation.id, issue, now(), db);
      } catch (err) {
        log.warn({ err, issueId: issue.id }, "chat: the filed ticket could not be recorded");
      }
      try {
        await sendMilestone(milestones, { handle: conversation.requesterHandle, session: conversation.requesterSession }, { kind: "ticket", ...issue });
      } catch (err) {
        log.warn({ err, conversationId: conversation.id }, "chat: the ticket milestone could not be sent");
      }
      return { ok: true, data: issue };
    },

    "chat:slack-request": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-request">> => {
      const payload = rawPayload as Commands["chat:slack-request"]["payload"];
      const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
      if (!text(payload.person)) return { ok: false, error: "chat: a Slack request needs a person" };
      if (!text(payload.brief)) return { ok: false, error: "chat: a Slack request needs a brief" };
      if (!text(payload.requesterSession) || !text(payload.repo)) return { ok: false, error: "chat: a Slack request needs the requesting session and its repo" };
      if (!isValidChatName(payload.requesterHandle)) return { ok: false, error: `invalid handle "${payload.requesterHandle}"` };
      const res = await requestSlackOpen(openDeps, payload);
      if (!res.ok) return slackRefusal(res.reason);
      return { ok: true, data: "gateId" in res ? { gateId: res.gateId, question: res.question } : { candidates: res.candidates } };
    },

    "chat:slack-start": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-start">> => {
      const payload = rawPayload as Commands["chat:slack-start"]["payload"];
      const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
      if (!text(payload.person)) return { ok: false, error: "chat: a Slack chat needs a person" };
      if (!text(payload.brief) || !text(payload.repo)) return { ok: false, error: "chat: a Slack chat needs a brief and a repo" };
      if (payload.requesterHandle !== undefined && !isValidChatName(payload.requesterHandle)) return { ok: false, error: `invalid handle "${payload.requesterHandle}"` };
      const found = await openDeps.findPerson(payload.person);
      if (!found.ok) return slackRefusal(found.reason);
      const res = await approveSlackOpen(openDeps, {
        person: found.person.id,
        personName: found.person.displayName,
        brief: payload.brief,
        requesterSession: payload.requesterSession ?? null,
        requesterHandle: payload.requesterHandle ?? null,
        requesterPane: payload.requesterPane ?? null,
        repo: payload.repo,
      });
      return res.ok ? { ok: true, data: { conversation: res.conversation } } : slackRefusal(res.reason);
    },

    "chat:slack-assignment": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-assignment">> => {
      const { sessionId } = rawPayload as Commands["chat:slack-assignment"]["payload"];
      if (typeof sessionId !== "string" || !sessionId) return { ok: false, error: "chat: an assignment needs a session" };
      return { ok: true, data: { conversation: conversationForAssignedSession(sessionId, db)?.id ?? null } };
    },

    "chat:slack-resume": async (rawPayload: unknown): Promise<CommandResult<"chat:slack-resume">> => {
      const payload = rawPayload as Commands["chat:slack-resume"]["payload"];
      if (!Number.isSafeInteger(payload.conversation)) return { ok: false, error: "chat: a resume needs a conversation id" };
      const old = conversationById(payload.conversation, db);
      if (!old) return slackRefusal(`No Slack chat ${payload.conversation} is known`);
      if (payload.requesterHandle !== undefined && !isValidChatName(payload.requesterHandle)) return { ok: false, error: `invalid handle "${payload.requesterHandle}"` };
      if (payload.approved === true) {
        const res = await approveSlackResume(openDeps, { conversation: old.id, requesterSession: payload.requesterSession ?? null, requesterHandle: payload.requesterHandle ?? null });
        return res.ok ? { ok: true, data: { conversation: res.conversation, agent: res.agent } } : slackRefusal(res.reason);
      }
      if (typeof payload.requesterSession !== "string" || !payload.requesterSession || payload.requesterHandle === undefined) {
        return { ok: false, error: "chat: a resume request needs the requesting session and its handle" };
      }
      if (old.closedAt === null) return slackRefusal("That chat is still open");
      const res = await requestResume(openDeps, old, { session: payload.requesterSession, handle: payload.requesterHandle });
      return res.ok ? { ok: true, data: { gateId: res.gateId, question: res.question } } : slackRefusal(res.reason);
    },

    "chat:slack-expire": async (): Promise<CommandResult<"chat:slack-expire">> => ({ ok: true, data: { expired: await expireSlackOpenGates(openDeps) } }),
  };
}
