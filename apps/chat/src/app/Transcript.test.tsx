import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { ChatMessage } from '@mattstack/rt-client';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import './icons';

import { BuddiesProvider } from './buddies-context';
import { SlackChatsProvider } from './slack-chats-context';
import {
  FakeWebSocket,
  fetchMock,
  installFakeWebSocket,
  installFetchMock,
  longCodeBlockMessage,
  renderTranscriptWithFakeSocket,
  restoreWebSocket,
} from './test-utils';
import { continuesGroup, PAGE_SIZE, Transcript } from './Transcript';

/** `count` messages with consecutive ids ending at `lastId`, all today. */
function page(count: number, lastId = count): ChatMessage[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const id = lastId - count + 1 + i;
    return {
      id,
      room: 'build',
      handle: 'fred',
      name: 'fred',
      body: `m${id}`,
      mentions: [],
      mentionNames: [],
      postedAt: now - (count - i) * 1000,
    };
  });
}

function olderRequests(): unknown[][] {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes('before=')
  );
}

beforeEach(() => {
  installFakeWebSocket();
});

afterEach(() => {
  restoreWebSocket();
});

test('a chat frame appends to the transcript without a refetch', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [],
  });
  pushFrame({ topic: 'chat/build/msg', payload: { id: 7 } });
  expect(await screen.findByTestId('message-7')).toBeInTheDocument();
});

test('a frame for another room does not append here', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [],
  });
  pushFrame({ topic: 'chat/other/msg', payload: { id: 8 } });
  expect(screen.queryByTestId('message-8')).toBeNull();
});

test('a reconnect refetches the tail without a frame', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [],
  });
  pushFrame({ topic: 'chat/build/msg', payload: { id: 1 } });
  expect(await screen.findByText('message 1')).toBeInTheDocument();
  const socket = FakeWebSocket.instances.at(-1)!;
  socket.onopen?.();
  const before = fetchMock.mock.calls.length;
  socket.onopen?.();
  await waitFor(() =>
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before)
  );
});

test('a fenced block renders as a CodeBlock inside the message, never widening the column', async () => {
  renderWithProviders(
    <Transcript room="build" messages={[longCodeBlockMessage]} />
  );
  const block = await screen.findByTestId('code-block');
  await waitFor(() => expect(block).toHaveTextContent('Cannot find module'));
  expect(screen.getByTestId('transcript-column')).toBeInTheDocument();
});

test('a mention of the human is marked as me', () => {
  renderWithProviders(
    <Transcript
      room="build"
      humanHandle="matt"
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'rt-chat-wt',
          name: 'rt-chat-wt',
          body: '@matt PR #67 is green, ok to merge?',
          mentions: ['matt'],
          mentionNames: ['matt'],
          postedAt: Date.now(),
        },
        {
          id: 2,
          room: 'build',
          handle: 'matt',
          name: 'matt',
          body: 'merge it',
          mentions: [],
          mentionNames: [],
          postedAt: Date.now(),
        },
      ]}
    />
  );
  const mention = screen.getByText('@matt');
  expect(mention).toHaveAttribute('data-mention', 'matt');
  expect(mention).toHaveAttribute('data-me', 'true');
});

test('markdown structure reaches the row: paragraphs, a list, code untouched', () => {
  renderWithProviders(
    <Transcript
      room="build"
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'deck-main',
          name: 'deck-main',
          body: 'first **point**\n\n- one\n- two\n\nsee `**not bold**`',
          mentions: [],
          mentionNames: [],
          postedAt: 1,
        },
      ]}
    />
  );
  const body = screen.getByTestId('message-body');
  expect(body.querySelectorAll('p')).toHaveLength(2);
  expect(body.querySelector('strong')).toHaveTextContent('point');
  expect(body.querySelectorAll('li')).toHaveLength(2);
  expect(screen.getByText('**not bold**').tagName).toBe('CODE');
});

