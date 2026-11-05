import { Group, Skeleton, Stack } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './chat-skeleton.module.css';
import { SectionLabel } from './FleetTree';

/** One message: the name's width, then each line of its body. Enough rows to
    run past the fold, as a real room's history does. */
const MESSAGES = [
  { name: 64, lines: ['91%', '96%', '42%'] },
  { name: 48, lines: ['58%'] },
  { name: 72, lines: ['94%', '87%'] },
  { name: 56, lines: ['97%', '92%', '89%', '36%'] },
  { name: 48, lines: ['71%'] },
  { name: 64, lines: ['93%', '64%'] },
  { name: 72, lines: ['95%', '90%', '52%'] },
  { name: 56, lines: ['83%'] },
  { name: 48, lines: ['96%', '74%'] },
];

const ROOM_WIDTHS = ['46%', '22%', '34%', '18%'];
const DM_ROWS = ['58%', '46%', '64%', '52%', '60%', '42%', '55%', '48%'];

/** Stand-in rows while a room's messages load: the message row's own avatar,
    name, time and line spacing. */
export function MessageSkeleton() {
  return (
    <div className={classes.messages} data-testid="message-skeleton">
      {MESSAGES.map((message, i) => (
        <div key={i} className={classes.message}>
          <Skeleton
            height={32}
            width={32}
            radius="sm"
            className={classes.face}
          />
          <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
            <Group gap={8} wrap="nowrap" className={classes.line}>
              <Skeleton height={13} width={message.name} />
              <Skeleton height={10} width={52} />
            </Group>
            {message.lines.map((width, j) => (
              <div key={j} className={classes.line}>
                <Skeleton height={13} width={width} />
              </div>
            ))}
          </Stack>
        </div>
      ))}
    </div>
  );
}

/** The title row's stand-in: the name and the members pill. */
export function TitleSkeleton() {
  return (
    <Group gap={10} wrap="nowrap" data-testid="title-skeleton">
      <Skeleton height={15} width={150} />
      <Skeleton height={26} width={66} radius="sm" />
    </Group>
  );
}

/** A whole room's stand-in, before there is a room to open: the rows, and the
    message box where it will land. */
export function RoomSkeleton() {
  return (
    <Stack gap={0} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <MessageSkeleton />
      <Skeleton
        height={48}
        radius="lg"
        style={{ width: 'auto', margin: '8px 20px 20px', flex: 'none' }}
      />
    </Stack>
  );
}

/** The sidebar's stand-in: its real headings over rows in the real shapes. */
export function RailSkeleton() {
  return (
    <div className={classes.rail} data-testid="rail-skeleton">
      <SectionLabel label="Rooms" />
      {ROOM_WIDTHS.map((width, i) => (
        <div key={i} className={classes.roomRow}>
          <Icon name="hash" size={13} color="var(--chat-ink-soft)" />
          <Skeleton height={13} width={width} />
        </div>
      ))}
      <div style={{ height: 10 }} />
      <SectionLabel label="Direct" />
      {DM_ROWS.map((width, i) => (
        <div key={i} className={classes.dmRow}>
          <Skeleton
            height={40}
            width={40}
            radius="sm"
            className={classes.face}
          />
          <Stack gap={8} style={{ flex: 1, minWidth: 0, paddingTop: 3 }}>
            <Skeleton height={14} width={width} />
            <Skeleton height={12} width="92%" />
            <Skeleton height={12} width="68%" />
          </Stack>
        </div>
      ))}
    </div>
  );
}
