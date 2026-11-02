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
  /** The gate the draft was saved on. A draft restores only onto that gate
      or the one that superseded it (`draftRestorableOn`), so it never crosses
      into a different review run; a draft without one restores nothing. */
  gateId?: string;
}

/** `GET /review/sheet-draft?mr=&gate=`'s reply: the MR's draft, and the gate
    the asked-for gate superseded while the board's gate cache still holds it
    (`GateCache.supersededBy`), else null. */
export interface SheetDraftReply {
  draft: SheetDraft | null;
  previousGateId: string | null;
}

/** Whether a saved draft belongs to the gate on screen: saved on it, or on
    the gate it superseded (the review agent re-raised it after revising a
    finding). A draft with no gate id restores nothing. */
export function draftRestorableOn(
  draft: SheetDraft,
  gateId: string,
  previousGateId: string | null
): boolean {
  if (!draft.gateId) return false;
  return draft.gateId === gateId || draft.gateId === previousGateId;
}

/** The GET reply from untrusted JSON; anything malformed reads as no
    draft. */
export function parseSheetDraftReply(x: unknown): SheetDraftReply {
  if (typeof x !== 'object' || x === null)
    return { draft: null, previousGateId: null };
  const { draft, previousGateId } = x as Record<string, unknown>;
  return {
    draft: parseSheetDraft(draft),
    previousGateId: typeof previousGateId === 'string' ? previousGateId : null,
  };
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
    six the sheet reads back. A draft with no `known` (a row saved before it
    existed) reads as knowing nothing, which restores nothing. */
export function parseSheetDraft(x: unknown): SheetDraft | null {
  if (typeof x !== 'object' || x === null) return null;
  const { ticked, known, texts, outcome, notes, gateId } = x as Record<
    string,
    unknown
  >;
  if (!isStrings(ticked)) return null;
  if (known !== undefined && !isStrings(known)) return null;
  if (!isStringRecord(texts) || !isStringRecord(notes)) return null;
  if (outcome !== undefined && typeof outcome !== 'string') return null;
  if (gateId !== undefined && typeof gateId !== 'string') return null;
  return {
    ticked: [...ticked],
    known: known ? [...known] : [],
    texts: { ...texts },
    ...(outcome !== undefined ? { outcome } : {}),
    notes: { ...notes },
    ...(gateId ? { gateId } : {}),
  };
}
