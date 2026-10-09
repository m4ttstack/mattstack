import { useState, type ReactNode } from 'react';
import {
  Anchor,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import type { ParsedEvidence } from '@mattstack/rt-client';

import classes from './EvidenceCard.module.css';
import { openEvidenceCompare } from './EvidenceCompare';
import { EvidenceImage } from './EvidenceImage';
import {
  evidenceUrl,
  PHASE_LABEL,
  phasesIn,
  shotFor,
  shotsOf,
  VARIANT_LABEL,
  variantsIn,
  type EvidencePhase,
  type EvidenceV1Parsed,
  type EvidenceVariant,
} from './evidenceImages';
import inline from './inline.module.css';
import { TranscriptBlock } from './TranscriptBlock';

export interface EvidenceCardProps {
  /** The run's repo in the wire form the run page carries. */
  repo: string;
  runId: string;
  evidence: ParsedEvidence;
  /** `story` is the live story's viewer, `record` the record view's column. */
  variant: 'story' | 'record';
  /** The run's own MR iid, for "attached to !<iid>"; null when it has none. */
  mrIid?: string | null;
  /** Story only: show just this phase, with no Before/After control. */
  phase?: EvidencePhase;
  /** Where a legacy file path opens, or null to show it as text. */
  pathHref?: (path: string) => string | null;
}

/** The story's screenshot height: tall enough to read the change, short
    enough that the story keeps moving; the full size is a click away. */
const SHOT_HEIGHT = 242;

function Label({ children, ...rest }: { children: ReactNode }) {
  return (
    <Text
      fz={10.5}
      fw={500}
      lh="normal"
      tt="uppercase"
      c="dimmed"
      lts={0.8}
      {...rest}
    >
      {children}
    </Text>
  );
}

/** Version 0 evidence is whatever text the agent wrote: a web link is
    something to follow, a file path is something to open in the editor when
    the page knows how. */
function LegacyLinks({
  links,
  pathHref,
  parity,
}: {
  links: string[];
  pathHref?: (path: string) => string | null;
  parity?: string;
}) {
  const hrefOf = (link: string) =>
    /^https?:\/\//i.test(link) ? link : (pathHref?.(link) ?? null);
  const allLinks = links.every(link => hrefOf(link) !== null);
  return (
    <Stack
      gap={0}
      c={allLinks ? 'accent' : undefined}
      data-evidence="legacy"
      data-parity={parity}
    >
      {links.map(link => {
        const href = hrefOf(link);
        return href ? (
          <Anchor
            key={link}
            fz={12.5}
            lh="18px"
            c="accent"
            href={href}
            target={href === link ? '_blank' : undefined}
            rel={href === link ? 'noopener noreferrer' : undefined}
            className={classes.link}
          >
            {link}
          </Anchor>
        ) : (
          <Text
            key={link}
            fz={12.5}
            lh="18px"
            ff="monospace"
            className={classes.link}
          >
            {link}
          </Text>
        );
      })}
    </Stack>
  );
}

function StoryCard({
  repo,
  runId,
  evidence,
  phase: only,
}: {
  repo: string;
  runId: string;
  evidence: EvidenceV1Parsed;
  phase?: EvidencePhase;
}) {
  const shots = shotsOf(evidence);
  const phases = only
    ? phasesIn(shots).filter(p => p === only)
    : phasesIn(shots);
  const [chosen, setChosen] = useState<EvidencePhase | null>(null);
  const [wanted, setWanted] = useState<EvidenceVariant>('annotated');

  const phase = chosen && phases.includes(chosen) ? chosen : phases[0];
  if (!phase) return null;
  const shot = shotFor(shots[phase], wanted);
  if (!shot) return null;
  const variants = variantsIn(shots[phase]);
  const shownVariant: EvidenceVariant =
    shots[phase].annotated === shot ? 'annotated' : 'plain';
  const src = evidenceUrl(repo, runId, shot.key);

  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.storyCard}
      data-parity="Evidence card"
    >
      <Stack gap={10}>
        <Group justify="space-between" wrap="nowrap">
          <Label data-parity="EVIDENCE">EVIDENCE</Label>
          <Group gap="xs" wrap="nowrap">
            {phases.length > 1 && (
              <SegmentedControl
                size="xs"
                aria-label="Before or after"
                className={inline.control}
                value={phase}
                onChange={v => setChosen(v as EvidencePhase)}
                data={phases.map(p => ({ value: p, label: PHASE_LABEL[p] }))}
              />
            )}
            {variants.length > 1 && (
              <SegmentedControl
                size="xs"
                aria-label="Plain or annotated"
                className={inline.control}
                data-parity="toggle"
                value={shownVariant}
                onChange={v => setWanted(v as EvidenceVariant)}
                data={variants.map(v => ({
                  value: v,
                  label: VARIANT_LABEL[v],
                }))}
              />
            )}
          </Group>
        </Group>
        <div className={classes.frame} data-parity="shot">
          <EvidenceImage
            src={src}
            name={shot.fileName}
            maxHeight={SHOT_HEIGHT}
            onOpen={() =>
              modals.open({
                title: shot.fileName,
                size: 'xl',
                centered: true,
                children: (
                  <EvidenceImage
                    src={src}
                    name={shot.fileName}
                    maxHeight="75vh"
                  />
                ),
              })
            }
          />
        </div>
        <Text fz={11.5} lh="normal" c="dimmed" data-parity="caption">
          {shot.fileName}
        </Text>
      </Stack>
    </Paper>
  );
}

