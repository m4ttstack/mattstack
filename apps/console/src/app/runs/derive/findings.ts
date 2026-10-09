export type FindingSeverity = 'critical' | 'important' | 'minor';

export interface ParsedFinding {
  severity: FindingSeverity | null;
  text: string;
  where: string | null;
}

const SEVERITY = /^\[(critical|important|minor)\]\s*/i;
const NON_BLOCKING = /^\[non-blocking\]\s*/i;
const WHERE = /\s*\(([^()\s]+(?::\d+)?)\)\s*$/;

/** A review finding's line split into its severity tag, text and the
    `(path:line)` it ends on. */
export function parseFinding(text: string): ParsedFinding {
  let rest = text.trim();
  let severity: ParsedFinding['severity'] = null;
  const tag = SEVERITY.exec(rest);
  if (tag) {
    severity = tag[1]!.toLowerCase() as FindingSeverity;
    rest = rest.slice(tag[0].length);
  }
  rest = rest.replace(NON_BLOCKING, '');
  const at = WHERE.exec(rest);
  if (at) rest = rest.slice(0, at.index);
  return { severity, text: rest.trim(), where: at ? at[1]! : null };
}
