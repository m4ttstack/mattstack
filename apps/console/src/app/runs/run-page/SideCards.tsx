import type { ReactNode } from 'react';
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
  /** Kept beside the value on the hero's one-line footer, which has no
      room for `sub`. */
  note?: string | null;
}

function FactCopy({ label, value }: { label: string; value: string }) {
  return (
    <CopyActionIcon
      value={value}
      className={inline.control}
      size="sm"
      label={`Copy ${label.toLowerCase()}`}
      icon={<Icon name="copy" size={13} data-parity="copy" />}
      iconSize={13}
    />
  );
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
  const valueType = { fz: 'sm', fw: 500, lh: 'normal' } as const;
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
            className={classes.value}
            data-parity="value"
          >
            {value}
          </Anchor>
        ) : (
          <Text
            {...valueType}
            truncate
            className={classes.value}
            data-parity="value"
          >
            {value ?? empty}
          </Text>
        )}
        {copyValue ? <FactCopy label={label} value={copyValue} /> : null}
      </Group>
      {sub ? (
        <Text fz="sm" lh="normal" c="dimmed" truncate data-parity="sub">
          {sub}
        </Text>
      ) : null}
    </Stack>
  );
}

/** The run's links as one unlabelled line along the foot of the live hero,
    with `end` at its right edge. */
export function FactsLine({
  facts,
  end,
}: {
  facts: FactProps[];
  end?: ReactNode;
}) {
  return (
    <Group gap={20} wrap="nowrap" className={classes.line} data-parity="Facts">
      {facts.map(f => {
        const copyValue = f.copy ?? f.value;
        const type = { fz: 'sm', lh: 'normal', truncate: true } as const;
        return (
          <Group
            key={f.name}
            gap={6}
            wrap="nowrap"
            className={classes.lineFact}
            data-fact={f.name}
          >
            <Icon name={f.icon} size={13} data-parity={f.iconLayer} />
            {f.value && f.href ? (
              <Anchor
                href={f.href}
                target="_blank"
                rel="noopener noreferrer"
                c="accent"
                data-parity="value"
                {...type}
              >
                {f.value}
              </Anchor>
            ) : (
              <Text c="dimmed" data-parity="value" {...type}>
                {f.value ?? f.empty}
              </Text>
            )}
            {f.note ? (
              <Text c="dimmed" data-parity="note" {...type}>
                {f.note}
              </Text>
            ) : null}
            {copyValue ? <FactCopy label={f.label} value={copyValue} /> : null}
          </Group>
        );
      })}
      {end ? <span className={classes.lineEnd}>{end}</span> : null}
    </Group>
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
