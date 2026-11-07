import { readFile } from 'node:fs/promises';
import {
  fromOperatorPage,
  hasLocalOrigin,
  isLocalRequest,
  type LocalServer,
} from '@mattstack/app-server/local-request';
import {
  chatArchive,
  chatBuddies,
  chatDmOpen,
  chatJoin,
  chatMark,
  chatMessages,
  chatPost,
  chatRooms,
  chatSlackAvatarFile,
  chatSlackAvatars,
  chatSlackPeople,
  chatSlackResume,
  chatSlackStart,
  chatSlackStatus,
  chatWho,
  getSetting,
  matchSlackFaces,
  paneList,
  parseIdentity,
  serializeIdentity,
  type AgentStatus,
  type ChatMessage,
  type RoomSummary,
  type RtClientOptions,
} from '@mattstack/rt-client';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { validator } from 'hono/validator';

import {
  fixtureBuddies,
  fixtureMembers,
  fixtureMessages,
  fixtureRooms,
  fixturesEnabled,
  fixtureSlackPeople,
  fixtureSlackStatus,
} from './fixtures';

/**
 * Resolved at CALL time (mirrors rt-client's own `defaultSock()` convention):
 * an env override read fresh per request, undefined otherwise so rt-client's
 * built-in default sock path still applies.
 */
function rtOpts(): RtClientOptions {
  return { sockPath: process.env.RT_SOCK_PATH };
}

/** The human operating this viewer, not the buddy/room being looked at.
    Query string wins; `chat.humanHandle` is the fallback everywhere a
    request doesn't name one explicitly. */
function humanHandle(c: Context): string {
  return c.req.query('handle') ?? getSetting<string>('chat.humanHandle').value;
}

/**
 * `before` is a message id and `limit` is a count, so both are non-negative
 * integers. `Number.isFinite` let `before=1.5` and `limit=-5` through to the
 * daemon, which is a worse place to find out.
 */
