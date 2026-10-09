import { useCallback, useState, type ReactNode } from 'react';
import {
  Anchor,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import type { ParsedEvidence } from '@mattstack/rt-client';
import { legacyItems, type LegacyItem } from '@mattstack/rt-client/evidence';
import { useLocation, useSearch } from 'wouter';

import classes from './EvidenceCard.module.css';
import { EvidenceCompare } from './EvidenceCompare';
import { EvidenceImage } from './EvidenceImage';
import {
  evidenceUrl,
  fileNameOf,
  isCompareMode,
  legacyImageUrl,
  PHASE_LABEL,
  phasesIn,
  shotFor,
  shotsOf,
  urlLabel,
  variantsIn,
  type CompareMode,
  type EvidencePhase,
  type EvidenceV1Parsed,
  type EvidenceVariant,
} from './evidenceImages';
import { TranscriptBlock } from './TranscriptBlock';

export interface EvidenceCardProps {
  /** The run's repo in the wire form the run page carries. */
  repo: string;
  runId: string;
  evidence: ParsedEvidence;
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
}

/** Where the compare modal opens, kept in the URL as `?compare=<mode>` so a
    link opens the record on it. */
const COMPARE_PARAM = 'compare';

interface CompareOpen {
  mode?: CompareMode;
  variant?: EvidenceVariant;
}

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

function compareTitle(ticket: string | null | undefined, caseUsed?: string) {
  return [ticket, caseUsed].filter(Boolean).join(' · ') || 'Evidence';
}

/** One screenshot, the size of the column it sits in, its file name under it. */
function Thumb({
  src,
  name,
  size,
  onOpen,
}: {
  src: string;
  name: string;
  size: 'story' | 'record';
  onOpen: () => void;
}) {
  return (
    <Stack
      gap={6}
      className={size === 'story' ? classes.storyThumb : classes.thumb}
    >
      <div
        className={size === 'story' ? classes.storyFrame : classes.thumbFrame}
        data-parity="img"
      >
        <EvidenceImage
          src={src}
          name={name}
          maxHeight={size === 'story' ? 144 : 132}
          onOpen={onOpen}
        />
      </div>
      <Text
        fz={11.5}
        lh="normal"
        ff="monospace"
        c="dimmed"
        truncate
        data-parity="cap"
      >
        {name}
      </Text>
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
      fz={12.5}
      lh="normal"
      c="accent"
      className={classes.link}
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
      fz={12.5}
      lh="normal"
      c="accent"
      ff="monospace"
      className={classes.path}
    >
      {path}
    </Anchor>
  ) : (
    <Text fz={12.5} lh="normal" ff="monospace" className={classes.path}>
      {path}
    </Text>
  );
}

function openFullSize(src: string, name: string) {
  modals.open({
    title: name,
    size: 'calc(100vw - 48px)',
    children: (
      <div className={classes.fullFrame}>
        <EvidenceImage src={src} name={name} maxHeight="100%" />
      </div>
    ),
  });
}

/** Version 0 evidence is whatever text the agent wrote: its screenshots show
    as images, a web link is something to follow, any other file something to
    open in the editor. */
function LegacyEvidence({
  repo,
  runId,
  links,
  size,
  pathHref,
}: {
  repo: string;
  runId: string;
  links: string[];
  size: 'story' | 'record';
  pathHref?: (path: string) => string | null;
}) {
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
                onOpen={() => openFullSize(src, name)}
              />
            );
          })}
        </div>
      )}
      {rest.length > 0 && <Stack gap={4}>{rest.map(linkOf)}</Stack>}
    </Stack>
  );
}

/** The story's evidence: the stage's screenshots as thumbnails, the page they
    were taken on, and the way to see them full size. */
