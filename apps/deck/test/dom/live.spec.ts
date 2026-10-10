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
      await page.route('**/api/v1/apps/*/live', async r => {
        calls.push(r.request().method());
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
      expect(calls).toEqual(['DELETE']);
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