test('the anchor scrolls once, and a later live merge does not repeat it', async () => {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push((this as Element).id);
  };
  try {
    const { pushFrame } = renderTranscriptWithFakeSocket({
      room: 'build',
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
      anchor: 'm-7',
    });
    expect(scrolled).toEqual(['m-7']);
    pushFrame({ topic: 'chat/build/msg', payload: { id: 8 } });
    expect(await screen.findByTestId('message-8')).toBeInTheDocument();
    expect(scrolled).toEqual(['m-7']);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test('an empty older page ends the edge at where the chat started', async () => {
  renderTranscriptWithFakeSocket({ room: 'build', messages: page(PAGE_SIZE) });
  const edge = screen.getByTestId('transcript-edge');
  expect(edge).toHaveTextContent('Load older messages');
  fireEvent.click(edge);
  expect(await screen.findByTestId('transcript-start')).toHaveTextContent(
    'This chat started today'
  );
  expect(screen.queryByTestId('transcript-edge')).toBeNull();
  expect(olderRequests()).toHaveLength(1);
});

test('an error page leaves the top edge retryable instead of exhausting it', async () => {
  renderTranscriptWithFakeSocket({ room: 'build', messages: page(PAGE_SIZE) });
  fetchMock.mockImplementationOnce(
    async () => new Response('{}', { status: 502 })
  );
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await waitFor(() => expect(olderRequests()).toHaveLength(1));
  await waitFor(() =>
    expect(screen.getByTestId('transcript-edge')).not.toHaveAttribute(
      'data-loading'
    )
  );
  expect(screen.getByTestId('transcript-edge')).not.toBeDisabled();
  expect(screen.queryByTestId('transcript-start')).toBeNull();
});

test("after an older page loads, the reader's row stays put while content above it settles", async () => {
  // Highlighters land after mount, so the content above the reader shrinks
  // after the first correction; every live ResizeObserver callback is
  // captured and fired by hand to stand in for that settling.
  const callbacks = new Set<ResizeObserverCallback>();
  class CapturingResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      callbacks.add(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      callbacks.delete(this.callback);
    }
  }
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver =
    CapturingResizeObserver as unknown as typeof ResizeObserver;
  try {
    renderTranscriptWithFakeSocket({
      room: 'build',
      messages: page(PAGE_SIZE, 60),
    });
    const view = viewOf(screen.getByTestId('transcript-scroll'));
    // The scroll library's own jump to the end lands a frame after mount
    // and would overwrite a stub set any earlier.
    await act(() => new Promise(resolve => setTimeout(resolve, 50)));
    Object.defineProperty(view, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 1000,
    });
    view.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    let rowTop = 40;
    const row = screen.getByTestId('message-31');
    row.getBoundingClientRect = () => ({ top: rowTop }) as DOMRect;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ messages: page(PAGE_SIZE, 30) }),
    } as Response);
    fireEvent.click(screen.getByTestId('transcript-edge'));
    await screen.findByTestId('message-1');
    expect(view.scrollTop).toBe(1000);

    rowTop = -260;
    act(() => {
      for (const callback of callbacks) callback([], {} as ResizeObserver);
    });
    expect(view.scrollTop).toBe(700);
  } finally {
    globalThis.ResizeObserver = originalResizeObserver;
  }
});

test('the older-messages control is a subtle Mantine button, so it reads as clickable', () => {
  renderTranscriptWithFakeSocket({ room: 'build', messages: page(PAGE_SIZE) });
  const edge = screen.getByTestId('transcript-edge');
  expect(edge.tagName).toBe('BUTTON');
  expect(edge).toHaveAttribute('data-variant', 'subtle');
  expect(edge).toHaveTextContent('Load older messages');
});

test('an older page shorter than the page size ends the edge without another round trip', async () => {
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: page(PAGE_SIZE, 40),
  });
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ messages: page(3, 10) }),
  } as Response);
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await screen.findByTestId('transcript-start');
  expect(screen.queryByTestId('transcript-edge')).toBeNull();
  expect(screen.getByTestId('message-8')).toBeInTheDocument();
  expect(olderRequests()).toHaveLength(1);
});

test('a first page shorter than the page size opens at where the chat started, with no edge', () => {
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: page(PAGE_SIZE - 1),
  });
  expect(screen.getByTestId('transcript-start')).toBeInTheDocument();
  expect(screen.queryByTestId('transcript-edge')).toBeNull();
});

test('the tail refetch and the older fetch each ask for one page', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: page(PAGE_SIZE, 60),
  });
  pushFrame({ topic: 'chat/build/msg', payload: { id: 61 } });
  await screen.findByTestId('message-61');
  const tail = fetchMock.mock.calls.find(
    ([url]) =>
      String(url).includes('/api/chat/messages/build') &&
      !String(url).includes('before=')
  );
  expect(String(tail?.[0])).toContain(`limit=${PAGE_SIZE}`);
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await waitFor(() => expect(olderRequests()).toHaveLength(1));
  expect(String(olderRequests()[0]![0])).toContain(`limit=${PAGE_SIZE}`);
});

