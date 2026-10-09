import type { ReactNode } from 'react';
import {
  Anchor,
  Badge,
  CopyActionIcon,
  Group,
  Kbd,
  Paper,
  Skeleton,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { IconName } from '@mattstack/app-kit/icons';

import type { DecisionEntry } from '../derive/story';
import inline from './inline.module.css';
import classes from './SideCards.module.css';

const LABEL_TYPE = {
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
  hotkey: string;
  /** What `c` or the copy button writes; defaults to the value. */
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
  hotkey,
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
        <Kbd size="xs" className={inline.kbd} data-parity={`kbd ${hotkey}`}>
          <span data-parity={hotkey}>{hotkey}</span>
        </Kbd>
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

export interface SideCardsProps {
  facts: FactProps[];
  decisions: DecisionEntry[];
  /** Where a decision row and "Open log" scroll to. */
  onOpenDecision: (entry: DecisionEntry | null) => void;
  /** "None yet." on a work run; review and respond runs add where the
      answer will come from. */
  noDecisions: string;
  inputs:
    | { state: 'loading' }
    | { state: 'error' }
    | { state: 'ready'; pack: string; counts: string };
  onViewInputs: () => void;
}

/** The run page's side column: links, decisions and effective inputs. */
export function SideCards({
  facts,
  decisions,
  onOpenDecision,
  noDecisions,
  inputs,
  onViewInputs,
}: SideCardsProps) {
  return (
    <Stack gap={14} className={classes.side} data-parity="Side">
      <SideCard name="Facts" gap={14}>
        {facts.map(f => (
          <Fact key={f.name} {...f} />
        ))}
      </SideCard>
      <SideCard name="Decisions mini" gap={10}>
        <Group wrap="nowrap" className={classes.header}>
          <Text {...LABEL_TYPE} data-parity="title">
            Decisions · {decisions.length}
          </Text>
          <span className={classes.grow} />
          <Anchor
            component="button"
            type="button"
            fz={12}
            fw={500}
            lh="normal"
            c="accent"
            onClick={() => onOpenDecision(decisions[0] ?? null)}
            data-parity="open log"
          >
            Open log →
          </Anchor>
        </Group>
        {decisions.length === 0 ? (
          <Text fz={12.5} lh="normal" c="dimmed" data-parity="none">
            {noDecisions}
          </Text>
        ) : (
          decisions.map(d => (
            <div
              key={`${d.gateId}-${d.questionId}`}
              className={classes.decision}
            >
              <UnstyledButton
                className={classes.decisionButton}
                onClick={() => onOpenDecision(d)}
              >
                <Group gap={8} wrap="nowrap">
                  {d.stage ? (
                    <Badge
                      size="xs"
                      radius="sm"
                      variant="light"
                      color="gray"
                      tt="none"
                      className={`${inline.tag} ${classes.stageTag}`}
                      data-parity="stage tag"
                    >
                      <span data-parity="stage">{d.stage}</span>
                    </Badge>
                  ) : null}
                  <Text fz={12.5} lh="normal" truncate data-parity="pick">
                    {d.pick}
                  </Text>
                </Group>
              </UnstyledButton>
            </div>
          ))
        )}
      </SideCard>
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
