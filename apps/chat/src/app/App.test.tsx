import { notifications } from '@mattstack/app-kit/notifications';
import {
  renderWithProviders,
  setViewportWidth,
} from '@mattstack/app-kit/test-utils';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';

import {
  FakeWebSocket,
  fetchMock,
  installFakeWebSocket,
  installFetchMock,
  restoreWebSocket,
} from './test-utils';

import './icons';

import { App } from './App';
import { PAGE_SIZE } from './Transcript';

const DESKTOP_WIDTH = window.innerWidth;

// `useBuddies` opens a real `/ws` connection on every mount now (for the
// chat/*/msg refetch) -- stub it the same way Transcript's own suite does,
// rather than letting every test in this file hit jsdom's real WebSocket.
beforeEach(() => {
  installFakeWebSocket();
});

// Reset the URL and the persisted scheme preference so nothing leaks
// across tests.
afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.removeItem('ui-color-scheme');
  // The mobile-viewport test below leaves `chat-rooms-sidebar` collapsed:
  // `PageShell`'s own mobile effect persists `sidebarOpen: false` to this
  // key regardless of which test set the viewport, and a later desktop
  // test would otherwise inherit a collapsed (pointer-events: none) rail.
  window.localStorage.removeItem('chat-rooms-sidebar');
  setViewportWidth(DESKTOP_WIDTH);
  // The notifications store lives outside React (a module-level singleton),
  // so an error toast from one test survives that test's unmount and can
  // collide with a later test asserting the same message.
  notifications.clean();
  restoreWebSocket();
});

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderWithProviders(<App />);
}

test('/demo renders the kit full-screen PageShell showcase, bypassing the chat chrome', () => {
  renderAt('/demo');

  expect(
    screen.getByRole('navigation', { name: 'Gear app navigation' })
  ).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: 'App sections' })).toBeNull();
});

test('unknown paths render the not-found page inside the chat chrome', () => {
  renderAt('/no/such/page');

  expect(
    screen.getByRole('heading', { level: 1, name: 'Page not found' })
  ).toBeTruthy();
  expect(screen.getByRole('banner')).toBeInTheDocument();
  expect(screen.queryByTestId('room-rail')).toBeNull();

  fireEvent.click(screen.getByRole('link', { name: /Back home/ }));

  expect(window.location.pathname).toBe('/');
});

test('seeded messages survive to the opened room, even if the fetch rejects', async () => {
  // `activeRoom` is undefined on the first render, so a seed bound to `room`
  // at mount binds to undefined and is discarded the moment a real room
  // lands. The seed then only ever worked when the fetch happened to return
  // the same thing -- which is the seam not working at all.
  installFetchMock();
  fetchMock.mockRejectedValue(new Error('network down'));
  window.history.replaceState(null, '', '/r/build');

  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
        messages: [
          {
            id: 7,
            room: 'build',
            handle: 'deck-main',
            name: 'deck-main',
            body: 'seeded body',
            mentions: [],
            mentionNames: [],
            postedAt: 1,
          },
        ],
      }}
    />
  );

  // textContent, not getByText: message bodies are split into spans so
  // mentions can carry their own colour.
  const transcript = await screen.findByTestId('transcript');
  expect(transcript).toHaveTextContent('seeded body');
});

