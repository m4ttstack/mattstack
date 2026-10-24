/** The review sheet draft's wire shape check, shared by the PUT route and the
    client's read of the GET. It lives apart from question-state.ts because
    that module opens the sqlite state db and the client bundle cannot. */

/** The review sheet's unsent state: which findings are ticked, their
    editable texts, the chosen outcome and per-finding notes. */
export interface SheetDraft {
  ticked: string[];
  texts: Record<string, string>;
  outcome?: string;
  notes: Record<string, string>;
}

const isStringRecord = (x: unknown): x is Record<string, string> =>
  typeof x === 'object' &&
  x !== null &&
  !Array.isArray(x) &&
  Object.values(x).every(v => typeof v === 'string');

/** A sheet draft from untrusted JSON, or null when any part has the wrong
    shape. Unknown fields are dropped, so a stored row only ever holds the
    four the sheet reads back. */
export function parseSheetDraft(x: unknown): SheetDraft | null {
  if (typeof x !== 'object' || x === null) return null;
  const { ticked, texts, outcome, notes } = x as Record<string, unknown>;
  if (!Array.isArray(ticked) || !ticked.every(t => typeof t === 'string'))
    return null;
  if (!isStringRecord(texts) || !isStringRecord(notes)) return null;
  if (outcome !== undefined && typeof outcome !== 'string') return null;
  return {
    ticked: [...ticked],
    texts: { ...texts },
    ...(outcome !== undefined ? { outcome } : {}),
    notes: { ...notes },
  };
}
