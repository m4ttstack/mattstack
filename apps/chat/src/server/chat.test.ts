import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  chatRooms: vi.fn(),
  chatWho: vi.fn(),
  chatMessages: vi.fn(),
  chatBuddies: vi.fn(),
  chatJoin: vi.fn(),
  chatMark: vi.fn(),
  chatPost: vi.fn(),
  chatArchive: vi.fn(),
  chatDmOpen: vi.fn(),
  chatSlackAvatarFile: vi.fn(),
  chatSlackAvatars: vi.fn(),
  matchSlackFaces: vi.fn(() => ({ person: 'U1' })),
  chatSlackStatus: vi.fn(),
  paneList: vi.fn(),
  daemonHealth: vi.fn(),
  getSetting: vi.fn(() => ({ value: 'matt' })),
}));
const rt = await import('@mattstack/rt-client');
const { routes } = await import('./routes');

beforeEach(() => {
  vi.resetAllMocks();
  // The rooms handler now reads each DM room's newest message for the fleet
  // tree's second line. Most tests do not care what it is, only that the call
  // resolves like the daemon's would.
  vi.mocked(rt.chatMessages).mockResolvedValue({
    ok: true,
    data: { messages: [] },
  });
});
afterEach(() => {
  delete process.env.CHAT_FIXTURES;
});

test("rooms returns the daemon's payload, DM rows included", async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        {
          room: 'dm-9f3a2b1c0d4e',
          memberCount: 3,
          unread: 1,
          mentions: 1,
          kind: 'dm',
          participants: {
            a: 'deck-main',
            b: 'rt-chat-wt',
            aName: 'deck-main',
            bName: 'rt-chat-wt',
          },
        },
      ],
    },
  });
  const res = await routes.request('/api/chat/rooms?handle=matt');
  expect(res.status).toBe(200);
  expect((await res.json()).rooms[1]).toMatchObject({
    kind: 'dm',
    participants: {
      a: 'deck-main',
      b: 'rt-chat-wt',
      aName: 'deck-main',
      bName: 'rt-chat-wt',
    },
  });
});

test('only DM rows carry lastMessage, one line, capped at 120 chars', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        {
          room: 'dm-9f3a',
          memberCount: 3,
          unread: 1,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'edie', b: 'stan', aName: 'edie', bName: 'stan' },
        },
      ],
    },
  });
  vi.mocked(rt.chatMessages).mockResolvedValue({
    ok: true,
    data: {
      messages: [
        {
          id: 9,
          room: 'dm-9f3a',
          handle: 'edie',
          name: 'edie',
          body: `pack compile is green,\n\ncutting ${'x'.repeat(200)}`,
          postedAt: 1,
          mentions: [],
          mentionNames: [],
        },
      ],
    },
  });

  const body = await (
    await routes.request('/api/chat/rooms?handle=matt')
  ).json();

  expect(body.rooms[0].lastMessage).toBeUndefined();
  expect(rt.chatMessages).toHaveBeenCalledTimes(1);
  expect(rt.chatMessages).toHaveBeenCalledWith(
    expect.objectContaining({ room: 'dm-9f3a', limit: 1 }),
    expect.anything()
  );
  expect(body.rooms[1].lastMessage.handle).toBe('edie');
  expect(body.rooms[1].lastMessage.body).toHaveLength(120);
  expect(
    body.rooms[1].lastMessage.body.startsWith(
      'pack compile is green, cutting x'
    )
  ).toBe(true);
});

test('a DM whose tail cannot be read still lists, without lastMessage', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        {
          room: 'dm-9f3a',
          memberCount: 3,
          unread: 1,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'edie', b: 'stan', aName: 'edie', bName: 'stan' },
        },
      ],
    },
  });
  vi.mocked(rt.chatMessages).mockResolvedValue({ ok: false, error: 'nope' });

  const res = await routes.request('/api/chat/rooms?handle=matt');
  expect(res.status).toBe(200);
  expect((await res.json()).rooms[0].lastMessage).toBeUndefined();
});

test('an ok:false from the daemon becomes a 502, not a crash', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({ ok: false, error: 'nope' });
  expect((await routes.request('/api/chat/rooms?handle=matt')).status).toBe(
    502
  );
});

