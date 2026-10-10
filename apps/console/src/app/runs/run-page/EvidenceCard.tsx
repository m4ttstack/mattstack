import { Fragment, useState, type ReactNode } from 'react';
import {
  Anchor,
  Badge,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import {
  legacyItems,
  type EvidenceCase,
  type EvidenceRecord,
  type LegacyItem,
} from '@mattstack/rt-client/evidence';

import { Eyebrow } from '../Eyebrow';
import classes from './EvidenceCard.module.css';
import {
  EvidenceCompare,
  EvidenceFrame,
  EvidenceModal,
  type CompareOpen,
} from './EvidenceCompare';
import { EvidenceImage } from './EvidenceImage';
import {
  addressOf,
  badgesOf,
  evidenceTitle,
  evidenceUrl,
  fileNameOf,
  headLabel,
  legacyImageUrl,
  PHASE_LABEL,
  shotIn,
  shotLine,
  shownName,
  slotsOf,
  urlLabel,
  type EvidenceCases,
  type EvidencePhase,
} from './evidenceImages';
import { TranscriptBlock } from './TranscriptBlock';

export interface EvidenceCardProps {
  /** The run's repo in the wire form the run page carries. */
  repo: string;
  runId: string;
  evidence: EvidenceRecord;
  /** `story` is the live story's stage row, `record` the record view's column. */
  variant: 'story' | 'record';
  /** The run's ticket, which heads the full-size view. */
  ticket?: string | null;
  /** The run's own MR iid, for "attached to !<iid>"; null when it has none. */
  mrIid?: string | null;
  /** Story only: the phase this stage captured. */
  phase?: EvidencePhase;
  /** Where a legacy file path opens, or null to show it as text. */
  pathHref?: (path: string) => string | null;
  /** Story only: this row shows the evidence's url. */
  withUrl?: boolean;
  /** Record only: the page owns the compare modal (it follows `?compare=`),
      so the card hands it each request. */
  onCompare?: (open: CompareOpen) => void;
}

/** A thumbnail's frame: a screenshot's proportions at the width of the
    column it sits in. */
function ThumbFrame({ children }: { children: ReactNode }) {
  return (
    <Paper
      variant="panel-outline"
      radius="lg"
      className={classes.frame}
      data-parity="img"
    >
      {children}
    </Paper>
  );
}

/** One screenshot, the size of the column it sits in, its file name under it. */
function Thumb({
  src,
  name,
  size,
  line,
  onOpen,
}: {
  src: string;
  name: string;
  size: 'story' | 'record';
  line?: { kind: 'caption' | 'waiver'; text: string } | null;
  onOpen: () => void;
}) {
  return (
    <Stack
      gap={6}
      className={size === 'story' ? classes.storyThumb : classes.thumb}
    >
      <ThumbFrame>
        <EvidenceImage src={src} name={name} cover onOpen={onOpen} />
      </ThumbFrame>
      <Text
        fz="sm"
        lh="normal"
        ff="monospace"
        c="dimmed"
        truncate
        data-parity="cap"
      >
        {name}
      </Text>
      {line ? (
        <Text
          fz="sm"
          lh="normal"
          c={line.kind === 'waiver' ? 'dimmed' : undefined}
          data-parity={line.kind}
        >
          {line.text}
        </Text>
      ) : null}
    </Stack>
  );
}

/** A web link, opened in a new tab and read without its scheme. */
function UrlLink({ url }: { url: string }) {
  return (
    <Anchor
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      fz="md"
      lh="normal"
      c="accent"
      className={classes.link}
      data-parity="link"
    >
      <Icon name="externalLink" size={13} data-parity="i" />
      <span data-parity="t">{urlLabel(url)}</span>
    </Anchor>
  );
}

/** A file the evidence names that is not an image: opened in the editor when
    the page knows how, else shown as its path. */
function FileLink({
  path,
  pathHref,
}: {
  path: string;
  pathHref?: (path: string) => string | null;
}) {
  const href = pathHref?.(path) ?? null;
  return href ? (
    <Anchor
      href={href}
      fz="md"
      lh="normal"
      c="accent"
      ff="monospace"
      className={classes.path}
    >
      {path}
    </Anchor>
  ) : (
    <Text fz="md" lh="normal" ff="monospace" className={classes.path}>
      {path}
    </Text>
  );
}

/** Version 0 evidence is whatever text the agent wrote: its screenshots show
    as images, a web link is something to follow, any other file something to
    open in the editor. */
function LegacyEvidence({
  repo,
  runId,
  links,
  size,
  ticket,
  pathHref,
}: {
  repo: string;
  runId: string;
  links: string[];
  size: 'story' | 'record';
  ticket?: string | null;
  pathHref?: (path: string) => string | null;
}) {
  const [full, setFull] = useState<{ src: string; name: string } | null>(null);
  const items = legacyItems(links);
  const images = items.filter(i => i.kind === 'image');
  const rest = items.filter(i => i.kind !== 'image');
  const linkOf = (item: LegacyItem) =>
    item.kind === 'url' ? (
      <UrlLink key={item.value} url={item.value} />
    ) : (
      <FileLink key={item.value} path={item.value} pathHref={pathHref} />
    );
  return (
    <Stack gap={12}>
      {images.length > 0 && (
        <div className={size === 'story' ? classes.strip : classes.thumbs}>
          {images.map(i => {
            const src = legacyImageUrl(repo, runId, i.value);
            const name = fileNameOf(i.value);
            return (
              <Thumb
                key={i.value}
                src={src}
                name={name}
                size={size}
                onOpen={() => setFull({ src, name })}
              />
            );
          })}
        </div>
      )}
      {rest.length > 0 && <Stack gap={4}>{rest.map(linkOf)}</Stack>}
      {full && (
        <EvidenceModal
          title={evidenceTitle(ticket, full.name)}
          onClose={() => setFull(null)}
        >
          <EvidenceFrame src={full.src} name={full.name} />
        </EvidenceModal>
      )}
    </Stack>
  );
}

/** One case in a several-case story row: its annotated shot (or the waived
    base), then its label, badges and line. */
function CaseThumb({
  repo,
  runId,
  c,
  phase,
  onCompare,
}: {
  repo: string;
  runId: string;
  c: EvidenceCase;
  phase: EvidencePhase;
  onCompare: (open: CompareOpen) => void;
}) {
  const shot = shotIn(c, phase, 'light');
  if (!shot) return null;
  const line = shotLine(c, shot);
  return (
    <Stack gap={4} className={classes.storyThumb} data-parity="case">
      <ThumbFrame>
        <EvidenceImage
          src={evidenceUrl(repo, runId, addressOf(c, phase, shot))}
          name={shownName(shot)}
          cover
          onOpen={() =>
            onCompare({
              caseId: c.id,
              mode: phase,
              theme: shot.theme,
              variant: 'annotated',
            })
          }
        />
      </ThumbFrame>
      <Group gap={6} wrap="nowrap" data-parity="label line">
        <Text fz="sm" lh="normal" fw={500} truncate data-parity="label">
          {c.label}
        </Text>
        <CaseBadges c={c} phase={phase} />
      </Group>
      {line ? (
        <Text
          fz="sm"
          lh="normal"
          c={line.kind === 'waiver' ? 'dimmed' : undefined}
          data-parity={line.kind}
        >
          {line.kind === 'waiver' && line.text === 'Waived' && c.waiver
            ? `Waived: ${c.waiver}`
            : line.text}
        </Text>
      ) : null}
    </Stack>
  );
}

/** The story's evidence: one case's shots as they are, or one shot per case
    for several, the page they were taken on, and the way to see them full
    size. */
function StoryEvidence({
  repo,
  runId,
  rec,
  phase: only,
  withUrl,
  onCompare,
}: {
  repo: string;
  runId: string;
  rec: EvidenceCases;
  phase?: EvidencePhase;
  withUrl: boolean;
  onCompare: (open: CompareOpen) => void;
}) {
  const phase =
    only ??
    (['before', 'after'] as const).find(p =>
      rec.cases.some(c => (c[p]?.length ?? 0) > 0)
    );
  if (!phase) return null;
  const inPhase = rec.cases.filter(c => (c[phase]?.length ?? 0) > 0);
  if (inPhase.length === 0) return null;
  const url = withUrl ? rec.url : undefined;
  const one = rec.cases.length === 1 ? inPhase[0]! : null;
  const shot = one ? shotIn(one, phase, 'light') : null;
  return (
    <Stack gap={12}>
      <div className={classes.strip} data-parity="strip">
        {one && shot
          ? (['plain', 'annotated'] as const)
              .filter(v => v === 'plain' || shot.annotated)
              .map(variant => (
                <Thumb
                  key={variant}
                  src={evidenceUrl(
                    repo,
                    runId,
                    addressOf(one, phase, shot, variant)
                  )}
                  name={shownName(shot, variant)}
                  size="story"
                  line={
                    variant === 'annotated' || !shot.annotated
                      ? shotLine(one, shot)
                      : null
                  }
                  onOpen={() =>
                    onCompare({
                      caseId: one.id,
                      mode: phase,
                      theme: shot.theme,
                      variant,
                    })
                  }
                />
              ))
          : inPhase.map(c => (
              <CaseThumb
                key={c.id}
                repo={repo}
                runId={runId}
                c={c}
                phase={phase}
                onCompare={onCompare}
              />
            ))}
      </div>
      <Group gap={16} wrap="wrap" className={classes.links} data-parity="links">
        {url ? <UrlLink url={url} /> : null}
        <Anchor
          component="button"
          type="button"
          fz="md"
          lh="normal"
          c="accent"
          onClick={() => onCompare({ mode: phase })}
          data-parity="open"
        >
          Open full size →
        </Anchor>
      </Group>
    </Stack>
  );
}

/** One image of a case in the record: its thumbnail, the phase (and theme
    when the slot has one), then its caption or waiver. */
function CaseShot({
  repo,
  runId,
  c,
  phase,
  onCompare,
}: {
  repo: string;
  runId: string;
  c: EvidenceCase;
  phase: EvidencePhase;
  onCompare: (open: CompareOpen) => void;
}) {
  const shot = shotIn(c, phase, 'light');
  if (!shot)
    return (
      <div className={classes.noBefore} data-parity={`no ${phase}`}>
        <Text fz="sm" lh="normal" c="dimmed" data-parity="t">
          {`No ${phase} image`}
        </Text>
      </div>
    );
  const name = shownName(shot);
  const line = shotLine(c, shot);
  return (
    <Stack
      gap={6}
      className={classes.thumb}
      data-parity={`shot ${PHASE_LABEL[phase]}`}
    >
      <ThumbFrame>
        <EvidenceImage
          src={evidenceUrl(repo, runId, addressOf(c, phase, shot))}
          name={name}
          cover
          onOpen={() =>
            onCompare({
              caseId: c.id,
              mode: phase,
              theme: shot.theme,
              variant: 'annotated',
            })
          }
        />
      </ThumbFrame>
      <Stack gap={2} data-parity="cap">
        {shot.theme ? (
          <Group gap={6} wrap="nowrap" data-parity="phase row">
            <Text fz="sm" lh="normal" fw={500} data-parity="phase">
              {PHASE_LABEL[phase]}
            </Text>
            <Text fz="sm" lh="normal" c="dimmed" data-parity="theme">
              {shot.theme}
            </Text>
          </Group>
        ) : (
          <Text fz="sm" lh="normal" fw={500} data-parity="phase">
            {PHASE_LABEL[phase]}
          </Text>
        )}
        {line ? (
          <Text
            fz="sm"
            lh="normal"
            c={line.kind === 'waiver' ? 'dimmed' : undefined}
            data-parity={line.kind}
          >
            {line.text}
          </Text>
        ) : null}
      </Stack>
    </Stack>
  );
}

/** The quiet gray badges after a case's label. */
function CaseBadges({ c, phase }: { c: EvidenceCase; phase?: EvidencePhase }) {
  return badgesOf(c, phase).map(b => (
    <Badge
      key={b}
      variant="light"
      color="gray"
      size="sm"
      data-parity={`badge ${b}`}
    >
      {b}
    </Badge>
  ));
}

/** One case in the record: its head, the case's own waiver, and Before and
    After side by side (an empty column keeps After on the right). */
function CaseGroup({
  repo,
  runId,
  rec,
  c,
  onCompare,
}: {
  repo: string;
  runId: string;
  rec: EvidenceCases;
  c: EvidenceCase;
  onCompare: (open: CompareOpen) => void;
}) {
  const label = headLabel(rec, c);
  const phases = slotsOf(c);
  return (
    <Stack gap={10} className={classes.caseGroup} data-parity={`Case ${c.id}`}>
      {label ? (
        <Group gap={8} wrap="nowrap" data-parity="head">
          <Text fz="md" lh="normal" fw={500} truncate data-parity="label">
            {label}
          </Text>
          <CaseBadges c={c} />
        </Group>
      ) : null}
      {c.waiver ? (
        <Text fz="sm" lh="normal" c="dimmed" data-parity="case waiver">
          {`Waived: ${c.waiver}`}
        </Text>
      ) : null}
      <div className={classes.thumbs} data-parity="pair">
        {(phases.length === 1 ? (['before', 'after'] as const) : phases).map(
          p => (
            <CaseShot
              key={p}
              repo={repo}
              runId={runId}
              c={c}
              phase={p}
              onCompare={onCompare}
            />
          )
        )}
      </div>
    </Stack>
  );
}

function RecordColumn({
  repo,
  runId,
  rec,
  mrIid,
  onCompare,
}: {
  repo: string;
  runId: string;
  rec: EvidenceCases;
  mrIid?: string | null;
  onCompare: (open: CompareOpen) => void;
}) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.recordCard}
      data-parity="Evidence"
    >
      <Stack gap={16}>
        <Group justify="space-between" wrap="nowrap">
          <Eyebrow data-parity="title">{`EVIDENCE · ${rec.cases.length}`}</Eyebrow>
          {rec.attach === 'ship' && mrIid ? (
            <Text fz="md" lh="normal" c="dimmed" data-parity="attached">
              attached to !{mrIid}
            </Text>
          ) : null}
        </Group>
        {rec.cases.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 ? <Divider data-parity="rule" /> : null}
            <CaseGroup
              repo={repo}
              runId={runId}
              rec={rec}
              c={c}
              onCompare={onCompare}
            />
          </Fragment>
        ))}
        {rec.transcript ? <TranscriptBlock repo={repo} runId={runId} /> : null}
      </Stack>
    </Paper>
  );
}

