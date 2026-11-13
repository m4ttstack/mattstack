import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  __setRosterReader,
  __setSettingReader,
} from '../src/server/config/index.js';
import { resolvePreset } from '../src/server/util/window.js';

const during = vi.hoisted(() => ({ userLookup: async () => {} }));

vi.mock('../src/server/config/current-user.js', () => ({
  getCurrentUser: async () => {
    await during.userLookup();
    return null;
  },
  __setCurrentUser: () => {},
  __resetCurrentUser: () => {},
}));

const dir = mkdtempSync(join(tmpdir(), 'boxscore-host-race-'));
process.env.BOXSCORE_DB = join(dir, 'test.sqlite');

const { getLeaderboard } = await import('../src/server/leaderboard.js');
const { getStore, __resetStore } = await import('../src/server/store/index.js');

const PROJECT = 'acme/app';
const SETTINGS: Record<string, unknown> = {
  'boxscore.projects': [PROJECT],
  'rt.integrations': { forgeHost: 'gl.example' },
};

beforeAll(() => {
  __setSettingReader(<T>(k: string) => SETTINGS[k] as T | undefined);
  __setRosterReader(() => [{ username: 'alice' }]);
  process.env.GITLAB_TOKEN = 'test-token';
});
afterAll(() => {
  __setSettingReader(null);
  __setRosterReader(null);
  __resetStore();
  rmSync(dir, { recursive: true, force: true });
});

describe('getLeaderboard: the host changes while a request waits', () => {
  it("refuses to serve rows once another host took the store, instead of labelling them with this one's", async () => {
    const window = resolvePreset('30d', new Date());
    getStore().clear();
    during.userLookup = async () => {
      getStore().adoptForgeHost('https://gl.other.example');
      getStore().upsertIndexRows([
        {
          projectPath: PROJECT,
          iid: 7,
          title: 'other host MR',
          state: 'merged',
          createdAt: window.start,
          updatedAt: window.end,
          mergedAt: window.end,
          authorUsername: 'alice',
          sourceBranch: 'b',
          labels: [],
          scannedAt: window.end,
        },
      ]);
    };

    await expect(
      getLeaderboard({ window, refresh: false, trend: false })
    ).rejects.toThrow('the confirmed GitLab host changed');
  });
});
