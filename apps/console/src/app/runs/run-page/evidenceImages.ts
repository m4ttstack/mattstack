import type {
  EvidenceCase,
  EvidenceRecord,
  EvidenceShot,
  EvidenceSlotName,
  EvidenceTheme,
} from '@mattstack/rt-client/evidence';

export type EvidenceCases = Extract<EvidenceRecord, { version: 2 }>;
export type EvidencePhase = EvidenceSlotName;
export type EvidenceVariant = 'plain' | 'annotated';
export type CompareMode = EvidencePhase | 'side';

export const PHASE_LABEL: Record<EvidencePhase, string> = {
  before: 'Before',
  after: 'After',
};
export const MODE_LABEL: Record<CompareMode, string> = {
  ...PHASE_LABEL,
  side: 'Side by side',
};

const PHASES: EvidencePhase[] = ['before', 'after'];
const THEMES: EvidenceTheme[] = ['light', 'dark'];
/** What `readEvidence` names a v1 record's one case when it has no text. */
const V1_FALLBACK_LABEL = 'Evidence';

export function isCompareMode(value: string | null): value is CompareMode {
  return value === 'before' || value === 'after' || value === 'side';
}

export function isTheme(value: string | null): value is EvidenceTheme {
  return value === 'light' || value === 'dark';
}

/** A web link as a person reads it: no scheme. */
export function urlLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

export function fileNameOf(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export function slotsOf(c: EvidenceCase): EvidencePhase[] {
  return PHASES.filter(p => (c[p]?.length ?? 0) > 0);
}

export function themesIn(c: EvidenceCase): EvidenceTheme[] {
  const seen = new Set(
    PHASES.flatMap(p => c[p] ?? []).flatMap(s => (s.theme ? [s.theme] : []))
  );
  return THEMES.filter(t => seen.has(t));
}

/** The slot's shot in the asked theme, else its first (light comes first). */
export function shotIn(
  c: EvidenceCase,
  slot: EvidencePhase,
  theme?: EvidenceTheme
): EvidenceShot | null {
  const shots = c[slot] ?? [];
  return shots.find(s => s.theme === theme) ?? shots[0] ?? null;
}

/** An image that goes out unmarked: no annotated copy, and a waiver. */
export function isWaived(shot: EvidenceShot): boolean {
  return !shot.annotated && !!shot.waiver;
}

/** A slot is waived when it has images and none of them is annotated. */
export function phaseWaived(c: EvidenceCase, slot: EvidencePhase): boolean {
  const shots = c[slot] ?? [];
  return shots.length > 0 && shots.every(isWaived);
}

/** A case is waived when none of its images is annotated. */
export function caseWaived(c: EvidenceCase): boolean {
  const shots = PHASES.flatMap(p => c[p] ?? []);
  return shots.length > 0 && shots.every(isWaived);
}

/** The quiet badges after a case's label: its themes, then waived. */
export function badgesOf(c: EvidenceCase, slot?: EvidencePhase): string[] {
  const waived = slot ? phaseWaived(c, slot) : caseWaived(c);
  return [
    ...(themesIn(c).length === 2 ? ['light + dark'] : []),
    ...(waived ? ['waived'] : []),
  ];
}

/** The line under an image: its caption, its waiver, or only "Waived" when
    the case's waiver covers it and `caseWaiverShown` (the record prints it
    once under the case's head). */
export function shotLine(
  c: EvidenceCase,
  shot: EvidenceShot,
  caseWaiverShown = false
): { kind: 'caption' | 'waiver'; text: string } | null {
  if (shot.annotated)
    return shot.caption ? { kind: 'caption', text: shot.caption } : null;
  if (!shot.waiver) return null;
  return {
    kind: 'waiver',
    text:
      caseWaiverShown && shot.waiver === c.waiver
        ? 'Waived'
        : `Waived: ${shot.waiver}`,
  };
}

/** A case's heading, or none for a v1 record that named no case. */
export function headLabel(rec: EvidenceCases, c: EvidenceCase): string | null {
  return rec.source === 1 && c.label === V1_FALLBACK_LABEL ? null : c.label;
}

/** "WEB-409 · Rush order, Sep 14 delay, Denver": the run, then what the
    full-size view shows. */
export function evidenceTitle(
  ticket: string | null | undefined,
  what?: string
): string {
  return [ticket, what].filter(Boolean).join(' · ') || 'Evidence';
}

export interface ShotAddress {
  caseId: string;
  slot: EvidencePhase;
  theme?: EvidenceTheme;
  annotated: boolean;
}

/** Where a shot is served: annotated unless the plain one is asked for or
    there is no annotated copy. */
export function addressOf(
  c: EvidenceCase,
  slot: EvidencePhase,
  shot: EvidenceShot,
  variant: EvidenceVariant = 'annotated'
): ShotAddress {
  return {
    caseId: c.id,
    slot,
    ...(shot.theme ? { theme: shot.theme } : {}),
    annotated: variant === 'annotated' && !!shot.annotated,
  };
}

/** The file name of the image `addressOf` serves for the same variant. */
export function shownName(
  shot: EvidenceShot,
  variant: EvidenceVariant = 'annotated'
): string {
  return fileNameOf(
    variant === 'annotated' && shot.annotated ? shot.annotated : shot.path
  );
}

/** `repo` is already the wire form the run page carries (percent-encoded,
    possibly `remote:`-prefixed), so it goes in as it is. */
export function evidenceUrl(
  repo: string,
  runId: string,
  a: ShotAddress
): string {
  const query = new URLSearchParams();
  if (a.theme) query.set('theme', a.theme);
  if (a.annotated) query.set('annotated', '1');
  const qs = query.toString();
  return `/api/runs/${repo}/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(a.caseId)}/${a.slot}${qs ? `?${qs}` : ''}`;
}

export function transcriptUrl(repo: string, runId: string): string {
  return `/api/runs/${repo}/${encodeURIComponent(runId)}/evidence/transcript`;
}

/** A legacy run's image is addressed by the path its evidence text names. */
export function legacyImageUrl(
  repo: string,
  runId: string,
  path: string
): string {
  return `/api/runs/${repo}/${encodeURIComponent(runId)}/evidence-file?path=${encodeURIComponent(path)}`;
}