/** Legacy evidence in the record: its screenshots and links in a card of
    their own. */
function RecordLegacy({
  repo,
  runId,
  links,
  ticket,
  pathHref,
}: {
  repo: string;
  runId: string;
  links: string[];
  ticket?: string | null;
  pathHref?: (path: string) => string | null;
}) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.recordCard}
      data-parity="Evidence"
    >
      <Stack gap={12}>
        <Eyebrow data-parity="title">{`EVIDENCE · ${links.length}`}</Eyebrow>
        <LegacyEvidence
          repo={repo}
          runId={runId}
          links={links}
          size="record"
          ticket={ticket}
          pathHref={pathHref}
        />
      </Stack>
    </Paper>
  );
}

function CaseEvidence({
  repo,
  runId,
  evidence,
  variant,
  ticket,
  mrIid,
  phase,
  withUrl = false,
  onCompare,
}: Omit<EvidenceCardProps, 'evidence' | 'pathHref'> & {
  evidence: EvidenceCases;
}) {
  const [own, setOwn] = useState<CompareOpen | null>(null);
  const request = onCompare ?? setOwn;
  return (
    <>
      {variant === 'story' ? (
        <StoryEvidence
          repo={repo}
          runId={runId}
          rec={evidence}
          phase={phase}
          withUrl={withUrl}
          onCompare={request}
        />
      ) : (
        <RecordColumn
          repo={repo}
          runId={runId}
          rec={evidence}
          mrIid={mrIid}
          onCompare={request}
        />
      )}
      {own && (
        <EvidenceCompare
          repo={repo}
          runId={runId}
          record={evidence}
          ticket={ticket}
          {...own}
          onClose={() => setOwn(null)}
        />
      )}
    </>
  );
}

/** A run's evidence: its cases, links and transcript, and nothing for a run
    that recorded none. */
export function EvidenceCard({
  repo,
  runId,
  evidence,
  variant,
  ticket,
  mrIid,
  phase,
  pathHref,
  withUrl,
  onCompare,
}: EvidenceCardProps) {
  if (evidence.version === null) return null;
  if (evidence.version === 0)
    return variant === 'story' ? (
      <LegacyEvidence
        repo={repo}
        runId={runId}
        links={evidence.links}
        size="story"
        ticket={ticket}
        pathHref={pathHref}
      />
    ) : (
      <RecordLegacy
        repo={repo}
        runId={runId}
        links={evidence.links}
        ticket={ticket}
        pathHref={pathHref}
      />
    );
  if (evidence.version !== 2) return null;
  return (
    <CaseEvidence
      repo={repo}
      runId={runId}
      evidence={evidence}
      variant={variant}
      ticket={ticket}
      mrIid={mrIid}
      phase={phase}
      withUrl={withUrl}
      onCompare={onCompare}
    />
  );
}