/** Answers every messages request from one ordered history, paging older
    by `before` and `limit` the way the daemon does. */
function serveHistory(all: ChatMessage[]) {
  installFetchMock();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://chat.test');
    const before = url.searchParams.get('before');
    const limit = Number(url.searchParams.get('limit'));
    const messages = (
      before === null ? all : all.filter(m => m.id < Number(before))
    ).slice(-limit);
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages }),
    } as Response;
  });
}

function recordingScrollIntoView(run: (scrolled: string[]) => Promise<void>) {
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push((this as Element).id);
  };
  return run(scrolled).finally(() => {
    Element.prototype.scrollIntoView = original;
  });
}

test('a link to a message older than the first page pages back until it is in the list, then scrolls to it', () =>
  recordingScrollIntoView(async scrolled => {
    serveHistory(page(60, 60));
    renderWithProviders(
      <Transcript room="build" messages={page(PAGE_SIZE, 60)} anchor="m-5" />
    );
    await waitFor(() => expect(scrolled).toEqual(['m-5']));
    expect(screen.getByTestId('message-5')).toBeInTheDocument();
    expect(olderRequests()).toHaveLength(1);
  }));

test(
  'anchor paging gives up after ten pages without ever scrolling',
  () =>
    recordingScrollIntoView(async scrolled => {
      serveHistory(page(400, 400));
      renderWithProviders(
        <Transcript room="build" messages={page(PAGE_SIZE, 400)} anchor="m-1" />
      );
      // Ten pages is 330 rendered messages. CI runs this suite four-way
      // parallel on a 4 vCPU runner, where it took over fifteen seconds and
      // the wait gave up after nine pages.
      await waitFor(() => expect(olderRequests()).toHaveLength(10), {
        timeout: 45_000,
      });
      await act(async () => {});
      expect(olderRequests()).toHaveLength(10);
      expect(scrolled).toEqual([]);
      expect(screen.queryByTestId('message-1')).toBeNull();
    }),
  60_000
);

test('a link into the loaded range that names a missing message never pages', () =>
  recordingScrollIntoView(async scrolled => {
    serveHistory(page(60, 60));
    renderWithProviders(
      <Transcript
        room="build"
        messages={page(PAGE_SIZE, 60).filter(m => m.id !== 45)}
        anchor="m-45"
      />
    );
    await act(async () => {});
    expect(olderRequests()).toHaveLength(0);
    expect(scrolled).toEqual([]);
  }));

function withScrollableView(run: () => void) {
  const proto = HTMLElement.prototype;
  const originals = (['scrollHeight', 'clientHeight'] as const).map(
    name => [name, Object.getOwnPropertyDescriptor(proto, name)] as const
  );
  const isView = (el: unknown) =>
    typeof (el as HTMLElement).className === 'string' &&
    (el as HTMLElement).className.includes('view');
  Object.defineProperty(proto, 'scrollHeight', {
    configurable: true,
    get() {
      return isView(this) ? 1000 : 0;
    },
  });
  Object.defineProperty(proto, 'clientHeight', {
    configurable: true,
    get() {
      return isView(this) ? 300 : 0;
    },
  });
  try {
    run();
  } finally {
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(proto, name, original);
      else delete (proto as unknown as Record<string, unknown>)[name];
    }
  }
}

test('opening a room never pages on its own, even when the list is taller than the view', async () => {
  withScrollableView(() => {
    renderTranscriptWithFakeSocket({
      room: 'build',
      messages: page(PAGE_SIZE),
    });
  });
  await act(async () => {});
  expect(olderRequests()).toHaveLength(0);
  expect(screen.getByTestId('transcript-edge')).toHaveTextContent(
    'Load older messages'
  );
});

test('scrolling to the top never pages on its own; only the edge button does', async () => {
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: page(PAGE_SIZE, 60),
  });
  const view = viewOf(screen.getByTestId('transcript-scroll'));
  scrollTo(view, 500);
  scrollTo(view, 0);
  await act(async () => {});
  expect(olderRequests()).toHaveLength(0);
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await waitFor(() => expect(olderRequests()).toHaveLength(1));
  expect(String(olderRequests()[0]![0])).toContain('before=31');
});

