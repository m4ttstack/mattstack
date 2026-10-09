import { Fragment, useState, type ReactNode } from 'react';
import { Group, NavLink, Stack, Text } from '@mattstack/app-kit/core';

import { formatDuration } from '../derive/duration';
import type { DecisionStage } from '../derive/record';
import { DecisionCard } from './DecisionCard';
import classes from './DecisionsTab.module.css';
import { Dot } from './Dot';

const anchorOf = (stage: string | null) =>
  `decisions-stage-${stage ?? 'other'}`;

const stageName = (stage: string | null) => stage ?? 'other';

function stageMeta(group: DecisionStage): string {
  const n = group.answered;
  const count = `${n} ${n === 1 ? 'decision' : 'decisions'}`;
  return group.durationMs == null
    ? count
    : `${count} · ${formatDuration(group.durationMs)}`;
}

function StageIndex({ groups }: { groups: DecisionStage[] }) {
  const [active, setActive] = useState(groups[0]?.stage ?? null);
  const go = (stage: string | null) => {
    setActive(stage);
    document
      .getElementById(anchorOf(stage))
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const anyOverrode = groups.some(g => g.overrode);
  return (
    <nav className={classes.index} aria-label="Decisions by stage">
      <Text
        fz={10.5}
        fw={500}
        lh="normal"
        tt="uppercase"
        lts={0.8}
        c="dimmed"
        data-parity="title"
      >
        By stage
      </Text>
      {groups.map(g => {
        const on = g.stage === active;
        return (
          <NavLink
            key={stageName(g.stage)}
            component="button"
            active={on}
            onClick={() => go(g.stage)}
            label={<span data-parity="name">{stageName(g.stage)}</span>}
            rightSection={
              <Group gap={6} wrap="nowrap">
                {g.overrode ? (
                  <Dot
                    tone="warn"
                    aria-label="an answer went against the recommendation"
                    data-parity="overrode"
                  />
                ) : null}
                <Text fz={12} lh="normal" c="dimmed" data-parity="count">
                  {g.answered}
                </Text>
              </Group>
            }
            data-parity={on ? `Index ${stageName(g.stage)}` : undefined}
          />
        );
      })}
      {anyOverrode ? (
        <Group gap={6} wrap="nowrap" className={classes.legend}>
          <Dot tone="warn" data-parity="d" />
          <Text fz={11.5} lh="normal" c="dimmed" data-parity="label">
            you overrode the pick
          </Text>
        </Group>
      ) : null}
    </nav>
  );
}

export interface DecisionsTabProps {
  groups: DecisionStage[];
  /** Work runs group the log by stage and add the stage index. */
  byStage: boolean;
  /** The evidence column, on a work run with evidence. */
  evidence: ReactNode;
}

/** The record's decision log: a stage index, one card per gate in stage
    order, and the evidence beside them. */
export function DecisionsTab({ groups, byStage, evidence }: DecisionsTabProps) {
  const empty = groups.every(g => g.gates.length === 0);
  return (
    <div className={classes.columns} data-parity="Columns">
      {byStage && !empty ? <StageIndex groups={groups} /> : null}
      <Stack gap={12} className={classes.log} data-testid="decision-log">
        {empty ? (
          <Text fz={13} lh="normal" c="dimmed">
            No decisions on this run.
          </Text>
        ) : (
          groups.map(g => (
            <Fragment key={stageName(g.stage)}>
              {byStage ? (
                <Group
                  gap={8}
                  wrap="nowrap"
                  id={anchorOf(g.stage)}
                  className={classes.stageHead}
                  data-stage-group={stageName(g.stage)}
                >
                  <Text fz={14} fw={700} lh="normal" data-parity="name">
                    {stageName(g.stage)}
                  </Text>
                  <Text fz={12} lh="normal" c="dimmed" data-parity="meta">
                    {stageMeta(g)}
                  </Text>
                </Group>
              ) : null}
              {g.gates.map(gate => (
                <DecisionCard key={gate.id} gate={gate} />
              ))}
            </Fragment>
          ))
        )}
      </Stack>
      {evidence ? <div className={classes.rail}>{evidence}</div> : null}
    </div>
  );
}
