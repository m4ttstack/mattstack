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
  /** What the daemon's resume takes. */
  id?: number;
  room: string;
  /** The teammate's chat handle. */
  handle?: string;
  /** Set once rt holds the teammate's Slack picture. */
  avatarId?: string;
  avatarVersion?: string;
  /** The pane's agent: the one person who reads what Matt types here. */
  agentName?: string;
  /** The teammate's chat name, as the room's pair reads it. */
  name?: string;
  openedAt?: number;
  /** Set once the chat has ended. */
  closedAt?: number;
}

interface SlackChatsValue {
  byRoom: ReadonlyMap<string, SlackChat>;
  avatars: ReadonlyMap<string, string>;
  /** Reads the daemon's chats again, after an action that changes them. */
  refresh: () => void;
}

const SlackChatsContext = createContext<SlackChatsValue>({
  byRoom: new Map(),
  avatars: new Map(),
  refresh: () => {},
});

/** Rooms that hold a Slack support chat, open or closed. */
export function SlackChatsProvider({
  chats,
  own,
  refresh,
  children,
}: {
  chats: readonly SlackChat[];
  refresh?: () => void;
  /** The viewer's own picture: they have no Slack chat to carry one. */
  own?: { handle: string; url: string };
  children: ReactNode;
}) {
  const ownHandle = own?.handle;
  const ownUrl = own?.url;
  const value = useMemo(
    () => ({
      byRoom: new Map(chats.map(c => [c.room, c])),
      avatars: new Map([
        ...chats.flatMap(c =>
          c.handle && c.avatarId
            ? [
                [
                  c.handle,
                  `/api/chat/slack-avatar/${c.avatarId}?v=${c.avatarVersion ?? ''}`,
                ] as const,
              ]
            : []
        ),
        ...(ownHandle && ownUrl ? [[ownHandle, ownUrl] as const] : []),
      ]),
      refresh: refresh ?? (() => {}),
    }),
    [chats, ownHandle, ownUrl, refresh]
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

export function useRefreshSlackChats(): () => void {
  return useContext(SlackChatsContext).refresh;
}

/** Whether a room holds a Slack chat that hasn't ended. */
export function useLiveSlackRoom(): (room: string) => boolean {
  const { byRoom } = useContext(SlackChatsContext);
  return room => {
    const chat = byRoom.get(room);
    return chat !== undefined && chat.closedAt === undefined;
  };
}

/** An open Slack chat whose room has no message yet: the agent is still
    starting and has not said hello. */
export function isOpening(
  chat: SlackChat | undefined,
  room: { lastPostedAt?: number } | undefined
): boolean {
  return (
    chat !== undefined &&
    chat.closedAt === undefined &&
    room !== undefined &&
    room.lastPostedAt === undefined
  );
}

/** Whether the support chat dialog is open, so its sidebar row can show as active. */
export const SupportChatOpenContext = createContext(false);

/** The support bot's name from the persona setting, read once. */
export function useSupportPersona(): string | undefined {
  const [persona, setPersona] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    fetch('/api/chat/slack-persona')
      .then(res => (res.ok ? res.json() : { persona: null }))
      .then((data: { persona: string | null }) => {
        if (!cancelled) setPersona(data.persona ?? undefined);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return persona;
}

/** The label for starting a support chat, named after the bot. */
export function supportChatLabel(persona: string | undefined): string {
  return persona ? `${persona} Support Chat` : 'Support Chat';
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
export function useSlackChats(): {
  chats: SlackChat[];
  refresh: () => void;
} {
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

  return { chats, refresh: refetch };
}