const twoRooms = {
  daemonReachable: true,
  buddies: [],
  rooms: [
    { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
    { room: 'ops', memberCount: 1, unread: 0, mentions: 0 },
  ],
  messages: [],
  members: [],
};

const kaiRemyDms = {
  daemonReachable: true,
  buddies: [],
  rooms: [
    {
      room: 'dm-e41f7a3c68bd',
      memberCount: 2,
      unread: 0,
      mentions: 0,
      kind: 'dm' as const,
      participants: { a: 'kai', b: 'remy', aName: 'kai', bName: 'remy' },
    },
    {
      room: 'dm-2c9b7e41d0a5',
      memberCount: 2,
      unread: 0,
      mentions: 0,
      kind: 'dm' as const,
      participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
    },
    {
      room: 'dm-jay-max',
      memberCount: 2,
      unread: 0,
      mentions: 0,
      kind: 'dm' as const,
      participants: { a: 'jay', b: 'max', aName: 'jay', bName: 'max' },
    },
  ],
  messages: [],
  members: [],
};

const avatarCount = (el: HTMLElement) => el.querySelectorAll('img').length;

test('an open DM whose pair repeats in the sidebar shows avatars in the page bar', () => {
  window.history.replaceState(null, '', '/r/dm-2c9b7e41d0a5');
  renderWithProviders(<App initialState={kaiRemyDms} />);
  const bar = screen.getByTestId('page-bar');
  expect(bar).toHaveTextContent('kai, remy');
  expect(bar).not.toHaveTextContent('m2p4');
  expect(avatarCount(screen.getByTestId('page-bar-title'))).toBe(2);
});

test('an open DM title carries both avatars, unique pair or not', () => {
  window.history.replaceState(null, '', '/r/dm-jay-max');
  renderWithProviders(<App initialState={kaiRemyDms} />);
  const title = screen.getByTestId('page-bar-title');
  expect(title).toHaveTextContent(/^jay, max$/);
  expect(avatarCount(title)).toBe(2);
});

test('a malformed room escape renders not-found instead of throwing', () => {
  renderAt('/r/%E0%A4%A');
  expect(screen.getByText('Nothing lives at this address.')).toBeTruthy();
});

test('/r/<room> opens that room instead of the first one', () => {
  window.history.replaceState(null, '', '/r/ops');
  renderWithProviders(<App initialState={twoRooms} />);
  expect(
    within(screen.getByTestId('page-bar')).getByText('ops')
  ).toBeInTheDocument();
});

test('picking a room in the rail moves the URL to /r/<room>', () => {
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(<App initialState={twoRooms} />);
  fireEvent.click(screen.getByTestId('room-row-ops'));
  expect(window.location.pathname).toBe('/r/ops');
  expect(
    within(screen.getByTestId('page-bar')).getByText('ops')
  ).toBeInTheDocument();
});

test('a #m-<id> anchor scrolls that message into view', () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push((this as Element).id);
  };
  try {
    window.history.replaceState(null, '', '/r/build#m-7');
    renderWithProviders(
      <App
        initialState={{
          ...twoRooms,
          messages: [
            {
              id: 7,
              room: 'build',
              handle: 'deck-main',
              name: 'deck-main',
              body: 'anchored',
              mentions: [],
              mentionNames: [],
              postedAt: 1,
            },
          ],
        }}
      />
    );
    expect(scrolled).toContain('m-7');
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test('a same-room hash change scrolls to the new anchor', () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push((this as Element).id);
  };
  try {
    window.history.replaceState(null, '', '/r/build#m-7');
    renderWithProviders(
      <App
        initialState={{
          ...twoRooms,
          messages: [
            {
              id: 7,
              room: 'build',
              handle: 'deck-main',
              name: 'deck-main',
              body: 'one',
              mentions: [],
              mentionNames: [],
              postedAt: 1,
            },
            {
              id: 8,
              room: 'build',
              handle: 'deck-main',
              name: 'deck-main',
              body: 'two',
              mentions: [],
              mentionNames: [],
              postedAt: 2,
            },
          ],
        }}
      />
    );
    expect(scrolled).toEqual(['m-7']);
    act(() => {
      window.history.replaceState(null, '', '/r/build#m-8');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(scrolled).toEqual(['m-7', 'm-8']);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test('the room list lives in the PageShell sidebar and the transcript in its content', () => {
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(<App initialState={twoRooms} />);
  const sidebar = document.getElementById('page-shell-sidebar');
  expect(sidebar).not.toBeNull();
  expect(
    within(sidebar as HTMLElement).getByTestId('room-rail')
  ).toBeInTheDocument();
  const content = document.getElementById('page-shell-content');
  expect(content).not.toBeNull();
  expect(
    within(content as HTMLElement).getByTestId('transcript')
  ).toBeInTheDocument();
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
});

test('with every room closed, a room link still mounts the rail and says rooms come back', () => {
  window.history.replaceState(null, '', '/r/gone');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          {
            room: 'build',
            memberCount: 1,
            unread: 0,
            mentions: 0,
            archivedAt: Date.now(),
          },
        ],
        messages: [],
        members: [],
      }}
    />
  );
  expect(screen.getByTestId('room-rail')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Every room is closed. A post from anyone brings its room back.'
    )
  ).toBeInTheDocument();
});

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

