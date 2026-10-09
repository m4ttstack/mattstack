import { Fragment, type ReactNode } from 'react';
import { Group, Stack, Text, ThemeIcon } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { formatDuration } from '../derive/duration';
import type { DecisionStage } from '../derive/record';
import { DecisionCard } from './DecisionCard';
import classes from './DecisionsTab.module.css';
import { STAGE_BULLET } from './StageRow';

const stageName = (stage: string | null) => stage ?? 'other';

const counted = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "3 decisions · 12m · 1 override", each part only when there is one. */
function stageMeta(group: DecisionStage): string {
  const parts: string[] = [];
  if (group.answered > 0)
    parts.push(counted(group.answered, 'decision', 'decisions'));
  if (group.durationMs != null) parts.push(formatDuration(group.durationMs));
  if (group.overrides > 0)
    parts.push(counted(group.overrides, 'override', 'overrides'));
  return parts.join(' · ');
}

/** A stage's place on the log's rule: its name, what was decided there, and
    a bullet in its status's tone. The head paints nothing, so the boards key
    its layers straight under the log. */
function StageHead({ group }: { group: DecisionStage }) {
  const name = stageName(group.stage);
  const bullet = group.status ? STAGE_BULLET[group.status] : null;
  const meta = stageMeta(group);
  return (
    <Group
      gap={10}
      wrap="nowrap"
      className={classes.stageHead}
      data-stage-group={name}
    >
      {bullet ? (
        <span className={classes.bullet}>
          <ThemeIcon
            radius="xl"
            size={18}
            color={bullet.color}
            aria-label={group.status ?? undefined}
            data-parity="bullet"
          >
            <Icon name={bullet.icon} size={10} data-parity="c" />
          </ThemeIcon>
        </span>
      ) : null}
      <Text fz={15} fw={700} lh="normal" data-parity="name">
        {name}
      </Text>
      {meta ? (
        <Text fz={12.5} lh="normal" c="dimmed" data-parity="meta">
          {meta}
        </Text>
      ) : null}
    </Group>
  );
}

export interface DecisionsTabProps {
  groups: DecisionStage[];
  /** Work runs head each stage's gates on the log's rule. */
  byStage: boolean;
  /** The evidence column, on a work run with evidence. */
  evidence: ReactNode;
}

/** The record's decision log: each stage heading its gates along one rule,
    in stage order, with the evidence beside them. */
export function DecisionsTab({ groups, byStage, evidence }: DecisionsTabProps) {
  const empty = groups.every(g => g.gates.length === 0);
  return (
    <div className={classes.columns}>
      <Stack
        gap={12}
        className={classes.log}
        data-timeline={byStage && !empty ? 'true' : undefined}
        data-testid="decision-log"
        data-parity="Decision log"
      >
        {empty ? (
          <Text fz={13} lh="normal" c="dimmed">
            No decisions on this run.
          </Text>
        ) : (
          groups.map(g => (
            <Fragment key={stageName(g.stage)}>
              {byStage ? <StageHead group={g} /> : null}
              {g.gates.map(gate => (
                <DecisionCard key={gate.id} gate={gate} />
              ))}
            </Fragment>
          ))
        )}
      </Stack>
      {evidence ? (
        <div className={classes.rail} data-parity="Evidence rail">
          {evidence}
        </div>
      ) : null}
    </div>
  );
}
