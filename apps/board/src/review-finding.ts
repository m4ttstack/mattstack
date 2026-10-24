/** One finding from the review agent's structured report (version 3 of the
    findings file, see the review-core-body-tail skill). The questions agent,
    the revision flow and the review sheet all read this one shape, so it
    lives here rather than in any of their layers. `comment` is the drafted
    text that posts; `evidence` is verbatim command output, a string. */
export interface ReportFinding {
  id: string;
  tier: 'Critical' | 'Important' | 'Minor';
  kind?: string;
  title: string;
  body: string;
  fix?: string;
  file?: string;
  line?: number | string;
  fileLabel?: string;
  evidence?: string;
  comment: string;
}

const TIERS = new Set(['Critical', 'Important', 'Minor']);

function optString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Reads one finding out of untrusted json (a revision file the questions
    agent wrote). Null unless every required field is present with the right
    type; optional fields of the wrong type are dropped, not trusted. */
export function parseReportFinding(x: unknown): ReportFinding | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (
    typeof o.id !== 'string' ||
    typeof o.tier !== 'string' ||
    !TIERS.has(o.tier) ||
    typeof o.title !== 'string' ||
    typeof o.body !== 'string' ||
    typeof o.comment !== 'string'
  )
    return null;
  const f: ReportFinding = {
    id: o.id,
    tier: o.tier as ReportFinding['tier'],
    title: o.title,
    body: o.body,
    comment: o.comment,
  };
  const kind = optString(o.kind);
  if (kind !== undefined) f.kind = kind;
  const fix = optString(o.fix);
  if (fix !== undefined) f.fix = fix;
  const file = optString(o.file);
  if (file !== undefined) f.file = file;
  if (typeof o.line === 'number' || typeof o.line === 'string') f.line = o.line;
  const fileLabel = optString(o.fileLabel);
  if (fileLabel !== undefined) f.fileLabel = fileLabel;
  const evidence = optString(o.evidence);
  if (evidence !== undefined) f.evidence = evidence;
  return f;
}
