/**
 * The chat tools beyond post/dm/ack/claim/release (those stay in tools.ts).
 * Every tool acts only as this session: the handle comes from this
 * session's file and the session id from the server's environment, never
 * from input. No import of commands/chat.ts (TUI-adjacent).
 */
import {
  chatArchive, chatAway, chatBack, chatBuddies, chatInvite, chatJoin, chatLeave, chatMark, chatMessages,
  chatRead, chatRooms, chatSignOut, chatWho, getSetting,
} from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { existsSync, statSync } from "fs";
import { isAbsolute } from "path";
import { deleteChatSession, readChatSession, type ChatSession } from "../chat-session.ts";
import { inboxAlive, resolveInbox } from "../claude-registry.ts";
import { parseDuration } from "../duration.ts";
import { selfPaneRef } from "../self-pane.ts";
import { spawnRtJson, type RtVerbResult } from "./rt-verb.ts";
import { checkChatName, checkOptional, checkRequired, err, fromResponse, ok, requireChatHandle, type McpToolDef } from "./shared.ts";

export interface ChatToolDeps {
  read: typeof chatRead; messages: typeof chatMessages; mark: typeof chatMark; rooms: typeof chatRooms;
  who: typeof chatWho; buddies: typeof chatBuddies; join: typeof chatJoin; leave: typeof chatLeave;
  away: typeof chatAway; back: typeof chatBack;
  signOut: typeof chatSignOut; archive: typeof chatArchive; invite: typeof chatInvite;
  session: (id: string | undefined) => ChatSession | null;
  deleteSession: (id: string) => void;
  spawnRt: (path: string[], rest: string[], opts: { cwd?: string; timeoutMs?: number }) => Promise<RtVerbResult>;
  isDir: (path: string) => boolean;
  serverCwd: () => string | undefined;
  /** null means the setting could not be read at all, distinct from unset (undefined): only null blocks "as". */
  humanHandle: () => string | undefined | null;
  sessionAlive: (id: string) => boolean;
  now: () => number;
}

export const realChatToolDeps: ChatToolDeps = {
  read: chatRead, messages: chatMessages, mark: chatMark, rooms: chatRooms, who: chatWho, buddies: chatBuddies,
  join: chatJoin, leave: chatLeave, away: chatAway, back: chatBack, signOut: chatSignOut, archive: chatArchive, invite: chatInvite,
  session: readChatSession,
  deleteSession: deleteChatSession,
  spawnRt: (path, rest, opts) => spawnRtJson(path, rest, opts),
  isDir: (p) => existsSync(p) && statSync(p).isDirectory(),
  serverCwd: () => {
    try {
      return process.cwd();
    } catch {
      return undefined;
    }
  },
  humanHandle: () => {
    try {
      const v = getSetting<string>("chat.humanHandle").value;
      return typeof v === "string" && v ? v : undefined;
    } catch {
      return null;
    }
  },
  sessionAlive: (id) => {
    const binding = resolveInbox(id);
    return binding !== null && inboxAlive(binding);
  },
  now: () => Date.now(),
};

