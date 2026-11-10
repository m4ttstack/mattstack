import type { ReactNode } from 'react';
import {
  Accordion,
  Badge,
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
import { readEvidence } from '@mattstack/rt-client/evidence';

import { formatDuration } from '../derive/duration';
import { fieldLabel } from '../derive/fields';
import type { StageAttempt } from '../derive/stages';
import { stageSummary, type StoryEntry } from '../derive/story';
import { FailureExcerpt } from '../FailureExcerpt';
import { EvidenceCard } from './EvidenceCard';
import { FieldStrip, isStripField } from './FieldStrip';
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

const VALUE_TYPE = { fz: 'md' as const, lh: '1.5' };

/** One labelled line of an opened stage: the label in a fixed column, the
    value beside it. */
function StageField({
  label,
  lead = null,
  children,
}: {
  label: string;
  /** Beside the label: the verdict that sums the field up. */
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack gap={6} className={classes.field} data-row={label}>
      <Group gap={10} wrap="nowrap" align="center">
        <Text fz="sm" fw={500} lh="normal" c="dimmed" data-parity="k">
          {label}
        </Text>
        {lead}
      </Group>
      <div className={classes.value}>{children}</div>
    </Stack>
  );
}

/** How a redirected attempt ended, after the gate that sent it back:
    "back to implement: <note>" as a quiet outcome line and its note. */
function RedirectOutcome({ text }: { text: string }) {
  const split = text.indexOf(': ');
  const head = split < 0 ? text : text.slice(0, split);
  const note = split < 0 ? '' : text.slice(split + 2);
  const label = (
    <Group gap={6} wrap="nowrap" c="dimmed">
      <Icon name="cornerUpLeft" size={13} />
      <Text fz="sm" fw={500} lh="normal">
        {head.charAt(0).toUpperCase() + head.slice(1)}
      </Text>
    </Group>
  );
  if (!note)
    return (
      <div className={classes.outcome} data-row="Redirected">
        {label}
      </div>
    );
  return (
    <Accordion
      chevronPosition="left"
      chevron={<Accordion.Chevron size={12} />}
      classNames={{
        root: classes.outcome,
        item: classes.outcomeItem,
        control: classes.outcomeControl,
        label: classes.outcomeLabel,
        content: classes.outcomeNote,
      }}
      data-row="Redirected"
    >
      <Accordion.Item value="note">
        <Accordion.Control>{label}</Accordion.Control>
        <Accordion.Panel>
          <Text fz="sm" lh="normal" c="dimmed">
            {note}
          </Text>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

/** The review skill's own verdict phrase, "Ready to merge: yes | no | with
    fixes", read from the review field's text. */
const VERDICT = /ready to merge:\s*(yes|no|with fixes)/i;

const VERDICTS = {
  yes: { label: 'Ready to merge', color: 'ok', icon: 'checkCircle' },
  'with fixes': { label: 'Ready with fixes', color: 'warn', icon: 'warning' },
  no: { label: 'Not ready to merge', color: 'bad', icon: 'circleX' },
} as const;

function ReviewVerdict({ text }: { text: string }) {
  const match = VERDICT.exec(text);
  if (!match) return null;
  const verdict = VERDICTS[match[1]!.toLowerCase() as keyof typeof VERDICTS];
  return (
    <Badge
      size="md"
      variant="light"
      color={verdict.color}
      tt="none"
      leftSection={<Icon name={verdict.icon} size={12} />}
      className={classes.verdict}
      data-verdict={match[1]!.toLowerCase()}
    >
      {verdict.label}
    </Badge>
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
  const evidence = entry.evidence ? readEvidence(evidenceField?.value) : null;
  const summary = stageSummary(entry, evidence);
  return (
    <NavLink
      component="button"
      active={active}
      onClick={onPick}
      leftSection={<Bullet entry={entry} size={16} />}
      label={
        <Group gap={8} wrap="nowrap">
          <Text span fz="md" fw={500} truncate data-parity="name">
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
      classNames={{
        root: classes.nav,
        section: classes.navBullet,
        description: classes.navSummary,
      }}
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
  const evidence = entry.evidence ? readEvidence(evidenceField?.value) : null;
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
          <Text fz="h3" fw={600} lh="normal" data-parity="name">
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
      ) : null}
      <FieldStrip fields={entry.fields.filter(isStripField)} />
      {entry.fields
        .filter(f => !isStripField(f))
        .map(f => (
          <StageField
            key={f.key}
            label={fieldLabel(f.key)}
            lead={f.key === 'review' ? <ReviewVerdict text={f.value} /> : null}
          >
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
      {entry.holds.map(h => (
        <StageField key={h.from} label="Held">
          <Text {...VALUE_TYPE} data-parity="v">
            {h.to != null ? `held ${formatDuration(h.to - h.from)}` : 'held'}
            {h.reason ? ` · ${h.reason}` : ''}
          </Text>
        </StageField>
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
      {entry.gates.map((g, i) => (
        <GateRecordView
          key={g.id}
          gate={g}
          number={i + 1}
          linked={g.id === linkedGateId}
        />
      ))}
      {entry.redirect ? <RedirectOutcome text={entry.redirect} /> : null}
    </Stack>
  );
}