test('two bare URLs in one body both render as links', () => {
  // remark-gfm autolinks bare URLs; both instances in one body must resolve,
  // not just the first, at the Transcript level (not just inside
  // MessageMarkdown's own suite).
  renderWithProviders(
    <Transcript
      room="build"
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'deck-main',
          name: 'deck-main',
          body: 'see http://x.test/a and http://y.test/b',
          mentions: [],
          mentionNames: [],
          postedAt: 1,
        },
      ]}
    />
  );
  expect(screen.getByRole('link', { name: 'http://x.test/a' })).toHaveAttribute(
    'href',
    'http://x.test/a'
  );
  expect(screen.getByRole('link', { name: 'http://y.test/b' })).toHaveAttribute(
    'href',
    'http://y.test/b'
  );
});

test('a day divider sits between messages on different days, never between same-day ones', () => {
  // Today at noon: `Transcript` labels against the real clock, so the
  // fixture must be anchored to the day the test runs, never a fixed date.
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  const now = noon.getTime();
  const msg = (id: number, postedAt: number) => ({
    id,
    room: 'build',
    handle: 'fred',
    name: 'fred',
    body: `m${id}`,
    mentions: [],
    mentionNames: [],
    postedAt,
  });
  renderWithProviders(
    <Transcript
      room="build"
      messages={[
        msg(1, now - 2 * 86_400_000),
        msg(2, now - 2 * 86_400_000 + 60_000),
        msg(3, now - 86_400_000),
        msg(4, now),
      ]}
    />
  );
  const dividers = screen.getAllByTestId('day-divider');
  expect(dividers.map(d => d.textContent)).toEqual(['Yesterday', 'Today']);
  expect(
    screen
      .getByTestId('message-4')
      .querySelector('[title]')
      ?.getAttribute('title')
  ).toBe(new Date(now).toLocaleString());
});

function viewOf(transcript: HTMLElement): HTMLElement {
  return transcript.querySelector<HTMLElement>('[class*="view"]')!;
}

function scrollTo(view: HTMLElement, top: number, height = 1000, client = 300) {
  Object.defineProperty(view, 'scrollHeight', {
    configurable: true,
    value: height,
  });
  Object.defineProperty(view, 'clientHeight', {
    configurable: true,
    value: client,
  });
  Object.defineProperty(view, 'scrollTop', {
    configurable: true,
    writable: true,
    value: top,
  });
  fireEvent.scroll(view);
}

test('the new pill counts live arrivals while scrolled up and goes away at the bottom', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [
      {
        id: 1,
        room: 'build',
        handle: 'fred',
        name: 'fred',
        body: 'first',
        mentions: [],
        mentionNames: [],
        postedAt: Date.now(),
      },
    ],
  });
  const view = viewOf(screen.getByTestId('transcript-scroll'));
  expect(screen.queryByTestId('new-pill')).toBeNull();

  scrollTo(view, 100);
  expect(screen.getByTestId('new-pill')).toHaveTextContent('Latest');

  pushFrame({ topic: 'chat/build/msg', payload: { id: 7 } });
  await screen.findByTestId('message-7');
  expect(screen.getByTestId('new-pill')).toHaveTextContent('1 new message');

  scrollTo(view, 700);
  expect(screen.queryByTestId('new-pill')).toBeNull();
});

test('a first row with older messages to load carries its day', () => {
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: page(PAGE_SIZE, 40),
  });
  expect(screen.getByTestId('day-divider')).toHaveTextContent('Today');
  expect(screen.queryByTestId('transcript-start')).toBeNull();
});

test('reaching the oldest message swaps its day for the start line, and a day divider marks the next day', async () => {
  const now = Date.now();
  renderTranscriptWithFakeSocket({
    room: 'build',
    messages: page(PAGE_SIZE, 40),
  });
  // Queued AFTER the render: `renderTranscriptWithFakeSocket` installs the
  // fetch mock, and the `before=` request is the next call it answers.
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      messages: [
        {
          id: 1,
          room: 'build',
          handle: 'fred',
          name: 'fred',
          body: 'old',
          mentions: [],
          mentionNames: [],
          postedAt: now - 3 * 86_400_000,
        },
      ],
    }),
  } as Response);
  fireEvent.click(screen.getByTestId('transcript-edge'));
  await screen.findByTestId('message-1');
  expect(screen.getByTestId('transcript-start')).toHaveTextContent(
    /^This chat started /
  );
  expect(screen.getAllByTestId('day-divider').map(d => d.textContent)).toEqual([
    'Today',
  ]);
});