test('daemon-unreachable ALSO arrives as ok:false, never a throw', async () => {
  // rt-client cannot throw: rtCommand catches everything and returns
  // ok:false with an "rt daemon unreachable at <sock>" prefix.
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: false,
    error: 'rt daemon unreachable at /x/rt.sock: ECONNREFUSED',
  });
  expect((await routes.request('/api/chat/rooms?handle=matt')).status).toBe(
    502
  );
});

test("who passes the daemon's status through and never spawns git", async () => {
  vi.mocked(rt.chatWho).mockResolvedValueOnce({
    ok: true,
    data: {
      members: [
        {
          room: 'build',
          handle: 'a',
          name: 'a',
          joinedAt: 1,
          lastReadId: 0,
          wakeOn: 'mention',
          cwd: '/w/a',
          status: 'idle',
        },
      ],
    },
  });
  const res = await routes.request('/api/chat/who/build');
  // One read. A Response body is a stream, so a second res.json() throws
  // "Body is unusable" rather than returning the same payload again.
  const body = await res.json();
  expect(body.members[0]).toMatchObject({ status: 'idle' });
  expect(body.members[0].branch).toBeUndefined();
});

test("buddies carries each buddy's rooms as tags, with DMs collapsed to `dm`", async () => {
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          sessionId: 's1',
          handle: 'a',
          baseHandle: 'a',
          name: 'a',
          signedInAt: 1,
          lastSeenAt: 1,
          branch: 'fix-auth',
          status: 'live',
        },
      ],
    },
  });
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        { room: 'build', memberCount: 2, unread: 0, mentions: 0 },
        {
          room: 'dm-9f3a2b1c0d4e',
          memberCount: 3,
          unread: 0,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'a', b: 'b', aName: 'a', bName: 'b' },
        },
      ],
    },
  });
  vi.mocked(rt.chatWho)
    .mockResolvedValueOnce({
      ok: true,
      data: {
        members: [
          {
            room: 'build',
            handle: 'a',
            name: 'a',
            joinedAt: 1,
            lastReadId: 0,
            wakeOn: 'mention',
            status: 'live',
          },
        ],
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        members: [
          {
            room: 'dm-9f3a2b1c0d4e',
            handle: 'a',
            name: 'a',
            joinedAt: 1,
            lastReadId: 0,
            wakeOn: 'all',
            status: 'live',
          },
        ],
      },
    });
  const res = await routes.request('/api/chat/buddies');
  expect((await res.json()).buddies[0]).toMatchObject({
    handle: 'a',
    status: 'live',
    branch: 'fix-auth',
    rooms: ['build', 'dm'],
  });
});

test('buddies join the live herdr pane title by sessionId', async () => {
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          sessionId: 's1',
          handle: 'a',
          baseHandle: 'a',
          name: 'a',
          signedInAt: 1,
          lastSeenAt: 1,
          status: 'live',
        },
      ],
    },
  });
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: { rooms: [] },
  });
  vi.mocked(rt.paneList).mockResolvedValueOnce({
    ok: true,
    data: {
      panes: [
        {
          paneId: 'w1:p1',
          workspace: 'x',
          agentStatus: 'working',
          sessionId: 's1',
          title: 'Fix the thing',
          tab: 'loosening mcp rules',
        },
      ],
    },
  });
  const res = await routes.request('/api/chat/buddies');
  expect((await res.json()).buddies[0]).toMatchObject({
    handle: 'a',
    paneTitle: 'Fix the thing',
    paneWorkspace: 'x',
    paneTab: 'loosening mcp rules',
    agentStatus: 'working',
  });
});

test('a pane herdr reports with no session id still joins its buddy by handle', async () => {
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          sessionId: 's1',
          handle: 'a',
          baseHandle: 'a',
          name: 'a',
          signedInAt: 1,
          lastSeenAt: 1,
          status: 'idle',
        },
      ],
    },
  });
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: { rooms: [] },
  });
  vi.mocked(rt.paneList).mockResolvedValueOnce({
    ok: true,
    data: {
      panes: [
        {
          paneId: 'w1:p1',
          workspace: 'x',
          agentStatus: 'blocked',
          presence: { handle: 'a', name: 'a', status: 'idle', rooms: [] },
        },
      ],
    },
  });
  const res = await routes.request('/api/chat/buddies');
  expect((await res.json()).buddies[0]).toMatchObject({
    handle: 'a',
    paneWorkspace: 'x',
    agentStatus: 'blocked',
  });
});