test('DM on a sender’s card opens the pair’s room and focuses the composer there', async () => {
  installFetchMock();
  const now = Date.now();
  const dmRoom = {
    room: 'dm-1a2b3c4d5e6f',
    memberCount: 2,
    unread: 0,
    mentions: 0,
    kind: 'dm' as const,
    participants: { a: 'fred', b: 'matt' },
  };
  const build = { room: 'build', memberCount: 2, unread: 0, mentions: 0 };
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/dm/open')
      return Promise.resolve(
        jsonResponse({ room: dmRoom.room, created: true })
      );
    if (url === '/api/chat/rooms')
      return Promise.resolve(jsonResponse({ rooms: [build, dmRoom] }));
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [
          {
            sessionId: 's',
            handle: 'fred',
            baseHandle: 'fred',
            name: 'fred',
            signedInAt: now,
            lastSeenAt: now,
            status: 'live',
            rooms: ['build'],
          },
        ],
        rooms: [build],
        members: [
          {
            room: 'build',
            handle: 'fred',
            name: 'fred',
            joinedAt: now,
            lastReadId: 0,
            wakeOn: 'mention',
            status: 'live',
          },
        ],
        messages: [
          {
            id: 7,
            room: 'build',
            handle: 'fred',
            name: 'fred',
            body: 'hello',
            mentions: [],
            mentionNames: [],
            postedAt: now,
          },
        ],
      }}
    />
  );
  const transcript = await screen.findByTestId('transcript');
  await userEvent.click(within(transcript).getByText('fred'));
  await userEvent.click(await screen.findByTestId('card-dm-fred'));

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/dm/open',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ to: 'fred' }),
    })
  );
  await screen.findByTestId(`dm-row-${dmRoom.room}`);
  expect(window.location.pathname).toBe(`/r/${dmRoom.room}`);
  // `focus()` defers through requestAnimationFrame.
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
  );
  expect(screen.queryByText(/direct message to/)).toBeNull();
});

test('Focus pane on a buddy in a herdr pane posts to that pane’s focus route', async () => {
  installFetchMock();
  const now = Date.now();
  const build = { room: 'build', memberCount: 2, unread: 0, mentions: 0 };
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/panes/w1:p1/focus')
      return Promise.resolve(jsonResponse({ paneId: 'w1:p1', focused: true }));
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [
          {
            sessionId: 's',
            handle: 'fred',
            baseHandle: 'fred',
            name: 'fred',
            signedInAt: now,
            lastSeenAt: now,
            status: 'live',
            rooms: ['build'],
            pane: 'w1:p1',
          },
        ],
        rooms: [build],
        members: [
          {
            room: 'build',
            handle: 'fred',
            name: 'fred',
            joinedAt: now,
            lastReadId: 0,
            wakeOn: 'mention',
            status: 'live',
          },
        ],
        messages: [
          {
            id: 7,
            room: 'build',
            handle: 'fred',
            name: 'fred',
            body: 'hello',
            mentions: [],
            mentionNames: [],
            postedAt: now,
          },
        ],
      }}
    />
  );
  const transcript = await screen.findByTestId('transcript');
  await userEvent.click(within(transcript).getByText('fred'));
  await userEvent.click(await screen.findByTestId('card-focus-fred'));

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/panes/w1:p1/focus',
    expect.objectContaining({ method: 'POST' })
  );
});

test('a buddy with no herdr pane shows no Focus pane button', async () => {
  installFetchMock();
  const now = Date.now();
  const build = { room: 'build', memberCount: 2, unread: 0, mentions: 0 };
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [
          {
            sessionId: 's',
            handle: 'fred',
            baseHandle: 'fred',
            name: 'fred',
            signedInAt: now,
            lastSeenAt: now,
            status: 'live',
            rooms: ['build'],
          },
        ],
        rooms: [build],
        members: [
          {
            room: 'build',
            handle: 'fred',
            name: 'fred',
            joinedAt: now,
            lastReadId: 0,
            wakeOn: 'mention',
            status: 'live',
          },
        ],
        messages: [
          {
            id: 7,
            room: 'build',
            handle: 'fred',
            name: 'fred',
            body: 'hello',
            mentions: [],
            mentionNames: [],
            postedAt: now,
          },
        ],
      }}
    />
  );
  const transcript = await screen.findByTestId('transcript');
  await userEvent.click(within(transcript).getByText('fred'));
  await screen.findByTestId('card-dm-fred');
  expect(screen.queryByTestId('card-focus-fred')).toBeNull();
});

