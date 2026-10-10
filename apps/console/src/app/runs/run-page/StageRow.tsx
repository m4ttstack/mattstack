import type { ReactNode } from 'react';
import {
  Group,
  NavLink,
  Stack,
  Text,
  ThemeIcon,
} from '@mattstack/app-kit/core';
import type { MantineColor } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { IconName } from '@mattstack/app-kit/icons';
import type { RunFieldRow } from '@mattstack/rt-client';
import { parseEvidence } from '@mattstack/rt-client/evidence';

import { formatDuration } from '../derive/duration';
import { fieldLabel } from '../derive/fields';
import type { StageAttempt } from '../derive/stages';
import { stageSummary, type StoryEntry } from '../derive/story';
import { FailureExcerpt } from '../FailureExcerpt';
import { EvidenceCard } from './EvidenceCard';
import { FieldValue } from './FieldValue';
import { GateRecordView } from './GateRecord';
import { StageDocLink } from './StageDoc';
import classes from './StageRow.module.css';

export const STAGE_BULLET: Record<
  StageAttempt['status'],
  { color: MantineColor; icon: IconName; layer: string }
> = {
  done: { color: 'ok', icon: 'check', layer: 'check' },
  failed: { color: 'bad', icon: 'close', layer: 'x' },
  redirected: { color: 'warn', icon: 'cornerUpLeft', layer: 'corner-up-left' },
  running: { color: 'accent', icon: 'loader', layer: 'loader' },
};

const VALUE_TYPE = { fz: 'lg', lh: 'normal' };

/** One labelled line of an opened stage: the label in a fixed column, the
    value beside it. */
function StageField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Group
      gap={12}
      wrap="nowrap"
      align="flex-start"
      className={classes.field}
      data-row={label}
    >
      <Text
        fz="md"
        lh="normal"
        c="dimmed"
        className={classes.key}
        data-parity="k"
      >
        {label}
      </Text>
      <div className={classes.value}>{children}</div>
    </Group>
  );
}

export interface StagePaneProps {
  entry: StoryEntry;
  repo: string;
  runId: string;
  evidenceField: RunFieldRow | null;
  pathHref?: (path: string) => string | null;
  /** The gate a deep link names: its decision rings. */
  linkedGateId?: string | null;
  /** The run's ticket, which heads the evidence's full-size view. */
  ticket?: string | null;
  /** Draw the stage's name over it: only when no list beside it names it. */
  heading?: boolean;
}

function Bullet({ entry, size = 18 }: { entry: StoryEntry; size?: number }) {
  const bullet = STAGE_BULLET[entry.attempt.status];
  return (
    <ThemeIcon
      radius="xl"
      size={size}
      color={bullet.color}
      aria-label={entry.attempt.status}
      className={classes.keep}
      data-parity="bullet"
    >
      <Icon name={bullet.icon} size={size - 7} data-parity={bullet.layer} />
    </ThemeIcon>
  );
}

/** One stage attempt in the story's list: its bullet, name, time and a
    one-line summary. Picking it shows the attempt in the pane. */
export function StageNavItem({
  entry,
  evidenceField,
  active,
  onPick,
}: {
  entry: StoryEntry;
  evidenceField: RunFieldRow | null;
  active: boolean;
  onPick: () => void;
}) {
  const evidence = entry.evidence ? parseEvidence(evidenceField?.value) : null;
  const summary = stageSummary(entry, evidence);
  return (
    <NavLink
      component="button"
      active={active}
      onClick={onPick}
      leftSection={<Bullet entry={entry} size={16} />}
      label={
        <Group gap={8} wrap="nowrap" justify="space-between">
          <Text
            span
            fz="md"
            fw={active ? 600 : 500}
            truncate
            data-parity="name"
          >
            {entry.label}
          </Text>
          {entry.durationMs != null ? (
            <Text
              span
              fz="sm"
              c="dimmed"
              className={classes.keep}
              data-parity="duration"
            >
              {formatDuration(entry.durationMs)}
            </Text>
          ) : null}
        </Group>
      }
      description={summary || undefined}
      classNames={{ root: classes.nav, description: classes.navSummary }}
      data-stage={entry.attempt.stage}
      data-attempt={entry.attempt.attempt}
      aria-current={active ? 'step' : undefined}
    />
  );
}

/** One stage attempt in full: its name and time over its stage doc, fields,
    decisions and evidence. */
export function StagePane({
  entry,
  repo,
  runId,
  evidenceField,
  pathHref,
  linkedGateId = null,
  ticket = null,
  heading = false,
}: StagePaneProps) {
  const evidence = entry.evidence ? parseEvidence(evidenceField?.value) : null;
  return (
    <Stack
      gap={14}
      className={classes.pane}
      data-stage={entry.attempt.stage}
      data-attempt={entry.attempt.attempt}
      data-parity={`Stage ${entry.attempt.stage}`}
    >
      {heading ? (
        <Group gap={10} wrap="nowrap">
          <Bullet entry={entry} />
          <Text fz="xl" fw={600} lh="normal" data-parity="name">
            {entry.label}
          </Text>
          {entry.durationMs != null ? (
            <Text fz="md" c="dimmed">
              {formatDuration(entry.durationMs)}
            </Text>
          ) : null}
          <div className={classes.summary} />
          <StageDocLink stage={entry.attempt.stage} className={classes.doc} />
        </Group>
      ) : (
        <Group justify="flex-end">
          <StageDocLink stage={entry.attempt.stage} className={classes.doc} />
        </Group>
      )}
      {entry.fields.map(f => (
        <StageField key={f.key} label={fieldLabel(f.key)}>
          <FieldValue
            fieldKey={f.key}
            value={f.value}
            pathHref={pathHref}
            type={VALUE_TYPE}
            data-parity="v"
          />
        </StageField>
      ))}
      {entry.failure ? (
        <>
          <StageField label="Failed">
            <Text {...VALUE_TYPE} data-parity="v">
              {entry.failure.reason ?? 'No reason recorded'}
            </Text>
          </StageField>
          {entry.failure.detailPath ? (
            <StageField label="Log">
              <FailureExcerpt
                repo={repo}
                runId={runId}
                detailPath={entry.failure.detailPath}
              />
            </StageField>
          ) : null}
        </>
      ) : null}
      {entry.redirect ? (
        <StageField label="Redirected">
          <Text {...VALUE_TYPE} data-parity="v">
            {entry.redirect}
          </Text>
        </StageField>
      ) : null}
      {entry.holds.map(h => (
        <StageField key={h.from} label="Held">
          <Text {...VALUE_TYPE} data-parity="v">
            {h.to != null ? `held ${formatDuration(h.to - h.from)}` : 'held'}
            {h.reason ? ` · ${h.reason}` : ''}
          </Text>
        </StageField>
      ))}
      {entry.gates.map(g => (
        <GateRecordView key={g.id} gate={g} linked={g.id === linkedGateId} />
      ))}
      {evidence && entry.evidence ? (
        <EvidenceCard
          repo={repo}
          runId={runId}
          evidence={evidence}
          variant="story"
          ticket={ticket}
          phase={entry.evidence === 'legacy' ? undefined : entry.evidence}
          withUrl={entry.evidenceUrl ?? false}
          pathHref={pathHref}
        />
      ) : null}
    </Stack>
  );
}
