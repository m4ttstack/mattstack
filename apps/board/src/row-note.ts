/** A note the board's seat writes on one MR, for itself: a line of plain
    text kept in the board's own state db, attached to /data.json, and never
    sent to GitLab, Slack or a pane. Notes are not pruned when an MR leaves
    the board -- they are hand-written, tiny, and an MR that comes back
    should still carry what its reader said about it. */

import { Database } from 'bun:sqlite';

import {
  deleteKvValue,
  getKvValue,
  listKvValues,
  setKvValue,
} from './state/index.ts';

export const NOTE_NS = 'row-note';
export const MAX_NOTE_LEN = 2000;

/** Trim, cap, and collapse the empty forms to undefined: an empty save is
    how the editor clears a note, so "" and "   " are a delete, not a note. */
export function normalizeNote(text: string): string | undefined {
  const trimmed = text.trim().slice(0, MAX_NOTE_LEN);
  return trimmed || undefined;
}

/** `at` is when the note was last saved (ISO). Notes saved before the
    store kept a time are bare strings in the kv and read with no `at`. */
export type StoredNote = { text: string; at?: string };

function toStoredNote(value: unknown): StoredNote | undefined {
  if (typeof value === 'string') return value ? { text: value } : undefined;
  if (!value || typeof value !== 'object') return undefined;
  const { text, at } = value as { text?: unknown; at?: unknown };
  if (typeof text !== 'string' || !text) return undefined;
  return typeof at === 'string' ? { text, at } : { text };
}

export function readNotes(db?: Database): Map<string, StoredNote> {
  const out = new Map<string, StoredNote>();
  for (const [key, value] of listKvValues(NOTE_NS, db)) {
    const note = toStoredNote(value);
    if (note) out.set(key, note);
  }
  return out;
}

/** Write or clear one MR's note. Returns what the row now carries, so the
    route can answer with the stored form rather than the typed one. */
export function writeNote(
  mrUrl: string,
  text: string,
  db?: Database,
  now: number = Date.now()
): StoredNote | undefined {
  const normalized = normalizeNote(text);
  if (normalized === undefined) {
    deleteKvValue(NOTE_NS, mrUrl, db);
    return undefined;
  }
  const prior = toStoredNote(
    getKvValue<unknown>(NOTE_NS, mrUrl, undefined, db)
  );
  // The same words saved again are not a new note: keep when it was written.
  if (prior?.at && prior.text === normalized) return prior;
  const note = { text: normalized, at: new Date(now).toISOString() };
  setKvValue(NOTE_NS, mrUrl, note, db);
  return note;
}

export function attachNotes<T extends { webUrl?: string | null }>(
  mrs: T[],
  notes: Map<string, StoredNote>
): Array<T & { note?: string; noteAt?: string }> {
  return mrs.map(mr => {
    const note = mr.webUrl ? notes.get(mr.webUrl) : undefined;
    if (!note) return mr;
    return note.at
      ? { ...mr, note: note.text, noteAt: note.at }
      : { ...mr, note: note.text };
  });
}
