import { Fragment, useState } from 'react';
import {
  Badge,
  Button,
  Popover,
  ScrollArea,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { AnimatedChevron, Icon } from '@mattstack/app-kit/icons';
import type { AgentStatus, RoomSummary } from '@mattstack/rt-client';

import {
  AGENT_STATE_WORD,
  agentState,
  isRoomForRepo,
  seenElapsed,
  type AgentState,
} from './agent-state';
import { AgentHoverCard, HandleAvatar } from './AgentName';
import { useBuddies } from './buddies-context';
import { doing, type DoingInput } from './doing';
import classes from './room-members.module.css';
import { StateDot } from './StateDot';

/** A room member as the page bar holds it: enough for the task line, plus
    the herdr state and repo the grouping and the repo chip read. */
export type MemberBuddy = DoingInput & {
  agentStatus?: AgentStatus;
  repo?: string;
  lastSeenAt?: number;
};

type SignedInState = Exclude<AgentState, 'offline'>;

const GROUPS: { state: SignedInState; word: string }[] = [
  { state: 'blocked', word: 'Needs you' },
  { state: 'working', word: 'Working' },
  { state: 'done', word: 'Done' },
];

const STACK_MAX = 3;

function MemberRow({
  member,
  room,
  reachable,
  now,
}: {
  member: MemberBuddy;
  room: RoomSummary;
  reachable: boolean;
  now: number;
}) {
  const ctx = useBuddies();
  const roster = ctx?.byHandle.get(member.handle);
  const task = doing(member, now);
  const name = member.name ?? ctx?.nameOf(member.handle) ?? member.handle;
  // The room is usually named for its repo, so the chip only earns its place
  // on an agent working somewhere else.
  const otherRepo =
    room.kind !== 'dm' && member.repo && !isRoomForRepo(room.room, member.repo)
      ? member.repo
      : undefined;
  const row = (
    <div className={classes.row} data-testid={`members-row-${member.handle}`}>
      <HandleAvatar handle={member.handle} variant="inline" size={22} />
      <div className={classes.text}>
        <div className={classes.line}>
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
          {member.lastSeenAt !== undefined && (
            <span className={classes.age}>
              {seenElapsed({ ...member, lastSeenAt: member.lastSeenAt }, now)}
            </span>
          )}
        </div>
        {task && <span className={classes.task}>{task.text}</span>}
      </div>
    </div>
  );
  if (!roster) return row;
  return (
    <AgentHoverCard
      buddy={roster}
      position="right-start"
      offset={14}
      reachable={reachable}
      now={now}
      inRoom
      task={task}
    >
      {row}
    </AgentHoverCard>
  );
}

/** The room's members behind one pill: who (a stack of their sprites) and
    how they are doing (a count per herdr state). The dropdown lists them by
    state, an agent waiting on the human first; hovering a row docks its card
    beside the dropdown, so the list never moves under the pointer. */
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
  const tally = groups.map(
    g => `${g.members.length} ${AGENT_STATE_WORD[g.state].toLowerCase()}`
  );

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      withinPortal
      shadow="md"
      radius="lg"
      width={320}
      trapFocus
      // A row's agent card is portalled outside this dropdown, so a mousedown
      // on its buttons would read as outside and close the list (and the card
      // with it) before the click lands. On click, the button's handler runs
      // first.
      clickOutsideEvents={['click', 'touchend']}
      classNames={{ dropdown: classes.dropdown }}
    >
      <Popover.Target>
        <Button
          variant="default"
          size="sm"
          data-testid="members-chip"
          aria-label={
            tally.length > 0
              ? `Members of ${roomLabel}: ${tally.join(', ')}`
              : `Members of ${roomLabel}`
          }
          onClick={() => setOpened(o => !o)}
          leftSection={
            stack.length > 0 ? (
              <span className={classes.stack}>
                {stack.map(b => (
                  <HandleAvatar
                    key={b.handle}
                    handle={b.handle}
                    variant="inline"
                    size={18}
                  />
                ))}
              </span>
            ) : undefined
          }
          rightSection={<AnimatedChevron opened={opened} size={14} />}
        >
          <Tooltip
            label={tally.join(' · ')}
            disabled={opened || tally.length === 0}
            openDelay={300}
            withinPortal
          >
            <span className={classes.counts}>
              {groups.length > 0 ? (
                groups.map(g => (
                  <span
                    key={g.state}
                    className={classes.countItem}
                    data-testid={`members-count-${g.state}`}
                  >
                    <StateDot state={g.state} />
                    {g.members.length}
                  </span>
                ))
              ) : (
                <span className={classes.countItem}>
                  <StateDot state="offline" testId="members-count-none" />0
                </span>
              )}
              {!reachable && <span>last known</span>}
            </span>
          </Tooltip>
        </Button>
      </Popover.Target>
      <Popover.Dropdown data-testid="members-dropdown">
        <div className={classes.header}>
          <span className={classes.title}>
            {signedIn.length} in {roomLabel}
          </span>
          <span className={classes.wakes} data-testid="members-wakes">
            wakes: {wakeMode}
          </span>
        </div>
        {reachable ? (
          <>
            <ScrollArea.Autosize mah={420} type="auto" scrollbars="y">
              <div className={classes.list}>
                {groups.map(g => (
                  <Fragment key={g.state}>
                    <div
                      className={classes.group}
                      data-state={g.state}
                      data-testid={`members-group-${g.state}`}
                    >
                      {g.state === 'blocked' && (
                        <StateDot state="blocked" size="sm" />
                      )}
                      {g.word}
                      <span className={classes.count}>{g.members.length}</span>
                    </div>
                    {g.members.map(b => (
                      <MemberRow
                        key={b.handle}
                        member={b}
                        room={room}
                        reachable={reachable}
                        now={now}
                      />
                    ))}
                  </Fragment>
                ))}
                {offlineOpen &&
                  offline.map(b => (
                    <MemberRow
                      key={b.handle}
                      member={b}
                      room={room}
                      reachable={reachable}
                      now={now}
                    />
                  ))}
              </div>
            </ScrollArea.Autosize>
            {offline.length > 0 && (
              <div className={classes.signedOutRule}>
                <UnstyledButton
                  className={classes.signedOut}
                  aria-expanded={offlineOpen}
                  data-testid="members-signed-out"
                  onClick={() => setOfflineOpen(o => !o)}
                >
                  <span className={classes.signedOutLabel}>
                    <Icon
                      name={offlineOpen ? 'chevronDown' : 'chevronRight'}
                      size={12}
                    />
                    {offline.length} signed out
                  </span>
                  {!offlineOpen && (
                    <span className={classes.names}>
                      {offline.map(nameOf).join(' ')}
                    </span>
                  )}
                </UnstyledButton>
              </div>
            )}
          </>
        ) : (
          <div className={classes.withheld}>
            presence withheld while the daemon is down
          </div>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