test('a failed pane:list degrades buddies to no titles, never a 502', async () => {
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          sessionId: 's1',
          handle: 'a',
          baseHandle: 'a',
          name: 'a',
          signedInAt: 1,
          lastSeenAt: 1,
          status: 'live',
        },
      ],
    },
  });
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: { rooms: [] },
  });
  vi.mocked(rt.paneList).mockResolvedValueOnce({
    ok: false,
    error: 'herdr unavailable: not running',
  });
  const res = await routes.request('/api/chat/buddies');
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    buddies: Array<Record<string, unknown>>;
  };
  expect(body.buddies[0]!.handle).toBe('a');
  expect(body.buddies[0]!.paneTitle).toBeUndefined();
});

test('fixtures mode bakes paneTitle directly, no pane:list call: jay carries a real title, max carries only its own handle', async () => {
  process.env.CHAT_FIXTURES = '1';
  const res = await routes.request('/api/chat/buddies');
  const body = (await res.json()) as {
    buddies: Array<{ handle: string; paneTitle?: string }>;
  };
  expect(body.buddies.find(b => b.handle === 'jay')?.paneTitle).toBe(
    'Boxscore mattstack integration'
  );
  expect(body.buddies.find(b => b.handle === 'max')?.paneTitle).toBe('max');
  expect(rt.paneList).not.toHaveBeenCalled();
});

test('a dropped write surfaces as an error, never a silent success', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: { rooms: [{ room: 'r', memberCount: 1, unread: 0, mentions: 0 }] },
  });
  vi.mocked(rt.chatJoin).mockResolvedValueOnce({
    ok: true,
    data: { handle: 'matt', name: 'matt', memberCount: 2, unread: 0 },
  });
  vi.mocked(rt.chatPost).mockResolvedValueOnce({
    ok: false,
    error: 'write dropped',
  });
  expect(
    (
      await routes.request('/api/chat/post', {
        method: 'POST',
        body: JSON.stringify({ room: 'r', body: 'x' }),
      })
    ).status
  ).toBe(502);
});

test('posting into a room the human has not joined joins first, then posts', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: { rooms: [] },
  });
  vi.mocked(rt.chatJoin).mockResolvedValueOnce({
    ok: true,
    data: { handle: 'matt', name: 'matt', memberCount: 2, unread: 0 },
  });
  vi.mocked(rt.chatPost).mockResolvedValueOnce({
    ok: true,
    data: { id: 1, recipients: [], recipientNames: [], others: 1 },
  });
  const res = await routes.request('/api/chat/post', {
    method: 'POST',
    body: JSON.stringify({ room: 'release', body: 'hello' }),
  });
  expect(res.status).toBe(200);
  expect(rt.chatJoin).toHaveBeenCalledWith(
    expect.objectContaining({ room: 'release', handle: 'matt' }),
    expect.anything()
  );
  expect(vi.mocked(rt.chatJoin).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(rt.chatPost).mock.invocationCallOrder[0]
  );
});

test('posting into a DM never joins: the human is already its silent member and join refuses DM rooms', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        {
          room: 'dm-9f3a2b1c0d4e',
          memberCount: 3,
          unread: 0,
          mentions: 0,
          kind: 'dm',
          participants: {
            a: 'deck-main',
            b: 'rt-chat-wt',
            aName: 'deck-main',
            bName: 'rt-chat-wt',
          },
        },
      ],
    },
  });
  vi.mocked(rt.chatPost).mockResolvedValueOnce({
    ok: true,
    data: {
      id: 2,
      recipients: ['deck-main', 'rt-chat-wt'],
      recipientNames: ['deck-main', 'rt-chat-wt'],
      others: 2,
    },
  });
  const res = await routes.request('/api/chat/post', {
    method: 'POST',
    body: JSON.stringify({
      room: 'dm-9f3a2b1c0d4e',
      body: 'seen — fine by me',
    }),
  });
  expect(res.status).toBe(200);
  expect(rt.chatJoin).not.toHaveBeenCalled();
});

