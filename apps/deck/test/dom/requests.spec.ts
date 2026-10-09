// Guard: the board page calls exactly this set of /api/ endpoints with these
// methods. Redesigns move controls around and may only retarget the flow
// helpers below, never EXPECTED_REQUESTS.
import { expect, test } from 'bun:test';
import type { Locator, Page, Route } from 'playwright';

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

function settingsFor(page: Page, name: string): Locator {
  return page.getByRole('dialog', {
    name: `settings for ${name}`,
    exact: true,
  });
}

async function openSettings(page: Page, name: string): Promise<Locator> {
  const open = page.getByRole('dialog', { name: /^settings for / });
  if ((await open.count()) > 0) {
    await open.getByRole('button', { name: 'close', exact: true }).click();
    await open.waitFor({ state: 'detached' });
  }
  await page
    .getByRole('button', { name: `settings for ${name}`, exact: true })
    .click();
  const dlg = settingsFor(page, name);
  await dlg.waitFor({ state: 'visible' });
  return dlg;
}

function modalBlock(dlg: Locator, id: string): Locator {
  return dlg.locator(`[data-block="${id}"]`);
}

async function drivePublish(page: Page): Promise<void> {
  await rowFor(page, 'forecast')
    .locator('[data-part="switch-control"]')
    .click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/publish'));
}

async function drivePublishInModal(page: Page): Promise<void> {
  const dlg = await openSettings(page, 'ledger');
  await modalBlock(dlg, 'reach')
    .getByRole('switch', { name: 'publish ledger', exact: true })
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
  const dlg = await openSettings(page, 'orbit');
  await modalBlock(dlg, 'port')
    .getByRole('switch', { name: "serve orbit's dev port publicly" })
    .click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/public-follows-override'));
}

async function driveDevPortRevert(page: Page): Promise<void> {
  const dlg = await openSettings(page, 'orbit');
  await modalBlock(dlg, 'port')
    .getByRole('button', { name: 'revert to 11007', exact: true })
    .click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/override'));
}

async function driveDevPortSave(page: Page): Promise<void> {
  const port = modalBlock(await openSettings(page, 'atlas'), 'port');
  await port
    .getByRole('textbox', { name: 'dev port override' })
    .pressSequentially('5173');
  await port.getByRole('button', { name: 'Route to it', exact: true }).click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/override'));
}

async function drivePasswordSet(page: Page): Promise<void> {
  const gates = modalBlock(await openSettings(page, 'forecast'), 'gates');
  await gates.getByLabel('new password', { exact: true }).fill('s3cret');
  await gates.getByRole('button', { name: 'Save', exact: true }).click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/password'));
}

async function drivePasswordRemove(page: Page): Promise<void> {
  const gates = modalBlock(await openSettings(page, 'atlas'), 'gates');
  await gates
    .getByRole('button', { name: 'remove password', exact: true })
    .click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/password'));
}

async function driveGoogleSignInWho(page: Page): Promise<void> {
  const gates = modalBlock(await openSettings(page, 'forecast'), 'gates');
  await gates
    .getByRole('switch', { name: 'require google sign-in', exact: true })
    .click();
  const draft = gates.getByRole('textbox', { name: 'add email' });
  await draft.fill('a@x.dev');
  await draft.press('Enter');
  await gates.getByRole('button', { name: 'Apply', exact: true }).click();
  await waitFor(sawRequest('PUT /api/v1/apps/:app/access'));
}

async function driveEditSave(page: Page): Promise<void> {
  const app = modalBlock(await openSettings(page, 'orbit'), 'app');
  await app
    .getByRole('textbox', { name: 'base port', exact: true })
    .fill('12345');
  await app.getByRole('button', { name: 'Save changes', exact: true }).click();
  await waitFor(sawRequest('PATCH /api/v1/apps/:app'));
}

async function driveSourceUnlink(page: Page): Promise<void> {
  const dlg = await openSettings(page, 'atlas');
  await modalBlock(dlg, 'code')
    .getByRole('button', { name: 'unlink', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'unlink atlas?', exact: true })
    .getByRole('button', { name: 'unlink', exact: true })
    .click();
  await waitFor(sawRequest('PATCH /api/v1/apps/:app'));
}

async function driveRemove(page: Page): Promise<void> {
  const dlg = await openSettings(page, 'atlas');
  await modalBlock(dlg, 'danger')
    .getByRole('button', { name: 'Remove app…', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'remove atlas?', exact: true })
    .getByRole('button', { name: 'remove app', exact: true })
    .click();
  await waitFor(sawRequest('DELETE /api/v1/apps/:app'));
}

async function driveCommand(page: Page): Promise<void> {
  await page.locator('[aria-label="deploy atlas"]').click();
  await waitFor(sawRequest('POST /api/v1/apps/:app/commands/deploy'));
  await waitFor(sawRequest('GET /api/v1/apps/:app/commands/deploy/:id'));
}

async function driveRemoteToggle(page: Page): Promise<void> {
  const dlg = await openSettings(page, 'atlas');
  await modalBlock(dlg, 'reach')
    .getByRole('switch', { name: 'push atlas to Railway', exact: true })
    .click();
  await waitFor(sawRequest('POST /api/v1/apps/:app/remote'));
}

async function drivePush(page: Page): Promise<void> {
  const dlg = await openSettings(page, 'railwayapp');
  await modalBlock(dlg, 'reach')
    .getByRole('button', { name: 'Push to Railway', exact: true })
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
    await flow(drivePublishInModal, page);
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
