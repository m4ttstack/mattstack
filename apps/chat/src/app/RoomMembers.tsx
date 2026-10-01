import { Fragment, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Menu,
  ScrollArea,
} from '@mattstack/app-kit/core';
import { AnimatedChevron, Icon } from '@mattstack/app-kit/icons';
import type { AgentStatus, RoomSummary } from '@mattstack/rt-client';

import { agentState, isRoomForRepo, type AgentState } from './agent-state';
import { AgentCard, CARD_WIDTH, SpriteAvatar } from './AgentName';
import { useBuddies } from './buddies-context';
import { doing, type DoingInput } from './doing';
import classes from './room-members.module.css';
import { StateDot } from './StateDot';

/** A room member as the page bar holds it: enough for the task line, plus
    the herdr state and repo the grouping and the repo chip read. */
export type MemberBuddy = DoingInput & {
  agentStatus?: AgentStatus;
  repo?: string;
};

type SignedInState = Exclude<AgentState, 'offline'>;

const GROUPS: { state: SignedInState; word: string }[] = [
  { state: 'blocked', word: 'Needs you' },
  { state: 'working', word: 'Working' },
  { state: 'done', word: 'Done' },
];

const STACK_MAX = 3;
const DROPDOWN_WIDTH = 320;
/** Rows a group shows before its "N more". */
const GROUP_CAP = 8;
/** The list scrolls past this, under the header, so a big room never runs
    the dropdown off the screen. */
const LIST_MAX_HEIGHT = 420;

/** From a row's right edge to the dropdown's outer edge (its padding and
    hairline), so a member's card meets the list instead of overlapping it. */
const DROPDOWN_DOCK_OFFSET = 5;

function MemberLabel({
  member,
  room,
  now,
}: {
  member: MemberBuddy;
  room: RoomSummary;
  now: number;
}) {
  const ctx = useBuddies();
  const task = doing(member, now);
  const name = member.name ?? ctx?.nameOf(member.handle) ?? member.handle;
  // The room is usually named for its repo, so the chip only earns its place
  // on an agent working somewhere else.
  const otherRepo =
    room.kind !== 'dm' && member.repo && !isRoomForRepo(room.room, member.repo)
      ? member.repo
      : undefined;
  return (
    <span className={classes.label}>
      <span className={classes.labelLine}>
        <span className={classes.name}>{name}</span>
        {otherRepo && (
          <Badge
            variant="outline"
            size="sm"
            color="gray"
            classNames={{ root: classes.repo }}
          >
            {otherRepo}
          </Badge>
        )}
      </span>
      {task && <span className={classes.task}>{task.text}</span>}
    </span>
  );
}

/** One member: a submenu item whose submenu is the agent's card, so the
    card docks flush beside the list and the row stays marked while the
    pointer is on the card. A member presence does not know gets a plain
    item with no card.

    The submenu is fixed-positioned so the list's scroll area does not clip
    it, and controlled so a card closed by the menu closing stays closed on
    the next open. */
function MemberItem({
  member,
  room,
  reachable,
  now,
  active,
  onActive,
}: {
  member: MemberBuddy;
  room: RoomSummary;
  reachable: boolean;
  now: number;
  active: boolean;
  onActive: (open: boolean) => void;
}) {
  const ctx = useBuddies();
  const roster = ctx?.byHandle.get(member.handle);
  const avatar = <SpriteAvatar handle={member.handle} size="sm" />;
  const label = <MemberLabel member={member} room={room} now={now} />;
  if (!roster) {
    return (
      <Menu.Item
        leftSection={avatar}
        classNames={{ itemLabel: classes.itemLabel }}
        closeMenuOnClick={false}
        data-testid={`members-row-${member.handle}`}
      >
        {label}
      </Menu.Item>
    );
  }
  return (
    <Menu.Sub
      position="right-start"
      offset={DROPDOWN_DOCK_OFFSET}
      width={CARD_WIDTH}
      floatingStrategy="fixed"
      opened={active}
      onChange={onActive}
    >
      <Menu.Sub.Target>
        <Menu.Sub.Item
          leftSection={avatar}
          classNames={{ itemLabel: classes.itemLabel }}
          data-testid={`members-row-${member.handle}`}
          data-menu-active={active || undefined}
        >
          {label}
        </Menu.Sub.Item>
      </Menu.Sub.Target>
      <Menu.Sub.Dropdown>
        <AgentCard
          buddy={roster}
          reachable={reachable}
          now={now}
          inRoom
          task={doing(member, now)}
          inMenu
        />
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  );
}

/** The room's members behind one pill: who (their sprites) and how many.
    The dropdown lists them by herdr state, an agent waiting on the human
    first; each row's card opens as its submenu. */