test('rooms includes rooms the FLEET is in that the human has not joined', async () => {
  // `chat:rooms` is listRooms(handle), so asking as the human returns only
  // his memberships. Two agents signed into #forge-leaderboard were visible
  // in the roster while the rail showed nothing -- the room he most needed
  // to read was the one room he could not see.
  // Memberships come from chat:rooms per handle: the human's own call, then
  // one per buddy. `a` is also in a room joined by name that no repo
  // derives, which is the case a repo-based union could never show.
  const roomsByHandle: Record<string, string[]> = {
    matt: ['build'],
    a: ['forge-leaderboard', 'mantine-tokyo', 'dm-a1b2'],
    b: ['forge-leaderboard'],
    c: ['build'],
  };
  vi.mocked(rt.chatRooms).mockImplementation(async ({ handle }) => ({
    ok: true,
    data: {
      rooms: (roomsByHandle[handle] ?? []).map(room => ({
        room,
        memberCount: 2,
        unread: handle === 'matt' ? 1 : 0,
        mentions: 0,
        ...(room.startsWith('dm-')
          ? {
              kind: 'dm' as const,
              participants: { a: 'a', b: 'b', aName: 'a', bName: 'b' },
            }
          : {}),
      })),
    },
  }));
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: (['a', 'b', 'c'] as const).map((handle, i) => ({
        sessionId: `s${i + 1}`,
        handle,
        baseHandle: handle,
        name: handle,
        signedInAt: 1,
        lastSeenAt: 1,
        status: 'live' as const,
        repo: handle === 'c' ? 'build' : 'forge-leaderboard',
      })),
    },
  });
  const member = (room: string, handle: string) => ({
    room,
    handle,
    name: handle,
    joinedAt: 1,
    lastReadId: 0,
    wakeOn: 'mention' as const,
    status: 'live' as const,
  });
  vi.mocked(rt.chatWho).mockImplementation(async ({ room }) => ({
    ok: true,
    data: {
      members:
        room === 'forge-leaderboard'
          ? [member(room, 'a'), member(room, 'b')]
          : [member(room, 'a')],
    },
  }));

  const body = await (
    await routes.request('/api/chat/rooms?handle=matt')
  ).json();

  // `build` is already the human's, so it is not duplicated from presence.
  expect(body.rooms.map((r: { room: string }) => r.room)).toEqual([
    'build',
    'forge-leaderboard',
    'mantine-tokyo',
    'dm-a1b2',
  ]);
  // An agent-to-agent DM is the human's to read by design; the rail names
  // it by its pair, so the pair travels with it.
  expect(body.rooms[3]).toMatchObject({
    room: 'dm-a1b2',
    kind: 'dm',
    participants: { a: 'a', b: 'b', aName: 'a', bName: 'b' },
    joined: false,
  });
  expect(body.rooms[2]).toMatchObject({
    room: 'mantine-tokyo',
    memberCount: 1,
    joined: false,
  });
  expect(body.rooms[0]).toMatchObject({ room: 'build', unread: 1 });
  expect(body.rooms[1]).toMatchObject({
    room: 'forge-leaderboard',
    memberCount: 2,
    joined: false,
    // No read cursor in a room he never joined, so no honest unread count.
    unread: 0,
  });
});

test('a failed presence lookup degrades to the human rooms, not an error', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }],
    },
  });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({ ok: false, error: 'nope' });

  const res = await routes.request('/api/chat/rooms?handle=matt');
  expect(res.status).toBe(200);
  expect((await res.json()).rooms).toHaveLength(1);
});

