import { Progress } from '@mattstack/app-kit/core';
import { Link } from '@mattstack/app-kit/router';
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
  dim = false,
  href,
  parity,
}: {
  rank: number | null;
  name: string;
  value: string;
  fraction: number;
  you?: boolean;
  leader?: boolean;
  delta?: { text: string; tone: DeltaTone };
  /** Dims the value, for a zero or missing one. */
  dim?: boolean;
  /** Makes the name a link. */
  href?: string;
  parity?: string;
}) {
  const barColor = you
    ? 'var(--tk-fill-accent)'
    : leader
      ? 'var(--tk-fill-gold)'
      : 'var(--tk-muted)';
  const percent = Math.max(0, Math.min(1, fraction)) * 100;
  const who = (
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
  );
  return (
    <div
      className={classes.rankRow}
      data-parity={parity}
      style={
        you ? { background: 'var(--mantine-color-accent-light)' } : undefined
      }
    >
      <span className={classes.rankSlot}>
        {leader && rank !== null ? (
          <LeaderMark parity="Rank" />
        ) : (
          <span
            className={`${classes.num} ${classes.text} ${classes.rankNumber}`}
            data-parity="n"
          >
            {rank ?? '–'}
          </span>
        )}
      </span>
      {href ? (
        <Link
          href={href}
          className={classes.whoLink}
          onClick={e => e.stopPropagation()}
        >
          {who}
        </Link>
      ) : (
        who
      )}
      <Progress.Root
        size={4}
        radius={2}
        className={classes.track}
        data-parity="Track"
      >
        {percent > 0 && (
          <Progress.Section
            value={percent}
            color={barColor}
            className={classes.bar}
            data-parity="Bar"
          />
        )}
      </Progress.Root>
      <span
        className={`${classes.num} ${classes.text} ${classes.val}`}
        data-parity="Val"
        style={dim ? { color: 'var(--tk-text-3)' } : undefined}
      >
        {value}
      </span>
      {delta ? (
        <DeltaMark text={delta.text} tone={delta.tone} parity="Delta" />
      ) : null}
    </div>
  );
}
