import { useState } from 'react';
import {
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
} from '@mattstack/app-kit/core';

import classes from './EvidenceCompare.module.css';
import { EvidenceImage } from './EvidenceImage';
import {
  evidenceUrl,
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

export interface EvidenceCompareProps {
  repo: string;
  runId: string;
  evidence: EvidenceV1Parsed;
  /** The run it belongs to, e.g. its ticket and the case it was captured on. */
  title: string;
  /** Side by side when the evidence has both phases and none is asked for. */
  initialMode?: CompareMode;
  /** The variant a thumbnail showed; annotated otherwise. */
  initialVariant?: EvidenceVariant;
  onClose: () => void;
}

/** The evidence full size: Before, After, or both side by side, picked by one
    control. The image keeps its aspect ratio inside the frame. */
export function EvidenceCompare({
  repo,
  runId,
  evidence,
  title,
  initialMode,
  initialVariant = 'annotated',
  onClose,
}: EvidenceCompareProps) {
  const shots = shotsOf(evidence);
  const phases = phasesIn(shots);
  const modes: CompareMode[] = phases.length > 1 ? [...phases, 'side'] : phases;
  const [mode, setMode] = useState<CompareMode>(
    initialMode && modes.includes(initialMode)
      ? initialMode
      : (modes.at(-1) ?? 'before')
  );
  const shown: EvidencePhase[] = mode === 'side' ? phases : [mode];

  return (
    <Modal.Root opened onClose={onClose} size="calc(100vw - 48px)">
      <Modal.Overlay />
      <Modal.Content data-parity="Compare modal">
        <div data-parity="modal">
          <Modal.Header data-parity="head">
            <Modal.Title data-parity="t">{title}</Modal.Title>
            <Group gap="sm" wrap="nowrap">
              {modes.length > 1 && (
                <SegmentedControl
                  aria-label="Before, after or side by side"
                  value={mode}
                  onChange={v => setMode(v as CompareMode)}
                  data={modes.map(m => ({ value: m, label: MODE_LABEL[m] }))}
                  data-parity="seg"
                />
              )}
              <Modal.CloseButton aria-label="Close" />
            </Group>
          </Modal.Header>
          <Modal.Body>
            <div
              className={classes.images}
              data-side={mode === 'side' ? 'true' : 'false'}
            >
              {shown.map(p => {
                const shot = shotFor(shots[p], initialVariant);
                if (!shot) return null;
                return (
                  <Stack key={p} gap={6} className={classes.column}>
                    <div className={classes.frame} data-parity="img">
                      <EvidenceImage
                        src={evidenceUrl(repo, runId, shot.key)}
                        name={shot.fileName}
                        maxHeight="100%"
                      />
                    </div>
                    <Text
                      fz={12}
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
          </Modal.Body>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}
