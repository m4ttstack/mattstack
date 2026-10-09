import type { MantineColor } from '@mattstack/app-kit/core';
import { Group, Progress, Stack, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { IconName } from '@mattstack/app-kit/icons';

import { formatDuration } from '../derive/duration';
import type { RailStage } from '../derive/stages';
import { Dot } from './Dot';

type Status = RailStage['status'];

const STATUS_COLOR: Record<Status, MantineColor | null> = {
  done: 'ok',
  running: 'accent',
  failed: 'bad',
  redirected: 'warn',
  held: 'warn',
  waiting: 'bad',
  'not-started': null,
};

const STATUS_ICON: Partial<
  Record<Status, { name: IconName; layer: string; color: string }>
> = {
  done: { name: 'check', layer: 'check', color: 'var(--tk-text-ok-vivid)' },
  failed: {
    name: 'circleX',
    layer: 'circle-x',
    color: 'var(--tk-text-bad-vivid)',
  },
  redirected: {
    name: 'cornerUpLeft',
    layer: 'corner-up-left',
    color: 'var(--tk-text-warn-vivid)',
  },
  held: { name: 'clock', layer: 'clock', color: 'var(--tk-text-warn-vivid)' },
};

const STATUS_SUFFIX: Partial<Record<Status, string>> = {
  waiting: ' · waiting on you',
  held: ' · held',
};

export interface StageRailProps {
  stages: RailStage[];
  /** Bars only, for a card that names the current stage elsewhere. */
  compact?: boolean;
  /** A stage still marked running on a run that has ended finished. */
  finished?: boolean;
}

function Bar({
  status,
  parity,
  label,
}: {
  status: Status;
  parity: string;
  label?: string;
}) {
  const color = STATUS_COLOR[status];
  // The bar is the filled section, or the bare track before the stage starts.
  return color ? (
    <Progress
      value={100}
      color={color}
      size="sm"
      aria-label={label}
      attributes={{ section: { 'data-parity': parity } }}
    />
  ) : (
    <Progress value={0} size="sm" aria-label={label} data-parity={parity} />
  );
}

function Column({ stage, status }: { stage: RailStage; status: Status }) {
  const notStarted = status === 'not-started';
  const icon = STATUS_ICON[status];
  const duration =
    notStarted || stage.durationMs == null
      ? '—'
      : formatDuration(stage.durationMs);

  return (
    <Stack gap={7} data-stage={stage.name} data-status={status}>
      <Bar status={status} parity="bar" />
      <Group gap={5} wrap="nowrap" data-part="lab">
        {icon ? (
          <Icon
            name={icon.name}
            size={12}
            color={icon.color}
            data-parity={icon.layer}
          />
        ) : null}
        {status === 'running' ? <Dot tone="accent" data-parity="live" /> : null}
        <Text
          fz={12}
          fw={500}
          lh="normal"
          c={status === 'waiting' ? 'bad' : notStarted ? 'dimmed' : undefined}
          data-muted={notStarted ? 'true' : undefined}
          data-parity={stage.name}
        >
          {stage.name}
          {STATUS_SUFFIX[status] ?? ''}
        </Text>
      </Group>
      <Group gap={8} wrap="nowrap" data-part="meta">
        <Text fz={11.5} lh="normal" c="dimmed" data-parity={duration}>
          {duration}
        </Text>
        {stage.attempts > 1 ? (
          <Text
            fz={11.5}
            lh="normal"
            c="dimmed"
            data-parity={`×${stage.attempts}`}
          >
            ×{stage.attempts}
          </Text>
        ) : null}
      </Group>
    </Stack>
  );
}

/** One column per pipeline stage: a bar colored by status, the stage name
    and its duration. */
export function StageRail({
  stages,
  compact = false,
  finished = false,
}: StageRailProps) {
  if (stages.length === 0) return null;
  const statusOf = (s: RailStage): Status =>
    finished && s.status === 'running' ? 'done' : s.status;

  if (compact) {
    return (
      <Group gap={3} wrap="nowrap" grow data-part="compact-rail">
        {stages.map(s => (
          <Bar
            key={s.name}
            status={statusOf(s)}
            parity={`seg ${s.name}`}
            label={`${s.name}: ${statusOf(s)}`}
          />
        ))}
      </Group>
    );
  }

  return (
    <Group gap={4} wrap="nowrap" grow align="flex-start" data-part="rail">
      {stages.map(s => (
        <Column key={s.name} stage={s} status={statusOf(s)} />
      ))}
    </Group>
  );
}