test('rooms asks for the human’s archived rooms too and passes archivedAt through', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        {
          room: 'retro',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          archivedAt: 1700000000000,
        },
      ],
    },
  });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: { buddies: [] },
  });
  const res = await routes.request('/api/chat/rooms?handle=matt');
  expect(res.status).toBe(200);
  expect(rt.chatRooms).toHaveBeenCalledWith(
    { handle: 'matt', includeArchived: true },
    expect.anything()
  );
  const { rooms } = await res.json();
  expect(rooms[1]).toMatchObject({ room: 'retro', archivedAt: 1700000000000 });
});

test('closing a channel the human never joined joins him first, then closes', async () => {
  vi.mocked(rt.chatRooms)
    .mockResolvedValueOnce({ ok: true, data: { rooms: [] } })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        rooms: [{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }],
      },
    });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          handle: 'fred',
          baseHandle: 'fred',
          name: 'fred',
          sessionId: 's1',
          status: 'live',
          signedInAt: 1,
          lastSeenAt: 1,
          cwd: '/x',
        },
      ],
    },
  });
  vi.mocked(rt.chatWho).mockResolvedValueOnce({
    ok: true,
    data: {
      members: [
        {
          room: 'build',
          handle: 'fred',
          name: 'fred',
          joinedAt: 1,
          lastReadId: 0,
          wakeOn: 'mention',
          status: 'live',
        },
      ],
    },
  });
  vi.mocked(rt.chatJoin).mockResolvedValueOnce({
    ok: true,
    data: { handle: 'matt', name: 'matt', memberCount: 2, unread: 0 },
  });
  vi.mocked(rt.chatArchive).mockResolvedValueOnce({
    ok: true,
    data: { room: 'build', archivedAt: 5 },
  });
  const res = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build' }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ room: 'build', closedAt: 5 });
  expect(rt.chatJoin).toHaveBeenCalledWith(
    { room: 'build', handle: 'matt' },
    expect.anything()
  );
  expect(rt.chatArchive).toHaveBeenCalledWith(
    { room: 'build', handle: 'matt', archived: true },
    expect.anything()
  );
});

test('closing a room already in the human’s listing never joins; a DM never joins either', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }],
    },
  });
  vi.mocked(rt.chatArchive).mockResolvedValue({
    ok: true,
    data: { room: 'build', archivedAt: 5 },
  });
  await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build' }),
  });
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        {
          room: 'dm-1',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'fred', b: 'matt', aName: 'fred', bName: 'matt' },
        },
      ],
    },
  });
  await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'dm-1' }),
  });
  expect(rt.chatJoin).not.toHaveBeenCalled();
  expect(rt.chatArchive).toHaveBeenCalledTimes(2);
});

test('closing a DM known only through the fleet union never joins', async () => {
  vi.mocked(rt.chatRooms)
    .mockResolvedValueOnce({ ok: true, data: { rooms: [] } })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        rooms: [
          {
            room: 'dm-1',
            memberCount: 2,
            unread: 0,
            mentions: 0,
            kind: 'dm',
            participants: {
              a: 'fred',
              b: 'matt',
              aName: 'fred',
              bName: 'matt',
            },
          },
        ],
      },
    });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          handle: 'fred',
          baseHandle: 'fred',
          name: 'fred',
          sessionId: 's1',
          status: 'live',
          signedInAt: 1,
          lastSeenAt: 1,
          cwd: '/x',
        },
      ],
    },
  });
  vi.mocked(rt.chatWho).mockResolvedValueOnce({
    ok: true,
    data: {
      members: [
        {
          room: 'dm-1',
          handle: 'fred',
          name: 'fred',
          joinedAt: 1,
          lastReadId: 0,
          wakeOn: 'mention',
          status: 'live',
        },
      ],
    },
  });
  vi.mocked(rt.chatArchive).mockResolvedValueOnce({
    ok: true,
    data: { room: 'dm-1', archivedAt: 5 },
  });
  const res = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'dm-1' }),
  });
  expect(res.status).toBe(200);
  expect(rt.chatJoin).not.toHaveBeenCalled();
  expect(rt.chatArchive).toHaveBeenCalledWith(
    { room: 'dm-1', handle: 'matt', archived: true },
    expect.anything()
  );
});

