import { useCallback, useEffect, useState } from 'react';
import type { GateSelections } from '@mattstack/gate-kit';
import type { GateRow } from '@mattstack/rt-client';

import { isWaiting } from '../../../shared/gate-waiting';

/** What the gate panel keeps between visits: the picks, the per-question
    notes and the question on screen. */
export interface GateDraft {
  selections: GateSelections;
  notes: Record<string, string>;
  item: string | null;
  /** Multi-select questions skipped on purpose, answered as "none". */
  skipped?: string[];
}

export function gateDraftKey(gateId: string): string {
  return `console.gateDraft.${gateId}`;
}

/** The `localStorage` getter itself throws when a browser blocks site data,
    and `setItem` throws on quota; the panel must never see either. */
function guarded<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function strings(v: unknown): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (v === null || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'string') out[k] = x;
    else if (Array.isArray(x) && x.every(e => typeof e === 'string'))
      out[k] = x as string[];
  }
  return out;
}

function parseDraft(raw: string | null): GateDraft | null {
  if (raw === null) return null;
  const parsed = guarded<unknown>(() => JSON.parse(raw), null);
  if (parsed === null || typeof parsed !== 'object') return null;
  const { selections, notes, item, skipped } = parsed as Record<
    string,
    unknown
  >;
  const noteStrings: Record<string, string> = {};
  for (const [k, v] of Object.entries(strings(notes)))
    if (typeof v === 'string') noteStrings[k] = v;
  return {
    selections: strings(selections),
    notes: noteStrings,
    item: typeof item === 'string' ? item : null,
    skipped: Array.isArray(skipped)
      ? skipped.filter((n): n is string => typeof n === 'string')
      : [],
  };
}

/** An emptied multi counts as a pick: it records a deliberate "none". */
function draftIsEmpty(draft: GateDraft): boolean {
  const picked = Object.values(draft.selections).some(
    v => Array.isArray(v) || v.length > 0
  );
  const noted = Object.values(draft.notes).some(n => n.trim().length > 0);
  return !picked && !noted && (draft.skipped?.length ?? 0) === 0;
}

export function readGateDraft(gateId: string): GateDraft | null {
  return guarded(
    () => parseDraft(localStorage.getItem(gateDraftKey(gateId))),
    null
  );
}

/** Stores a draft, or removes the entry for an empty one. True only when a
    draft with something in it is now stored. */
export function writeGateDraft(gateId: string, draft: GateDraft): boolean {
  return guarded(() => {
    if (draftIsEmpty(draft)) {
      localStorage.removeItem(gateDraftKey(gateId));
      return false;
    }
    localStorage.setItem(gateDraftKey(gateId), JSON.stringify(draft));
    return true;
  }, false);
}

export function clearGateDraft(gateId: string): void {
  guarded(() => localStorage.removeItem(gateDraftKey(gateId)), undefined);
}

/** One gate's draft: `initial` is read once on mount, `save` reports through
    `saved` whether a draft is now stored, `clear` drops it. */
export function useGateDraft(gateId: string) {
  const [initial] = useState(() => readGateDraft(gateId));
  const [saved, setSaved] = useState(initial !== null);
  const save = useCallback(
    (draft: GateDraft) => setSaved(writeGateDraft(gateId, draft)),
    [gateId]
  );
  const clear = useCallback(() => {
    clearGateDraft(gateId);
    setSaved(false);
  }, [gateId]);
  return { initial, saved, save, clear };
}

/** Drops the drafts of this run's gates that can no longer be answered. A
    panel unmounts with its gate, so it cannot clear its own. */
export function usePruneGateDrafts(gates: GateRow[]): void {
  useEffect(() => {
    for (const g of gates) if (!isWaiting(g)) clearGateDraft(g.id);
  }, [gates]);
}
