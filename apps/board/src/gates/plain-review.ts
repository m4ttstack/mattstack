import { readFileSync, statSync } from 'fs';

import { isFindingsQuestion } from '../client/board/review-gate.ts';
import { reviewReportJsonPath } from '../review-state.ts';
import type { GateQuestion } from './verbs.ts';

/** A gate the CLI refuses to open, as opposed to one the daemon could not.
    bin/gate.ts gives it its own exit code: the review wrapper answers any
    other failure by asking in the pane, which would walk around a refusal. */
export class GateRefused extends Error {}

export const GATE_REFUSED_EXIT = 3;

const PLAIN_REVIEW_REFUSAL =
  "gate open refused: this run's report json is structured, but the gate is plain, " +
  'so the human would see no body, evidence or drafted comment for any finding. ' +
  'Build the open the review skill skipped: run review-source.sh on the report json, ' +
  'then gate_open {handBack: true, outPath: <dir>/review-post.open.json}, and open ' +
  'that file with open-gate.sh. Only when one of those two has failed or refused, ' +
  'open the plain gate with --plain-reason "<its exact output>"; this message is ' +
  'not that output.';

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Obj)
    : null;
}

function parseObj(text: unknown): Obj | null {
  if (typeof text !== 'string') return null;
  try {
    return asObj(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The ids in this run's structured report, or null when a plain gate loses
    nothing. Only a domain skill writes the json, so one older than the run
    belongs to an earlier pass, and one with no version is the legacy shape
    whose fitted gate is prose anyway. */
function structuredFindingIds(
  handle: string,
  runStartedAt: number
): string[] | null {
  const path = reviewReportJsonPath(handle);
  let report: Obj | null;
  try {
    if (statSync(path).mtimeMs < runStartedAt) return null;
    report = parseObj(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (!report || (report.version !== 2 && report.version !== 3)) return null;
  if (!Array.isArray(report.findings)) return null;
  return report.findings.map(f => String(asObj(f)?.id));
}

/** Checks the `gate-ctx` tags and finding ids only. The sheet's own reader
    is stricter, and a fitted file it cannot draw must still open. */
function carriesFindings(
  questions: GateQuestion[],
  context: string | undefined,
  ids: string[]
): boolean {
  if (parseObj(context)?.['gate-ctx'] !== 'review@1') return false;
  const carried = new Set<string>();
  for (const q of questions.filter(isFindingsQuestion)) {
    const ctx = parseObj(q.context);
    if (ctx?.['gate-ctx'] !== 'findings@1' || !Array.isArray(ctx.findings))
      return false;
    for (const f of ctx.findings) carried.add(String(asObj(f)?.id));
  }
  return ids.every(id => carried.has(id));
}

/** The context a review-post gate opens with. Throws GateRefused for a plain
    gate over this run's structured report, unless `plainReason` says why the
    fitted open could not be built; the reason then heads the gate's context,
    where the human reads it. */
export function reviewPostContext(
  handle: string,
  runStartedAt: number,
  questions: GateQuestion[],
  extras: { context?: string; plainReason?: string }
): string | undefined {
  const { context } = extras;
  const ids = structuredFindingIds(handle, runStartedAt);
  if (ids === null || carriesFindings(questions, context, ids)) return context;
  const reason = extras.plainReason?.trim();
  if (!reason) throw new GateRefused(PLAIN_REVIEW_REFUSAL);
  return [`Plain gate: ${reason}`, ...(context ? [context] : [])].join('\n\n');
}
