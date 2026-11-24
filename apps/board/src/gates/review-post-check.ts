import { readFileSync, statSync } from 'fs';

import type { RtResponse, RunDetail } from '@mattstack/rt-client';
import {
  isFindingsQuestion,
  paneContext,
} from '../client/board/review-gate.ts';
import { reviewReportJsonPath, reviewReportPath } from '../review-state.ts';
import type { GateQuestion } from './verbs.ts';

/** A gate the CLI refuses to open, as opposed to one the daemon could not.
    bin/gate.ts gives it its own exit code: the review wrapper answers any
    other failure by asking in the pane, which would walk around a refusal. */
export class GateRefused extends Error {}

export const GATE_REFUSED_EXIT = 3;

const PLAIN_PROBLEM =
  "This run's report json is structured, but the gate is plain, so the human would " +
  'see no body, evidence or drafted comment for any finding. Build the open the ' +
  'review skill skipped: run review-source.sh on the report json, then gate_open ' +
  '{handBack: true, outPath: <dir>/review-post.open.json}, and open that file with ' +
  'open-gate.sh. Only when one of those two has failed or refused, open the plain ' +
  'gate with --plain-reason "<its exact output>"; this message is not that output.';

const NO_RUN_PROBLEM =
  'The report names no run the daemon knows. Enter the run the review skill skipped: ' +
  'run_enter as its Run section says, record the MR and branch on it, rebuild the ' +
  'open with its runDb, and write one "review-run: <run id>" line into --report. Only ' +
  'when run_enter has refused, open the gate with --no-run-reason "<its exact output>"; ' +
  'this message is not that output.';

type GetRun = (runId: string) => Promise<RtResponse<RunDetail>>;

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
  if (!Array.isArray(report.findings)) return [];
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

/** A domain review writes its run id into the report; only a "run not found"
    answer makes the line a miss, since a daemon that cannot answer says
    nothing about the run. */
async function hasRun(handle: string, getRun: GetRun): Promise<boolean> {
  let markdown: string;
  try {
    markdown = readFileSync(reviewReportPath(handle), 'utf8');
  } catch {
    return false;
  }
  const id = [...markdown.matchAll(/^review-run:[ \t]*(\S+)[ \t]*$/gm)].at(
    -1
  )?.[1];
  if (!id) return false;
  const res = await getRun(id);
  return res.ok || res.error !== 'run not found';
}

/** The context a review-post gate opens with. Over this run's structured
    report, throws one GateRefused naming everything missing: the fitted
    context (unless `plainReason` says why it could not be built, which then
    heads the gate's context, where the human reads it) and the recorded run
    (unless `noRunReason` says why it could not be entered). */
export async function reviewPostContext(
  handle: string,
  runStartedAt: number,
  questions: GateQuestion[],
  extras: { context?: string; plainReason?: string; noRunReason?: string },
  getRun: GetRun
): Promise<string | undefined> {
  const { context } = extras;
  const ids = structuredFindingIds(handle, runStartedAt);
  if (ids === null) return context;
  const fitted = carriesFindings(questions, context, ids);
  const plainReason = extras.plainReason?.trim();
  const problems: string[] = [];
  if (!fitted && !plainReason) problems.push(PLAIN_PROBLEM);
  if (!extras.noRunReason?.trim() && !(await hasRun(handle, getRun)))
    problems.push(NO_RUN_PROBLEM);
  if (problems.length > 0)
    throw new GateRefused(['gate open refused:', ...problems].join('\n'));
  if (fitted) return context;
  const prose = paneContext(context);
  return [`Plain gate: ${plainReason}`, ...(prose ? [prose] : [])].join('\n\n');
}