function parseIntParam(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

const CHAT_NAME = /^[a-z0-9._-]+$/;

/** Where a buddy's session runs in herdr, in the buddy row's own field names. */
interface PaneInfo {
  paneTitle?: string;
  paneWorkspace: string;
  paneTab?: string;
  agentStatus: AgentStatus;
}

interface PaneIndex {
  bySession: Map<string, PaneInfo>;
  byHandle: Map<string, PaneInfo>;
}

/**
 * The herdr pane each buddy runs in, by session id and, for a pane herdr
 * reports without one, by the presence handle `pane:list` matched it to.
 * Degrades to empty maps on any failure, herdr being down included: the
 * buddy roster is the important half of `/api/chat/buddies` and must never
 * 502 because the pane list could not be read.
 */
async function paneIndex(): Promise<PaneIndex> {
  const index: PaneIndex = { bySession: new Map(), byHandle: new Map() };
  try {
    const res = await paneList(rtOpts());
    if (!res?.ok || !res.data) return index;
    for (const pane of res.data.panes) {
      const info: PaneInfo = {
        ...(pane.title ? { paneTitle: pane.title } : {}),
        paneWorkspace: pane.workspace,
        ...(pane.tab ? { paneTab: pane.tab } : {}),
        agentStatus: pane.agentStatus,
      };
      if (pane.sessionId) index.bySession.set(pane.sessionId, info);
      if (pane.presence) index.byHandle.set(pane.presence.handle, info);
    }
    return index;
  } catch {
    return index;
  }
}

/** The daemon's own defaults for `chat:messages`, so fixtures page the
    same way: the newest `limit` (1..500, 50 unasked), oldest first, and
    `before` walking older by id. */
const FIXTURE_PAGE_DEFAULT = 50;
const FIXTURE_PAGE_MAX = 500;

function pageFixtureMessages(
  all: ChatMessage[],
  before: number | undefined,
  limit: number | undefined
): ChatMessage[] {
  const size = Math.min(
    Math.max(limit ?? FIXTURE_PAGE_DEFAULT, 1),
    FIXTURE_PAGE_MAX
  );
  const older = before === undefined ? all : all.filter(m => m.id < before);
  return older.slice(-size);
}

/**
 * A DM room's name is a hashed pair-key -- an internal lookup, not something
 * a UI shows. Every buddy-facing surface collapses it to the literal tag
 * `"dm"`; only `who`/`rooms` (talking to one room the caller already named)
 * ever see the real name.
 */
function roomTag(room: { room: string; kind?: 'dm' }): string {
  return room.kind === 'dm' ? 'dm' : room.room;
}

/**
 * The rooms the FLEET is in that the human has not joined.
 *
 * `chat:rooms` is `listRooms(handle)`, so asking as the human returns only
 * his own memberships. That is correct for a chat client and wrong for this
 * viewer: two agents can be signed into a room, visible in the roster, and
 * the rail would show nothing. The room is exactly what he needs to read.
 *
 * There is still no all-rooms verb in the daemon. Presence is the next best
 * source and a sufficient one here: `PresenceRow.repo` is the room sign-in
 * derives from a cwd, so "rooms with at least one signed-in agent" is the
 * set this viewer cares about. A room nobody is signed into is not a room
 * whose silence needs explaining.
 *
 * Rows come back `joined: false` so the rail can mark them, per the
 * artboard's `not joined` badge. Posting into one still works: the server
 * joins before it posts.
 */
async function unjoinedFleetRooms(
  joined: RoomSummary[]
): Promise<RoomSummary[]> {
  // Deliberately non-fatal: the human's own rooms are the important half of
  // this list, so a failed presence lookup degrades to "no extra rooms"
  // rather than failing the whole rail.
  const buddiesRes = await chatBuddies(rtOpts());
  if (!buddiesRes?.ok || !buddiesRes.data) return [];

  // Memberships, not repos: a presence row names the repo a buddy works in,
  // but a buddy can be in a room joined by name (`--room mantine-tokyo`)
  // that no repo derives, and `chat:rooms` is listRooms(handle) for any
  // handle, the same call the human's own half of this list comes from.
  const known = new Set(joined.map(r => r.room));
  const perBuddy = await Promise.all(
    buddiesRes.data.buddies.map(b =>
      chatRooms({ handle: b.handle }, rtOpts()).catch(() => null)
    )
  );
  // A DM room is listed too: the human is the silent third party in every
  // agent-to-agent DM by design (the rail's DIRECT section). Its summary
  // keeps `kind` and `participants` so the rail names the pair, never the
  // hashed room.
  const byRoom = new Map<string, RoomSummary>();
  for (const r of perBuddy) {
    if (!r?.ok || !r.data) continue;
    for (const summary of r.data.rooms) {
      if (!known.has(summary.room) && !byRoom.has(summary.room)) {
        byRoom.set(summary.room, summary);
      }
    }
  }
  const candidates = [...byRoom.keys()];

  const whos = await Promise.all(
    candidates.map(room => chatWho({ room }, rtOpts()))
  );

  return candidates.flatMap((room, i) => {
    const who = whos[i];
    if (!who?.ok || !who.data) return [];
    const summary = byRoom.get(room)!;
    return [
      {
        room,
        kind: summary.kind,
        participants: summary.participants,
        memberCount: who.data.members.length,
        // The human has no read cursor in a room he never joined, so there
        // is no honest unread count to report. Zero, not a guess.
        unread: 0,
        mentions: 0,
        joined: false,
      },
    ];
  });
}

const SLACK_PEOPLE_FRESH_MS = 60 * 60_000;

type SlackPeople = NonNullable<
  Awaited<ReturnType<typeof chatSlackAvatars>>['data']
>['people'];

let slackPeople: SlackPeople = [];
let slackPeopleAt = 0;

/** The daemon reads the directory hourly, so a page load need not ask more. */
async function knownSlackPeople(): Promise<SlackPeople> {
  if (slackPeopleAt && Date.now() - slackPeopleAt < SLACK_PEOPLE_FRESH_MS) {
    return slackPeople;
  }
  const res = await chatSlackAvatars(rtOpts());
  if (res.ok && res.data?.people.length) {
    slackPeople = res.data.people;
    slackPeopleAt = Date.now();
  }
  return slackPeople;
}

/** What a daemon verb that declined or failed says. A decline by policy
    (the daemon's `failure` block, as Slack's refusals send) is the
    operator's to act on, so it is a 409 with the plain sentence; anything
    else is a transport or handler failure, a 502. */
interface DaemonFailure {
  error: string;
  refused: boolean;
}

function daemonFailure(
  res: { error?: string; failure?: { code: string; message: string } },
  fallback: string
): DaemonFailure {
  return res.failure?.code === 'slack-chat'
    ? { error: res.failure.message, refused: true }
    : { error: res.error ?? fallback, refused: false };
}

/** A route that reads the Slack directory or starts or reopens a real
    chat answers only the operator's own page: the daemon verbs behind it
    ask no gate, so a forged cross-site post must never reach them. */
function notOperator(c: Context): boolean {
  return !(
    isLocalRequest(c.req.raw, c.env as LocalServer | undefined) &&
    hasLocalOrigin(c.req.raw)
  );
}

/** Starting or reopening a chat is approval itself, so the request must also
    come from the page: a pane's shell sends no Origin. */
function notOperatorPage(c: Context): boolean {
  return notOperator(c) || !fromOperatorPage(c.req.raw);
}

/** A write must say it is JSON: a form post can send text/plain without a
    CORS preflight, JSON it cannot. */
function notJson(c: Context): boolean {
  return !(c.req.header('content-type') ?? '')
    .toLowerCase()
    .startsWith('application/json');
}

/** The name the support agent goes by, for the new-chat form's placeholder. */
function supportPersonaName(): string | undefined {
  const name = getSetting<{ name?: string } | undefined>(
    'chat.slackSupport.persona'
  ).value?.name?.trim();
  return name || undefined;
}

type SlackDirectory = NonNullable<
  Awaited<ReturnType<typeof chatSlackPeople>>['data']
>['people'];

let slackDirectory: SlackDirectory = [];
let slackDirectoryAt = 0;

/** The picker filters this list in the browser, so one Slack read serves
    every keystroke: the daemon reads the whole directory per call, and a
    page only asks again after an hour. A failed read is never kept. */
async function slackDirectoryFor(): Promise<
  { people: SlackDirectory } | DaemonFailure
> {
  if (
    slackDirectoryAt &&
    Date.now() - slackDirectoryAt < SLACK_PEOPLE_FRESH_MS
  ) {
    return { people: slackDirectory };
  }
  const res = await chatSlackPeople(rtOpts());
  if (!res.ok || !res.data) return daemonFailure(res, 'slack-people: no data');
  slackDirectory = res.data.people;
  slackDirectoryAt = Date.now();
  return { people: slackDirectory };
}

/** For a test: the next call reads the daemon again. */
export function forgetSlackDirectory(): void {
  slackDirectoryAt = 0;
}

/** The repo a chat started here runs in: `chat.slackSupport.defaultRepo`,
    which holds `host/path`, as the daemon's trigger offer reads it. The
    daemon's repo index keys on the wire form, so a bare `host/path` is
    converted and a wire form is left alone. */
function supportRepo(): string | null {
  const value = getSetting<string | undefined>(
    'chat.slackSupport.defaultRepo'
  ).value?.trim();
  if (!value) return null;
  return parseIdentity(value)
    ? value
    : serializeIdentity({ kind: 'remote', id: value });
}

async function slackRoomOf(conversation: number): Promise<string | null> {
  const res = await chatSlackStatus(rtOpts()).catch(() => null);
  if (!res?.ok || !res.data) return null;
  return (
    [...res.data.conversations, ...res.data.closed].find(
      c => c.id === conversation
    )?.room ?? null
  );
}

async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const raw: unknown = await c.req.json();
    return raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return null;
  }
}

