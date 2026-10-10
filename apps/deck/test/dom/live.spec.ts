import { expect, test } from 'bun:test';
import type { Page } from 'playwright';

import { withBoard } from './rig.ts';

// The source list's popup is a dialog too, so match the modal frame itself.
const modal = (page: Page) => page.locator('[data-part="modal"]');

test('LIVE column: go live on a ready app, the source on a live one', async () => {
  await withBoard(
    async page => {
      expect(
        await page.getByRole('button', { name: /^run .* live$/ }).count()
      ).toBeGreaterThan(0);
      expect(
        await page
          .getByRole('button', { name: /is live from console-runs-3/ })
          .count()
      ).toBe(1);
      expect(await page.locator('.board-subline').textContent()).toContain(
        '1 live'
      );
    },
    { fixture: 'status-live.json' }
  );
});

const SOURCES = {
  sources: [
    {
      path: '/repo',
      branch: 'main',
      main: true,
      needsSetup: false,
      lastActiveAt: null,
      liveApps: [],
    },
    {
      path: '/wt/a',
      branch: 'console-runs-3',
      main: false,
      needsSetup: false,
      lastActiveAt: '2026-01-02T00:00:00Z',
      liveApps: ['console'],
    },
    {
      path: '/wt/b',
      branch: 'deck-live-mode',
      main: false,
      needsSetup: true,
      lastActiveAt: '2026-01-01T00:00:00Z',
      liveApps: [],
    },
  ],
  error: null,
};

test('go live: the form defaults to main and submits the picked worktree', async () => {
  await withBoard(
    async page => {
      await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
      let put: unknown = null;
      await page.route('**/api/v1/apps/*/live', async r => {
        put = r.request().postDataJSON();
        await r.fulfill({ status: 202, json: { ok: true, setup: 'running' } });
      });
      await page
        .getByRole('button', { name: /^run .* live$/ })
        .first()
        .click();
      const dialog = modal(page);
      expect(
        await dialog
          .getByRole('combobox', { name: 'Code to run' })
          .textContent()
      ).toContain('main');
      await dialog.getByRole('combobox', { name: 'Code to run' }).click();
      await page.getByPlaceholder('Search worktrees').fill('deck');
      await page.keyboard.press('Enter');
      expect(await dialog.textContent()).toContain('Needs setup first.');
      expect(await dialog.textContent()).toContain(
        'Worktrees use your real data.'
      );
      await dialog.getByRole('button', { name: 'Go Live' }).click();
      expect(put).toEqual({ source: '/wt/b' });
    },
    { fixture: 'status-live.json' }
  );
});

test('go live: Escape closes the open list first, then the modal', async () => {
  await withBoard(
    async page => {
      await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
      await page
        .getByRole('button', { name: /^run .* live$/ })
        .first()
        .click();
      await modal(page).getByRole('combobox', { name: 'Code to run' }).click();
      await page.getByPlaceholder('Search worktrees').waitFor();
      await page.keyboard.press('Escape');
      await page
        .getByPlaceholder('Search worktrees')
        .waitFor({ state: 'detached' });
      expect(await modal(page).count()).toBe(1);
      await page.keyboard.press('Escape');
      await modal(page).waitFor({ state: 'detached' });
    },
    { fixture: 'status-live.json' }
  );
});

const WITHOUT = (path: string) => ({
  ...SOURCES,
  sources: SOURCES.sources.filter(s => s.path !== path),
});

test('go live: a failed PUT shows its error and keeps the modal open', async () => {
  await withBoard(
    async page => {
      await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
      await page.route('**/api/v1/apps/*/live', r =>
        r.fulfill({ status: 409, json: { error: 'Port 11140 is taken.' } })
      );
      await page
        .getByRole('button', { name: /^run .* live$/ })
        .first()
        .click();
      const dialog = modal(page);
      await dialog.getByRole('button', { name: 'Go Live' }).click();
      await dialog.getByText('Port 11140 is taken.').waitFor();
      expect(await modal(page).count()).toBe(1);
    },
    { fixture: 'status-live.json' }
  );
});

test('a live app: Switch waits for a different pick, Stop Live sends DELETE', async () => {
  await withBoard(
    async page => {
      await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
      let deleted = false;
      await page.route('**/api/v1/apps/*/live', async r => {
        if (r.request().method() === 'DELETE') deleted = true;
        await r.fulfill({ json: { ok: true } });
      });
      await page
        .getByRole('button', { name: /is live from console-runs-3/ })
        .click();
      const dialog = modal(page);
      expect(
        await dialog.getByRole('button', { name: 'Switch' }).isDisabled()
      ).toBe(true);
      await dialog.getByRole('button', { name: 'Stop Live' }).click();
      await modal(page).waitFor({ state: 'detached' });
      expect(deleted).toBe(true);
      await page.getByText('Live mode stopped').waitFor();
    },
    { fixture: 'status-live.json' }
  );
});

