// Who can reach it: the publish and Railway switches and Push to Railway in
// the settings modal's reach block, ported from remote.spec.ts and the
// publish tests in board.spec.ts. status-remote.json: atlas is a plain
// non-remote row that can still turn remote on, railwayapp is already live on
// Railway, gatedapp is password-only (no sign-in gate) with remote off, the
// one combination that disables the switch, and lockedout is the same
// password-only combination but already remote, so its switch stays enabled
// and the off path is never blocked.
import { expect, test } from 'bun:test';
import type { Locator, Page } from 'playwright';

import { withBoard } from './rig.ts';

const RAILWAY_DISABLED_TIP =
  'add sign-in access before pushing this app to Railway (a password alone does not gate the public origin)';

function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({
    has: page
      .locator('[data-part="table-cell"]')
      .first()
      .filter({ hasText: name }),
  });
}

function settingsFor(page: Page, name: string) {
  return page.getByRole('dialog', {
    name: `settings for ${name}`,
    exact: true,
  });
}

/** Fails within 2s on a missing dialog, so a red run names the dialog rather
    than a later control or the test's own timeout. */
async function openSettings(page: Page, name: string): Promise<Locator> {
  await page
    .getByRole('button', { name: `settings for ${name}`, exact: true })
    .click();
  const dlg = settingsFor(page, name);
  await dlg.waitFor({ state: 'visible', timeout: 2000 });
  return dlg;
}

/** Opens the modal and returns its reach block. */
async function openReach(page: Page, name: string): Promise<Locator> {
  const dlg = await openSettings(page, name);
  return dlg.locator('[data-block="reach"]');
}

function railwayTip(reach: Locator) {
  return reach.locator(
    `[data-part="tooltip"][data-tip="${RAILWAY_DISABLED_TIP}"]`
  );
}

async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 4000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('waitUntil() timed out');
}

const ok = {
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true }),
};

test('a live-remote row carries the Railway marker in the table and Push to Railway in its modal', async () => {
  await withBoard(
    async page => {
      expect(
        await rowFor(page, 'railwayapp')
          .locator('[aria-label="served from Railway (live)"]')
          .count()
      ).toBe(1);
      expect(
        await rowFor(page, 'atlas')
          .locator('[aria-label^="served from Railway"]')
          .count()
      ).toBe(0);

      const reach = await openReach(page, 'railwayapp');
      const push = reach.getByRole('button', {
        name: 'Push to Railway',
        exact: true,
      });
      expect(await push.count()).toBe(1);
      expect(await push.isDisabled()).toBe(false);
    },
    { fixture: 'status-remote.json' }
  );
});

test('a non-remote row renders an enabled Railway switch, off, with no status and no Push', async () => {
  await withBoard(
    async page => {
      const reach = await openReach(page, 'atlas');
      const sw = reach.getByRole('switch', {
        name: 'push atlas to Railway',
        exact: true,
      });
      expect(await sw.count()).toBe(1);
      expect(await sw.isChecked()).toBe(false);
      expect(await sw.isDisabled()).toBe(false);
      const text = (await reach.textContent()) ?? '';
      for (const status of ['deploying', 'verifying', 'live'])
        expect(text).not.toContain(status);
      expect(
        await reach
          .getByRole('button', { name: 'Push to Railway', exact: true })
          .count()
      ).toBe(0);
    },
    { fixture: 'status-remote.json' }
  );
});

test('turning the Railway switch on POSTs {enabled:true}', async () => {
  await withBoard(
    async page => {
      let body: unknown = null;
      await page.route('**/api/v1/apps/atlas/remote', async route => {
        body = route.request().postDataJSON();
        await route.fulfill(ok);
      });

      const reach = await openReach(page, 'atlas');
      await reach
        .getByRole('switch', { name: 'push atlas to Railway', exact: true })
        .click();

      await waitUntil(async () => body !== null);
      expect(body).toEqual({ enabled: true });
    },
    { fixture: 'status-remote.json' }
  );
});

test("a live row's reach block shows the Railway status and Push to Railway POSTs to /push", async () => {
  await withBoard(
    async page => {
      let pushed = false;
      await page.route('**/api/v1/apps/railwayapp/push', async route => {
        pushed = true;
        await route.fulfill(ok);
      });

      const reach = await openReach(page, 'railwayapp');
      expect(
        await reach
          .getByRole('switch', {
            name: 'turn off remote for railwayapp',
            exact: true,
          })
          .isChecked()
      ).toBe(true);
      expect(await reach.textContent()).toContain('live');

      const push = reach.getByRole('button', {
        name: 'Push to Railway',
        exact: true,
      });
      expect(await push.isDisabled()).toBe(false);
      await push.click();

      await waitUntil(async () => pushed);
    },
    { fixture: 'status-remote.json' }
  );
});

test("a password-only row's Railway switch is disabled with today's tooltip", async () => {
  await withBoard(
    async page => {
      const reach = await openReach(page, 'gatedapp');
      expect(
        await reach
          .getByRole('switch', {
            name: 'push gatedapp to Railway',
            exact: true,
          })
          .isDisabled()
      ).toBe(true);
      expect(await railwayTip(reach).count()).toBe(1);
    },
    { fixture: 'status-remote.json' }
  );
});

test('an already-remote password-only row keeps its Railway switch enabled, so it can still be turned off', async () => {
  await withBoard(
    async page => {
      const reach = await openReach(page, 'lockedout');
      const sw = reach.getByRole('switch', {
        name: 'turn off remote for lockedout',
        exact: true,
      });
      expect(await sw.isChecked()).toBe(true);
      expect(await sw.isDisabled()).toBe(false);
      expect(await railwayTip(reach).count()).toBe(0);
    },
    { fixture: 'status-remote.json' }
  );
});

test('the publish switch in the modal carries the parity aria-label and fires PUT then a refresh GET', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route('**/api/v1/apps/forecast/publish', async route => {
      putBody = route.request().postDataJSON();
      await route.fulfill(ok);
    });

    const reach = await openReach(page, 'forecast');
    let statusRequests = 0;
    await page.route('**/api/v1/status', async route => {
      statusRequests++;
      await route.continue();
    });

    const sw = reach.getByRole('switch', {
      name: 'make forecast private',
      exact: true,
    });
    expect(await sw.isChecked()).toBe(true);
    const before = statusRequests;
    await sw.click();

    await waitUntil(async () => putBody !== null && statusRequests > before);
    expect(putBody).toEqual({ published: false });
  });
});

test('the publish switch in the modal flips optimistically before the PUT resolves, and reverts when the server never confirms', async () => {
  await withBoard(async page => {
    let releasePut: () => void = () => {};
    const putHeld = new Promise<void>(r => (releasePut = r));
    await page.route('**/api/v1/apps/ledger/publish', async route => {
      await putHeld;
      await route.fulfill(ok);
    });

    const reach = await openReach(page, 'ledger');
    const sw = reach.getByRole('switch', {
      name: /^(publish ledger|make ledger private)$/,
    });
    expect(await sw.isChecked()).toBe(false);
    await sw.click();
    await new Promise(r => setTimeout(r, 50));
    expect(await sw.isChecked()).toBe(true);

    releasePut();
    await waitUntil(async () => !(await sw.isChecked()));
  });
});