function post(
  id: number,
  handle: string,
  postedAt: number,
  extra: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id,
    room: 'build',
    handle,
    name: handle,
    body: `m${id}`,
    mentions: [],
    mentionNames: [],
    postedAt,
    ...extra,
  };
}

const MINUTE = 60_000;
const NOON = new Date(2026, 5, 15, 12).getTime();

test('continuesGroup: the same speaker within the hour groups', () => {
  expect(
    continuesGroup(post(1, 'fred', NOON), post(2, 'fred', NOON + MINUTE))
  ).toBe(true);
  expect(
    continuesGroup(post(1, 'fred', NOON), post(2, 'fred', NOON + 60 * MINUTE))
  ).toBe(true);
});

test('continuesGroup: past the hour does not group', () => {
  expect(
    continuesGroup(
      post(1, 'fred', NOON),
      post(2, 'fred', NOON + 60 * MINUTE + 1)
    )
  ).toBe(false);
});

test('continuesGroup: another speaker does not group', () => {
  expect(
    continuesGroup(post(1, 'fred', NOON), post(2, 'max', NOON + MINUTE))
  ).toBe(false);
});

test('continuesGroup: two ids that share a name do not group', () => {
  expect(
    continuesGroup(
      post(1, 'remy', NOON, { name: 'remy' }),
      post(2, 'remy.m2p4', NOON + MINUTE, { name: 'remy' })
    )
  ).toBe(false);
});

test('continuesGroup: midnight breaks a group inside the hour', () => {
  const lateNight = new Date(2026, 5, 15, 23, 50).getTime();
  const nextDay = new Date(2026, 5, 16, 0, 10).getTime();
  expect(
    continuesGroup(post(1, 'fred', lateNight), post(2, 'fred', nextDay))
  ).toBe(false);
});

test('continuesGroup: the first message starts a group', () => {
  expect(continuesGroup(undefined, post(1, 'fred', NOON))).toBe(false);
});

test('a grouped message drops its face and name but keeps its body', () => {
  renderWithProviders(
    <Transcript
      room="build"
      messages={[
        post(1, 'fred', NOON),
        post(2, 'fred', NOON + MINUTE),
        post(3, 'max', NOON + 2 * MINUTE),
      ]}
    />
  );
  const first = screen.getByTestId('message-1');
  const grouped = screen.getByTestId('message-2');
  const next = screen.getByTestId('message-3');
  expect(first).not.toHaveAttribute('data-grouped');
  expect(first.querySelectorAll('img')).toHaveLength(1);
  expect(first).toHaveTextContent('fred');
  expect(grouped).toHaveAttribute('data-grouped', 'true');
  expect(grouped.querySelectorAll('img')).toHaveLength(0);
  expect(grouped).not.toHaveTextContent('fred');
  expect(grouped).toHaveTextContent('m2');
  expect(next).not.toHaveAttribute('data-grouped');
  expect(next).toHaveTextContent('max');
});

test('the compact embed groups the same way, with the face in the header', () => {
  renderWithProviders(
    <Transcript
      compact
      room="build"
      messages={[post(1, 'fred', NOON), post(2, 'fred', NOON + MINUTE)]}
    />
  );
  expect(screen.getByTestId('transcript-column')).toHaveAttribute(
    'data-compact',
    'true'
  );
  expect(screen.getByTestId('message-1').querySelectorAll('img')).toHaveLength(
    1
  );
  expect(screen.getByTestId('message-2')).toHaveAttribute(
    'data-grouped',
    'true'
  );
  expect(screen.getByTestId('message-2').querySelectorAll('img')).toHaveLength(
    0
  );
});

