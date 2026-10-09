import { expect, test } from 'bun:test';

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
