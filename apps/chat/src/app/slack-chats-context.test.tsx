import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import {
  SlackChatsProvider,
  useSlackAvatar,
  useSlackChat,
  useSlackChats,
  type SlackChat,
} from './slack-chats-context';

let openFrame: (() => void) | undefined;

vi.mock('./relay-socket', () => ({
  isMsgTopic: () => true,
  useRelayFrames: (handler: (frame: { topic: string }) => void) => {
    openFrame = () => handler({ topic: 'chat/r/msg' });
  },
  useRelayOpen: () => {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  openFrame = undefined;
});

function statusReply(names: string[]): Response {
  return new Response(
    JSON.stringify({ conversations: names.map(room => ({ room })) })
  );
}

const rooms = (chats: SlackChat[]) => chats.map(c => c.room);

function within(chats: SlackChat[]) {
  return ({ children }: { children: ReactNode }) => (
    <SlackChatsProvider chats={chats}>{children}</SlackChatsProvider>
  );
}

test('an older status request that finishes last cannot overwrite a newer one', async () => {
  const replies: ((res: Response) => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>(resolve => {
          replies.push(resolve);
        })
    )
  );
  const { result } = renderHook(() => useSlackChats());
  act(() => openFrame?.());
  expect(replies).toHaveLength(2);

  await act(async () => replies[1]?.(statusReply(['dm-new'])));
  await vi.waitFor(() => expect(rooms(result.current)).toEqual(['dm-new']));

  await act(async () => {
    replies[0]?.(statusReply(['dm-old']));
    await new Promise(resolve => setTimeout(resolve));
  });
  expect(rooms(result.current)).toEqual(['dm-new']);
});

test('the latest status request still applies', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => statusReply(['dm-one']))
  );
  const { result } = renderHook(() => useSlackChats());
  await vi.waitFor(() => expect(rooms(result.current)).toEqual(['dm-one']));
});

test('ended chats list alongside open ones, carrying when they closed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            conversations: [{ room: 'dm-open' }],
            closed: [{ room: 'dm-done', closedAt: 5 }],
          })
        )
    )
  );
  const { result } = renderHook(() => useSlackChats());
  await vi.waitFor(() =>
    expect(result.current).toEqual([
      { room: 'dm-done', closedAt: 5 },
      { room: 'dm-open' },
    ])
  );
});

test('a refused status read leaves no rooms rather than an error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 502 }))
  );
  const { result } = renderHook(() => useSlackChats());
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve));
  });
  expect(result.current).toEqual([]);
});

test('useSlackAvatar returns a URL carrying the picture version', () => {
  const wrapper = within([
    {
      room: 'dm-1',
      handle: 'slack.t1.u1',
      avatarId: 'u1',
      avatarVersion: 'v9',
    },
  ]);
  const { result } = renderHook(() => useSlackAvatar('slack.t1.u1'), {
    wrapper,
  });
  expect(result.current).toBe('/api/chat/slack-avatar/u1?v=v9');
});

test('a new picture version changes the URL', () => {
  const url = (avatarVersion: string) =>
    renderHook(() => useSlackAvatar('slack.t1.u1'), {
      wrapper: within([
        { room: 'dm-1', handle: 'slack.t1.u1', avatarId: 'u1', avatarVersion },
      ]),
    }).result.current;
  expect(url('one')).not.toBe(url('two'));
});

test('useSlackAvatar has nothing for a chat with no picture or no handle', () => {
  const wrapper = within([
    { room: 'dm-1', handle: 'slack.t1.u1' },
    { room: 'dm-2', avatarId: 'u2', avatarVersion: 'v1' },
  ]);
  const avatar = (handle: string) =>
    renderHook(() => useSlackAvatar(handle), { wrapper }).result.current;
  expect(avatar('slack.t1.u1')).toBeUndefined();
  expect(avatar('kai')).toBeUndefined();
});

test('useSlackChat finds a chat by its room', () => {
  const wrapper = within([{ room: 'dm-1', agentName: 'kai' }]);
  const chat = (room: string) =>
    renderHook(() => useSlackChat(room), { wrapper }).result.current;
  expect(chat('dm-1')?.agentName).toBe('kai');
  expect(chat('build')).toBeUndefined();
});
