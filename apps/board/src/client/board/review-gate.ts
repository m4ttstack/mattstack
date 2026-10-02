import {
  collapseChunks,
  optionValue,
  type GateQuestion,
} from '@mattstack/gate-kit';
import type { GateRow } from '../../gates/store.ts';
import { gateContext } from '../../gates/wait-meta.ts';
import {
  parseGateCtx,
  type CarryoverCtx,
  type FindingEntry,
  type FindingSeverity,
  type Readiness,
  type ReviewCtx,
  type SkippedEntry,
} from './gate-ctx.ts';
import { postPicks, type PostPick } from './respond-post.ts';

export const SEVERITY_ORDER: readonly FindingSeverity[] = [
  'critical',
  'important',
  'minor',
];

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  critical: 'Critical',
  important: 'Important',
  minor: 'Minor',
};

/** One earlier thread's question: the post/resolve pair the respond gate's
    post step uses, joined to its carryover@1 card. */
export interface CarryoverPick extends PostPick {
  carry: CarryoverCtx;
}

export interface ReviewGate {
  review: ReviewCtx;
  /** Every findings chunk's entries, keyed by the option value each joins. */
  findings: Map<string, FindingEntry>;
  /** The reviewer's earlier threads, in gate order; empty on a first pass. */
  carryovers: CarryoverPick[];
  /** Every skipped chunk's entries, keyed by the `restore:<id>` option each
      joins. */
  skipped: Map<string, SkippedEntry>;
  /** Every question except the per-thread ones, which must not collapse:
      their `thread-N` ids would read as chunks of one question. */
  rest: GateQuestion[];
}

type ReviewGateInput = Pick<GateRow, 'kind' | 'context' | 'meta' | 'questions'>;

/** The sheet looks up its findings question by the collapsed id `findings`
    (`ReviewGateSheet.tsx`), which is what a chunked `findings-N` set becomes
    post-`collapseChunks` and also what an unchunked single question is named
    outright, so both forms must join here or the sheet finds a question the
    join never validated. */
export function isFindingsQuestion(q: { id: string }): boolean {
  return q.id === 'findings' || q.id.startsWith('findings-');
}

export function isSkippedQuestion(q: { id: string }): boolean {
  return q.id === 'skipped' || q.id.startsWith('skipped-');
}

export const RESTORE_PREFIX = 'restore:';

/** The review sheet's whole input, or null when the gate is not a
    review-post whose gate context is review@1, whose every findings chunk
    is findings@1 joined one-to-one to its own options, whose per-severity
    counts match the joined findings, whose every per-thread question
    carries a carryover@1 naming its own thread, whose every skipped chunk
    is skipped@1 joined one-to-one to its `restore:` options, and whose
    remaining questions collapse to at most one `findings` multi, at most
    one `skipped` multi and exactly one single-choice verdict. There is no
    half-joined sheet: any mismatch routes the whole gate elsewhere. */
export function readReviewGate(gate: ReviewGateInput): ReviewGate | null {
  if (gate.kind !== 'review-post') return null;
  const review = parseGateCtx(gateContext(gate));
  if (review?.shape !== 'review@1') return null;
  const carryovers: CarryoverPick[] = [];
  for (const pick of postPicks(gate.questions)) {
    const q = gate.questions.find(x => x.id === pick.name);
    const carry = parseGateCtx(q?.context);
    if (carry?.shape !== 'carryover@1' || carry.thread !== pick.threadId)
      return null;
    carryovers.push({ ...pick, carry });
  }
  const threadNames = new Set(carryovers.map(c => c.name));
  const rest = gate.questions.filter(q => !threadNames.has(q.id));
  const skipped = new Map<string, SkippedEntry>();
  for (const q of rest) {
    if (!isSkippedQuestion(q)) continue;
    const ctx = parseGateCtx(q.context);
    if (ctx?.shape !== 'skipped@1') return null;
    const values = new Set(q.options.map(optionValue));
    if (values.size !== q.options.length) return null;
    if (ctx.skipped.length !== values.size) return null;
    for (const entry of ctx.skipped) {
      const value = `${RESTORE_PREFIX}${entry.id}`;
      if (!values.has(value) || skipped.has(value)) return null;
      skipped.set(value, entry);
    }
  }
  const findings = new Map<string, FindingEntry>();
  for (const q of rest) {
    if (!isFindingsQuestion(q)) continue;
    const ctx = parseGateCtx(q.context);
    if (ctx?.shape !== 'findings@1') return null;
    const values = new Set(q.options.map(optionValue));
    if (values.size !== q.options.length) return null;
    if (ctx.findings.length !== values.size) return null;
    for (const entry of ctx.findings) {
      if (!values.has(entry.id) || findings.has(entry.id)) return null;
      findings.set(entry.id, entry);
    }
  }
  for (const s of SEVERITY_ORDER) {
    let joined = 0;
    for (const f of findings.values()) if (f.severity === s) joined++;
    if (joined !== (review.findings[s] ?? 0)) return null;
  }
  let collapsed: GateQuestion[];
  try {
    collapsed = collapseChunks(rest).questions;
  } catch {
    return null;
  }
  const multis = collapsed.filter(q => q.multi);
  if (collapsed.length - multis.length !== 1) return null;
  const multiIds = multis.map(q => q.id);
  if (new Set(multiIds).size !== multiIds.length) return null;
  if (multiIds.some(id => id !== 'findings' && id !== 'skipped')) return null;
  return { review, findings, carryovers, skipped, rest };
}

export function isReviewSheetGate(gate: ReviewGateInput): boolean {
  return readReviewGate(gate) !== null;
}

export function readinessProse(readiness: Readiness): string {
  return `Ready to merge: ${readiness.replace(/-/g, ' ')}`;
}

export function severityTally(counts: Record<FindingSeverity, number>): string {
  const parts = SEVERITY_ORDER.filter(s => counts[s] > 0).map(
    s => `${counts[s]} ${s}`
  );
  return parts.length > 0 ? parts.join(', ') : 'no findings';
}

export function reviewMeta(review: ReviewCtx): string {
  const { reviewer, round, re_review, prior } = review;
  return [
    reviewer,
    round !== undefined ? `round ${round}` : undefined,
    prior
      ? `${prior.addressed} addressed, ${prior.still_open} waiting on author`
      : re_review
        ? 're-review'
        : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function reviewProse(review: ReviewCtx): string {
  const meta = reviewMeta(review);
  return [
    `**${readinessProse(review.readiness)}** · ${severityTally(review.findings)}`,
    ...(meta ? [meta] : []),
    review.summary,
  ].join('\n\n');
}

/** A gate-level context as a pane without a structured card shows it:
    prose exactly as written, a review@1 flattened, and nothing for any
    other shape, whose card lives elsewhere. Structured JSON never reaches
    a reader raw. */
export function paneContext(context: string | undefined): string | undefined {
  const ctx = parseGateCtx(context);
  if (ctx === null) return context;
  return ctx.shape === 'review@1' ? reviewProse(ctx) : undefined;
}