function StoryEvidence({
  repo,
  runId,
  evidence,
  phase: only,
  onCompare,
}: {
  repo: string;
  runId: string;
  evidence: EvidenceV1Parsed;
  phase?: EvidencePhase;
  onCompare: (open: CompareOpen) => void;
}) {
  const shots = shotsOf(evidence);
  const phases = phasesIn(shots);
  const phase = only ? phases.find(p => p === only) : phases[0];
  if (!phase) return null;
  const url = phase === 'before' ? evidence.evidence.url : undefined;

  return (
    <Stack gap={12}>
      <div className={classes.strip}>
        {variantsIn(shots[phase]).map(variant => {
          const shot = shots[phase][variant]!;
          return (
            <Thumb
              key={variant}
              src={evidenceUrl(repo, runId, shot.key)}
              name={shot.fileName}
              size="story"
              onOpen={() => onCompare({ mode: phase, variant })}
            />
          );
        })}
      </div>
      <Group gap={16} wrap="wrap" className={classes.links}>
        {url && <UrlLink url={url} />}
        <Anchor
          component="button"
          type="button"
          fz={12.5}
          lh="normal"
          c="accent"
          onClick={() => onCompare({})}
        >
          Open full size →
        </Anchor>
      </Group>
    </Stack>
  );
}

function RecordColumn({
  repo,
  runId,
  evidence,
  mrIid,
  onCompare,
}: {
  repo: string;
  runId: string;
  evidence: EvidenceV1Parsed;
  mrIid?: string | null;
  onCompare: (open: CompareOpen) => void;
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
                              onCompare({ mode: p, variant: shown })
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
                  onClick={() => onCompare({})}
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

/** Legacy evidence in the record: its screenshots and links in a card of
    their own. */
function RecordLegacy({
  repo,
  runId,
  links,
  pathHref,
}: {
  repo: string;
  runId: string;
  links: string[];
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
        <Label data-parity="title">{`EVIDENCE · ${links.length}`}</Label>
        <LegacyEvidence
          repo={repo}
          runId={runId}
          links={links}
          size="record"
          pathHref={pathHref}
        />
      </Stack>
    </Paper>
  );
}

/** The record's compare modal follows `?compare=`, so a link opens it; the
    story's is the card's own. */
function useCompare(fromUrl: boolean) {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const linked = fromUrl
    ? new URLSearchParams(search).get(COMPARE_PARAM)
    : null;
  const [open, setOpen] = useState<CompareOpen | null>(() =>
    isCompareMode(linked) ? { mode: linked } : null
  );
  const close = useCallback(() => {
    setOpen(null);
    const params = new URLSearchParams(search);
    if (!params.has(COMPARE_PARAM)) return;
    params.delete(COMPARE_PARAM);
    const qs = params.toString();
    navigate(qs ? `${location}?${qs}` : location, { replace: true });
  }, [search, location, navigate]);
  return { open, setOpen, close };
}

function V1Evidence({
  repo,
  runId,
  evidence,
  variant,
  ticket,
  mrIid,
  phase,
}: Omit<EvidenceCardProps, 'evidence' | 'pathHref'> & {
  evidence: EvidenceV1Parsed;
}) {
  const compare = useCompare(variant === 'record');
  return (
    <>
      {variant === 'story' ? (
        <StoryEvidence
          repo={repo}
          runId={runId}
          evidence={evidence}
          phase={phase}
          onCompare={compare.setOpen}
        />
      ) : (
        <RecordColumn
          repo={repo}
          runId={runId}
          evidence={evidence}
          mrIid={mrIid}
          onCompare={compare.setOpen}
        />
      )}
      {compare.open && (
        <EvidenceCompare
          repo={repo}
          runId={runId}
          evidence={evidence}
          title={compareTitle(ticket, evidence.evidence.case)}
          initialMode={compare.open.mode}
          initialVariant={compare.open.variant}
          onClose={compare.close}
        />
      )}
    </>
  );
}

/** A run's evidence: its screenshots, links and case, and nothing for a run
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
}: EvidenceCardProps) {
  if (evidence.version === null) return null;
  if (evidence.version === 0)
    return variant === 'story' ? (
      <LegacyEvidence
        repo={repo}
        runId={runId}
        links={evidence.links}
        size="story"
        pathHref={pathHref}
      />
    ) : (
      <RecordLegacy
        repo={repo}
        runId={runId}
        links={evidence.links}
        pathHref={pathHref}
      />
    );
  return (
    <V1Evidence
      repo={repo}
      runId={runId}
      evidence={evidence}
      variant={variant}
      ticket={ticket}
      mrIid={mrIid}
      phase={phase}
    />
  );
}