/** The DMs the human is an end of. Agent-to-agent DMs, which he only
    watches, are not his. */
function ownDms(rooms: RoomSummary[], handle: string): RoomSummary[] {
  return rooms.filter(
    r =>
      r.kind === 'dm' &&
      (r.participants?.a === handle || r.participants?.b === handle)
  );
}

/** The newest `limit` messages across DMs, oldest first. Message ids run
    across every room, so `before` pages the merged list as it does one room. */
function newestAcross(lists: ChatMessage[][], limit: number): ChatMessage[] {
  return lists
    .flat()
    .sort((a, b) => a.id - b.id)
    .slice(-limit);
}

interface DmLastMessage {
  handle: string;
  name: string;
  body: string;
}

/** A one-line preview, so the whole body of a long post never crosses the
    wire for text the sidebar truncates anyway. */
const DM_PREVIEW_CAP = 120;

/**
 * The newest message per DM room, for the fleet tree's DM second line.
 * That line prefers what the two ends are doing; this is the fallback for a
 * pair whose panes report no title, and only DM rooms carry it -- a channel
 * row has badges to say what changed.
 *
 * One `chatMessages` per DM room, in parallel and non-fatal: a room whose
 * tail fails to read renders the pair form instead of failing the listing.
 */
async function withDmLastMessage(
  rooms: RoomSummary[]
): Promise<(RoomSummary & { lastMessage?: DmLastMessage })[]> {
  const dms = rooms.filter(r => r.kind === 'dm');
  if (dms.length === 0) return rooms;
  const tails = await Promise.all(
    dms.map(r =>
      chatMessages({ room: r.room, limit: 1 }, rtOpts()).catch(() => null)
    )
  );
  const byRoom = new Map<string, DmLastMessage>();
  dms.forEach((room, i) => {
    const tail = tails[i];
    const message = tail?.ok ? tail.data?.messages.at(-1) : undefined;
    if (!message) return;
    byRoom.set(room.room, {
      handle: message.handle,
      name: message.name ?? message.handle,
      // Collapsed, not just cut: a body's newlines and fences would otherwise
      // reach the client as a "one-line" preview that is nothing of the sort.
      body: message.body.replace(/\s+/g, ' ').trim().slice(0, DM_PREVIEW_CAP),
    });
  });
  return rooms.map(room => {
    const lastMessage = byRoom.get(room.room);
    return lastMessage ? { ...room, lastMessage } : room;
  });
}

