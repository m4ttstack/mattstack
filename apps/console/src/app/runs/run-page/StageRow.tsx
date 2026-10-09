import { useId, type ReactNode } from 'react';
import {
  Group,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
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
import { DecisionRow } from './DecisionRow';
import { EvidenceCard } from './EvidenceCard';
import { FieldValue } from './FieldValue';
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

const VALUE_TYPE = { fz: 13, lh: 'normal' };

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
        fz={12.5}
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

export interface StageRowProps {
  entry: StoryEntry;
  open: boolean;
  onToggle: () => void;
  repo: string;
  runId: string;
  evidenceField: RunFieldRow | null;
  pathHref?: (path: string) => string | null;
  /** The gate a deep link names: its decision opens and rings. */
  linkedGateId?: string | null;
  /** The run's ticket, which heads the evidence's full-size view. */
  ticket?: string | null;
}

/** One stage attempt of the story as a row: what it was and a one-line
    summary while folded; its fields, decisions and evidence once opened. */
export function StageRow({
  entry,
  open,
  onToggle,
  repo,
  runId,
  evidenceField,
  pathHref,
  linkedGateId = null,
  ticket = null,
}: StageRowProps) {
  const bodyId = useId();
  const bullet = STAGE_BULLET[entry.attempt.status];
  const evidence = entry.evidence ? parseEvidence(evidenceField?.value) : null;
  const summary = stageSummary(entry, evidence);

  return (
    <div
      className={classes.row}
      data-stage={entry.attempt.stage}
      data-attempt={entry.attempt.attempt}
      data-open={open ? 'true' : 'false'}
      data-parity={`Stage ${entry.attempt.stage}`}
    >
      <div
        className={classes.head}
        onClick={e => {
          // The stage doc modal portals out of the row but still bubbles here.
          if (e.currentTarget.contains(e.target as Node)) onToggle();
        }}
      >
        <ThemeIcon
          radius="xl"
          size={18}
          color={bullet.color}
          aria-label={entry.attempt.status}
          className={classes.bullet}
          data-parity="bullet"
        >
          <Icon name={bullet.icon} size={11} data-parity={bullet.layer} />
        </ThemeIcon>
        <Text
          fz={14}
          fw={500}
          lh="normal"
          className={classes.keep}
          data-parity="name"
        >
          {entry.label}
        </Text>
        {entry.durationMs != null ? (
          <Text
            fz={12.5}
            lh="normal"
            c="dimmed"
            className={classes.keep}
            data-parity="duration"
          >
            {formatDuration(entry.durationMs)}
          </Text>
        ) : null}
        <Text
          fz={13}
          lh="normal"
          c="dimmed"
          truncate
          className={classes.summary}
          data-parity={summary ? 'summary' : undefined}
        >
          {summary}
        </Text>
        {open ? (
          <StageDocLink stage={entry.attempt.stage} className={classes.keep} />
        ) : null}
        <UnstyledButton
          className={classes.chevron}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          aria-label={`${open ? 'Hide' : 'Show'} ${entry.label}`}
          onClick={e => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <Icon
            name={open ? 'chevronDown' : 'chevronRight'}
            size={15}
            data-parity="chevron"
          />
        </UnstyledButton>
      </div>
      {open ? (
        <Stack gap={10} id={bodyId} className={classes.body}>
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
                {h.to != null
                  ? `held ${formatDuration(h.to - h.from)}`
                  : 'held'}
                {h.reason ? ` · ${h.reason}` : ''}
              </Text>
            </StageField>
          ))}
          {entry.gates.flatMap(g =>
            g.questions.map(q => (
              <DecisionRow
                key={`${g.id}-${q.id}`}
                gate={g}
                question={q}
                linked={g.id === linkedGateId}
              />
            ))
          )}
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
      ) : null}
    </div>
  );
}