test('a live app whose worktree is gone: picking main enables Switch', async () => {
  await withBoard(
    async page => {
      await page.route('**/live/sources', r =>
        r.fulfill({ json: WITHOUT('/wt/a') })
      );
      let put: unknown = null;
      await page.route('**/api/v1/apps/*/live', async r => {
        put = r.request().postDataJSON();
        await r.fulfill({ json: { ok: true } });
      });
      await page
        .getByRole('button', { name: /is live from console-runs-3/ })
        .click();
      const dialog = modal(page);
      const select = dialog.getByRole('combobox', { name: 'Code to run' });
      await select.waitFor();
      expect(
        await dialog.getByRole('button', { name: 'Switch' }).isDisabled()
      ).toBe(true);
      await select.click();
      await page.getByPlaceholder('Search worktrees').fill('main');
      await page.keyboard.press('Enter');
      expect(
        await dialog.getByRole('button', { name: 'Switch' }).isDisabled()
      ).toBe(false);
      await dialog.getByRole('button', { name: 'Switch' }).click();
      await modal(page).waitFor({ state: 'detached' });
      expect(put).toEqual({ source: '/repo' });
    },
    { fixture: 'status-live.json' }
  );
});

test('setup failed: shows the branch and the log, Dismiss sends DELETE', async () => {
  await withBoard(
    async page => {
      await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
      const calls: string[] = [];
      await page.route('**/api/v1/apps/*/live/setup', async r => {
        calls.push(`${r.request().method()} setup`);
        await r.fulfill({ json: { ok: true } });
      });
      await page.getByRole('button', { name: /setup failed/ }).click();
      const dialog = modal(page);
      expect(await dialog.textContent()).toContain(
        "Couldn't set up deck-live-mode"
      );
      expect(await dialog.textContent()).toContain('lockfile is frozen');
      await dialog.getByRole('button', { name: 'Dismiss' }).click();
      await modal(page).waitFor({ state: 'detached' });
      expect(calls).toEqual(['DELETE setup']);
    },
    { fixture: 'status-live.json' }
  );
});

test('setup failed: Try Again PUTs the same worktree again', async () => {
  await withBoard(
    async page => {
      await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
      const calls: Array<{ method: string; body: unknown }> = [];
      await page.route('**/api/v1/apps/*/live', async r => {
        calls.push({
          method: r.request().method(),
          body: r.request().postDataJSON(),
        });
        await r.fulfill({ status: 202, json: { ok: true, setup: 'running' } });
      });
      await page.getByRole('button', { name: /setup failed/ }).click();
      await modal(page).getByRole('button', { name: 'Try Again' }).click();
      await modal(page).waitFor({ state: 'detached' });
      expect(calls).toEqual([{ method: 'PUT', body: { source: '/wt/b' } }]);
    },
    { fixture: 'status-live.json' }
  );
});

test('setup failed on a worktree that is gone: Try Again stays disabled', async () => {
  await withBoard(
    async page => {
      let served = false;
      await page.route('**/live/sources', r => {
        served = true;
        return r.fulfill({ json: WITHOUT('/wt/b') });
      });
      await page.getByRole('button', { name: /setup failed/ }).click();
      const dialog = modal(page);
      await dialog.waitFor();
      for (let i = 0; i < 20 && !served; i++) await page.waitForTimeout(50);
      await page.waitForTimeout(100);
      expect(served).toBe(true);
      expect(
        await dialog.getByRole('button', { name: 'Try Again' }).isDisabled()
      ).toBe(true);
    },
    { fixture: 'status-live.json' }
  );
});

test('settings while live: source, processes, live UI port', async () => {
  await withBoard(
    async page => {
      await page
        .getByRole('button', { name: 'settings for atlas', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'settings for atlas' });
      const code = dialog.locator('[data-block="code"]');
      expect(await code.textContent()).toContain('console-runs-3');
      expect(
        await code.getByRole('button', { name: 'Change code' }).count()
      ).toBe(1);
      expect(
        await code.getByRole('button', { name: 'Stop Live' }).count()
      ).toBe(1);
      expect(
        await code.getByRole('button', { name: /redeploy/i }).count()
      ).toBe(0);
      expect(await code.getByRole('button', { name: 'relink' }).count()).toBe(
        0
      );
      const procs = dialog.locator('[data-block="live-processes"]');
      expect(await procs.textContent()).toContain(
        'bun --watch src/server/index.ts'
      );
      expect(await procs.textContent()).toContain('11140');
      const port = dialog.locator('[data-block="port"]');
      expect(await port.textContent()).toContain('Live UI');
      expect(await port.getByLabel('dev port override').count()).toBe(0);
    },
    { fixture: 'status-live.json' }
  );
});

