import { expect, test } from 'bun:test';
import type { Page } from 'playwright';

import { withBoard } from './rig.ts';

test('renders a button per command and POSTs on click', async () => {
  await withBoard(
    async page => {
      let postedUrl = '';
      await page.route('**/api/v1/apps/*/commands/*', async route => {
        postedUrl = route.request().url();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ started: true, runId: 'x' }),
        });
      });
      const deploy = page.locator('[aria-label="deploy atlas"]');
      expect(await deploy.count()).toBe(1);
      for (const name of ['build', 'deploy']) {
        const button = page.locator(`[aria-label="${name} atlas"]`);
        expect(await button.locator('svg').count()).toBe(1);
        expect((await button.innerText()).trim()).toBe('');
      }
      await deploy.click();
      expect(postedUrl).toContain('/api/v1/apps/atlas/commands/deploy');
    },
    { fixture: 'status-commands.json' }
  );
});

test('no command buttons when the row omits commands', async () => {
  await withBoard(
    async page => {
      expect(await page.locator('[aria-label="deploy atlas"]').count()).toBe(0);
    },
    { fixture: 'status.json' }
  );
});

function mainFrameNavigations(page: Page): () => number {
  let count = 0;
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) count++;
  });
  return () => count;
}

test('a deploy whose start never answers on an app row toasts and goes idle without reloading', async () => {
  await withBoard(
    async page => {
      await page.route('**/api/v1/apps/atlas/commands/deploy', route =>
        route.abort()
      );
      const navigated = mainFrameNavigations(page);
      await page.locator('[aria-label="deploy atlas"]').click();

      await page
        .locator('[data-part="toasthost-toast"]', {
          hasText: 'deploy could not start',
        })
        .waitFor({ timeout: 4000 });
      await page.waitForSelector(
        '[aria-label="deploy atlas"]:not([aria-busy="true"]):not([disabled])',
        { timeout: 2000 }
      );
      await new Promise(r => setTimeout(r, 1500));
      expect(navigated()).toBe(0);
    },
    { fixture: 'status-newcode.json' }
  );
}, 15000);

test("deck's own deploy whose start never answers waits for deck and reloads", async () => {
  await withBoard(
    async page => {
      await page.route('**/api/v1/apps/forecast/commands/deploy', route =>
        route.abort()
      );
      let healthz = 0;
      await page.route('**/healthz', async route => {
        healthz++;
        await route.fulfill({ status: 200, body: 'ok' });
      });
      const loaded = page.waitForEvent('load', { timeout: 20000 });
      await page.locator('[aria-label="deploy forecast"]').click();
      await loaded;
      expect(healthz).toBeGreaterThan(0);
      await page.waitForSelector('[data-board-ready]');
    },
    { fixture: 'status-newcode.json' }
  );
}, 30000);
