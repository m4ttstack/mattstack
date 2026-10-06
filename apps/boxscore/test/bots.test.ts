import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __setRosterReader,
  __setSettingReader,
} from '../src/server/config/index.js';
import type { IndexRow } from '../src/server/store/index.js';

const dir = mkdtempSync(join(tmpdir(), 'boxscore-bots-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getStore } = await import('../src/server/store/index.js');
const { scanSuspectedBots } = await import('../src/server/bots.js');

const row = (iid: number, authorUsername: string): IndexRow => ({
  projectPath: 'acme/widgets',
  iid,
  title: 't',
  state: 'merged',
  createdAt: '2026-07-09T00:00:00.000Z',
  updatedAt: '2026-07-09T00:00:00.000Z',
  mergedAt: '2026-07-09T12:00:00.000Z',
  authorUsername,
  sourceBranch: 'feat/x',
  labels: [],
  scannedAt: '2026-07-09T13:00:00.000Z',
});

beforeEach(() => getStore().clear());
afterEach(() => {
  __setSettingReader(null);
  __setRosterReader(null);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('scanSuspectedBots', () => {
  it('never flags an org member on another team, only names outside the org', async () => {
    const org = [
      { username: 'dev1', teams: ['widgets'] },
      { username: 'deploy_bot', teams: ['gadgets'] },
    ];
    __setSettingReader(<T>(key: string) =>
      key === 'mattstack.roster' ? (org as T) : undefined
    );
    __setRosterReader(() => [{ username: 'dev1' }]);
    getStore().upsertIndexRows([
      row(1, 'dev1'),
      row(2, 'deploy_bot'),
      row(3, 'release_bot'),
    ]);
    const flagged = (await scanSuspectedBots([])).map(b => b.username);
    expect(flagged).toEqual(['release_bot']);
  });
});
