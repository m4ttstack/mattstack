import { useCallback, useState, type ReactNode } from 'react';
import {
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useLocation, useSearch } from 'wouter';

import classes from './EvidenceCompare.module.css';
import { EvidenceImage } from './EvidenceImage';
import {
  evidenceUrl,
  isCompareMode,
  MODE_LABEL,
  PHASE_LABEL,
  phasesIn,
  shotFor,
  shotsOf,
  type CompareMode,
  type EvidencePhase,
  type EvidenceV1Parsed,
  type EvidenceVariant,
} from './evidenceImages';

/** Where the compare modal opens: the mode, and the variant a thumbnail
    showed. Empty opens it side by side, annotated. */
export interface CompareOpen {
  mode?: CompareMode;
  variant?: EvidenceVariant;
}

const COMPARE_PARAM = 'compare';

/** `?compare=<mode>` on a record: the mode a link asks for, and a way to drop
    the param once the modal it opened closes. */
export function useCompareLink() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const asked = new URLSearchParams(search).get(COMPARE_PARAM);
  const clear = useCallback(() => {
    const params = new URLSearchParams(search);
    if (!params.has(COMPARE_PARAM)) return;
    params.delete(COMPARE_PARAM);
    const qs = params.toString();
    navigate(qs ? `${location}?${qs}` : location, { replace: true });
  }, [search, location, navigate]);
  return { mode: isCompareMode(asked) ? asked : null, asked, clear };
}

/** Evidence full size: the kit modal less a margin, its title, any control
    beside the close button, and the frames. */
export function EvidenceModal({
  title,
  controls,
  onClose,
  parityRoot,
  children,
}: {
  title: string;
  controls?: ReactNode;
  onClose: () => void;
  /** The parity root this modal is compared as, when a board draws it. */
  parityRoot?: string;
  children: ReactNode;
}) {
  return (
    <Modal.Root opened onClose={onClose} size="calc(100vw - 48px)">
      <Modal.Overlay />
      <Modal.Content data-parity={parityRoot}>
        <div data-parity={parityRoot ? 'modal' : undefined}>
          <Modal.Header data-parity="head">
            <Modal.Title data-parity="t">{title}</Modal.Title>
            <Group gap="sm" wrap="nowrap">
              {controls}
              <Modal.CloseButton aria-label="Close" data-autofocus />
            </Group>
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}

/** One image full size, kept to its aspect ratio inside the frame. */
export function EvidenceFrame({ src, name }: { src: string; name: string }) {
  return (
    <Paper
      variant="panel-outline"
      radius="md"
      className={classes.frame}
      data-parity="img"
    >
      <EvidenceImage src={src} name={name} maxHeight="100%" />
    </Paper>
  );
}

export interface EvidenceCompareProps extends CompareOpen {
  repo: string;
  runId: string;
  evidence: EvidenceV1Parsed;
  /** The run it belongs to, e.g. its ticket and the case it was captured on. */
  title: string;
  onClose: () => void;
}

/** The evidence full size: Before, After, or both side by side, picked by one
    control. Side by side when both phases exist and none is asked for. */
export function EvidenceCompare({
  repo,
  runId,
  evidence,
  title,
  mode: asked,
  variant = 'annotated',
  onClose,
}: EvidenceCompareProps) {
  const shots = shotsOf(evidence);
  const phases = phasesIn(shots);
  const modes: CompareMode[] = phases.length > 1 ? [...phases, 'side'] : phases;
  const [mode, setMode] = useState<CompareMode>(
    asked && modes.includes(asked) ? asked : (modes.at(-1) ?? 'before')
  );
  const shown: EvidencePhase[] = mode === 'side' ? phases : [mode];

  return (
    <EvidenceModal
      title={title}
      onClose={onClose}
      parityRoot="Compare modal"
      controls={
        modes.length > 1 && (
          <SegmentedControl
            aria-label="Before, after or side by side"
            value={mode}
            onChange={v => setMode(v as CompareMode)}
            data={modes.map(m => ({ value: m, label: MODE_LABEL[m] }))}
            data-parity="seg"
          />
        )
      }
    >
      <div
        className={classes.images}
        data-side={mode === 'side' ? 'true' : 'false'}
      >
        {shown.map(p => {
          const shot = shotFor(shots[p], variant);
          if (!shot) return null;
          return (
            <Stack key={p} gap={6} className={classes.column}>
              <EvidenceFrame
                src={evidenceUrl(repo, runId, shot.key)}
                name={shot.fileName}
              />
              <Text
                fz="md"
                fw={500}
                lh="normal"
                c="dimmed"
                truncate
                data-parity="cap"
              >
                {mode === 'side' ? PHASE_LABEL[p] : shot.fileName}
              </Text>
            </Stack>
          );
        })}
      </div>
    </EvidenceModal>
  );
}
