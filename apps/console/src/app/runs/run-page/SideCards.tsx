import type { ReactNode } from 'react';
import {
  Anchor,
  CopyActionIcon,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { IconName } from '@mattstack/app-kit/icons';

import inline from './inline.module.css';
import classes from './SideCards.module.css';

export const LABEL_TYPE = {
  fz: 10.5,
  fw: 500,
  lh: 'normal',
  tt: 'uppercase',
  lts: 0.8,
  c: 'dimmed',
} as const;

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
  const valueType = { fz: 13, fw: 500, lh: 'normal' } as const;
  return (
    <Stack gap={4} className={classes.fact} data-fact={name}>
      <Text {...LABEL_TYPE} data-parity="label">
        {label}
      </Text>
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
          size="xs"
          label={copyValue ? `Copy ${label.toLowerCase()}` : undefined}
          icon={<Icon name="copy" size={13} data-parity="copy" />}
          iconSize={13}
        />
      </Group>
      {sub ? (
        <Text fz={11.5} lh="normal" c="dimmed" truncate data-parity="sub">
          {sub}
        </Text>
      ) : null}
    </Stack>
  );
}

function SideCard({
  name,
  gap,
  children,
}: {
  name: string;
  gap: number;
  children: ReactNode;
}) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.card}
      data-parity={name}
    >
      <Stack gap={gap}>{children}</Stack>
    </Paper>
  );
}

/** The run's links in one card; `name` is the card's board layer. */
export function FactsCard({
  facts,
  name = 'Facts',
}: {
  facts: FactProps[];
  name?: string;
}) {
  return (
    <SideCard name={name} gap={14}>
      {facts.map(f => (
        <Fact key={f.name} {...f} />
      ))}
    </SideCard>
  );
}

export interface SideCardsProps {
  facts: FactProps[];
  inputs:
    | { state: 'loading' }
    | { state: 'error' }
    | { state: 'ready'; pack: string; counts: string };
  onViewInputs: () => void;
}

/** The run page's side column: the run's links and its effective inputs.
    Decisions live in the story, not here. */
export function SideCards({ facts, inputs, onViewInputs }: SideCardsProps) {
  return (
    <Stack gap={14} className={classes.side} data-parity="Side">
      <FactsCard facts={facts} />
      <SideCard name="Inputs" gap={8}>
        <Text {...LABEL_TYPE} data-parity="title">
          Effective inputs
        </Text>
        {inputs.state === 'loading' ? (
          <Skeleton height={34} />
        ) : inputs.state === 'error' ? (
          <Text fz={12.5} lh="normal" c="dimmed" data-parity="pack">
            Couldn&apos;t read the inputs
          </Text>
        ) : (
          <>
            <Text fz={12.5} lh="normal" data-parity="pack">
              {inputs.pack}
            </Text>
            <Text fz={12} lh="normal" c="dimmed" data-parity="counts">
              {inputs.counts}
            </Text>
          </>
        )}
        <Anchor
          component="button"
          type="button"
          fz={12}
          fw={500}
          lh="normal"
          c="accent"
          className={classes.start}
          onClick={onViewInputs}
          data-parity="view"
        >
          View inputs →
        </Anchor>
      </SideCard>
    </Stack>
  );
}
