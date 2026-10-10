import {
  Anchor,
  CopyActionIcon,
  Group,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { IconName } from '@mattstack/app-kit/icons';

import { Eyebrow } from '../Eyebrow';
import inline from './inline.module.css';
import classes from './SideCards.module.css';

export interface FactProps {
  /** The fact's layer: `Fact MR`, `Fact Branch`, `Fact Worktree`. */
  name: string;
  label: string;
  icon: IconName;
  /** The icon's layer, the lucide name the board uses. */
  iconLayer: string;
  value: string | null;
  /** Shown when there is no value. */
  empty: string;
  href?: string | null;
  /** What the copy button writes; defaults to the value. */
  copy?: string | null;
  sub: string | null;
}

function Fact({
  name,
  label,
  icon,
  iconLayer,
  value,
  empty,
  href,
  copy,
  sub,
}: FactProps) {
  const copyValue = copy ?? value;
  const valueType = { fz: 'lg', fw: 500, lh: 'normal' } as const;
  return (
    <Stack gap={4} className={classes.fact} data-fact={name}>
      <Eyebrow data-parity="label">{label}</Eyebrow>
      <Group gap={6} wrap="nowrap" className={classes.factValue}>
        <Icon name={icon} size={13} data-parity={iconLayer} />
        {value && href ? (
          <Anchor
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            {...valueType}
            c="accent"
            truncate
            className={classes.grow}
            data-parity="value"
          >
            {value}
          </Anchor>
        ) : (
          <Text
            {...valueType}
            truncate
            className={classes.grow}
            data-parity="value"
          >
            {value ?? empty}
          </Text>
        )}
        <CopyActionIcon
          value={copyValue ?? ''}
          disabled={!copyValue}
          className={inline.control}
          size="sm"
          label={copyValue ? `Copy ${label.toLowerCase()}` : undefined}
          icon={<Icon name="copy" size={13} data-parity="copy" />}
          iconSize={13}
        />
      </Group>
      {sub ? (
        <Text fz="sm" lh="normal" c="dimmed" truncate data-parity="sub">
          {sub}
        </Text>
      ) : null}
    </Stack>
  );
}

/** The run's links as a row along the foot of its header card. */
export function FactsStrip({ facts }: { facts: FactProps[] }) {
  return (
    <div className={classes.strip} data-parity="Facts">
      {facts.map(f => (
        <Fact key={f.name} {...f} />
      ))}
    </div>
  );
}
