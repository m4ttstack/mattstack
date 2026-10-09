import type { EvidenceImageKey, ParsedEvidence } from '@mattstack/rt-client';

export type EvidenceV1Parsed = Extract<ParsedEvidence, { version: 1 }>;
export type EvidencePhase = 'before' | 'after';
export type EvidenceVariant = 'plain' | 'annotated';

export const PHASE_LABEL: Record<EvidencePhase, string> = {
  before: 'Before',
  after: 'After',
};
export const VARIANT_LABEL: Record<EvidenceVariant, string> = {
  plain: 'Plain',
  annotated: 'Annotated',
};

export interface EvidenceShot {
  key: EvidenceImageKey;
  fileName: string;
}

export type PhaseShots = Partial<Record<EvidenceVariant, EvidenceShot>>;

const KEYS: Record<EvidencePhase, Record<EvidenceVariant, EvidenceImageKey>> = {
  before: { plain: 'before', annotated: 'beforeAnnotated' },
  after: { plain: 'after', annotated: 'afterAnnotated' },
};

export function fileNameOf(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

/** The images a v1 evidence field carries, grouped by phase and variant. */
export function shotsOf(
  evidence: EvidenceV1Parsed
): Record<EvidencePhase, PhaseShots> {
  const byKey = new Map(evidence.images.map(i => [i.key, i.path]));
  const phase = (p: EvidencePhase): PhaseShots => {
    const shots: PhaseShots = {};
    for (const v of ['plain', 'annotated'] as const) {
      const key = KEYS[p][v];
      const path = byKey.get(key);
      if (path) shots[v] = { key, fileName: fileNameOf(path) };
    }
    return shots;
  };
  return { before: phase('before'), after: phase('after') };
}

export function phasesIn(
  shots: Record<EvidencePhase, PhaseShots>
): EvidencePhase[] {
  return (['before', 'after'] as const).filter(
    p => Object.keys(shots[p]).length > 0
  );
}

export function variantsIn(phase: PhaseShots): EvidenceVariant[] {
  return (['plain', 'annotated'] as const).filter(v => phase[v]);
}

/** The wanted variant when the phase has it, else the one it does have;
    annotated is the default since it is the one a person marked up to read. */
export function shotFor(
  phase: PhaseShots,
  variant: EvidenceVariant = 'annotated'
): EvidenceShot | null {
  return (
    phase[variant] ?? phase[variant === 'plain' ? 'annotated' : 'plain'] ?? null
  );
}

/** `repo` is already the wire form the run page carries (percent-encoded,
    possibly `remote:`-prefixed), so it goes in as it is. */
export function evidenceUrl(
  repo: string,
  runId: string,
  key: EvidenceImageKey | 'transcript'
): string {
  return `/api/runs/${repo}/${encodeURIComponent(runId)}/evidence/${key}`;
}

/** A legacy run's image is addressed by the path its evidence text names. */
export function legacyImageUrl(
  repo: string,
  runId: string,
  path: string
): string {
  return `/api/runs/${repo}/${encodeURIComponent(runId)}/evidence-file?path=${encodeURIComponent(path)}`;
}
