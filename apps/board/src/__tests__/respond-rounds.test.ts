import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { readRespondRounds, recordRespondRound } from '../respond-rounds.ts';
import { openStateDb } from '../state/db.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rr-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const URL_A = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
const URL_B = 'https://gitlab.com/acme/webapp/-/merge_requests/4822';

describe('respond rounds', () => {
  test('first round for a person is 1, then 2', () => {
    expect(recordRespondRound(URL_A, 'john', 1, db)).toBe(1);
    expect(recordRespondRound(URL_A, 'john', 2, db)).toBe(2);
  });

  test('rounds are per person', () => {
    recordRespondRound(URL_A, 'john', 1, db);
    recordRespondRound(URL_A, 'john', 2, db);
    recordRespondRound(URL_A, 'darryl', 3, db);
    expect(readRespondRounds(db).get(URL_A)).toEqual({ john: 2, darryl: 1 });
  });

  test('rounds for one MR do not advance another', () => {
    recordRespondRound(URL_A, 'john', 1, db);
    recordRespondRound(URL_A, 'john', 2, db);
    expect(recordRespondRound(URL_B, 'john', 3, db)).toBe(1);
    expect(readRespondRounds(db).get(URL_B)).toEqual({ john: 1 });
  });
});