const NO_SESSION = "CLAUDE_CODE_SESSION_ID is not set; this tool runs inside a Claude Code session";
const ROOM_PROP = { room: { type: "string", description: "Room name (lowercase letters, digits, . _ -)." } };
const REPLACED = "this session cannot be reached (replaced by /clear, ended, or not in Claude Code's session registry), so chat_sign_in would sign in a session nothing receives for; run `rt chat sign-in` in Bash";
/** The reserved mention every human post carries (chat:post adds it for the human handle). */
const RESERVED_HANDLES = ["here"];
const SIGN_OUT_TIMEOUT_MS = 3000;
const PANE_REF = /^[A-Za-z0-9._:][A-Za-z0-9._:-]*$/;
const NOTE_MAX = 300;
/** Bidi override/isolate controls (reorder how the surrounding text renders) plus soft hyphen and the zero-width/BOM characters: all invisible on the page, none distinguishable from their absence by eye. */
const BIDI_CONTROLS = "\u00ad\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff";
/** Newlines are allowed because the daemon's inviteText folds them to spaces; every other C0 byte, DEL, C1 control or bidi control would reach the target pane as a keystroke or a visually reordered line. */
const NOTE_CONTROL = new RegExp(`[\\u0000-\\u0009\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f${BIDI_CONTROLS}]`);
/** inviteText prefixes every delivered note with "note from <handle>: ", folding any run of whitespace (space, tab, newline, NBSP, line/paragraph separator) to one space, so the phrase must be matched the same way to catch every spelling the daemon would fold into it. */
const NOTE_FROM = /note\s+from/i;
const AWAY_MAX = 300;
/** Away text is one line: no exception for newline or tab here, unlike NOTE_CONTROL. */
const AWAY_CONTROL = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${BIDI_CONTROLS}]`);

function flagValueError(name: string, v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v === "") return `"${name}" must be a non-empty string`;
  if (v.startsWith("-")) return `"${name}" must not start with "-"`;
  return undefined;
}

function checkPositiveInt(input: Record<string, unknown>, name: string): string | undefined {
  const v = input[name];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return `"${name}" must be a positive integer`;
  return undefined;
}

function checkCwd(input: Record<string, unknown>, isDir: (p: string) => boolean): string | undefined {
  const v = input.cwd;
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !isAbsolute(v) || !isDir(v)) return '"cwd" must be an absolute path to an existing directory';
  return undefined;
}

export function chatToolDefs(deps: ChatToolDeps = realChatToolDeps): McpToolDef[] {
  const handleOf = (env: NodeJS.ProcessEnv) => requireChatHandle(env, deps.session);
  return [
    {
      name: "chat_read",
      description: "Read unread chat messages as this session's handle (every room, or one), advancing this handle's read cursor. since (30s, 5m, 500ms, bare seconds) peeks without advancing; last returns a room's newest N regardless of the cursor, then marks it read.",
      inputSchema: { type: "object", properties: { ...ROOM_PROP, limit: { type: "number" }, since: { type: "string" }, last: { type: "number" } }, additionalProperties: false },
      shellForms: ["rt chat read"],
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = checkOptional(input, [{ name: "room", type: "string" }, { name: "since", type: "string" }]) ?? checkPositiveInt(input, "limit") ?? checkPositiveInt(input, "last")
          ?? (input.room !== undefined ? checkChatName("room", input.room) : undefined);
        if (bad) return err(bad);
        const room = input.room as string | undefined;
        if (input.last !== undefined) {
          if (input.since !== undefined) return err("last and since are mutually exclusive");
          if (!room) return err("last needs a room");
          // chat:messages checks no membership, so last could otherwise read any room including other agents' DMs.
          const who = await deps.who({ room });
          if (!who.ok) return fromResponse(who);
          if (!(who.data?.members ?? []).some((m) => m.handle === id.handle)) return err(`${id.handle} is not a member of #${room}; join it first`);
          const page = await deps.messages({ room, limit: input.last as number });
          if (!page.ok) return fromResponse(page);
          const messages = page.data?.messages ?? [];
          // upto is the shown page's own newest id, never the room's true latest: a message posted after this fetch (or beyond limit) must stay unread.
          if (messages.length > 0) {
            const upto = Math.max(...messages.map((m) => m.id));
            const marked = await deps.mark({ handle: id.handle, room, upto });
            if (!marked.ok) return fromResponse(marked);
          }
          return ok({ rooms: [{ room, messages }] });
        }
        let sinceMs: number | undefined;
        if (typeof input.since === "string") {
          const ms = parseDuration(input.since);
          if (ms == null) return err(`"since" is not a duration (use 30s, 5m, 500ms, or bare seconds): ${JSON.stringify(input.since)}`);
          sinceMs = deps.now() - ms;
        }
        const payload: Commands["chat:read"]["payload"] = { handle: id.handle, limit: (input.limit as number | undefined) ?? 20 };
        if (room) payload.room = room;
        if (sinceMs !== undefined) payload.sinceMs = sinceMs;
        const res = await deps.read(payload);
        return res.ok ? ok({ rooms: res.data?.rooms ?? [] }) : fromResponse(res);
      },
    },
    {
      name: "chat_mark",
      description: "Mark chat messages read for this session's handle: every open room, one room, or one room up to a message id (upto).",
      inputSchema: { type: "object", properties: { ...ROOM_PROP, upto: { type: "number" } }, additionalProperties: false },
      shellForms: ["rt chat mark"],
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = (input.room !== undefined ? checkChatName("room", input.room) : undefined) ?? checkPositiveInt(input, "upto");
        if (bad) return err(bad);
        if (input.upto !== undefined && input.room === undefined) return err("upto needs a room");
        const payload: Commands["chat:mark"]["payload"] = { handle: id.handle };
        if (typeof input.room === "string") payload.room = input.room;
        if (typeof input.upto === "number") payload.upto = input.upto;
        return fromResponse(await deps.mark(payload));
      },
    },
    {
      name: "chat_rooms",
      description: "List the chat rooms this session's handle belongs to, with unread counts.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      shellForms: ["rt chat rooms"],
      async handler(_input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        return fromResponse(await deps.rooms({ handle: id.handle }));
      },
    },
    {
      name: "chat_who",
      description: "List a chat room's members with their presence status.",
      inputSchema: { type: "object", properties: { ...ROOM_PROP }, required: ["room"], additionalProperties: false },
      shellForms: ["rt chat who"],
      async handler(input) {
        const bad = checkChatName("room", input.room);
        if (bad) return err(bad);
        const res = await deps.who({ room: input.room as string });
        return res.ok ? ok({ rooms: [{ room: input.room, members: res.data?.members ?? [] }] }) : fromResponse(res);
      },
    },
    {
      name: "chat_buddies",
      description: "List every chat handle on this machine with its presence status (live, idle, away, offline).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      shellForms: ["rt chat buddies"],
      async handler() {
        return fromResponse(await deps.buddies());
      },
    },
    {
      name: "chat_join",
      description: "Join a chat room as this session's handle. wakeOn (mention, all, none) sets when a message is delivered; cwd is the checkout this session works in (the server's own directory is fixed at session start).",
      inputSchema: { type: "object", properties: { ...ROOM_PROP, wakeOn: { type: "string", enum: ["mention", "all", "none"] }, cwd: { type: "string" } }, required: ["room"], additionalProperties: false },
      shellForms: ["rt chat join"],
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = checkChatName("room", input.room) ?? checkCwd(input, deps.isDir);
        if (bad) return err(bad);
        if (input.wakeOn !== undefined && input.wakeOn !== "mention" && input.wakeOn !== "all" && input.wakeOn !== "none") return err('"wakeOn" must be mention, all or none');
        const room = input.room as string;
        const payload: Commands["chat:join"]["payload"] = { room, handle: id.handle };
        if (input.wakeOn !== undefined) payload.wakeOn = input.wakeOn as "mention" | "all" | "none";
        const cwd = (input.cwd as string | undefined) ?? deps.serverCwd();
        if (cwd) payload.cwd = cwd;
        const pane = selfPaneRef(env);
        if (pane) payload.pane = pane;
        const res = await deps.join(payload);
        return res.ok ? ok({ room, ...res.data }) : fromResponse(res);
      },
    },
    {
      name: "chat_leave",
      description: "Leave a chat room as this session's handle.",
      inputSchema: { type: "object", properties: { ...ROOM_PROP }, required: ["room"], additionalProperties: false },
      shellForms: ["rt chat leave"],
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = checkChatName("room", input.room);
        if (bad) return err(bad);
        return fromResponse(await deps.leave({ room: input.room as string, handle: id.handle }));
      },
    },
    {
      name: "chat_away",
      description: "Set an away message on this session's chat presence without signing out; chat_back clears it.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
      shellForms: ["rt chat away"],
      async handler(input, env) {
        const sessionId = env.CLAUDE_CODE_SESSION_ID;
        if (!sessionId) return err(NO_SESSION);
        const bad = checkRequired(input, [{ name: "text", type: "string" }]);
        if (bad) return err(bad);
        const text = input.text as string;
        if (text.trim() === "") return err('"text" must not be empty');
        if (AWAY_CONTROL.test(text)) return err('"text" must not contain control characters');
        if (text.length > AWAY_MAX) return err(`"text" must be at most ${AWAY_MAX} characters`);
        return fromResponse(await deps.away({ sessionId, text }));
      },
    },
    {
      name: "chat_back",
      description: "Clear this session's chat away message.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      shellForms: ["rt chat back"],
      async handler(_input, env) {
        const sessionId = env.CLAUDE_CODE_SESSION_ID;
        if (!sessionId) return err(NO_SESSION);
        return fromResponse(await deps.back({ sessionId }));
      },
    },
    {
      name: "chat_sign_in",
      description: "Sign this session in to rt chat (presence, a handle, and the repo room derived from cwd unless room or noRoom says otherwise). cwd is the checkout this session works in; the server's own directory is fixed at session start. as picks this session's base handle and may not be the human's handle. After a /clear this tool refuses; run `rt chat sign-in` in Bash instead.",
      inputSchema: {
        type: "object",
        properties: { cwd: { type: "string" }, as: { type: "string" }, room: { type: "string" }, noRoom: { type: "boolean" }, status: { type: "string" } },
        additionalProperties: false,
      },
      shellForms: [{
        id: "rt chat sign-in",
        pattern: /(?<![\w-])rt\s+chat\s+sign-in(?![\w-])/,
        example: "rt chat sign-in",
        note: "after a /clear the tool refuses and Bash is correct; mark that line <!-- mcp-lint: allow -->",
      }],
      async handler(input, env) {
        const sessionId = env.CLAUDE_CODE_SESSION_ID;
        if (!sessionId) return err(NO_SESSION);
        const bad = checkOptional(input, [{ name: "noRoom", type: "boolean" }])
          ?? flagValueError("as", input.as) ?? flagValueError("room", input.room) ?? flagValueError("status", input.status)
          ?? (input.as !== undefined ? checkChatName("as", input.as) : undefined)
          ?? (input.room !== undefined ? checkChatName("room", input.room) : undefined)
          ?? checkCwd(input, deps.isDir);
        if (bad) return err(bad);
        if (input.room !== undefined && input.noRoom === true) return err("room and noRoom are mutually exclusive");
        if (typeof input.status === "string") {
          if (AWAY_CONTROL.test(input.status)) return err('"status" must not contain control characters');
          if (input.status.length > AWAY_MAX) return err(`"status" must be at most ${AWAY_MAX} characters`);
        }
        if (typeof input.as === "string") {
          const human = deps.humanHandle();
          if (human === null) return err('"as" is refused: the human\'s chat handle could not be read');
          if (input.as === human || RESERVED_HANDLES.includes(input.as)) {
            return err(`"as" may not be ${JSON.stringify(input.as)}: that handle speaks for the human`);
          }
          // A session may retake its own prior seat; any other "as" must name
          // a handle nobody else's presence row or room membership still claims.
          const own = deps.session(sessionId);
          if (own?.baseHandle !== input.as) {
            const buddies = await deps.buddies();
            if (!buddies.ok) return fromResponse(buddies);
            const rows = buddies.data?.buddies ?? [];
            // Sign-out keeps the presence row under this same session id (no
            // session file survives it), so the roster alone must also grant
            // the own-seat exemption the session file gives above.
            const ownRow = rows.some((b) => b.sessionId === sessionId && b.baseHandle === input.as);
            if (!ownRow) {
              const held = rows.find((b) => (b.baseHandle === input.as || b.handle === input.as) && b.sessionId !== sessionId);
              if (held) return err(`"as" names a handle another session holds or held (${held.handle}); omit as, or pick an unused name`);
              // includeArchived: archived rooms, DMs included, keep their history, and the buddies roster only covers about a day past sign-out.
              const rooms = await deps.rooms({ handle: input.as, includeArchived: true });
              if (!rooms.ok) return fromResponse(rooms);
              if ((rooms.data?.rooms ?? []).length > 0) {
                return err('"as" names a handle that still has room memberships; omit as, or pick an unused name');
              }
            }
          }
        }
        if (!deps.sessionAlive(sessionId)) return err(REPLACED);
        const rest = ["--session", sessionId];
        if (typeof input.as === "string") rest.push("--as", input.as);
        if (typeof input.room === "string") rest.push("--room", input.room);
        if (input.noRoom === true) rest.push("--no-room");
        if (typeof input.status === "string") rest.push("--status", input.status);
        const r = await deps.spawnRt(["chat", "sign-in"], rest, typeof input.cwd === "string" ? { cwd: input.cwd } : {});
        if (!r.ok) return err(r.error);
        const body = r.body;
        if (body === null || typeof body !== "object" || typeof (body as { handle?: unknown }).handle !== "string") {
          return err("rt chat sign-in returned no handle");
        }
        const { handle, room } = body as { handle: string; room?: unknown };
        return ok({ handle, room: room ?? null });
      },
    },
    {
      name: "chat_sign_out",
      description: "Sign this session out of rt chat: drop its presence and delete its session file. Room memberships are kept.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      shellForms: ["rt chat sign-out"],
      async handler(_input, env) {
        const sessionId = env.CLAUDE_CODE_SESSION_ID;
        if (!sessionId) return err(NO_SESSION);
        const res = await deps.signOut({ sessionId }, { timeoutMs: SIGN_OUT_TIMEOUT_MS });
        // Local cleanup runs whatever the daemon said, as the CLI's sign-out does: a stranded file keeps resolving to a dead handle.
        deps.deleteSession(sessionId);
        return ok(res.ok ? {} : { daemonError: res.error ?? "sign-out failed" });
      },
    },
    {
      name: "chat_archive",
      description: "Archive a chat room this session's handle belongs to (hidden from every member's room list until someone posts into it), or reopen it with reopen: true.",
      inputSchema: { type: "object", properties: { ...ROOM_PROP, reopen: { type: "boolean" } }, required: ["room"], additionalProperties: false },
      shellForms: ["rt chat archive"],
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = checkChatName("room", input.room) ?? checkOptional(input, [{ name: "reopen", type: "boolean" }]);
        if (bad) return err(bad);
        const room = input.room as string;
        // The daemon checks no membership, and archiving hides the room from everyone in it.
        const who = await deps.who({ room });
        if (!who.ok) return fromResponse(who);
        if (!(who.data?.members ?? []).some((m) => m.handle === id.handle)) return err(`${id.handle} is not a member of #${room}; only a member may archive or reopen it`);
        const res = await deps.archive({ room, handle: id.handle, archived: input.reopen !== true });
        return res.ok ? ok({ room: res.data?.room ?? room, archivedAt: res.data?.archivedAt ?? null }) : fromResponse(res);
      },
    },
    {
      name: "chat_invite",
      description: "Invite another herdr pane into a chat room: types /chat:join <room> (with an optional one-line note from this session's handle) into that pane. pane is a herdr pane id or ref; note is at most 300 characters; newlines become spaces and other control characters are refused.",
      inputSchema: { type: "object", properties: { pane: { type: "string" }, ...ROOM_PROP, note: { type: "string" } }, required: ["pane", "room"], additionalProperties: false },
      shellForms: ["rt chat invite"],
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = checkRequired(input, [{ name: "pane", type: "string" }]) ?? checkChatName("room", input.room) ?? checkOptional(input, [{ name: "note", type: "string" }]);
        if (bad) return err(bad);
        if (!PANE_REF.test(input.pane as string)) return err('"pane" must be a herdr pane id or ref (letters, digits, . _ : -, not starting with -)');
        if (typeof input.note === "string") {
          if (NOTE_CONTROL.test(input.note)) return err('"note" must not contain control characters');
          if (input.note.length > NOTE_MAX) return err(`"note" must be at most ${NOTE_MAX} characters`);
          if (NOTE_FROM.test(input.note)) return err('"note" must not contain "note from" (reserved for the delivered attribution prefix)');
        }
        const payload: Commands["chat:invite"]["payload"] = { paneId: input.pane as string, room: input.room as string, from: id.handle };
        if (typeof input.note === "string") payload.note = input.note;
        const callerPane = selfPaneRef(env);
        if (callerPane) payload.callerPane = callerPane;
        return fromResponse(await deps.invite(payload));
      },
    },
  ];
}