test('close 400s on a bad body and on a room nobody lists, and never join-creates', async () => {
  const bad = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: '{not json',
  });
  expect(bad.status).toBe(400);
  const noRoom = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  expect(noRoom.status).toBe(400);
  expect((await noRoom.json()).error).toBe('room is required');
  vi.mocked(rt.chatRooms).mockResolvedValue({ ok: true, data: { rooms: [] } });
  vi.mocked(rt.chatBuddies).mockResolvedValue({
    ok: true,
    data: { buddies: [] },
  });
  const ghost = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'ghost' }),
  });
  expect(ghost.status).toBe(400);
  expect(rt.chatJoin).not.toHaveBeenCalled();
  expect(rt.chatArchive).not.toHaveBeenCalled();
});

test('close 502s when the daemon refuses, and the old archive route is gone', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }],
    },
  });
  vi.mocked(rt.chatArchive).mockResolvedValueOnce({ ok: false, error: 'nope' });
  const refused = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build' }),
  });
  expect(refused.status).toBe(502);
  const gone = await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build', archived: true }),
  });
  expect(gone.status).toBe(404);
});

test('dm/open opens or reuses the pair’s room as the human without posting', async () => {
  vi.mocked(rt.chatDmOpen).mockResolvedValueOnce({
    ok: true,
    data: { room: 'dm-1a2b3c4d5e6f', created: true },
  });
  const res = await routes.request('/api/chat/dm/open?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ to: 'fred' }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ room: 'dm-1a2b3c4d5e6f', created: true });
  expect(rt.chatDmOpen).toHaveBeenCalledWith(
    { from: 'matt', to: 'fred' },
    expect.anything()
  );
  expect(rt.chatPost).not.toHaveBeenCalled();
});

test('dm/open surfaces a dropped write as a 502 with the daemon message', async () => {
  vi.mocked(rt.chatDmOpen).mockResolvedValueOnce({
    ok: false,
    error: 'dm-open dropped',
  });
  const res = await routes.request('/api/chat/dm/open?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ to: 'fred' }),
  });
  expect(res.status).toBe(502);
  expect((await res.json()).error).toBe('dm-open dropped');
});

test('dm/open 400s on a missing, invalid, or own handle before touching the daemon', async () => {
  const cases: Array<[unknown, string]> = [
    [{}, 'to is required'],
    [{ to: 'Has@Sigil' }, 'invalid handle "Has@Sigil"'],
    [{ to: 'matt' }, "can't DM yourself"],
  ];
  for (const [body, message] of cases) {
    const res = await routes.request('/api/chat/dm/open?handle=matt', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(message);
  }
  expect(rt.chatDmOpen).not.toHaveBeenCalled();
});

test('POST /api/chat/dm is gone', async () => {
  // The JSON-vs-SPA-shell 404 shape is @mattstack/app-server's createApp
  // concern now (covered there); this only guards the route stays retired.
  const res = await routes.request('/api/chat/dm', {
    method: 'POST',
    body: JSON.stringify({ to: 'fred', body: 'hi' }),
  });
  expect(res.status).toBe(404);
});

test('fixtures mode pages GET /api/chat/messages like the daemon: the newest `limit`, `before` walking older, oldest first', async () => {
  process.env.CHAT_FIXTURES = '1';
  const ids = async (query: string) =>
    (
      (await (
        await routes.request(`/api/chat/messages/rt${query}`)
      ).json()) as {
        messages: { id: number }[];
      }
    ).messages.map(m => m.id);
  expect(await ids('?limit=2')).toEqual([608, 609]);
  expect(await ids('?before=605&limit=2')).toEqual([603, 604]);
  expect(await ids('?before=601&limit=2')).toEqual([]);
  expect(await ids('')).toEqual([601, 602, 603, 604, 605, 606, 607, 608, 609]);
  expect(rt.chatMessages).not.toHaveBeenCalled();
});

test('dm/open hands the daemon a name or an id exactly as typed', async () => {
  vi.mocked(rt.chatDmOpen).mockResolvedValue({
    ok: true,
    data: { room: 'dm-2c9b7e41d0a5', created: false },
  });
  for (const to of ['remy', 'remy.m2p4']) {
    const res = await routes.request('/api/chat/dm/open?handle=matt', {
      method: 'POST',
      body: JSON.stringify({ to }),
    });
    expect(res.status).toBe(200);
  }
  expect(vi.mocked(rt.chatDmOpen).mock.calls.map(c => c[0])).toEqual([
    { from: 'matt', to: 'remy' },
    { from: 'matt', to: 'remy.m2p4' },
  ]);
});

test('buddies that share a name keep their own rooms, keyed by id', async () => {
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          sessionId: 's1',
          handle: 'remy',
          baseHandle: 'remy',
          name: 'remy',
          signedInAt: 1,
          lastSeenAt: 1,
          status: 'idle',
        },
        {
          sessionId: 's2',
          handle: 'remy.m2p4',
          baseHandle: 'remy',
          name: 'remy',
          signedInAt: 2,
          lastSeenAt: 2,
          status: 'live',
        },
      ],
    },
  });
  vi.mocked(rt.chatRooms).mockImplementation(async ({ handle }) => ({
    ok: true,
    data: {
      rooms:
        handle === 'remy'
          ? [{ room: 'rt', memberCount: 2, unread: 0, mentions: 0 }]
          : [
              {
                room: 'dm-2c9b7e41d0a5',
                memberCount: 3,
                unread: 0,
                mentions: 0,
                kind: 'dm' as const,
                participants: {
                  a: 'kai',
                  b: 'remy.m2p4',
                  aName: 'kai',
                  bName: 'remy',
                },
              },
            ],
    },
  }));
  const res = await routes.request('/api/chat/buddies');
  const { buddies } = await res.json();
  expect(buddies).toMatchObject([
    { handle: 'remy', name: 'remy', rooms: ['rt'] },
    { handle: 'remy.m2p4', name: 'remy', rooms: ['dm'] },
  ]);
});

