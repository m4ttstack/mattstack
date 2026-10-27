/** The review sheet draft's wire shape check, shared by the PUT route, the
    kv store and the client's read of the GET. It lives apart from
    review-sheet-draft.ts because that module opens the sqlite state db and
    the client bundle cannot. */

/** The review sheet's unsent state: which findings are ticked, their
    editable texts, the chosen outcome and per-finding notes. */
export interface SheetDraft {
  ticked: string[];
  /** Every finding id the sheet showed when the draft was saved. A finding
      absent here is new to the gate being restored onto, so it keeps its
      default rather than reading as "unticked". */
  known: string[];
  texts: Record<string, string>;
  outcome?: string;
  notes: Record<string, string>;
}

const isStringRecord = (x: unknown): x is Record<string, string> =>
  typeof x === 'object' &&
  x !== null &&
  !Array.isArray(x) &&
  Object.values(x).every(v => typeof v === 'string');

const isStrings = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every(t => typeof t === 'string');

/** A sheet draft from untrusted JSON, or null when any part has the wrong
    shape. Unknown fields are dropped, so a stored row only ever holds the
    five the sheet reads back. A draft with no `known` (a row saved before it
    existed) reads as knowing nothing, which restores nothing. */
export function parseSheetDraft(x: unknown): SheetDraft | null {
  if (typeof x !== 'object' || x === null) return null;
  const { ticked, known, texts, outcome, notes } = x as Record<string, unknown>;
  if (!isStrings(ticked)) return null;
  if (known !== undefined && !isStrings(known)) return null;
  if (!isStringRecord(texts) || !isStringRecord(notes)) return null;
  if (outcome !== undefined && typeof outcome !== 'string') return null;
  return {
    ticked: [...ticked],
    known: known ? [...known] : [],
    texts: { ...texts },
    ...(outcome !== undefined ? { outcome } : {}),
    notes: { ...notes },
  };
}
