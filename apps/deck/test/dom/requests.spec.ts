// Guard: the board page calls exactly this set of /api/ endpoints with these
// methods. Redesigns move controls around and may only retarget the flow
// helpers below, never EXPECTED_REQUESTS.
import { expect, test } from 'bun:test';
import type { Page, Route } from 'playwright';

import { withBoard } from './rig.ts';

const EXPECTED_REQUESTS: string[] = [
  'DELETE /api/v1/apps/:app',
  'GET /api/v1/apps/:app/commands/deploy/:id',
  'GET /api/v1/status',
  'PATCH /api/v1/apps/:app',
  'POST /api/v1/apps',
  'POST /api/v1/apps/:app/commands/deploy',
  'POST /api/v1/apps/:app/push',
  'POST /api/v1/apps/:app/remote',
  'POST /api/v1/apps/:app/restart',
  'POST /api/v1/apps/register',
  'POST /api/v1/proxy/restart',
  'PUT /api/v1/apps/:app/access',
  'PUT /api/v1/apps/:app/override',
  'PUT /api/v1/apps/:app/password',
  'PUT /api/v1/apps/:app/public-follows-override',
  'PUT /api/v1/apps/:app/publish',
];

const recorded = new Set<string>();
const requestLog: string[] = [];
let flowStart = 0;

async function flow(drive: (page: Page) => Promise<void>, page: Page) {
  flowStart = requestLog.length;
  await drive(page);
}

function normalize(method: string, rawUrl: string): string | null {
  const { pathname } = new URL(rawUrl);
  if (!pathname.startsWith('/api/')) return null;
  const path = pathname
    .replace(/^\/api\/v1\/apps\/(?!register(?:\/|$))[^/]+/, '/api/v1/apps/:app')
    .replace(/(\/commands\/[^/]+)\/[^/]+$/, '$1/:id');
  return `${method} ${path}`;
}

function fulfillJson(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function instrument(page: Page): Promise<void> {
  page.on('request', req => {
    const key = normalize(req.method(), req.url());
    if (!key) return;
    recorded.add(key);
    requestLog.push(key);
  });
  await page.route('**/api/v1/**', async route => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (req.method() === 'GET') {
      if (/\/commands\/[^/]+\/[^/]+$/.test(pathname)) {
        await fulfillJson(route, { status: 'exited', exitCode: 0 });
        return;
      }
      await route.continue();
      return;
    }
    await fulfillJson(route, { ok: true, runId: 'run-1' });
  });
}

function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({
    has: page
      .locator('[data-part="table-cell"]')
      .first()
      .filter({ hasText: name }),
  });
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 6000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('waitFor() timed out');
}

function sawRequest(key: string): () => boolean {
  return () => requestLog.slice(flowStart).includes(key);
}

async function openSettings(page: Page, name: string): Promise<void> {
  if ((await page.locator('[data-part="sidedrawer"]').count()) > 0) {
    await page.locator('[data-part="drawer-close"]').click();
    await page.waitForSelector('[data-part="sidedrawer"]', {
      state: 'detached',
    });
  }
  await rowFor(page, name).locator('[data-part="row-chevron"]').click();
  await page.waitForSelector('[data-part="sidedrawer"]');
}

async function openScreen(page: Page, label: string): Promise<void> {
  await page
    .locator('[data-part="listgroup-nav"] button', { hasText: label })
    .click();
}

function navAction(page: Page) {
  return page.locator('[data-part="drawer-navaction"]');
}

async function drivePublish(page: Page): Promise<void> {
  await rowFor(page, 'forecast')
    .locator('[data-part="switch-control"]')
    .click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/publish'));
}

async function driveRestart(page: Page): Promise<void> {
  await rowFor(page, 'atlas').locator('[aria-label="restart atlas"]').click();
  await waitFor(sawRequest('POST /api/v1/apps/:app/restart'));
}

async function driveReloadProxy(page: Page): Promise<void> {
  await page.locator('button:has-text("reload proxy")').click();
  await waitFor(sawRequest('POST /api/v1/proxy/restart'));
}

async function driveRegisterApp(page: Page): Promise<void> {
  await page.locator('button', { hasText: 'add app' }).click();
  const modal = page.locator('[data-part="modal"]');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('[name="app-dir"]').fill('/Users/matt/code/newapp');
  await modal.locator('button[type="submit"]').click();
  await waitFor(sawRequest('POST /api/v1/apps/register'));
  await page.waitForSelector('[data-part="modal"]', { state: 'detached' });
}

async function driveManualAdd(page: Page): Promise<void> {
  await page.route('**/api/v1/apps/register', route =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'no mattstack.deck.json in /Users/matt/code/newapp',
      }),
    })
  );
  await page.locator('button', { hasText: 'add app' }).click();
  const modal = page.locator('[data-part="modal"]');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('[name="app-dir"]').fill('/Users/matt/code/newapp');
  await modal.locator('button[type="submit"]').click();
  await waitFor(sawRequest('POST /api/v1/apps/register'));
  await modal.locator('[name="app-name"]').waitFor({ state: 'visible' });
  await modal.locator('[name="app-name"]').fill('newapp');
  await modal.getByPlaceholder('bun src/server.ts').click();
  await page.keyboard.type('bun run start');
  await modal.locator('button[type="submit"]').click();
  await waitFor(sawRequest('POST /api/v1/apps'));
}

async function driveDevPortPublicFollows(page: Page): Promise<void> {
  await openSettings(page, 'orbit');
  await openScreen(page, 'dev port');
  await page
    .locator('[data-part="listgroup-toggle"] [data-part="switch-control"]')
    .click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/public-follows-override'));
}