test('two identities that share a name read the same, and a mention keeps the id', () => {
  renderWithProviders(
    <BuddiesProvider
      buddies={[]}
      roomMembers={['remy', 'remy.m2p4', 'max']}
      now={0}
      reachable
    >
      <Transcript
        room="rt"
        messages={[
          post(1, 'remy', NOON, { name: 'remy' }),
          post(2, 'remy.m2p4', NOON + MINUTE, { name: 'remy' }),
          post(3, 'max', NOON + 2 * MINUTE, {
            body: '@remy welcome',
            mentions: ['remy.m2p4'],
            mentionNames: ['remy'],
          }),
        ]}
      />
    </BuddiesProvider>
  );
  expect(screen.getByTestId('message-1')).toHaveTextContent('remy');
  expect(screen.getByTestId('message-2')).toHaveTextContent('remy');
  expect(screen.getByTestId('message-2')).not.toHaveTextContent('m2p4');
  const mention = screen
    .getByTestId('message-3')
    .querySelector('[data-mention]')!;
  expect(mention).toHaveTextContent('@remy');
  expect(mention).toHaveAttribute('data-mention', 'remy.m2p4');
});

test('a Slack chat that ended says so at the foot of the transcript', () => {
  renderWithProviders(
    <SlackChatsProvider chats={[{ room: 'build', closedAt: NOON }]}>
      <Transcript room="build" messages={[post(1, 'fred', NOON)]} />
    </SlackChatsProvider>
  );
  expect(screen.getByTestId('slack-closed-note')).toHaveTextContent(
    'Chat closed'
  );
});

test('an open Slack chat and a plain room show no closed note', () => {
  renderWithProviders(
    <SlackChatsProvider chats={[{ room: 'build' }]}>
      <Transcript room="build" messages={[post(1, 'fred', NOON)]} />
    </SlackChatsProvider>
  );
  expect(screen.queryByTestId('slack-closed-note')).toBeNull();
});

test('stand-in rows hold the place of a first page, and only until messages land', () => {
  const { rerender } = renderWithProviders(
    <Transcript room="build" messages={[]} loading />
  );
  expect(screen.getByTestId('message-skeleton')).toBeInTheDocument();
  rerender(
    <Transcript room="build" messages={[post(1, 'fred', NOON)]} loading />
  );
  expect(screen.queryByTestId('message-skeleton')).toBeNull();
});

function feedMessages(): ChatMessage[] {
  return page(4).map((m, i) => ({
    ...m,
    room: i < 2 ? 'dm-a' : 'dm-b',
    handle: i === 1 ? 'matt' : m.handle,
  }));
}

const feed = (onPick = () => {}, picked?: string) => ({
  url: '/api/chat/direct',
  hears: (topic: string) => topic === 'chat/dm-a/msg',
  faces: ['fred', 'matt'],
  onPick,
  picked,
});

test('a feed draws one line where the conversation changes, and none within it', () => {
  renderWithProviders(
    <Transcript room="direct" feed={feed()} messages={feedMessages()} />
  );
  expect(screen.getAllByTestId('direct-separator')).toHaveLength(1);
  expect(
    screen.getByTestId('message-3').previousElementSibling
  ).toHaveAttribute('data-testid', 'direct-separator');
});

test('a click picks the message’s conversation and tints all of it', () => {
  const onPick = vi.fn();
  renderWithProviders(
    <Transcript
      room="direct"
      feed={feed(onPick, 'dm-a')}
      messages={feedMessages()}
    />
  );
  fireEvent.click(screen.getByText('m3'));
  expect(onPick).toHaveBeenCalledWith('dm-b');
  expect(screen.getByTestId('message-1')).toHaveAttribute('data-picked');
  expect(screen.getByTestId('message-2')).toHaveAttribute('data-picked');
  expect(screen.getByTestId('message-3')).not.toHaveAttribute('data-picked');
});

test('a feed pages older from its own url', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ messages: [] }),
  });
  renderWithProviders(
    <Transcript room="direct" feed={feed()} messages={page(PAGE_SIZE, 100)} />
  );
  fireEvent.click(await screen.findByTestId('transcript-edge'));
  await waitFor(() =>
    expect(String(olderRequests().at(-1)?.[0])).toMatch(
      /^\/api\/chat\/direct\?before=/
    )
  );
});

test('an empty feed says so once it has loaded', () => {
  renderWithProviders(
    <Transcript room="direct" feed={feed()} messages={[]} empty="Nothing yet" />
  );
  expect(screen.getByText('Nothing yet')).toBeInTheDocument();
});

test('a click in the space around the messages clears the pick', () => {
  const onPick = vi.fn();
  renderWithProviders(
    <Transcript
      room="direct"
      feed={feed(onPick, 'dm-a')}
      messages={feedMessages()}
    />
  );
  fireEvent.click(screen.getByTestId('direct-separator'));
  expect(onPick).toHaveBeenCalledWith(undefined);
});
