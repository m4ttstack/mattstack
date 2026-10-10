import { expect, test } from 'bun:test';

import { withBoard } from './rig.ts';

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
