import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { useSlackChatRooms } from './slack-chats-context';

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

function statusReply(rooms: string[]): Response {
  return new Response(
    JSON.stringify({ conversations: rooms.map(room => ({ room })) })
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
  const { result } = renderHook(() => useSlackChatRooms());
  act(() => openFrame?.());
  expect(replies).toHaveLength(2);

  await act(async () => replies[1]?.(statusReply(['dm-new'])));
  await vi.waitFor(() => expect(result.current).toEqual(['dm-new']));

  await act(async () => {
    replies[0]?.(statusReply(['dm-old']));
    await new Promise(resolve => setTimeout(resolve));
  });
  expect(result.current).toEqual(['dm-new']);
});

test('the latest status request still applies', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => statusReply(['dm-one']))
  );
  const { result } = renderHook(() => useSlackChatRooms());
  await vi.waitFor(() => expect(result.current).toEqual(['dm-one']));
});