async function driveDevPortRevert(page: Page): Promise<void> {
  await openSettings(page, 'orbit');
  await openScreen(page, 'dev port');
  await page
    .locator('[data-part="listgroup-action"] button', {
      hasText: 'revert to 11007',
    })
    .click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/override'));
}

async function driveDevPortSave(page: Page): Promise<void> {
  await openSettings(page, 'atlas');
  await openScreen(page, 'dev port');
  await page
    .locator('[data-part="listgroup-action"] button', {
      hasText: 'set override…',
    })
    .click();
  await page.getByRole('textbox', { name: 'dev port override' }).fill('5173');
  await navAction(page).click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/override'));
}

async function openAccessScreen(page: Page, name: string): Promise<void> {
  await openSettings(page, name);
  await page
    .locator('[data-part="listgroup-nav"]')
    .filter({
      has: page.locator('[data-part="listgroup-label"]', { hasText: 'access' }),
    })
    .locator('button')
    .click();
}

function accessNav(page: Page, label: string) {
  return page.locator('[data-part="listgroup-nav"]').filter({
    has: page.locator('[data-part="listgroup-label"]', { hasText: label }),
  });
}

async function drivePasswordSet(page: Page): Promise<void> {
  await openAccessScreen(page, 'forecast');
  await accessNav(page, 'password').locator('button').click();
  await page.locator('[aria-label="new password"]').fill('s3cret');
  await navAction(page).click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/password'));
}

async function drivePasswordRemove(page: Page): Promise<void> {
  await openAccessScreen(page, 'atlas');
  await accessNav(page, 'password').locator('button').click();
  await page
    .locator('button[data-intent="bad"]', { hasText: 'remove password' })
    .click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/password'));
}

async function driveGoogleSignInWho(page: Page): Promise<void> {
  await openAccessScreen(page, 'forecast');
  await page
    .locator('[data-part="listgroup-toggle"] [data-part="switch-control"]')
    .click();
  await accessNav(page, 'who').locator('button').click();
  const draft = page.getByRole('textbox', { name: 'add email' });
  await draft.fill('a@x.dev');
  await draft.press('Enter');
  await navAction(page).click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/access'));
}

async function driveEditSave(page: Page): Promise<void> {
  await openSettings(page, 'orbit');
  await openScreen(page, 'edit app');
  await page.getByRole('textbox', { name: 'base port' }).fill('12345');
  await navAction(page).click();
  await waitFor(sawRequest('PATCH /api/v1/apps/:app'));
}

async function driveSourceUnlink(page: Page): Promise<void> {
  await openSettings(page, 'atlas');
  await openScreen(page, 'source');
  await page
    .locator('[data-part="sidedrawer"] [data-part="listgroup-action"] button', {
      hasText: 'Unlink',
    })
    .click();
  await page
    .locator('[data-part="modal"] button', { hasText: 'unlink' })
    .click();
  await waitFor(sawRequest('PATCH /api/v1/apps/:app'));
}

async function driveRemove(page: Page): Promise<void> {
  await openSettings(page, 'atlas');
  await page
    .locator('[data-part="listgroup-action"] button', {
      hasText: 'remove app',
    })
    .click();
  await page
    .locator('[data-part="modal"] button', { hasText: 'remove app' })
    .click();
  await waitFor(sawRequest('DELETE /api/v1/apps/:app'));
}

async function driveCommand(page: Page): Promise<void> {
  await page.locator('[aria-label="deploy atlas"]').click();
  await waitFor(sawRequest('POST /api/v1/apps/:app/commands/deploy'));
  await waitFor(sawRequest('GET /api/v1/apps/:app/commands/deploy/:id'));
}

async function driveRemoteToggle(page: Page): Promise<void> {
  await openSettings(page, 'atlas');
  await page
    .locator('[data-part="listgroup-toggle"]')
    .filter({
      has: page.locator('[data-part="listgroup-label"]', { hasText: 'remote' }),
    })
    .locator('[data-part="switch-control"]')
    .click();
  await waitFor(sawRequest('POST /api/v1/apps/:app/remote'));
}

async function drivePush(page: Page): Promise<void> {
  await openSettings(page, 'railwayapp');
  await page
    .locator('[data-part="listgroup-action"] button', {
      hasText: 'Push to Railway',
    })
    .click();
  await waitFor(sawRequest('POST /api/v1/apps/:app/push'));
}

test('the board page calls exactly the pinned set of /api/ requests', async () => {
  await withBoard(async page => {
    await instrument(page);
    await flow(drivePublish, page);
    await flow(driveRestart, page);
    await flow(driveReloadProxy, page);
    await flow(driveRegisterApp, page);
    await flow(driveDevPortPublicFollows, page);
    await flow(driveDevPortRevert, page);
    await flow(driveDevPortSave, page);
    await flow(drivePasswordSet, page);
    await flow(drivePasswordRemove, page);
    await flow(driveGoogleSignInWho, page);
    await flow(driveEditSave, page);
    await flow(driveSourceUnlink, page);
    await flow(driveRemove, page);
  });
  await withBoard(
    async page => {
      await instrument(page);
      await flow(driveManualAdd, page);
    },
    { fixture: 'status.json' }
  );
  await withBoard(
    async page => {
      await instrument(page);
      await flow(driveCommand, page);
    },
    { fixture: 'status-commands.json' }
  );
  await withBoard(
    async page => {
      await instrument(page);
      await flow(driveRemoteToggle, page);
      await flow(drivePush, page);
    },
    { fixture: 'status-remote.json' }
  );

  const actual = [...recorded].sort();
  const expected = [...EXPECTED_REQUESTS].sort();
  const missing = expected.filter(r => !recorded.has(r));
  const extra = actual.filter(r => !expected.includes(r));
  expect(
    { missing, extra },
    `request set drifted: missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'}`
  ).toEqual({ missing: [], extra: [] });
}, 90000);
