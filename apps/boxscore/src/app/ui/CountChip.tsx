import classes from './ui.module.css';

export type ChipTone =
  'ok' | 'bad' | 'warn' | 'accent' | 'gold' | 'purple' | 'neutral';

export function CountChip({
  label,
  tone,
  count,
  parity,
}: {
  label: string;
  tone: ChipTone;
  count?: string;
  parity?: string;
}) {
  const neutral = tone === 'neutral';
  // The canvas neutral tint is surface step 3 in both schemes, which no role token holds.
  const fill = neutral
    ? 'var(--tk-surface-3)'
    : `var(--mantine-color-${tone}-light)`;
  const color = neutral ? 'var(--tk-text-2)' : `var(--tk-text-${tone}-small)`;
  return (
    <span
      className={classes.chip}
      data-parity={parity}
      style={{ background: fill }}
    >
      {count !== undefined ? (
        <span
          className={`${classes.num} ${classes.text} ${classes.chipCount}`}
          data-parity="cn"
          style={{ color }}
        >
          {count}
        </span>
      ) : null}
      <span className={classes.text} data-parity="cl" style={{ color }}>
        {label}
      </span>
    </span>
  );
}
