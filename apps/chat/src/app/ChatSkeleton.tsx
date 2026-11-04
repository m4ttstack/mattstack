import { Group, Skeleton, Stack } from '@mattstack/app-kit/core';

const MESSAGE_LINES = [
  ['34%', '88%', '62%'],
  ['26%', '74%'],
  ['30%', '92%', '81%', '40%'],
  ['22%', '56%'],
];

/** Stand-in rows while a room's messages load, in the message row's shape. */
export function MessageSkeleton() {
  return (
    <Stack
      gap={16}
      data-testid="message-skeleton"
      style={{ flex: 1, padding: '16px 24px 16px 20px' }}
    >
      {MESSAGE_LINES.map((lines, i) => (
        <Group key={i} gap={12} align="flex-start" wrap="nowrap">
          <Skeleton
            height={26}
            width={26}
            radius="sm"
            style={{ flex: 'none' }}
          />
          <Stack gap={8} style={{ flex: 1 }}>
            {lines.map((width, j) => (
              <Skeleton key={j} height={j === 0 ? 14 : 12} width={width} />
            ))}
          </Stack>
        </Group>
      ))}
    </Stack>
  );
}

/** A whole room's stand-in, before there is a room to open: the rows, and the
    message box where it will land. */
export function RoomSkeleton() {
  return (
    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
      <MessageSkeleton />
      <Skeleton
        height={46}
        radius="lg"
        style={{ width: 'auto', margin: '0 20px 20px' }}
      />
    </Stack>
  );
}

/** Stand-in rows while the room list loads, in the sidebar's shape. */
export function RailSkeleton() {
  return (
    <Stack gap={14} data-testid="rail-skeleton" style={{ padding: 16 }}>
      <Skeleton height={16} width="36%" />
      {['70%', '48%', '60%'].map((width, i) => (
        <Skeleton key={i} height={13} width={width} />
      ))}
      <Skeleton height={16} width="36%" mt={10} />
      {[0, 1, 2, 3].map(i => (
        <Group key={i} gap={10} wrap="nowrap">
          <Skeleton
            height={36}
            width={36}
            radius="sm"
            style={{ flex: 'none' }}
          />
          <Stack gap={8} style={{ flex: 1 }}>
            <Skeleton height={13} width="62%" />
            <Skeleton height={12} width="90%" />
          </Stack>
        </Group>
      ))}
    </Stack>
  );
}