async function closeFromMenu(room: string) {
  fireEvent.contextMenu(screen.getByTestId(`room-row-${room}`));
  const menu = await screen.findByTestId(`room-context-${room}`);
  await userEvent.click(within(menu).getByTestId('room-context-close'));
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: 'nope' }),
  } as Response;
}

test('a closed room reached by link opens with a live composer and is listed only while open', async () => {
  installFetchMock();
  window.history.replaceState(null, '', '/r/retro');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          {
            room: 'retro',
            memberCount: 1,
            unread: 0,
            mentions: 0,
            archivedAt: Date.now() - 3 * 86_400_000,
          },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  expect(screen.getByTestId('composer')).toBeInTheDocument();
  expect(screen.getByTestId('room-row-retro').dataset.active).toBe('true');
  expect(screen.queryByText(/archiv/i)).toBeNull();
  await userEvent.click(screen.getByTestId('room-row-build'));
  await waitFor(() => expect(window.location.pathname).toBe('/r/build'));
  expect(screen.queryByTestId('room-row-retro')).toBeNull();
});

test('closing another room from its menu drops the row at once and keeps the page', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close')
      return Promise.resolve(jsonResponse({ room: 'ghost', closedAt: 5 }));
    if (url === '/api/chat/rooms')
      return Promise.resolve(
        jsonResponse({
          rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
        })
      );
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          { room: 'ghost', memberCount: 1, unread: 2, mentions: 0 },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  await closeFromMenu('ghost');
  expect(screen.queryByTestId('room-row-ghost')).toBeNull();
  expect(window.location.pathname).toBe('/r/build');
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
});

test('a failed close restores the row and says so', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close') return Promise.resolve(errorResponse(502));
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          { room: 'ghost', memberCount: 1, unread: 0, mentions: 0 },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  await closeFromMenu('ghost');
  expect(
    await screen.findByText("Couldn't close the room: nope")
  ).toBeInTheDocument();
  expect(screen.getByTestId('room-row-ghost')).toBeInTheDocument();
});

test('the row leaves the rail before the close resolves, and comes back when it fails', async () => {
  installFetchMock();
  let rejectClose!: (e: Error) => void;
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close')
      return new Promise<Response>((_, reject) => {
        rejectClose = reject;
      });
    // Both rooms, always: if the row's absence were explained by a refetch
    // landing rather than the optimistic filter, this response would put
    // `ghost` right back before the assertion below runs.
    if (url === '/api/chat/rooms')
      return Promise.resolve(
        jsonResponse({
          rooms: [
            { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
            { room: 'ghost', memberCount: 1, unread: 0, mentions: 0 },
          ],
        })
      );
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          { room: 'ghost', memberCount: 1, unread: 0, mentions: 0 },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  await closeFromMenu('ghost');

  // The close request is still pending (rejectClose hasn't been called yet):
  // the row is gone and the page hasn't moved, so only the optimistic
  // removal -- not a response -- explains it.
  expect(screen.queryByTestId('room-row-ghost')).toBeNull();
  expect(window.location.pathname).toBe('/r/build');

  await act(async () => {
    rejectClose(new Error('boom'));
  });

  expect(
    await screen.findByText("Couldn't close the room: boom")
  ).toBeInTheDocument();
  expect(screen.getByTestId('room-row-ghost')).toBeInTheDocument();
});

test("a chat/<room>/msg frame refetches the open room's members", async () => {
  installFetchMock();
  fetchMock.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          String(url).startsWith('/api/chat/who/')
            ? {
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
              }
            : {}
        )
      )
  );
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(<App initialState={{ ...twoRooms, members: [] }} />);
  });
  const before = fetchMock.mock.calls.filter(([u]) =>
    String(u).startsWith('/api/chat/who/build')
  ).length;
  await act(async () => {
    for (const socket of FakeWebSocket.instances)
      socket.onmessage?.({
        data: JSON.stringify({ topic: 'chat/build/msg', payload: { id: 7 } }),
      });
  });
  const after = fetchMock.mock.calls.filter(([u]) =>
    String(u).startsWith('/api/chat/who/build')
  ).length;
  expect(after).toBeGreaterThan(before);
});