export const chat = new Hono()
  .get('/api/chat/rooms', async c => {
    if (fixturesEnabled()) return c.json({ rooms: fixtureRooms() }, 200);
    const res = await chatRooms(
      { handle: humanHandle(c), includeArchived: true },
      rtOpts()
    );
    if (!res.ok) return c.json({ error: res.error }, 502);

    const joined = res.data?.rooms ?? [];
    const extra = await unjoinedFleetRooms(joined);
    const rooms = await withDmLastMessage([...joined, ...extra]);
    return c.json({ rooms }, 200);
  })
  // Who the viewer is: the handle that keys rooms, and the name shown for it.
  .get('/api/chat/me', c => {
    const handle = humanHandle(c);
    const name = getSetting<string | undefined>('chat.displayName').value;
    return c.json({ handle, name: name || handle }, 200);
  })
  // The app makes no Slack call of its own: the daemon says which rooms hold
  // an open support chat. A daemon without the verb answers !ok, a 502 here,
  // which the client reads as no chats.
  .get('/api/chat/slack-status', async c => {
    if (fixturesEnabled()) return c.json(fixtureSlackStatus(), 200);
    const res = await chatSlackStatus(rtOpts());
    if (!res.ok || !res.data) {
      return c.json({ error: res.error ?? 'slack-status: no data' }, 502);
    }
    return c.json(res.data, 200);
  })
  .get('/api/chat/slack-avatar/:person', async c => {
    const res = await chatSlackAvatarFile(
      { person: c.req.param('person') },
      rtOpts()
    );
    const file = res.ok ? res.data?.file : undefined;
    if (!file) return c.json({ error: 'not found' }, 404);
    const bytes = await readFile(file.path).catch(() => null);
    if (!bytes) return c.json({ error: 'not found' }, 404);
    return c.body(bytes, 200, {
      'content-type': file.contentType,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
  })
  // Everyone a support chat can open with, for the new-chat picker. Each
  // person with a picture carries the id and version that
  // `/api/chat/slack-avatar/:person` takes.
  .get('/api/chat/slack-people', async c => {
    if (notOperator(c)) return c.json({ error: 'forbidden' }, 403);
    const persona = supportPersonaName();
    if (fixturesEnabled()) {
      return c.json({ people: fixtureSlackPeople(), persona }, 200);
    }
    const directory = await slackDirectoryFor();
    if ('error' in directory) {
      return directory.refused
        ? c.json({ error: directory.error }, 409)
        : c.json({ error: directory.error }, 502);
    }
    return c.json({ ...directory, persona }, 200);
  })
  // The operator's tap is the approval, so no gate and no requester pane:
  // the daemon's notices go to the operator's desk.
  .post('/api/chat/slack-start', async c => {
    if (notOperatorPage(c)) return c.json({ error: 'forbidden' }, 403);
    if (notJson(c)) {
      return c.json({ error: 'Send application/json' }, 415);
    }
    if (fixturesEnabled()) {
      return c.json(
        { error: 'Fixtures have no Slack to start a chat in' },
        409
      );
    }
    const raw = await jsonBody(c);
    if (!raw) return c.json({ error: 'Malformed JSON in request body' }, 400);
    const person = typeof raw.person === 'string' ? raw.person.trim() : '';
    const brief = typeof raw.brief === 'string' ? raw.brief.trim() : '';
    if (!person) return c.json({ error: 'person is required' }, 400);
    if (!brief) return c.json({ error: 'brief is required' }, 400);
    const repo = supportRepo();
    if (!repo) {
      return c.json(
        {
          error:
            'No repo is set for Slack chats. Set chat.slackSupport.defaultRepo first',
        },
        409
      );
    }
    const res = await chatSlackStart({ person, brief, repo }, rtOpts());
    if (!res.ok || !res.data) {
      const failed = daemonFailure(res, 'slack-start: no data');
      return failed.refused
        ? c.json({ error: failed.error }, 409)
        : c.json({ error: failed.error }, 502);
    }
    const { conversation } = res.data;
    return c.json({ conversation, room: await slackRoomOf(conversation) }, 200);
  })
  // Any closed chat, however long ago: the tap is the approval.
  .post('/api/chat/slack-resume', async c => {
    if (notOperatorPage(c)) return c.json({ error: 'forbidden' }, 403);
    if (notJson(c)) {
      return c.json({ error: 'Send application/json' }, 415);
    }
    if (fixturesEnabled()) {
      return c.json({ error: 'Fixtures have no Slack chat to resume' }, 409);
    }
    const raw = await jsonBody(c);
    if (!raw) return c.json({ error: 'Malformed JSON in request body' }, 400);
    const conversation = raw.conversation;
    if (
      typeof conversation !== 'number' ||
      !Number.isSafeInteger(conversation)
    ) {
      return c.json({ error: 'conversation is required' }, 400);
    }
    const res = await chatSlackResume(
      { conversation, approved: true },
      rtOpts()
    );
    if (!res.ok || !res.data || !('conversation' in res.data)) {
      const failed = daemonFailure(res, 'slack-resume: no data');
      return failed.refused
        ? c.json({ error: failed.error }, 409)
        : c.json({ error: failed.error }, 502);
    }
    const resumed = res.data.conversation;
    return c.json(
      { conversation: resumed, room: await slackRoomOf(resumed) },
      200
    );
  })
  // A person's picture by name, for the viewer's own face: the human has no
  // Slack chat to carry one. Null unless exactly one Slack person has the name.
  .get('/api/chat/slack-face', async c => {
    const name = c.req.query('name');
    if (!name || fixturesEnabled()) return c.json({ url: null }, 200);
    const people = await knownSlackPeople();
    const id = matchSlackFaces([['person', name]], people).person;
    const version = people.find(p => p.id === id)?.version ?? '';
    return c.json(
      { url: id ? `/api/chat/slack-avatar/${id}?v=${version}` : null },
      200
    );
  })
  .get('/api/chat/who/:room', async c => {
    const room = c.req.param('room');
    if (fixturesEnabled())
      return c.json({ members: fixtureMembers(room) }, 200);
    const res = await chatWho({ room }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  })
  // Buddies composition (2 + rooms daemon calls, deliberately uncached):
  // chatBuddies() gives the roster; the human's own chatRooms() gives the
  // set of rooms worth asking about; one chatWho() per room inverts
  // room -> members into handle -> rooms. Never re-derives a daemon-owned
  // status and never spawns git for `branch` -- both come straight off
  // chatBuddies()'s PresenceRow. The pane list rides alongside the rooms
  // wave as one more call, joined onto each buddy by sessionId.
  .get('/api/chat/buddies', async c => {
    if (fixturesEnabled()) return c.json({ buddies: fixtureBuddies() }, 200);
    const buddiesRes = await chatBuddies(rtOpts());
    if (!buddiesRes.ok || !buddiesRes.data) {
      return c.json({ error: buddiesRes.error ?? 'buddies: no data' }, 502);
    }

    // Each buddy's rooms come from its own memberships (`chat:rooms` is
    // listRooms(handle) for any handle), not from inverting `who` over the
    // human's rooms: the human is in no room he never joined, which was
    // every fleet room, so every buddy read as being nowhere. One wave of
    // calls, in buddy order, so a failure is that buddy's alone.
    const [perBuddy, panes] = await Promise.all([
      Promise.all(
        buddiesRes.data.buddies.map(b =>
          chatRooms({ handle: b.handle }, rtOpts()).catch(() => null)
        )
      ),
      paneIndex(),
    ]);
    const roomsByHandle = new Map<string, string[]>();
    buddiesRes.data.buddies.forEach((b, i) => {
      const r = perBuddy[i];
      if (!r?.ok || !r.data) return;
      const tags: string[] = [];
      for (const room of r.data.rooms) {
        const tag = roomTag(room);
        if (!tags.includes(tag)) tags.push(tag);
      }
      roomsByHandle.set(b.handle, tags);
    });

    const buddies = buddiesRes.data.buddies.map(buddy => ({
      ...buddy,
      rooms: roomsByHandle.get(buddy.handle) ?? [],
      ...(panes.bySession.get(buddy.sessionId) ??
        panes.byHandle.get(buddy.handle)),
    }));
    return c.json({ buddies }, 200);
  })
  .get(
    '/api/chat/messages/:room',
    validator('query', (value): { before?: number; limit?: number } => {
      const v = value as { before?: unknown; limit?: unknown };
      return {
        before: parseIntParam(
          typeof v?.before === 'string' ? v.before : undefined
        ),
        limit: parseIntParam(
          typeof v?.limit === 'string' ? v.limit : undefined
        ),
      };
    }),
    async c => {
      const room = c.req.param('room');
      const { before, limit } = c.req.valid('query');
      if (fixturesEnabled()) {
        return c.json(
          {
            messages: pageFixtureMessages(fixtureMessages(room), before, limit),
          },
          200
        );
      }
      const res = await chatMessages({ room, before, limit }, rtOpts());
      if (!res.ok) return c.json({ error: res.error }, 502);
      return c.json(res.data, 200);
    }
  )
  // Messages to you: every DM the human is an end of, closed ones too, as one
  // list. A DM whose tail fails to read is left out rather than failing the
  // rest.
  .get(
    '/api/chat/direct',
    validator('query', (value): { before?: number; limit?: number } => {
      const v = value as { before?: unknown; limit?: unknown };
      return {
        before: parseIntParam(
          typeof v?.before === 'string' ? v.before : undefined
        ),
        limit: parseIntParam(
          typeof v?.limit === 'string' ? v.limit : undefined
        ),
      };
    }),
    async c => {
      const { before, limit } = c.req.valid('query');
      const size = limit ?? FIXTURE_PAGE_DEFAULT;
      const handle = humanHandle(c);
      if (fixturesEnabled()) {
        const lists = ownDms(fixtureRooms(), handle).map(r =>
          pageFixtureMessages(fixtureMessages(r.room), before, size)
        );
        return c.json({ messages: newestAcross(lists, size) }, 200);
      }
      const res = await chatRooms({ handle, includeArchived: true }, rtOpts());
      if (!res.ok) return c.json({ error: res.error }, 502);
      const pages = await Promise.all(
        ownDms(res.data?.rooms ?? [], handle).map(r =>
          chatMessages({ room: r.room, before, limit: size }, rtOpts()).catch(
            () => null
          )
        )
      );
      const lists = pages.flatMap(p =>
        p?.ok && p.data ? [p.data.messages] : []
      );
      // A short older page reads as the end of history, and a cursor past a
      // missing DM skips its rows, so those failures must say so.
      const failed = lists.length < pages.length;
      if (failed && (before !== undefined || lists.length === 0)) {
        return c.json({ error: 'could not read every DM' }, 502);
      }
      return c.json({ messages: newestAcross(lists, size) }, 200);
    }
  )
  // Opening Messages to you reads everything in it.
  .post('/api/chat/direct/read', async c => {
    if (fixturesEnabled()) return c.json({ ok: true }, 200);
    const handle = humanHandle(c);
    const res = await chatRooms({ handle, includeArchived: true }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    const unread = ownDms(res.data?.rooms ?? [], handle).filter(
      r => r.unread > 0
    );
    const marks = await Promise.all(
      unread.map(r => chatMark({ handle, room: r.room }, rtOpts()))
    );
    const failed = marks.find(m => !m.ok);
    if (failed) return c.json({ error: failed.error }, 502);
    return c.json({ ok: true }, 200);
  })
  // The browser never touches rt-client directly -- this route owns the
  // join. A DM row is posted into directly (the human is a member of every
  // DM by construction, and `chat:join` REFUSES dm rooms, so joining one
  // would error); any other room is joined unconditionally right before the
  // post (idempotent for an existing member) so a first message into a room
  // the human never joined still lands.
  //
  // Parsed by hand rather than through `validator('json', ...)`: that
  // middleware only calls `c.req.json()` when the request carries a
  // `Content-Type: application/json` header, and silently hands the
  // validator function `{}` otherwise -- the composer's own `fetch` call
  // (like this route's tests) never sets one, so the validator form would
  // read every field as missing on every real request.
  .post('/api/chat/post', async c => {
    let raw: { room?: unknown; body?: unknown; mentions?: unknown };
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const room = typeof raw?.room === 'string' ? raw.room : undefined;
    const body = typeof raw?.body === 'string' ? raw.body : undefined;
    const mentions = Array.isArray(raw?.mentions)
      ? raw.mentions.filter((m): m is string => typeof m === 'string')
      : undefined;
    if (!room || body === undefined) {
      return c.json({ error: 'room and body are required' }, 400);
    }
    const handle = humanHandle(c);

    // Closed rooms too: a post revives one, and a closed DM must not fall
    // through to the join below, which refuses DM rooms.
    const roomsRes = await chatRooms(
      { handle, includeArchived: true },
      rtOpts()
    );
    if (!roomsRes.ok || !roomsRes.data) {
      return c.json({ error: roomsRes.error ?? 'rooms: no data' }, 502);
    }
    const target = roomsRes.data.rooms.find(r => r.room === room);

    if (target?.kind !== 'dm') {
      const joinRes = await chatJoin({ room, handle }, rtOpts());
      if (!joinRes.ok) return c.json({ error: joinRes.error }, 502);
    }

    const postRes = await chatPost({ room, handle, body, mentions }, rtOpts());
    if (!postRes.ok) return c.json({ error: postRes.error }, 502);
    return c.json(postRes.data, 200);
  })
  // Close is the one write that needs the human IN the room first: a closed
  // room only stays listed for members, and most channels are join-created
  // by agents. Joining first (never for a DM, which already holds him) is
  // the same move the post route makes. A name that neither his listing nor
  // the fleet union knows is refused before that join, so a typo can never
  // create-and-close a room. The daemon verb is archive; the viewer never
  // reopens, since any post revives the room.
  .post('/api/chat/close', async c => {
    let raw: { room?: unknown };
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const room = typeof raw?.room === 'string' ? raw.room : undefined;
    if (!room) return c.json({ error: 'room is required' }, 400);
    const handle = humanHandle(c);

    const roomsRes = await chatRooms(
      { handle, includeArchived: true },
      rtOpts()
    );
    if (!roomsRes.ok || !roomsRes.data) {
      return c.json({ error: roomsRes.error ?? 'rooms: no data' }, 502);
    }
    const mine = roomsRes.data.rooms.find(r => r.room === room);
    if (!mine) {
      const fleet = (await unjoinedFleetRooms(roomsRes.data.rooms)).find(
        r => r.room === room
      );
      if (!fleet) return c.json({ error: `unknown room "${room}"` }, 400);
      if (fleet.kind !== 'dm') {
        const joinRes = await chatJoin({ room, handle }, rtOpts());
        if (!joinRes.ok) return c.json({ error: joinRes.error }, 502);
      }
    }

    const res = await chatArchive({ room, handle, archived: true }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(
      { room: res.data?.room ?? room, closedAt: res.data?.archivedAt ?? null },
      200
    );
  })
  // Opens or reuses the pair's room with no first message: the client
  // navigates to it and the composer there is the DM. Parsed by hand for
  // the same reason as `/api/chat/post`.
  .post('/api/chat/dm/open', async c => {
    let raw: { to?: unknown };
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const to = typeof raw?.to === 'string' ? raw.to : undefined;
    if (!to) return c.json({ error: 'to is required' }, 400);
    if (!CHAT_NAME.test(to))
      return c.json({ error: `invalid handle "${to}"` }, 400);
    const from = humanHandle(c);
    if (to === from) return c.json({ error: "can't DM yourself" }, 400);
    const res = await chatDmOpen({ from, to }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(res.data, 200);
  });
