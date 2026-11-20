/** The row's note store (B10): what a save keeps, what an empty save
    clears, and how a note reaches /data.json. */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import {
  attachNotes,
  MAX_NOTE_LEN,
  readNotes,
  writeNote,
} from '../row-note.ts';
import { openStateDb } from '../state/db.ts';
import { setKvValue } from '../state/index.ts';

const db = openStateDb(
  join(mkdtempSync(join(tmpdir(), 'board-note-')), 'state.db')
);
afterAll(() => db.close());

const MR = 'https://gitlab.example.com/g/p/-/merge_requests/7';
const OTHER = 'https://gitlab.example.com/g/p/-/merge_requests/8';

const AT = Date.parse('2026-11-20T15:00:00.000Z');

test('a note round-trips, trimmed, with when it was saved', () => {
  expect(writeNote(MR, '  rebase after !8 lands  ', db, AT)).toEqual({
    text: 'rebase after !8 lands',
    at: '2026-11-20T15:00:00.000Z',
  });
  expect(readNotes(db).get(MR)).toEqual({
    text: 'rebase after !8 lands',
    at: '2026-11-20T15:00:00.000Z',
  });
});

test('a second save replaces the first, and its time', () => {
  writeNote(MR, 'first', db, AT);
  writeNote(MR, 'second', db, AT + 60_000);
  expect(readNotes(db).get(MR)).toEqual({
    text: 'second',
    at: '2026-11-20T15:01:00.000Z',
  });
});

test('saving the same words keeps when the note was written', () => {
  writeNote(MR, 'waiting on QA', db, AT);
  expect(writeNote(MR, '  waiting on QA ', db, AT + 86_400_000)).toEqual({
    text: 'waiting on QA',
    at: '2026-11-20T15:00:00.000Z',
  });
  expect(readNotes(db).get(MR)?.at).toBe('2026-11-20T15:00:00.000Z');
});

test('a note saved before notes carried a time reads with none', () => {
  setKvValue('row-note', MR, 'from before', db);
  expect(readNotes(db).get(MR)).toEqual({ text: 'from before' });
});

test('an empty save clears the note, and clears only that MR', () => {
  writeNote(MR, 'mine', db);
  writeNote(OTHER, 'theirs', db);
  expect(writeNote(MR, '   \n ', db)).toBeUndefined();
  const notes = readNotes(db);
  expect(notes.has(MR)).toBe(false);
  expect(notes.get(OTHER)?.text).toBe('theirs');
});

test('a note is capped, not refused', () => {
  const long = 'x'.repeat(MAX_NOTE_LEN + 50);
  expect(writeNote(MR, long, db)!.text.length).toBe(MAX_NOTE_LEN);
  writeNote(MR, '', db);
});

test('attachNotes hangs the note and its time on its own MR only', () => {
  const notes = new Map([
    [MR, { text: 'mine', at: '2026-11-20T15:00:00.000Z' }],
    [OTHER, { text: 'old' }],
  ]);
  const rows = attachNotes(
    [{ webUrl: MR, iid: 7 }, { webUrl: OTHER, iid: 8 }, { iid: 9 }],
    notes
  );
  expect(rows[0]!.note).toBe('mine');
  expect(rows[0]!.noteAt).toBe('2026-11-20T15:00:00.000Z');
  expect(rows[1]!.note).toBe('old');
  expect('noteAt' in rows[1]!).toBe(false);
  expect(rows[2]!.note).toBeUndefined();
});