test('a DM tail carries its author name beside the id', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        {
          room: 'dm-2c9b7e41d0a5',
          memberCount: 3,
          unread: 1,
          mentions: 0,
          kind: 'dm',
          participants: {
            a: 'kai',
            b: 'remy.m2p4',
            aName: 'kai',
            bName: 'remy',
          },
        },
      ],
    },
  });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: { buddies: [] },
  });
  vi.mocked(rt.chatMessages).mockResolvedValue({
    ok: true,
    data: {
      messages: [
        {
          id: 812,
          room: 'dm-2c9b7e41d0a5',
          handle: 'remy.m2p4',
          name: 'remy',
          body: 'on it',
          mentions: [],
          mentionNames: [],
          postedAt: 1,
        },
      ],
    },
  });
  const res = await routes.request('/api/chat/rooms?handle=matt');
  expect((await res.json()).rooms[0].lastMessage).toEqual({
    handle: 'remy.m2p4',
    name: 'remy',
    body: 'on it',
  });
});

test('slack-status passes the open chats through', async () => {
  const conversations = [
    {
      id: 1,
      room: 'dm-slack',
      handle: 'slack.alex',
      name: 'alex-slack',
      agentName: 'max',
      displayName: 'Alex Example',
      openedAt: 1,
      lastActiveAt: 2,
    },
  ];
  vi.mocked(rt.chatSlackStatus).mockResolvedValueOnce({
    ok: true,
    data: { conversations, closed: [] },
  });
  const res = await routes.request('/api/chat/slack-status');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ conversations, closed: [] });
});

test('slack-status is a 502 when the daemon refuses, as an old daemon does', async () => {
  vi.mocked(rt.chatSlackStatus).mockResolvedValueOnce({
    ok: false,
    error: 'unknown command',
  });
  const res = await routes.request('/api/chat/slack-status');
  expect(res.status).toBe(502);
});

test('slack-status under fixtures names one open chat and never calls the daemon', async () => {
  process.env.CHAT_FIXTURES = '1';
  const res = await routes.request('/api/chat/slack-status');
  const body = (await res.json()) as { conversations: { room: string }[] };
  expect(body.conversations).toHaveLength(1);
  expect(rt.chatSlackStatus).not.toHaveBeenCalled();
});

