import { Progress } from '@mattstack/app-kit/core';
import type { DeltaTone } from '../model/delta';
import { DeltaMark } from './DeltaMark';
import { LeaderMark } from './LeaderMark';
import classes from './ui.module.css';

export function RankRow({
  rank,
  name,
  value,
  fraction,
  you = false,
  leader = false,
  delta,
  parity,
}: {
  rank: number | null;
  name: string;
  value: string;
  fraction: number;
  you?: boolean;
  leader?: boolean;
  delta?: { text: string; tone: DeltaTone };
  parity?: string;
}) {
  const barColor = you
    ? 'var(--tk-fill-accent)'
    : leader
      ? 'var(--tk-fill-gold)'
      : 'var(--tk-muted)';
  const percent = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div
      className={classes.rankRow}
      data-parity={parity}
      style={
        you ? { background: 'var(--mantine-color-accent-light)' } : undefined
      }
    >
      <span className={classes.rankSlot}>
        {rank === null ? null : leader ? (
          <LeaderMark parity="Rank" />
        ) : (
          <span
            className={`${classes.num} ${classes.text} ${classes.rankNumber}`}
            data-parity="n"
          >
            {rank}
          </span>
        )}
      </span>
      <span
        className={`${classes.text} ${classes.who}`}
        data-parity="Who"
        style={{
          color: you ? 'var(--tk-text-accent)' : 'var(--tk-text-2)',
          fontWeight: you ? 500 : 400,
        }}
      >
        {name}
      </span>
      <Progress.Root
        size={4}
        radius={2}
        className={classes.track}
        data-parity="Track"
      >
        <Progress.Section
          value={percent}
          color={barColor}
          className={classes.bar}
          data-parity="Bar"
        />
      </Progress.Root>
      <span
        className={`${classes.num} ${classes.text} ${classes.val}`}
        data-parity="Val"
      >
        {value}
      </span>
      {delta ? (
        <DeltaMark text={delta.text} tone={delta.tone} parity="Delta" />
      ) : null}
    </div>
  );
}
