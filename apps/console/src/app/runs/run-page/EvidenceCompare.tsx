import { useState } from 'react';
import {
  ActionIcon,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';

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

export interface EvidenceCompareProps {
  repo: string;
  runId: string;
  evidence: EvidenceV1Parsed;
  initialPhase?: EvidencePhase;
  initialVariant?: EvidenceVariant;
}

/** The full-size view: one image at a time, flipped between Before and After
    by the toggle or the arrows. */
export function EvidenceCompare({
  repo,
  runId,
  evidence,
  initialPhase,
  initialVariant,
}: EvidenceCompareProps) {
  const shots = shotsOf(evidence);
  const phases = phasesIn(shots);
  const [phase, setPhase] = useState<EvidencePhase>(
    initialPhase && phases.includes(initialPhase)
      ? initialPhase
      : (phases[0] ?? 'before')
  );
  const [wanted, setWanted] = useState<EvidenceVariant>(
    initialVariant ?? 'annotated'
  );

  const shot = shotFor(shots[phase], wanted);
  const variants = variantsIn(shots[phase]);
  const shownVariant: EvidenceVariant =
    shots[phase].annotated === shot ? 'annotated' : 'plain';
  const at = phases.indexOf(phase);
  const earlier = phases[at - 1];
  const later = phases[at + 1];

  return (
    <Stack gap="sm" data-testid="evidence-compare">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <ActionIcon
            variant="default"
            aria-label={earlier ? `Show ${earlier}` : 'Nothing earlier'}
            disabled={!earlier}
            onClick={() => earlier && setPhase(earlier)}
          >
            <Icon name="arrowLeft" size={16} />
          </ActionIcon>
          <ActionIcon
            variant="default"
            aria-label={later ? `Show ${later}` : 'Nothing later'}
            disabled={!later}
            onClick={() => later && setPhase(later)}
          >
            <Icon name="arrowRight" size={16} />
          </ActionIcon>
          {phases.length > 1 && (
            <SegmentedControl
              size="xs"
              aria-label="Before or after"
              value={phase}
              onChange={v => setPhase(v as EvidencePhase)}
              data={phases.map(p => ({ value: p, label: PHASE_LABEL[p] }))}
            />
          )}
        </Group>
        {variants.length > 1 && (
          <SegmentedControl
            size="xs"
            aria-label="Plain or annotated"
            value={shownVariant}
            onChange={v => setWanted(v as EvidenceVariant)}
            data={variants.map(v => ({ value: v, label: VARIANT_LABEL[v] }))}
          />
        )}
      </Group>
      {shot && (
        <>
          <EvidenceImage
            src={evidenceUrl(repo, runId, shot.key)}
            name={shot.fileName}
            maxHeight="70vh"
          />
          <Text size="sm" c="dimmed">
            {shot.fileName}
          </Text>
        </>
      )}
    </Stack>
  );
}

export function openEvidenceCompare(props: EvidenceCompareProps) {
  modals.open({
    title: 'Compare full size',
    size: 'xl',
    centered: true,
    children: <EvidenceCompare {...props} />,
  });
}