test('the rooms write route and the invite route stay gone', async () => {
  const rooms = await routes.request('/api/chat/rooms', {
    method: 'POST',
    body: JSON.stringify({ room: 'build' }),
  });
  expect(rooms.status).toBe(404);
  const invite = await routes.request('/api/chat/invite', {
    method: 'POST',
    body: JSON.stringify({ room: 'build', panes: [{ paneId: 'w1:p1' }] }),
  });
  expect(invite.status).toBe(404);
  expect(rt.chatJoin).not.toHaveBeenCalled();
});

function humanDms() {
  const dm = (room: string, a: string, b: string, unread: number) => ({
    room,
    memberCount: 2,
    unread,
    mentions: 0,
    kind: 'dm' as const,
    participants: { a, b, aName: a, bName: b },
  });
  return [
    { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
    dm('dm-kai', 'kai', 'matt', 1),
    dm('dm-remy', 'matt', 'remy', 0),
    dm('dm-agents', 'kai', 'remy', 5),
  ];
}

const row = (id: number, room: string) => ({
  id,
  room,
  handle: 'kai',
  name: 'kai',
  body: `m${id}`,
  mentions: [],
  mentionNames: [],
  postedAt: id,
});

test('direct merges the human’s DMs by id and leaves out the rest', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValue({
    ok: true,
    data: { rooms: humanDms() },
  });
  vi.mocked(rt.chatMessages).mockImplementation(async ({ room }) => ({
    ok: true,
    data: {
      messages:
        room === 'dm-kai'
          ? [row(1, room), row(4, room)]
          : [row(2, room), row(3, room)],
    },
  }));
  const res = await routes.request('/api/chat/direct?limit=3');
  expect(res.status).toBe(200);
  const { messages } = await res.json();
  expect(messages.map((m: { id: number }) => m.id)).toEqual([2, 3, 4]);
  const asked = vi.mocked(rt.chatMessages).mock.calls.map(c => c[0].room);
  expect(asked).toEqual(['dm-kai', 'dm-remy']);
});

test('direct asks with the closed DMs too, and passes before through', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValue({
    ok: true,
    data: { rooms: humanDms() },
  });
  await routes.request('/api/chat/direct?before=9&limit=2');
  expect(vi.mocked(rt.chatRooms).mock.calls[0]![0]).toMatchObject({
    includeArchived: true,
  });
  expect(vi.mocked(rt.chatMessages).mock.calls[0]![0]).toMatchObject({
    before: 9,
    limit: 2,
  });
});

test('a DM whose tail fails is left out, the rest still answer', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValue({
    ok: true,
    data: { rooms: humanDms() },
  });
  vi.mocked(rt.chatMessages).mockImplementation(async ({ room }) =>
    room === 'dm-kai'
      ? { ok: false, error: 'nope' }
      : { ok: true, data: { messages: [row(2, room)] } }
  );
  const { messages } = await (await routes.request('/api/chat/direct')).json();
  expect(messages).toHaveLength(1);
});

test('reading direct marks only the human’s unread DMs', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValue({
    ok: true,
    data: { rooms: humanDms() },
  });
  vi.mocked(rt.chatMark).mockResolvedValue({ ok: true, data: {} });
  const res = await routes.request('/api/chat/direct/read', { method: 'POST' });
  expect(res.status).toBe(200);
  expect(vi.mocked(rt.chatMark).mock.calls.map(c => c[0])).toEqual([
    { handle: 'matt', room: 'dm-kai' },
  ]);
});

test('slack-face names the viewer’s picture, with its version', async () => {
  vi.mocked(rt.matchSlackFaces).mockReturnValue({ person: 'U1' });
  vi.mocked(rt.chatSlackAvatars).mockResolvedValue({
    ok: true,
    data: { people: [{ id: 'U1', version: 'v9' }] },
  } as never);
  const res = await routes.request('/api/chat/slack-face?name=Pat%20Lee');
  expect(await res.json()).toEqual({
    url: '/api/chat/slack-avatar/U1?v=v9',
  });
});

test('slack-face answers null for a name nobody matches', async () => {
  vi.mocked(rt.matchSlackFaces).mockReturnValue({});
  const res = await routes.request('/api/chat/slack-face?name=Nobody');
  expect(await res.json()).toEqual({ url: null });
});