test('opening a room asks for one page of messages, never the whole history', async () => {
  installFetchMock();
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(
      <App
        initialState={{
          daemonReachable: true,
          rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
        }}
      />
    );
  });
  const urls = fetchMock.mock.calls
    .map(([u]) => String(u))
    .filter(u => u.startsWith('/api/chat/messages/build'));
  expect(urls).toContain(`/api/chat/messages/build?limit=${PAGE_SIZE}`);
});

test('a msg frame for a room the rail does not know refetches rooms at once', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      jsonResponse(
        url === '/api/chat/rooms'
          ? {
              rooms: [
                { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
                { room: 'fresh', memberCount: 1, unread: 1, mentions: 0 },
              ],
            }
          : {}
      )
    )
  );
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(
      <App
        initialState={{
          daemonReachable: true,
          buddies: [],
          rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
          members: [],
          messages: [],
        }}
      />
    );
  });
  const before = fetchMock.mock.calls.filter(
    ([u]) => u === '/api/chat/rooms'
  ).length;
  await act(async () => {
    for (const socket of FakeWebSocket.instances)
      socket.onmessage?.({
        data: JSON.stringify({ topic: 'chat/fresh/msg', payload: { id: 9 } }),
      });
  });
  expect(
    fetchMock.mock.calls.filter(([u]) => u === '/api/chat/rooms').length
  ).toBe(before + 1);
  expect(await screen.findByTestId('room-row-fresh')).toBeInTheDocument();
  await act(async () => {
    for (const socket of FakeWebSocket.instances)
      socket.onmessage?.({
        data: JSON.stringify({ topic: 'chat/build/msg', payload: { id: 10 } }),
      });
  });
  expect(
    fetchMock.mock.calls.filter(([u]) => u === '/api/chat/rooms').length
  ).toBe(before + 1);
});

test('a reconnect and a tab becoming visible refetch rooms, buddies and members, in that order', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      jsonResponse(
        url === '/api/chat/rooms'
          ? {
              rooms: [
                { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
              ],
            }
          : { buddies: [], members: [] }
      )
    )
  );
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(<App initialState={{ ...twoRooms, members: [] }} />);
  });
  const socket = FakeWebSocket.instances[0]!;
  await act(async () => {
    socket.onopen?.();
  });
  fetchMock.mockClear();
  await act(async () => {
    socket.onclose?.();
  });
  const again = FakeWebSocket.instances.at(-1)!;
  await act(async () => {
    again.onopen?.();
  });
  await waitFor(() => {
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.indexOf('/api/chat/rooms')).toBeGreaterThanOrEqual(0);
    expect(urls.indexOf('/api/chat/buddies')).toBeGreaterThan(
      urls.indexOf('/api/chat/rooms')
    );
    expect(
      urls.findIndex(u => u.startsWith('/api/chat/who/build'))
    ).toBeGreaterThan(urls.indexOf('/api/chat/buddies'));
  });

  fetchMock.mockClear();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/chat/rooms')).toBe(
      true
    )
  );
});

test('the Slack label follows the daemon: shown while the chat is open, gone after it closes, absent on a failed status', async () => {
  installFetchMock();
  let conversations: { room: string }[] = [{ room: 'build' }];
  let failing = false;
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) !== '/api/chat/slack-status')
      return new Response(JSON.stringify({}));
    if (failing) return new Response('{}', { status: 502 });
    return new Response(JSON.stringify({ conversations }));
  });
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(<App initialState={twoRooms} />);
  });
  const frame = async () => {
    await act(async () => {
      for (const socket of FakeWebSocket.instances)
        socket.onmessage?.({
          data: JSON.stringify({ topic: 'chat/build/msg', payload: { id: 9 } }),
        });
    });
  };
  expect(await screen.findByText('Only Claude sees this')).toBeInTheDocument();

  conversations = [];
  await frame();
  await waitFor(() =>
    expect(screen.queryByText('Only Claude sees this')).toBeNull()
  );

  conversations = [{ room: 'build' }];
  await frame();
  expect(await screen.findByText('Only Claude sees this')).toBeInTheDocument();

  failing = true;
  await frame();
  await waitFor(() =>
    expect(screen.queryByText('Only Claude sees this')).toBeNull()
  );
  expect(screen.getByRole('textbox')).toBeEnabled();
});