function RecordColumn({
  repo,
  runId,
  evidence,
  mrIid,
}: {
  repo: string;
  runId: string;
  evidence: EvidenceV1Parsed;
  mrIid?: string | null;
}) {
  const shots = shotsOf(evidence);
  const phases = phasesIn(shots);
  const { transcript, case: caseUsed, attach } = evidence.evidence;

  const hasImages = phases.length > 0;
  const count = evidence.images.length;
  const heading = hasImages ? `EVIDENCE · ${count}` : 'EVIDENCE';

  return (
    <Stack gap={12}>
      {(hasImages || transcript) && (
        <Paper
          variant="ground"
          withBorder
          radius={12}
          className={classes.recordCard}
          data-parity="Evidence"
        >
          <Stack gap={12}>
            <Group justify="space-between" wrap="nowrap">
              <Label data-parity="title">{heading}</Label>
              {attach === 'ship' && mrIid && (
                <Text fz={12} lh="normal" c="dimmed" data-parity="attached">
                  attached to !{mrIid}
                </Text>
              )}
            </Group>
            {hasImages && (
              <>
                <div className={classes.thumbs}>
                  {phases.map(p => {
                    const shot = shotFor(shots[p], 'plain');
                    if (!shot) return null;
                    const shown: EvidenceVariant =
                      shots[p].plain === shot ? 'plain' : 'annotated';
                    return (
                      <Stack key={p} gap={6} className={classes.thumb}>
                        <div className={classes.thumbFrame} data-parity="img">
                          <UnstyledButton
                            className={classes.thumbButton}
                            aria-label={`Open ${shot.fileName} full size`}
                            onClick={() =>
                              openEvidenceCompare({
                                repo,
                                runId,
                                evidence,
                                initialPhase: p,
                                initialVariant: shown,
                              })
                            }
                          >
                            <EvidenceImage
                              src={evidenceUrl(repo, runId, shot.key)}
                              name={shot.fileName}
                              maxHeight={132}
                            />
                          </UnstyledButton>
                        </div>
                        <Group gap={6} wrap="nowrap">
                          <Text
                            fz={12}
                            lh="normal"
                            fw={500}
                            data-parity="phase"
                          >
                            {PHASE_LABEL[p]}
                          </Text>
                          <Text
                            fz={12}
                            lh="normal"
                            c="dimmed"
                            truncate
                            data-parity="name"
                          >
                            {shot.fileName}
                          </Text>
                        </Group>
                      </Stack>
                    );
                  })}
                </div>
                <Button
                  variant="default"
                  fullWidth
                  justify="space-between"
                  leftSection={
                    <Icon name="columns2" size={14} data-parity="columns-2" />
                  }
                  rightSection={
                    <Group gap={6} aria-hidden data-parity="arrows">
                      <Icon name="arrowLeft" size={14} />
                      <Icon name="arrowRight" size={14} />
                    </Group>
                  }
                  classNames={{ label: classes.compareLabel }}
                  data-parity="Compare"
                  onClick={() => openEvidenceCompare({ repo, runId, evidence })}
                >
                  <span data-parity="label">Compare full size</span>
                </Button>
              </>
            )}
            {transcript && <TranscriptBlock repo={repo} runId={runId} />}
          </Stack>
        </Paper>
      )}
      {caseUsed && <CaseCard value={caseUsed} />}
    </Stack>
  );
}

/** The case the evidence was captured on. */
function CaseCard({ value }: { value: string }) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.recordCard}
      data-parity="Case"
    >
      <Stack gap={8}>
        <Label data-parity="title">CASE USED</Label>
        <Text fz={13} lh="normal" fw={500} data-parity="value">
          {value}
        </Text>
      </Stack>
    </Paper>
  );
}

/** Legacy evidence in the record: its links in a card of their own. */
function RecordLinks({
  links,
  pathHref,
}: {
  links: string[];
  pathHref?: (path: string) => string | null;
}) {
  const heading = `EVIDENCE · ${links.length} ${links.length === 1 ? 'LINK' : 'LINKS'}`;
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.recordCard}
      data-parity="Evidence"
    >
      <Stack gap={12}>
        <Label data-parity="title">{heading}</Label>
        <LegacyLinks links={links} pathHref={pathHref} />
      </Stack>
    </Paper>
  );
}

/** A run's evidence: images for version 1, links for the legacy shape, and
    nothing for a run that recorded none. */
export function EvidenceCard({
  repo,
  runId,
  evidence,
  variant,
  mrIid,
  phase,
  pathHref,
}: EvidenceCardProps) {
  if (evidence.version === null) return null;
  if (evidence.version === 0)
    return variant === 'story' ? (
      <LegacyLinks links={evidence.links} pathHref={pathHref} parity="v" />
    ) : (
      <RecordLinks links={evidence.links} pathHref={pathHref} />
    );
  return variant === 'story' ? (
    <StoryCard repo={repo} runId={runId} evidence={evidence} phase={phase} />
  ) : (
    <RecordColumn repo={repo} runId={runId} evidence={evidence} mrIid={mrIid} />
  );
}
