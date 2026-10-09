// status-newcode.json: atlas, meridian and forecast (deck itself) are behind
// and carry a deploy command, so Redeploy all targets them in that order.
import { expect, test } from 'bun:test';
import type { Page } from 'playwright';

import fixture from '../fixture/status-newcode.json' with { type: 'json' };
import { withBoard } from './rig.ts';

const NEWCODE = { fixture: 'status-newcode.json' };

interface DeployPlan {
  /** Apps whose start answers the server's busy refusal. */
  busy?: string[];
  /** Apps whose run polls to this exit code (0 otherwise). */
  exit?: Record<string, number>;
  /** Apps whose run-status poll answers 404, as after deck restarted. */
  gone?: string[];
  /** Apps whose run keeps reporting `running` until removed from the set. */
  held?: Set<string>;
}

function appOf(url: string): string {
  return new URL(url).pathname.split('/')[4]!;
}

async function interceptDeploys(
  page: Page,
  plan: DeployPlan
): Promise<string[]> {
  const posted: string[] = [];
  await page.route('**/api/v1/apps/*/commands/deploy', async route => {
    const app = appOf(route.request().url());
    posted.push(app);
    if (plan.busy?.includes(app)) {
      await route.fulfill({ status: 409, json: { error: 'busy' } });
      return;
    }
    await route.fulfill({ json: { started: true, runId: `run-${app}` } });
  });
  await page.route('**/api/v1/apps/*/commands/deploy/*', async route => {
    const app = appOf(route.request().url());
    if (plan.gone?.includes(app)) {
      await route.fulfill({ status: 404, json: { error: 'not found' } });
      return;
    }
    if (plan.held?.has(app)) {
      await route.fulfill({ json: { status: 'running' } });
      return;
    }
    await route.fulfill({
      json: { status: 'exited', exitCode: plan.exit?.[app] ?? 0 },
    });
  });
  return posted;
}

async function waitUntil(
  check: () => Promise<boolean> | boolean,
  timeoutMs = 4000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('waitUntil() timed out');
}

function redeployAll(page: Page) {
  return page.getByRole('button', { name: 'Redeploy all', exact: true });
}

function toasts(page: Page, text: string) {
  return page.locator('[data-part="toasthost-toast"]', { hasText: text });
}

test('runs deploys one at a time in order, deck itself last', async () => {
  await withBoard(async page => {
    const posted = await interceptDeploys(page, { busy: ['forecast'] });
    await redeployAll(page).click();
    await waitUntil(() => posted.includes('forecast'), 15000);
    expect(posted).toEqual(['atlas', 'meridian', 'forecast']);
  }, NEWCODE);
}, 25000);

test('stops at the first failure and names the app', async () => {
  await withBoard(async page => {
    const posted = await interceptDeploys(page, { exit: { meridian: 1 } });
    await redeployAll(page).click();
    const stop = toasts(page, 'Redeploy all stopped at meridian');
    await stop.first().waitFor({ timeout: 15000 });
    expect(await stop.count()).toBe(1);
    expect(posted).toEqual(['atlas', 'meridian']);
    await new Promise(r => setTimeout(r, 1500));
    expect(posted).toEqual(['atlas', 'meridian']);
  }, NEWCODE);
}, 25000);

test('skips a row whose deploy is already running', async () => {
  await withBoard(async page => {
    const held = new Set(['atlas']);
    const posted = await interceptDeploys(page, { busy: ['forecast'], held });
    await page.locator('[aria-label="deploy atlas"]').click();
    await waitUntil(() => posted.includes('atlas'));
    await redeployAll(page).click();
    await waitUntil(() => posted.includes('forecast'), 15000);
    expect(posted).toEqual(['atlas', 'meridian', 'forecast']);
  }, NEWCODE);
}, 25000);

test('the button disables while running and a second run cannot start', async () => {
  await withBoard(async page => {
    const held = new Set(['atlas']);
    const posted = await interceptDeploys(page, { busy: ['forecast'], held });
    await redeployAll(page).click();

    const running = page.getByRole('button', {
      name: 'Redeploying…',
      exact: true,
    });
    await running.waitFor({ timeout: 4000 });
    expect(await running.isDisabled()).toBe(true);
    expect(await redeployAll(page).count()).toBe(0);
    const strip = page.locator('[data-block="update-strip"]');
    expect(await strip.textContent()).toContain('Redeploying 1 of 3 · atlas');

    await running.dispatchEvent('click');
    await new Promise(r => setTimeout(r, 300));
    expect(posted).toEqual(['atlas']);

    held.delete('atlas');
    await waitUntil(() => posted.includes('forecast'), 15000);
    await redeployAll(page).waitFor({ timeout: 4000 });
    expect(posted).toEqual(['atlas', 'meridian', 'forecast']);
  }, NEWCODE);
}, 25000);

test("deck's own deploy, last, waits for deck and reloads the page with no stop toast", async () => {
  await withBoard(async page => {
    const posted = await interceptDeploys(page, { gone: ['forecast'] });
    let healthz = 0;
    await page.route('**/healthz', async route => {
      healthz++;
      await route.fulfill({ status: 200, body: 'ok' });
    });
    const seen: string[] = [];
    await page.exposeBinding('__deckToast', (_src, text: string) => {
      seen.push(text);
    });
    await page.evaluate(() => {
      const report = (window as unknown as Record<string, (t: string) => void>)
        .__deckToast!;
      new MutationObserver(() => {
        for (const el of document.querySelectorAll(
          '[data-part="toasthost-toast"]'
        ))
          report(el.textContent ?? '');
      }).observe(document.body, { childList: true, subtree: true });
    });

    const loaded = page.waitForEvent('load', { timeout: 20000 });
    await redeployAll(page).click();
    await loaded;

    expect(posted).toEqual(['atlas', 'meridian', 'forecast']);
    expect(healthz).toBeGreaterThan(0);
    expect(seen.some(t => t.includes('Redeploy all stopped'))).toBe(false);
    await page.waitForSelector('[data-board-ready]');
  }, NEWCODE);
}, 30000);

test('hidden on a public host', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/status', async route => {
      const next = structuredClone(fixture) as typeof fixture;
      next.canManage = false;
      await route.fulfill({ json: next });
    });
    // The first status landed before the route; wait for a poll to apply it.
    await waitUntil(
      async () => (await page.getByRole('switch').count()) === 0,
      8000
    );
    expect(
      await page.locator('[data-block="update-strip"]').count()
    ).toBeGreaterThan(0);
    expect(await redeployAll(page).count()).toBe(0);
  }, NEWCODE);
}, 15000);
