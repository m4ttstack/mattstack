import { Group, Stack, Text, ThemeIcon } from '@mattstack/app-kit/core';
import type { MantineColor } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { IconName } from '@mattstack/app-kit/icons';
import type { RunFieldRow } from '@mattstack/rt-client';
import { parseEvidence } from '@mattstack/rt-client/evidence';

import { formatDuration } from '../derive/duration';
import type { StageAttempt } from '../derive/stages';
import type { StoryEntry } from '../derive/story';
import { FailureExcerpt } from '../FailureExcerpt';
import { DecisionRow } from './DecisionRow';
import { EvidenceCard } from './EvidenceCard';
import { FieldRows, OutputRow } from './OutputRow';
import { StageDocLink } from './StageDoc';
import classes from './StorySection.module.css';

const BULLET: Record<
  StageAttempt['status'],
  { color: MantineColor; icon: IconName }
> = {
  done: { color: 'ok', icon: 'check' },
  failed: { color: 'bad', icon: 'close' },
  redirected: { color: 'warn', icon: 'cornerUpLeft' },
  running: { color: 'accent', icon: 'loader' },
};

const VALUE_TYPE = { fz: 12.5, lh: '18px' } as const;

export interface StorySectionProps {
  repo: string;
  runId: string;
  entry: StoryEntry;
  evidenceField: RunFieldRow | null;
  pathHref?: (path: string) => string | null;
  /** A one-stage run's block draws no line down to a next section. */
  last?: boolean;
}

/** One stage attempt of the story: what it is, what it wrote, what was
    decided there, and how it ended. */
export function StorySection({
  repo,
  runId,
  entry,
  evidenceField,
  pathHref,
  last = false,
}: StorySectionProps) {
  const bullet = BULLET[entry.attempt.status];
  const evidence = entry.evidence ? parseEvidence(evidenceField?.value) : null;
  const rows =
    entry.fields.length > 0 ||
    entry.failure !== null ||
    entry.redirect !== null ||
    entry.holds.length > 0 ||
    entry.evidence === 'legacy';

  return (
    <div
      className={classes.section}
      data-stage={entry.attempt.stage}
      data-attempt={entry.attempt.attempt}
    >
      <div className={classes.gutter}>
        <ThemeIcon
          radius="xl"
          size={22}
          color={bullet.color}
          aria-label={entry.attempt.status}
          data-parity="bullet"
        >
          <Icon name={bullet.icon} size={12} data-parity="icon" />
        </ThemeIcon>
        {last ? null : <div className={classes.line} data-parity="line" />}
      </div>
      <Stack gap={10} className={classes.body}>
        <Group gap={8} wrap="nowrap" className={classes.head}>
          <Text fz={14} fw={700} lh="normal" data-parity="name">
            {entry.label}
          </Text>
          {entry.durationMs != null ? (
            <Text fz={12} lh="normal" c="dimmed" data-parity="duration">
              {formatDuration(entry.durationMs)}
            </Text>
          ) : null}
          <span className={classes.spacer} />
          <StageDocLink repo={repo} runId={runId} stage={entry.attempt.stage} />
        </Group>
        {rows ? (
          <Stack gap={6} className={classes.outputs}>
            <FieldRows fields={entry.fields} pathHref={pathHref} />
            {entry.failure ? (
              <>
                <OutputRow label="Failed">
                  <Text {...VALUE_TYPE} data-parity="v">
                    {entry.failure.reason ?? 'No reason recorded'}
                  </Text>
                </OutputRow>
                {entry.failure.detailPath ? (
                  <OutputRow label="Log">
                    <FailureExcerpt
                      repo={repo}
                      runId={runId}
                      detailPath={entry.failure.detailPath}
                    />
                  </OutputRow>
                ) : null}
              </>
            ) : null}
            {entry.redirect ? (
              <OutputRow label="Redirected">
                <Text {...VALUE_TYPE} data-parity="v">
                  {entry.redirect}
                </Text>
              </OutputRow>
            ) : null}
            {entry.holds.map(h => (
              <OutputRow key={h.from} label="Held">
                <Text {...VALUE_TYPE} data-parity="v">
                  {h.to != null
                    ? `held ${formatDuration(h.to - h.from)}`
                    : 'held'}
                  {h.reason ? ` · ${h.reason}` : ''}
                </Text>
              </OutputRow>
            ))}
            {entry.evidence === 'legacy' && evidence ? (
              <OutputRow label="Evidence">
                <EvidenceCard
                  repo={repo}
                  runId={runId}
                  evidence={evidence}
                  variant="story"
                  pathHref={pathHref}
                />
              </OutputRow>
            ) : null}
          </Stack>
        ) : null}
        {entry.gates.flatMap(g =>
          g.questions.map(q => (
            <DecisionRow key={`${g.id}-${q.id}`} gate={g} question={q} />
          ))
        )}
        {evidence && entry.evidence !== 'legacy' && entry.evidence ? (
          <EvidenceCard
            repo={repo}
            runId={runId}
            evidence={evidence}
            variant="story"
            phase={entry.evidence}
          />
        ) : null}
      </Stack>
    </div>
  );
}
