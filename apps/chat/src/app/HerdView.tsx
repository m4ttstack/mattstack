import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Center,
  Group,
  Menu,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { ChatMessage } from '@mattstack/rt-client';

import type { HerdTag } from '../server/herds';
import { HandleAvatar } from './AgentName';
import type { FleetRoom } from './FleetTree';
import { herdTitle } from './FleetTree';
import classes from './herd.module.css';
import { workerOf, type HerdGroup } from './herds';
import { isMsgTopic } from './relay-socket';
import { PAGE_SIZE, Transcript, type TranscriptFeed } from './Transcript';

/** The herd's title row, laid out as a room's `PageBar` is. */
export function HerdBar({
  group,
  onArchive,
}: {
  group: HerdGroup;
  onArchive?: () => void;
}) {
  const workers = group.tag.workers.length;
  return (
    <Group
      align="center"
      wrap="nowrap"
      gap="sm"
      data-testid="herd-bar"
      style={{ height: '100%', width: '100%', minWidth: 0, paddingInline: 8 }}
    >
      <Text
        component="span"
        fw={500}
        size="lg"
        truncate
        data-testid="herd-bar-title"
        style={{ minWidth: 0, color: 'var(--tk-text-1)' }}
      >
        {herdTitle(group.tag.shepherdName)}
      </Text>
      <Badge
        variant="light"
        color="gray"
        radius="sm"
        data-testid="herd-bar-workers"
      >
        {workers} {workers === 1 ? 'worker' : 'workers'}
      </Badge>
      {onArchive && (
        <Tooltip label="Archive herd">
          <ActionIcon
            variant="subtle"
            color="gray"
            size={28}
            aria-label="Archive herd"
            onClick={onArchive}
            style={{ marginLeft: 'auto', flex: 'none' }}
          >
            <Icon name="archive" size={16} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}

function Empty() {
  return (
    <Center mih="40dvh">
      <Text size="md" c="dimmed">
        Nothing posted in this herd yet
      </Text>
    </Center>
  );
}

/** A conversation pill: an optional round face, then its name. */
const Pill = forwardRef<
  HTMLButtonElement,
  {
    active?: boolean;
    face?: string;
    trailing?: ReactNode;
    className?: string;
    children: ReactNode;
  } & Omit<ComponentPropsWithoutRef<'button'>, 'children'>
>(function Pill(
  { active = false, face, trailing, className, children, ...rest },
  ref
) {
  return (
    <UnstyledButton
      ref={ref}
      className={`${classes.pill} ${className ?? ''}`}
      data-active={active || undefined}
      data-with-face={face ? true : undefined}
      {...rest}
    >
      {face && (
        <span className={classes.face}>
          <HandleAvatar handle={face} variant="inline" size={18} />
        </span>
      )}
      {children}
      {trailing}
    </UnstyledButton>
  );
});

/** A conversation to filter by. */
function FilterBadge({
  active,
  onClick,
  testId,
  face,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  face?: string;
  children: ReactNode;
}) {
  return (
    <Pill
      active={active}
      face={face}
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </Pill>
  );
}

/** One badge per conversation in the herd, and one to show them all. */
function HerdFilter({
  tag,
  rooms,
  filter,
  onFilter,
}: {
  tag: HerdTag;
  rooms: FleetRoom[];
  filter: string | undefined;
  onFilter: (room: string | undefined) => void;
}) {
  const own = rooms.find(r => r.kind !== 'dm');
  const dms = rooms.flatMap(room => {
    const worker = workerOf(room, tag);
    return worker ? [{ room: room.room, worker }] : [];
  });
  return (
    <div className={classes.filterBar} data-testid="herd-filter">
      <FilterBadge
        active={filter === undefined}
        onClick={() => onFilter(undefined)}
        testId="herd-filter-all"
      >
        All
      </FilterBadge>
      {own && (
        <FilterBadge
          active={filter === own.room}
          onClick={() => onFilter(own.room)}
          testId="herd-filter-room"
        >
          Herd room
        </FilterBadge>
      )}
      {dms.map(({ room, worker }) => (
        <FilterBadge
          key={room}
          active={filter === room}
          onClick={() => onFilter(room)}
          testId={`herd-filter-${worker.handle}`}
          face={worker.handle}
        >
          {worker.name}
        </FilterBadge>
      ))}
    </div>
  );
}

/** Where the composer's message goes: the herd room or one worker's DM,
    picked from a menu on the same badge the filter row uses. */
function HerdTo({
  tag,
  rooms,
  target,
  onPick,
}: {
  tag: HerdTag;
  rooms: FleetRoom[];
  target: string;
  onPick: (room: string) => void;
}) {
  const own = rooms.find(r => r.kind !== 'dm');
  const options = [
    ...(own ? [{ room: own.room, label: 'Herd room', face: undefined }] : []),
    ...rooms.flatMap(room => {
      const worker = workerOf(room, tag);
      return worker
        ? [{ room: room.room, label: worker.name, face: worker.handle }]
        : [];
    }),
  ];
  const current = options.find(o => o.room === target);
  return (
    <Menu position="top-start" offset={6} withinPortal shadow="md" radius="sm">
      <Menu.Target>
        <Pill
          className={classes.to}
          face={current?.face}
          data-testid="herd-to"
          aria-label={`To ${current?.label ?? 'Herd room'}`}
          trailing={
            <Icon name="chevronDown" size={12} className={classes.chevron} />
          }
        >
          {current?.label ?? 'Herd room'}
        </Pill>
      </Menu.Target>
      <Menu.Dropdown data-testid="herd-to-menu">
        {options.map(option => (
          <Menu.Item
            key={option.room}
            data-testid={`herd-to-${option.face ?? 'room'}`}
            leftSection={
              option.face ? (
                <HandleAvatar handle={option.face} variant="inline" size={16} />
              ) : (
                <Icon name="hash" size={14} />
              )
            }
            onClick={() => onPick(option.room)}
          >
            {option.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** A herd as one timeline: its shepherd's DMs with each worker and the
    herd's own room. A reply goes to the newest conversation until a filter
    or the composer's To picks another; `composer` draws the box for
    whichever that is. */
export function HerdView({
  tag,
  rooms,
  me,
  picked,
  onPick,
  composer,
}: {
  tag: HerdTag;
  rooms: FleetRoom[];
  me: string;
  picked: string | undefined;
  onPick: (room: string | undefined) => void;
  composer: (
    room: string,
    worker: { handle: string; name: string } | undefined,
    to: ReactNode,
    onDraftChange: (hasDraft: boolean) => void
  ) => ReactNode;
}) {
  const [filter, setFilter] = useState<string>();
  const base = `/api/chat/herd/${encodeURIComponent(tag.id)}`;
  const url = filter ? `${base}/${encodeURIComponent(filter)}` : base;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadedUrl, setLoadedUrl] = useState<string>();
  // A room joining the herd (a worker's first DM) pulls the tail again,
  // merged into what is loaded; the listing's polls leave it alone while
  // the set is unchanged.
  const roomSet = rooms
    .map(r => r.room)
    .sort()
    .join('|');

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    fetch(`${url}?limit=${PAGE_SIZE}`)
      .then(res => {
        if (!res.ok) throw new Error(`${res.url}: ${res.status}`);
        return res.json() as Promise<{ messages?: ChatMessage[] }>;
      })
      .then(data => {
        if (cancelled) return;
        setMessages(data.messages ?? []);
        setLoadedUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url]);

  // A draft belongs to who it was started for: a newer post must not
  // retarget it.
  const draftOpen = useRef(false);
  const heldForDraft = useRef(false);
  const pick = useRef(onPick);
  pick.current = onPick;

  const feed = useMemo<TranscriptFeed>(() => {
    const known = new Set(rooms.map(r => r.room));
    const byRoom = new Map(rooms.map(r => [r.room, r]));
    // A herd with nothing posted yet still has somewhere to write.
    const fallback = (rooms.find(r => r.kind !== 'dm') ?? rooms[0])?.room;
    return {
      url,
      tailKey: roomSet,
      faces: [tag.shepherdHandle, ...tag.workers.map(w => w.handle)],
      hears: topic => {
        if (!isMsgTopic(topic)) return false;
        const room = topic.slice('chat/'.length, -'/msg'.length);
        return filter ? room === filter : known.has(room);
      },
      target: list =>
        picked ??
        filter ??
        list.findLast(m => m.handle !== me)?.room ??
        list.at(-1)?.room ??
        fallback,
      onPick: room => {
        if (room === undefined && draftOpen.current) return;
        pick.current(room);
      },
      timeline: {
        to: message => {
          const worker = workerOf(byRoom.get(message.room), tag);
          return worker && message.handle !== worker.handle
            ? worker.name
            : undefined;
        },
      },
    };
  }, [rooms, roomSet, tag, me, picked, filter, url]);

  const footer = (list: ChatMessage[]) => {
    const target = feed.target(list);
    if (!target) return null;
    const worker = workerOf(
      rooms.find(r => r.room === target),
      tag
    );
    return composer(
      target,
      worker && { handle: worker.handle, name: worker.name },
      <HerdTo tag={tag} rooms={rooms} target={target} onPick={onPick} />,
      hasDraft => {
        draftOpen.current = hasDraft;
        if (hasDraft && picked === undefined) {
          heldForDraft.current = true;
          onPick(target);
        } else if (!hasDraft && heldForDraft.current) {
          // Held only for the draft: once it posts or empties, a reply goes
          // to the newest conversation again.
          heldForDraft.current = false;
          onPick(undefined);
        }
      }
    );
  };

  return (
    <Stack gap={0} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <HerdFilter
        tag={tag}
        rooms={rooms}
        filter={filter}
        onFilter={room => {
          setFilter(room);
          // A draft stays with who it was started for; only the To moves it.
          if (!draftOpen.current) {
            heldForDraft.current = false;
            onPick(room);
          }
        }}
      />
      <Box style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Transcript
          room={`herd:${tag.id}:${filter ?? ''}`}
          feed={feed}
          messages={messages}
          loading={loadedUrl !== url}
          humanHandle={me}
          empty={<Empty />}
          footer={footer}
        />
      </Box>
    </Stack>
  );
}