export function RoomMembers({
  room,
  buddies,
  reachable,
  now,
  wakeMode,
}: {
  room: RoomSummary;
  buddies: MemberBuddy[];
  reachable: boolean;
  now: number;
  wakeMode: string;
}) {
  const ctx = useBuddies();
  const [opened, setOpened] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [uncapped, setUncapped] = useState<ReadonlySet<string>>(new Set());
  const signedIn = buddies.filter(b => b.status !== 'offline');
  const offline = buddies.filter(b => b.status === 'offline');
  const groups = GROUPS.map(g => ({
    ...g,
    members: signedIn.filter(b => agentState(b) === g.state),
  })).filter(g => g.members.length > 0);
  const stack = groups.flatMap(g => g.members).slice(0, STACK_MAX);
  const roomLabel = room.kind === 'dm' ? 'conversation' : `#${room.room}`;
  const nameOf = (b: MemberBuddy) =>
    b.name ?? ctx?.nameOf(b.handle) ?? b.handle;

  const capped = (key: string, members: MemberBuddy[]) =>
    uncapped.has(key) ? members : members.slice(0, GROUP_CAP);
  const more = (key: string, members: MemberBuddy[]) =>
    !uncapped.has(key) &&
    members.length > GROUP_CAP && (
      <Menu.Item
        leftSection={<Icon name="chevronDown" size={12} />}
        closeMenuOnClick={false}
        data-testid={`members-more-${key}`}
        onClick={() => setUncapped(s => new Set(s).add(key))}
      >
        <span className={classes.more}>{members.length - GROUP_CAP} more</span>
      </Menu.Item>
    );
  const onOpenChange = (open: boolean) => {
    setOpened(open);
    if (!open) setActiveHandle(null);
  };

  const item = (b: MemberBuddy) => (
    <MemberItem
      key={b.handle}
      member={b}
      room={room}
      reachable={reachable}
      now={now}
      active={activeHandle === b.handle}
      onActive={open =>
        setActiveHandle(current =>
          open ? b.handle : current === b.handle ? null : current
        )
      }
    />
  );

  return (
    <Menu
      opened={opened}
      onChange={onOpenChange}
      position="bottom-start"
      width={DROPDOWN_WIDTH}
      shadow="md"
      radius="lg"
      withinPortal
    >
      <Menu.Target>
        <Button
          variant="default"
          size="sm"
          data-testid="members-chip"
          aria-label={`Members of ${roomLabel}: ${signedIn.length} signed in${reachable ? '' : ', last known'}`}
          leftSection={
            stack.length > 0 ? (
              <Avatar.Group spacing="xs">
                {stack.map(b => (
                  <SpriteAvatar key={b.handle} handle={b.handle} size="sm" />
                ))}
              </Avatar.Group>
            ) : undefined
          }
          rightSection={<AnimatedChevron opened={opened} size={14} />}
        >
          {signedIn.length}
          {!reachable && ' · last known'}
        </Button>
      </Menu.Target>
      <Menu.Dropdown data-testid="members-dropdown">
        <div className={classes.header}>
          <span className={classes.title}>
            {signedIn.length} in {roomLabel}
          </span>
          <span className={classes.wakes} data-testid="members-wakes">
            wakes: {wakeMode}
          </span>
        </div>
        {reachable ? (
          <ScrollArea.Autosize mah={LIST_MAX_HEIGHT}>
            {groups.map(g => (
              <Fragment key={g.state}>
                <Menu.Label data-testid={`members-group-${g.state}`}>
                  <span className={classes.groupLabel} data-state={g.state}>
                    {g.state === 'blocked' && (
                      <StateDot state="blocked" size="sm" />
                    )}
                    {g.word}
                    <span className={classes.count}>{g.members.length}</span>
                  </span>
                </Menu.Label>
                {capped(g.state, g.members).map(item)}
                {more(g.state, g.members)}
              </Fragment>
            ))}
            {offline.length > 0 && (
              <>
                <Menu.Divider />
                <Menu.Item
                  leftSection={
                    <Icon
                      name={offlineOpen ? 'chevronDown' : 'chevronRight'}
                      size={12}
                    />
                  }
                  classNames={{ itemLabel: classes.itemLabel }}
                  aria-expanded={offlineOpen}
                  closeMenuOnClick={false}
                  data-testid="members-signed-out"
                  onClick={() => setOfflineOpen(o => !o)}
                >
                  <span className={classes.signedOut}>
                    {offline.length} signed out
                    {!offlineOpen && (
                      <span className={classes.names}>
                        {offline.map(nameOf).join(' ')}
                      </span>
                    )}
                  </span>
                </Menu.Item>
                {offlineOpen && (
                  <>
                    {capped('offline', offline).map(item)}
                    {more('offline', offline)}
                  </>
                )}
              </>
            )}
          </ScrollArea.Autosize>
        ) : (
          <div className={classes.withheld}>
            presence withheld while the daemon is down
          </div>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
