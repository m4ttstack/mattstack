import { GROUPS, type MetricGroup } from '../../shared/metrics';
import { hueVar } from '../model/groups';
import classes from './ui.module.css';

type Variant = 'swatch-label' | 'pill' | 'tile';

// The canvas draws the neutral group three ways: muted swatch with text-3 on cards,
// text-2 swatch and label on leader tiles, a surface-3 pill with text-2 on panels.
// The canvas neutral tint is surface step 3 in both schemes, which no role token holds.
function colours(group: MetricGroup, variant: Variant) {
  const hue = GROUPS[group].hue;
  const neutral = hue === 'neutral';
  if (variant === 'pill') {
    return {
      fill: neutral
        ? 'var(--tk-surface-3)'
        : `var(--mantine-color-${hue}-light)`,
      swatch: undefined,
      label: hueVar(group, 'small'),
    };
  }
  if (variant === 'tile') {
    const c = neutral ? 'var(--tk-text-2)' : hueVar(group, 'text');
    return { fill: undefined, swatch: c, label: c };
  }
  return {
    fill: undefined,
    swatch: hueVar(group, 'swatch'),
    label: neutral ? 'var(--tk-text-3)' : hueVar(group, 'text'),
  };
}

export function GroupTag({
  group,
  variant,
  parity,
}: {
  group: MetricGroup;
  variant: Variant;
  parity?: string;
}) {
  const c = colours(group, variant);
  const tile = variant === 'tile';
  const swatchSize = tile ? 8 : 6;
  const className = [
    classes.groupTag,
    tile ? classes.groupTile : '',
    variant === 'pill' ? classes.groupPill : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span
      className={className}
      data-parity={parity}
      style={c.fill ? { background: c.fill } : undefined}
    >
      {c.swatch ? (
        <span
          className={classes.swatch}
          data-parity={tile ? 'Group Swatch' : 'Swatch'}
          style={{
            width: swatchSize,
            height: swatchSize,
            background: c.swatch,
          }}
        />
      ) : null}
      <span
        className={`${classes.text} ${classes.groupLabel}`}
        data-parity={tile ? 'Group Label' : 'Group'}
        style={{ color: c.label }}
      >
        {GROUPS[group].label.toUpperCase()}
      </span>
    </span>
  );
}
