import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __setRosterReader,
  __setSettingReader,
} from '../src/server/config/index.js';
import type { IndexRow } from '../src/server/store/index.js';
import { BUILTIN_BOT_PATTERN_LABELS } from '../src/shared/bots.js';

const dir = mkdtempSync(join(tmpdir(), 'boxscore-bots-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getStore } = await import('../src/server/store/index.js');
const { scanSuspectedBots } = await import('../src/server/bots.js');
const { isBotUsername } = await import('../src/server/metrics/stats.js');

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

describe('scanSuspectedBots after a host change', () => {
  it("flags nobody from the previous host's rows", async () => {
    __setSettingReader(<T>(key: string) =>
      key === 'rt.integrations'
        ? ({ forgeHost: 'gl.other.example' } as T)
        : undefined
    );
    __setRosterReader(() => []);
    getStore().adoptForgeHost('https://gl.example');
    getStore().upsertIndexRows([row(1, 'release_bot')]);

    expect(await scanSuspectedBots([])).toEqual([]);
  });
});

describe('GitHub bots', () => {
  it('lists dependabot[bot] from a stored note on a GitHub store', async () => {
    __setSettingReader(<T>(key: string) =>
      key === 'mattstack.integrations'
        ? ({ forge: { provider: 'github', host: 'github.com' } } as T)
        : undefined
    );
    __setRosterReader(() => [{ username: 'ada' }]);
    getStore().adoptForgeHost('https://github.com');
    getStore().upsertIndexRows([{ ...row(1, 'ada'), projectPath: 'o/r' }]);
    getStore().upsertMrMetrics([
      {
        projectPath: 'o/r',
        iid: 1,
        description: '',
        diffStats: { additions: 1, deletions: 0, filesChanged: 1 },
        fileStats: [],
        labels: [],
        approvedByUsernames: [],
        notes: [
          {
            authorUsername: 'dependabot[bot]',
            createdAt: '2026-07-09T02:00:00.000Z',
            system: false,
            inline: false,
          },
        ],
      },
    ]);
    const flagged = (await scanSuspectedBots([])).map(b => b.username);
    expect(flagged).toEqual(['dependabot[bot]']);
  });

  it('treats [bot] accounts as bots and people and GitLab bots as before', () => {
    expect(isBotUsername('dependabot[bot]')).toBe(true);
    expect(isBotUsername('github-actions[bot]')).toBe(true);
    expect(isBotUsername('ada')).toBe(false);
    expect(isBotUsername('project_5_bot_abc')).toBe(true);
  });

  it('labels the [bot] pattern for the settings page', () => {
    expect(BUILTIN_BOT_PATTERN_LABELS).toContain('*[bot]');
  });
});
