import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useInterval } from 'react-interval-hook';

import { isMsgTopic, useRelayFrames, useRelayOpen } from './relay-socket';

const SlackChatsContext = createContext<ReadonlySet<string>>(new Set());

/** Rooms whose pane is holding a Slack support chat right now. */
export function SlackChatsProvider({
  rooms,
  children,
}: {
  rooms: readonly string[];
  children: ReactNode;
}) {
  const value = useMemo(() => new Set(rooms), [rooms]);
  return (
    <SlackChatsContext.Provider value={value}>
      {children}
    </SlackChatsContext.Provider>
  );
}

/** True while `room` is an open Slack support chat. */
export function useIsSlackChat(room: string): boolean {
  return useContext(SlackChatsContext).has(room);
}

/**
 * The rooms with an open Slack chat, from the daemon's `chat:slack-status`
 * via the server. Refreshes with the other room data: on mount, every 5s,
 * on any `chat/<room>/msg` frame (the farewell that closes a chat is one)
 * and on a relay reconnect. A failed read, as an older daemon without the
 * verb gives, leaves no rooms rather than an error.
 */
export function useSlackChatRooms(): string[] {
  const [rooms, setRooms] = useState<string[]>([]);
  const latestRequest = useRef(0);

  const refetch = useCallback(() => {
    const request = ++latestRequest.current;
    fetch('/api/chat/slack-status')
      .then(async res => {
        if (!res.ok) return [];
        const data = (await res.json()) as {
          conversations?: { room: string }[];
        };
        return (data.conversations ?? []).map(c => c.room);
      })
      .catch(() => [] as string[])
      .then(next => {
        if (request !== latestRequest.current) return;
        setRooms(prev =>
          prev.length === next.length && prev.every((r, i) => r === next[i])
            ? prev
            : next
        );
      });
  }, []);

  useEffect(refetch, [refetch]);
  useInterval(refetch, 5000);
  useRelayFrames(frame => {
    if (isMsgTopic(frame.topic)) refetch();
  });
  useRelayOpen(() => refetch());

  return rooms;
}
