// Recent errors: the stderr tail in the settings modal, ported from
// logs.spec.ts. ledger carries the fixture's one stderr line; forecast
// carries none.
import { expect, test } from 'bun:test';
import type { Locator, Page } from 'playwright';

import fixture from '../fixture/status.json' with { type: 'json' };
import { withBoard } from './rig.ts';

/** Fails within 2s on a missing dialog, so a red run names the dialog rather
    than a later control or the test's own timeout. */
async function openErrors(page: Page, name: string): Promise<Locator> {
  await page
    .getByRole('button', { name: `settings for ${name}`, exact: true })
    .click();
  const dlg = page.getByRole('dialog', {
    name: `settings for ${name}`,
    exact: true,
  });
  await dlg.waitFor({ state: 'visible', timeout: 2000 });
  return dlg.locator('[data-block="errors"]');
}

async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 8000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('waitUntil() timed out');
}

function withStderr(lines: string[]): string {
  const next = structuredClone(fixture) as typeof fixture;
  const ledger = next.apps.find(a => a.name === 'ledger');
  if (!ledger?.service) throw new Error('fixture missing ledger.service');
  ledger.service.stderr = lines;
  return JSON.stringify(next);
}

// The first status fetch lands before withBoard hands the page over, so these
// open against the committed fixture and only intercept the board's next 5s
// poll: that is what makes them tests of "live", not of the initial render.
test('Recent errors shows a richer stderr tail landed by the next poll, newest last', async () => {
  await withBoard(async page => {
    const errors = await openErrors(page, 'ledger');
    expect(await errors.innerText()).toContain('Error: connect ECONNREFUSED');

    await page.route('**/api/v1/status', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: withStderr([
          'bun: error: connect ECONNREFUSED',
          'exited with code 1',
          'launchd: respawning in 10s',
        ]),
      })
    );

    await waitUntil(async () =>
      (await errors.innerText()).includes('respawning')
    );
    expect(await errors.innerText()).toContain(
      'bun: error: connect ECONNREFUSED\nexited with code 1\nlaunchd: respawning in 10s'
    );
    expect(await errors.innerText()).not.toContain(
      'Error: connect ECONNREFUSED'
    );
  });
}, 15000);

test('Recent errors live-updates when a later poll returns a new stderr line', async () => {
  await withBoard(async page => {
    const errors = await openErrors(page, 'ledger');
    expect(await errors.innerText()).toContain('Error: connect ECONNREFUSED');

    await page.route('**/api/v1/status', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: withStderr([
          'Error: connect ECONNREFUSED',
          'launchd: respawning in 10s',
        ]),
      })
    );

    await waitUntil(async () =>
      (await errors.innerText()).includes('respawning')
    );
    expect(await errors.innerText()).toContain(
      'Error: connect ECONNREFUSED\nlaunchd: respawning in 10s'
    );
  });
}, 15000);

test('empty state: a row with no stderr says so and offers no Copy', async () => {
  await withBoard(async page => {
    const errors = await openErrors(page, 'forecast');
    expect(await errors.textContent()).toContain(
      'No errors. Recent stderr shows here when a health check fails.'
    );
    expect(
      await errors.getByRole('button', { name: 'Copy', exact: true }).count()
    ).toBe(0);
  });
});

test('Copy writes the tail to the clipboard', async () => {
  await withBoard(async page => {
    const errors = await openErrors(page, 'ledger');
    await errors.getByRole('button', { name: 'Copy', exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe('Error: connect ECONNREFUSED');
  });
});