test('settings while live: Stop Live opens the live modal, Escape closes only it', async () => {
  await withBoard(
    async page => {
      await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
      await page
        .getByRole('button', { name: 'settings for atlas', exact: true })
        .click();
      const settings = page.getByRole('dialog', {
        name: 'settings for atlas',
      });
      await settings.getByRole('button', { name: 'Stop Live' }).click();
      const live = page.getByRole('dialog', {
        name: 'atlas is live',
        exact: true,
      });
      await live.waitFor();
      await page.keyboard.press('Escape');
      await live.waitFor({ state: 'detached' });
      expect(await settings.count()).toBe(1);
      await page.waitForFunction(
        () => document.activeElement?.textContent?.trim() === 'Stop Live'
      );
      expect(
        await settings
          .getByRole('button', { name: 'Stop Live' })
          .evaluate(el => el === document.activeElement)
      ).toBe(true);
    },
    { fixture: 'status-live.json' }
  );
});

test('settings while live: a successful Stop Live leaves focus inside settings', async () => {
  await withBoard(
    async page => {
      await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
      await page.route('**/api/v1/apps/*/live', r =>
        r.fulfill({ json: { ok: true } })
      );
      await page
        .getByRole('button', { name: 'settings for atlas', exact: true })
        .click();
      const settings = page.getByRole('dialog', {
        name: 'settings for atlas',
      });
      await settings.getByRole('button', { name: 'Stop Live' }).click();
      await page
        .getByRole('dialog', { name: 'atlas is live', exact: true })
        .getByRole('button', { name: 'Stop Live' })
        .click();
      await page.getByText('Live mode stopped').waitFor();
      await page.waitForTimeout(150);
      expect(
        await page.evaluate(
          () => !!document.activeElement?.closest('[role="dialog"]')
        )
      ).toBe(true);
    },
    { fixture: 'status-live.json' }
  );
});

test('settings while live: a process shows its log on demand', async () => {
  await withBoard(
    async page => {
      await page.route(/\/apps\/atlas\/logs\?process=ui/, r =>
        r.fulfill({ json: { stderr: ['vite: ready', 'hmr update'] } })
      );
      await page
        .getByRole('button', { name: 'settings for atlas', exact: true })
        .click();
      const procs = page
        .getByRole('dialog', { name: 'settings for atlas' })
        .locator('[data-block="live-processes"]');
      await procs.getByRole('button', { name: 'ui logs' }).click();
      await procs.getByLabel('ui log', { exact: true }).waitFor();
      expect(
        await procs.getByLabel('ui log', { exact: true }).textContent()
      ).toContain('hmr update');
      await procs.getByRole('button', { name: 'ui logs' }).click();
      await procs
        .getByLabel('ui log', { exact: true })
        .waitFor({ state: 'detached' });
    },
    { fixture: 'status-live.json' }
  );
});

test('a live app with a failed setup: Change code opens the live modal, Dismiss keeps it live', async () => {
  await withBoard(
    async page => {
      await page.route('**/api/v1/status', async r => {
        const res = await r.fetch();
        const data = await res.json();
        const atlas = data.apps.find(
          (a: { name: string }) => a.name === 'atlas'
        );
        atlas.liveSetup = {
          state: 'failed',
          branch: 'deck-live-mode',
          log: ['error: lockfile is frozen'],
        };
        await r.fulfill({ json: data });
      });
      await page.reload();
      await page.waitForSelector('[data-board-ready]');
      await page.route('**/live/sources', r => r.fulfill({ json: SOURCES }));
      const calls: string[] = [];
      await page.route('**/api/v1/apps/*/live**', async r => {
        calls.push(
          `${r.request().method()} ${new URL(r.request().url()).pathname}`
        );
        await r.fulfill({ json: { ok: true } });
      });
      await page
        .getByRole('button', { name: 'settings for atlas', exact: true })
        .click();
      await page
        .getByRole('dialog', { name: 'settings for atlas' })
        .getByRole('button', { name: 'Change code' })
        .click();
      await page
        .getByRole('dialog', { name: 'atlas is live', exact: true })
        .waitFor();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'atlas setup failed' }).click();
      await modal(page)
        .filter({ hasText: "Couldn't set up" })
        .getByRole('button', { name: 'Dismiss' })
        .click();
      await page.waitForTimeout(150);
      expect(calls.filter(c => c.startsWith('DELETE'))).toEqual([
        'DELETE /api/v1/apps/atlas/live/setup',
      ]);
    },
    { fixture: 'status-live.json' }
  );
});

test('settings after a failed setup: Recent errors shows the setup log', async () => {
  await withBoard(
    async page => {
      await page
        .getByRole('button', { name: 'settings for relay', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'settings for relay' });
      const errors = dialog.locator('[data-block="errors"]');
      expect(await errors.textContent()).toContain('Setup log');
      expect(await errors.textContent()).toContain('lockfile had changes');
    },
    { fixture: 'status-live.json' }
  );
});