const landingRooms = {
  ...twoRooms,
  rooms: [
    { room: 'build', memberCount: 1, unread: 0, mentions: 0, lastPostedAt: 20 },
    { room: 'ops', memberCount: 1, unread: 0, mentions: 0, lastPostedAt: 10 },
  ],
};

test('/ hands over to the room with the newest post, replacing itself in history', async () => {
  window.history.replaceState(null, '', '/');
  const before = window.history.length;
  renderWithProviders(<App initialState={landingRooms} />);
  await waitFor(() => expect(window.location.pathname).toBe('/r/build'));
  expect(window.history.length).toBe(before);
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
});

test('going back to / hands over to the latest room again', async () => {
  window.history.replaceState(null, '', '/r/ops');
  renderWithProviders(<App initialState={landingRooms} />);
  expect(
    within(screen.getByTestId('page-bar')).getByText('ops')
  ).toBeInTheDocument();
  act(() => {
    window.history.replaceState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await waitFor(() => expect(window.location.pathname).toBe('/r/build'));
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
});

test('/ passes over a closed room, however new, and a closed room is not listed', async () => {
  window.history.replaceState(null, '', '/');
  renderWithProviders(
    <App
      initialState={{
        ...twoRooms,
        rooms: [
          {
            room: 'closed-first',
            memberCount: 1,
            unread: 0,
            mentions: 0,
            lastPostedAt: 99,
            archivedAt: Date.now() - 3 * 86_400_000,
          },
          {
            room: 'build',
            memberCount: 1,
            unread: 0,
            mentions: 0,
            lastPostedAt: 1,
          },
        ],
      }}
    />
  );
  await waitFor(() => expect(window.location.pathname).toBe('/r/build'));
  expect(screen.queryByTestId('room-row-closed-first')).toBeNull();
});

test('/ stays put with nothing open, and says why', () => {
  window.history.replaceState(null, '', '/');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [],
        messages: [],
        members: [],
      }}
    />
  );
  expect(window.location.pathname).toBe('/');
  expect(
    screen.getByText('No agent has signed in. A room appears when one does.')
  ).toBeInTheDocument();
  expect(screen.queryByTestId('room-rail')).toBeNull();
});

test('agents signed in with no room yet get the sidebar and their own note', () => {
  window.history.replaceState(null, '', '/');
  const now = Date.now();
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [
          {
            sessionId: 's',
            handle: 'fred',
            baseHandle: 'fred',
            name: 'fred',
            signedInAt: now,
            lastSeenAt: now,
            status: 'live',
            rooms: [],
          },
        ],
        rooms: [],
        messages: [],
        members: [],
      }}
    />
  );
  expect(
    screen.getByText('Agents are signed in but not in a room yet.')
  ).toBeInTheDocument();
  expect(screen.getByTestId('room-rail')).toBeInTheDocument();
});

test('closing the open room hands over to the latest room left', async () => {
  installFetchMock();
  const build = {
    room: 'build',
    memberCount: 1,
    unread: 0,
    mentions: 0,
    lastPostedAt: 5,
  };
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close')
      return Promise.resolve(jsonResponse({ room: 'ghost', closedAt: 5 }));
    if (url === '/api/chat/rooms')
      return Promise.resolve(jsonResponse({ rooms: [build] }));
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/ghost');
  renderWithProviders(
    <App
      initialState={{
        ...twoRooms,
        rooms: [
          { room: 'ghost', memberCount: 1, unread: 0, mentions: 0 },
          build,
        ],
      }}
    />
  );
  await closeFromMenu('ghost');
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/close',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ room: 'ghost' }),
    })
  );
  await waitFor(() => expect(window.location.pathname).toBe('/r/build'));
  expect(screen.queryByTestId('room-row-ghost')).toBeNull();
});

