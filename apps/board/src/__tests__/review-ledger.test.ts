import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { insertAgentState, mintHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';

let dir: string;
let dbPath: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rl-'));
  dbPath = join(dir, 'state.db');
  db = openStateDb(dbPath);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CLI = join(import.meta.dir, '..', '..', 'bin', 'review-ledger.ts');
const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';

// Port 1 needs root to bind, so a connection refusal here is deterministic --
// this pins every CLI invocation in this file off any board that might
// actually be listening on the configured port.
function env() {
  return { ...process.env, MR_BOARD_PORT: '1', BOARD_STATE_DB: dbPath };
}

function seed(handle: string, iid: number): void {
  insertAgentState(
    'review',
    URL_A,
    iid,
    { mrUrl: URL_A, iid, status: 'queued', startedAt: 0, updatedAt: 0 },
    handle,
    db
  );
}

describe('review-ledger CLI', () => {
  async function run(args: string[]) {
    const proc = Bun.spawn(['bun', 'run', CLI, ...args], {
      env: env(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, out, err] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code, out: out.trim(), err: err.trim() };
  }

  test('read on an MR with no rounds answers round 0', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const r = await run(['read', handle]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      round: 0,
      reviewedSha: null,
      rounds: [],
      skipped: [],
      confirmed: [],
    });
  });

  test('record then read round-trips, qualifying skipped ids', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const skipped = JSON.stringify([
      {
        id: 'f3',
        title: 'unused import',
        severity: 'minor',
        file: 'src/a.ts',
        line: 4,
        excerpt: 'e',
        snippet: 's',
      },
    ]);
    const rec = await run([
      'record',
      handle,
      '--round',
      '1',
      '--sha',
      'abc123',
      '--outcome',
      'comment',
      '--skipped',
      skipped,
      '--confirmed',
      '["d9"]',
    ]);
    expect(rec.code).toBe(0);
    expect(JSON.parse(rec.out)).toEqual({ ok: true, round: 1 });
    const view = JSON.parse((await run(['read', handle])).out);
    expect(view.round).toBe(1);
    expect(view.reviewedSha).toBe('abc123');
    expect(view.skipped).toEqual([
      {
        id: 'r1-f3',
        title: 'unused import',
        severity: 'minor',
        file: 'src/a.ts',
        line: 4,
        excerpt: 'e',
        snippet: 's',
        round: 1,
      },
    ]);
    expect(view.confirmed).toEqual(['d9']);
  });

  test('a restore in a later round removes the finding from the read', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const skipped = JSON.stringify([
      { id: 'f3', title: 't', severity: 'minor', excerpt: 'e', snippet: 's' },
    ]);
    await run([
      'record',
      handle,
      '--round',
      '1',
      '--sha',
      'a',
      '--outcome',
      'comment',
      '--skipped',
      skipped,
    ]);
    await run([
      'record',
      handle,
      '--round',
      '2',
      '--sha',
      'b',
      '--outcome',
      'comment',
      '--restored',
      '["r1-f3"]',
    ]);
    expect(JSON.parse((await run(['read', handle])).out).skipped).toEqual([]);
  });

  test('bad input exits 1 with a reason and writes nothing', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const cases: Array<[string[], RegExp]> = [
      [
        [
          'record',
          handle,
          '--round',
          '0',
          '--sha',
          'a',
          '--outcome',
          'comment',
        ],
        /--round must be a positive integer/,
      ],
      [
        ['record', handle, '--round', '1', '--outcome', 'comment'],
        /--sha is required/,
      ],
      [
        [
          'record',
          handle,
          '--round',
          '1',
          '--sha',
          'a',
          '--outcome',
          'request_changes',
        ],
        /--outcome must be one of comment\|approve/,
      ],
      [
        [
          'record',
          handle,
          '--round',
          '1',
          '--sha',
          'a',
          '--outcome',
          'comment',
          '--skipped',
          '{',
        ],
        /--skipped must be a JSON array/,
      ],
      [
        [
          'record',
          handle,
          '--round',
          '1',
          '--sha',
          'a',
          '--outcome',
          'comment',
          '--skipped',
          '[{"id":"f1"}]',
        ],
        /--skipped\[0\]: id, title, severity and excerpt are required/,
      ],
      [
        [
          'record',
          handle,
          '--round',
          '1',
          '--sha',
          'a',
          '--outcome',
          'comment',
          '--restored',
          '[1]',
        ],
        /--restored must be a JSON array of strings/,
      ],
      [['frobnicate', handle], /usage: review-ledger/],
    ];
    for (const [args, want] of cases) {
      const r = await run(args);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(want);
    }
    expect(JSON.parse((await run(['read', handle])).out).round).toBe(0);
  }, 60_000);

  test('a handle with no review row exits 1', async () => {
    const r = await run(['read', mintHandle('review', URL_A, dir)]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no state row/);
  });
});
