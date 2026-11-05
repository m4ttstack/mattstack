import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Center, Stack, Text } from '@mattstack/app-kit/core';
import type { ChatMessage, RoomSummary } from '@mattstack/rt-client';

import { isMine, newestSenderRoom, otherEnd } from './direct';
import { isMsgTopic } from './relay-socket';
import { PAGE_SIZE, Transcript, type TranscriptFeed } from './Transcript';

const FEED_URL = '/api/chat/direct';

function Empty() {
  return (
    <Center mih="40dvh">
      <Stack align="center" gap={4}>
        <Text fw={500} size="lg">
          No messages yet
        </Text>
        <Text size="md" c="dimmed">
          DMs from agents land here
        </Text>
      </Stack>
    </Center>
  );
}

/** Every DM the human is an end of, as one timeline. A reply goes to the
    newest agent to write until a message click picks another; `composer`
    draws the box for whichever DM that is. */
export function DirectView({
  rooms,
  me,
  picked,
  onPick,
  composer,
}: {
  rooms: RoomSummary[];
  me: string;
  picked: string | undefined;
  onPick: (room: string | undefined) => void;
  composer: (
    room: string,
    to: { handle: string; name: string } | undefined
  ) => ReactNode;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${FEED_URL}?limit=${PAGE_SIZE}`)
      .then(res => {
        if (!res.ok) throw new Error(`${res.url}: ${res.status}`);
        return res.json() as Promise<{ messages?: ChatMessage[] }>;
      })
      .then(data => {
        if (cancelled) return;
        setMessages(data.messages ?? []);
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const feed = useMemo<TranscriptFeed>(() => {
    const known = new Map(rooms.map(r => [r.room, r]));
    return {
      url: FEED_URL,
      faces: rooms.flatMap(r =>
        isMine(r, me) && r.participants
          ? [r.participants.a, r.participants.b]
          : []
      ),
      // A room this list has not met yet may be a first DM to the human.
      hears: topic => {
        if (!isMsgTopic(topic)) return false;
        const room = known.get(topic.slice('chat/'.length, -'/msg'.length));
        return room === undefined || isMine(room, me);
      },
      target: list => picked ?? newestSenderRoom(list, me),
      onPick,
    };
  }, [rooms, me, picked, onPick]);

  const footer = (list: ChatMessage[]) => {
    const target = feed.target(list);
    if (!target) return null;
    const summary = rooms.find(r => r.room === target);
    return composer(target, summary && otherEnd(summary, me));
  };

  return (
    <Transcript
      room="direct"
      feed={feed}
      messages={messages}
      loading={!loaded}
      humanHandle={me}
      empty={<Empty />}
      footer={footer}
    />
  );
}
