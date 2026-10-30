import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import {
  cachedUpload,
  casLatch,
  clearReplyDue,
  putLatchRow,
  readLatchRow,
  readLatchRows,
  rememberUpload,
  type LatchRow,
} from '../latch/latch-state.ts';
import { openStateDb } from '../state/db.ts';

const MR = 'https://gitlab.example/g/p/-/merge_requests/1';

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'board-latch-')), 'state.db');
}

function row(overrides: Partial<LatchRow> = {}): LatchRow {
  return {
    mrUrl: MR,
    discussionId: 'disc-1',
    rootNoteId: 11,
    phase: 'armed',
    wait: null,
    launchAt: null,
    failures: 0,
    stuck: false,
    variant: null,
    replyDue: null,
    updatedAt: 100,
    ...overrides,
  };
}

describe('latch state', () => {
  test('put and read round-trip every field', () => {
    const db = openStateDb(tempPath());
    const r = row({
      phase: 'queued',
      wait: 'cooldown',
      launchAt: 500,
      failures: 2,
      stuck: true,
      variant: 'queued-cooldown',
      replyDue: 'Follow-up review done.',
    });
    putLatchRow(r, db);
    expect(readLatchRow(MR, db)).toEqual(r);
    expect(readLatchRows(db)).toEqual([r]);
    expect(readLatchRow('https://gitlab.example/none', db)).toBeNull();
  });

  test('casLatch moves only from a listed phase', () => {
    const db = openStateDb(tempPath());
    putLatchRow(row({ phase: 'queued' }), db);
    expect(casLatch(MR, ['armed'], { phase: 'running' }, 200, db)).toBe(false);
    expect(readLatchRow(MR, db)!.phase).toBe('queued');
    expect(casLatch(MR, ['queued'], { phase: 'running' }, 200, db)).toBe(true);
    const after = readLatchRow(MR, db)!;
    expect(after.phase).toBe('running');
    expect(after.updatedAt).toBe(200);
  });

  test('casLatch guarded by another discussion does not move the row', () => {
    const db = openStateDb(tempPath());
    putLatchRow(row({ phase: 'armed', discussionId: 'disc-1' }), db);
    const patch = { phase: 'spent' as const };
    expect(
      casLatch(MR, ['armed'], patch, 200, db, { discussionId: 'disc-2' })
    ).toBe(false);
    expect(readLatchRow(MR, db)!.phase).toBe('armed');
    expect(
      casLatch(MR, ['armed'], patch, 200, db, { discussionId: 'disc-1' })
    ).toBe(true);
    expect(readLatchRow(MR, db)!.phase).toBe('spent');
  });

  test('casLatch clears a field patched to null and ignores a missing row', () => {
    const db = openStateDb(tempPath());
    putLatchRow(row({ phase: 'error', wait: 'budget', launchAt: 5 }), db);
    const patch = { phase: 'armed' as const, wait: null, launchAt: null };
    expect(casLatch(MR, ['error'], patch, 300, db)).toBe(true);
    const after = readLatchRow(MR, db)!;
    expect(after.wait).toBeNull();
    expect(after.launchAt).toBeNull();
    expect(
      casLatch(
        'https://gitlab.example/none',
        ['armed'],
        { phase: 'spent' },
        1,
        db
      )
    ).toBe(false);
  });

  test('casLatch ignores undefined patch values', () => {
    const db = openStateDb(tempPath());
    putLatchRow(row({ phase: 'queued', wait: 'budget', launchAt: 9 }), db);
    expect(
      casLatch(MR, ['queued'], { phase: 'running', wait: undefined }, 200, db)
    ).toBe(true);
    const after = readLatchRow(MR, db)!;
    expect(after.phase).toBe('running');
    expect(after.wait).toBe('budget');
    expect(after.launchAt).toBe(9);
  });

  test('two cas racing from the same phase, only one wins', () => {
    const db = openStateDb(tempPath());
    putLatchRow(row({ phase: 'queued' }), db);
    const first = casLatch(MR, ['queued'], { phase: 'running' }, 200, db);
    const second = casLatch(MR, ['queued'], { phase: 'error' }, 201, db);
    expect([first, second]).toEqual([true, false]);
    expect(readLatchRow(MR, db)!.phase).toBe('running');
  });

  test('upload cache round-trips per variant', () => {
    const db = openStateDb(tempPath());
    expect(cachedUpload(MR, 'armed', db)).toBeNull();
    rememberUpload(MR, 'armed', '![a](/uploads/a.png)', db);
    rememberUpload(MR, 'queued', '![q](/uploads/q.png)', db);
    expect(cachedUpload(MR, 'armed', db)).toBe('![a](/uploads/a.png)');
    expect(cachedUpload(MR, 'queued', db)).toBe('![q](/uploads/q.png)');
    rememberUpload(MR, 'armed', '![b](/uploads/b.png)', db);
    expect(cachedUpload(MR, 'armed', db)).toBe('![b](/uploads/b.png)');
  });

  test('migration takes a v6 db to v7', () => {
    const path = tempPath();
    const first = openStateDb(path);
    first.run('DROP TABLE latch_state');
    first.run('DROP TABLE latch_uploads');
    first.run('PRAGMA user_version = 6');
    first.close();
    const db = openStateDb(path);
    expect(
      (db.query('PRAGMA user_version').get() as { user_version: number })
        .user_version
    ).toBe(7);
    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map(t => t.name);
    expect(tables).toContain('latch_state');
    expect(tables).toContain('latch_uploads');
    const cols = (
      db.query('PRAGMA table_info(latch_state)').all() as { name: string }[]
    ).map(c => c.name);
    expect(cols).toContain('reply_due');
  });

  test('clearReplyDue clears only the reply still owed on that discussion', () => {
    const db = openStateDb(tempPath());
    putLatchRow(row({ replyDue: 'Follow-up review done.' }), db);
    expect(clearReplyDue(MR, 'disc-2', 'Follow-up review done.', db)).toBe(
      false
    );
    expect(clearReplyDue(MR, 'disc-1', 'Other reply.', db)).toBe(false);
    expect(readLatchRow(MR, db)!.replyDue).toBe('Follow-up review done.');
    expect(clearReplyDue(MR, 'disc-1', 'Follow-up review done.', db)).toBe(
      true
    );
    expect(readLatchRow(MR, db)!.replyDue).toBeNull();
  });
});
