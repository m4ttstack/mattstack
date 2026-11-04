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

export interface SlackChat {
  room: string;
  /** The teammate's chat handle. */
  handle?: string;
  /** Set once rt holds the teammate's Slack picture. */
  avatarId?: string;
  /** The pane's agent: the one person who reads what Matt types here. */
  agentName?: string;
  /** Set once the chat has ended. */
  closedAt?: number;
}

interface SlackChatsValue {
  byRoom: ReadonlyMap<string, SlackChat>;
  avatars: ReadonlyMap<string, string>;
}

const SlackChatsContext = createContext<SlackChatsValue>({
  byRoom: new Map(),
  avatars: new Map(),
});

/** Rooms that hold a Slack support chat, open or closed. */
export function SlackChatsProvider({
  chats,
  children,
}: {
  chats: readonly SlackChat[];
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      byRoom: new Map(chats.map(c => [c.room, c])),
      avatars: new Map(
        chats.flatMap(c =>
          c.handle && c.avatarId
            ? [[c.handle, `/api/chat/slack-avatar/${c.avatarId}`] as const]
            : []
        )
      ),
    }),
    [chats]
  );
  return (
    <SlackChatsContext.Provider value={value}>
      {children}
    </SlackChatsContext.Provider>
  );
}

export function useSlackChat(room: string): SlackChat | undefined {
  return useContext(SlackChatsContext).byRoom.get(room);
}

export function useSlackAvatar(handle: string): string | undefined {
  return useContext(SlackChatsContext).avatars.get(handle);
}

interface SlackStatus {
  conversations?: Omit<SlackChat, 'closedAt'>[];
  closed?: (SlackChat & { closedAt: number })[];
}

/**
 * The rooms with a Slack chat, from the daemon's `chat:slack-status` via the
 * server. Refreshes with the other room data: on mount, every 5s, on any
 * `chat/<room>/msg` frame (the farewell that closes a chat is one) and on a
 * relay reconnect. A failed read, as an older daemon without the verb gives,
 * leaves no rooms rather than an error.
 */
export function useSlackChats(): SlackChat[] {
  const [chats, setChats] = useState<SlackChat[]>([]);
  const latestRequest = useRef(0);

  const refetch = useCallback(() => {
    const request = ++latestRequest.current;
    fetch('/api/chat/slack-status')
      .then(async res => {
        if (!res.ok) return [];
        const data = (await res.json()) as SlackStatus;
        return [...(data.closed ?? []), ...(data.conversations ?? [])];
      })
      .catch(() => [] as SlackChat[])
      .then(next => {
        if (request !== latestRequest.current) return;
        setChats(prev =>
          JSON.stringify(prev) === JSON.stringify(next) ? prev : next
        );
      });
  }, []);

  useEffect(refetch, [refetch]);
  useInterval(refetch, 5000);
  useRelayFrames(frame => {
    if (isMsgTopic(frame.topic)) refetch();
  });
  useRelayOpen(() => refetch());

  return chats;
}