test('stand-in skeletons show until the rooms answer', async () => {
  installFetchMock();
  let answerRooms!: (res: Response) => void;
  fetchMock.mockImplementation((url: string) =>
    url === '/api/chat/rooms'
      ? new Promise<Response>(resolve => {
          answerRooms = resolve;
        })
      : Promise.resolve(jsonResponse({}))
  );
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(<App />);
  expect(screen.getByTestId('rail-skeleton')).toBeInTheDocument();
  expect(screen.getByTestId('title-skeleton')).toBeInTheDocument();
  expect(screen.queryByTestId('page-bar')).toBeNull();
  await act(async () => {
    answerRooms(jsonResponse({ rooms: twoRooms.rooms }));
  });
  expect(screen.queryByTestId('rail-skeleton')).toBeNull();
  expect(await screen.findByTestId('page-bar')).toBeInTheDocument();
});

test('the embed route is one room alone: compact, with no chrome and no sidebar', async () => {
  installFetchMock();
  window.history.replaceState(null, '', '/embed/r/build');
  renderWithProviders(<App initialState={twoRooms} />);
  expect(screen.getByTestId('transcript-column')).toHaveAttribute(
    'data-compact',
    'true'
  );
  expect(screen.getByTestId('composer')).toBeInTheDocument();
  expect(screen.queryByRole('banner')).toBeNull();
  expect(screen.queryByTestId('room-rail')).toBeNull();
  expect(screen.queryByTestId('page-bar')).toBeNull();
});

test('a phone keeps the sidebar out of the way: no resizer, and the phone composer', () => {
  setViewportWidth(390);
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(<App initialState={twoRooms} />);
  expect(screen.queryByTestId('sidebar-resizer')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveStyle({
    maxHeight: '25vh',
  });
});

test('a desktop gets the sidebar resizer', () => {
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(<App initialState={twoRooms} />);
  expect(screen.getByTestId('sidebar-resizer')).toBeInTheDocument();
});

function mentioningMessage(handle: string) {
  return {
    id: 7,
    room: 'build',
    handle,
    name: 'stale name',
    body: `@${handle} hello`,
    mentions: [handle],
    mentionNames: [handle],
    postedAt: 1,
  };
}

function serveMe(me: () => Promise<Response>) {
  installFetchMock();
  fetchMock.mockImplementation((url: string) =>
    url === '/api/chat/me' ? me() : Promise.resolve(jsonResponse({}))
  );
  window.history.replaceState(null, '', '/r/build');
}

test('useMe: the server names the viewer, keying mentions on the handle and showing the name', async () => {
  serveMe(() =>
    Promise.resolve(jsonResponse({ handle: 'alex', name: 'Alex Rivera' }))
  );
  renderWithProviders(
    <App
      initialState={{ ...twoRooms, messages: [mentioningMessage('alex')] }}
    />
  );
  const row = await screen.findByTestId('message-7');
  await waitFor(() => expect(row).toHaveTextContent('Alex Rivera'));
  expect(row.querySelector('[data-mention]')).toHaveAttribute(
    'data-me',
    'true'
  );
});

test('useMe: before the server answers, the viewer is the default handle', () => {
  serveMe(() => new Promise<Response>(() => {}));
  renderWithProviders(
    <App
      initialState={{ ...twoRooms, messages: [mentioningMessage('matt')] }}
    />
  );
  expect(
    screen.getByTestId('message-7').querySelector('[data-mention]')
  ).toHaveAttribute('data-me', 'true');
});

test('useMe: a refused or failed answer keeps the default', async () => {
  serveMe(() => Promise.resolve(errorResponse(500)));
  const { unmount } = renderWithProviders(
    <App
      initialState={{ ...twoRooms, messages: [mentioningMessage('matt')] }}
    />
  );
  await act(async () => {});
  expect(
    screen.getByTestId('message-7').querySelector('[data-mention]')
  ).toHaveAttribute('data-me', 'true');
  unmount();

  serveMe(() => Promise.reject(new Error('network down')));
  renderWithProviders(
    <App
      initialState={{ ...twoRooms, messages: [mentioningMessage('matt')] }}
    />
  );
  await act(async () => {});
  expect(
    screen.getByTestId('message-7').querySelector('[data-mention]')
  ).toHaveAttribute('data-me', 'true');
});
