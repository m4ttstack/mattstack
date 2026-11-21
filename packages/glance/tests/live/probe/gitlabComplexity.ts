/**
 * Shared by the complexity probe and the offline budget test, so the digest
 * the test compares is the one the probe wrote.
 */
import { createHash } from 'node:crypto';

export interface ComplexityBudget {
  /** The cap gitlab.com reported when the scores were measured. */
  limit: number;
  documents: Record<string, { digest: string; score: number }>;
}

/** Whitespace never changes GitLab's score, so a reformat keeps its digest. */
export function documentDigest(document: string): string {
  return createHash('sha256').update(document.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

const PROBE_FIELD = 'queryComplexity { score limit }';

/** GitLab's own cost for the probe field, measured rather than assumed. */
export const PROBE_ONLY_DOCUMENT = `query GlanceComplexityProbe { ${PROBE_FIELD} }`;

export function withComplexityProbe(document: string): string {
  const selectionStart = document.indexOf('{');
  if (selectionStart < 0) throw new Error('document has no selection set');
  return `${document.slice(0, selectionStart + 1)} ${PROBE_FIELD}${document.slice(selectionStart + 1)}`;
}

interface ProbeEnvelope {
  data?: { queryComplexity?: { score: number; limit: number } | null } | null;
  errors?: Array<{ message: string }>;
}

/**
 * The score GitLab gave a probed document. A document over the cap is
 * refused before it runs, so its score only exists in the error text.
 */
export function readProbedScore(envelope: ProbeEnvelope): { score: number; limit: number | null } {
  const measured = envelope.data?.queryComplexity;
  if (measured) return { score: measured.score, limit: measured.limit };
  const text = (envelope.errors ?? []).map((e) => e.message).join('; ');
  const refused = /complexity of (\d+), which exceeds max complexity of (\d+)/.exec(text);
  if (refused) return { score: Number(refused[1]), limit: Number(refused[2]) };
  throw new Error(`GitLab returned no complexity score: ${text || 'empty response'}`);
}
