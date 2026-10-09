// Per-app settings modal: open/close/focus, header and status, the reduced
// forms, and the Code, App, Port and footer blocks. Every selector inside
// the modal is scoped to its dialog.
import { expect, test } from 'bun:test';
import type { Locator, Page, Route } from 'playwright';

import fixture from '../fixture/status.json' with { type: 'json' };
import { consoleErrors, withBoard } from './rig.ts';

function rowFor(page: Page, name: string) {
  return page.locator('[data-part="table-row"]').filter({
    has: page
      .locator('[data-part="table-cell"]')
      .first()
      .filter({ hasText: name }),
  });
}

function gearFor(page: Page, name: string) {
  return page.getByRole('button', {
    name: `settings for ${name}`,
    exact: true,
  });
}

function settingsFor(page: Page, name: string) {
  return page.getByRole('dialog', {
    name: `settings for ${name}`,
    exact: true,
  });
}

function anySettings(page: Page) {
  return page.getByRole('dialog', { name: /^settings for / });
}

/** The tunnel has no table row, so no gear: its modal opens from the header
    tunnel badge. */
const TUNNEL = 'cloudflared';

/** Fails within 2s on a missing dialog, so a red run names the dialog rather
    than a later control or the test's own timeout. */
async function openSettings(page: Page, name: string): Promise<Locator> {
  if (name === TUNNEL) await page.locator('button.tunnel-badge').click();
  else await gearFor(page, name).click();
  const dlg = settingsFor(page, name);
  await dlg.waitFor({ state: 'visible', timeout: 2000 });
  return dlg;
}

async function closeSettings(page: Page, name: string): Promise<void> {
  await settingsFor(page, name)
    .getByRole('button', { name: 'close', exact: true })
    .click();
  await settingsFor(page, name).waitFor({ state: 'detached', timeout: 2000 });
}

function block(dlg: Locator, id: string) {
  return dlg.locator(`[data-block="${id}"]`);
}

function statusPill(dlg: Locator) {
  return block(dlg, 'status').locator('[data-part="status-pill"]');
}

function button(scope: Locator, name: string) {
  return scope.getByRole('button', { name, exact: true });
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

function activeLabel(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.activeElement?.getAttribute('aria-label') ?? null
  );
}

async function expectFocusOnGear(page: Page, name: string): Promise<void> {
  await waitUntil(
    async () => (await activeLabel(page)) === `settings for ${name}`
  );
  expect(
    await page.evaluate(
      () => document.activeElement?.classList.contains('row-gear') ?? false
    )
  ).toBe(true);
}

async function statusPollsDuring(page: Page, ms: number): Promise<number> {
  let hits = 0;
  const handler = async (route: Route) => {
    hits++;
    await route.continue();
  };
  await page.route('**/api/v1/status', handler);
  await new Promise(r => setTimeout(r, ms));
  await page.unroute('**/api/v1/status', handler);
  return hits;
}

const ok = {
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true }),
};

// ---------------------------------------------------------------------------
// Opening, closing, focus
// ---------------------------------------------------------------------------

test('the modal opens only from the row gear; esc, close and backdrop close it; focus returns to the gear', async () => {
  await withBoard(async page => {
    await rowFor(page, 'atlas')
      .locator('[data-part="table-cell"]')
      .nth(1)
      .click();
    expect(await settingsFor(page, 'atlas').count()).toBe(0);

    await openSettings(page, 'atlas');
    await page.keyboard.press('Escape');
    await settingsFor(page, 'atlas').waitFor({ state: 'detached' });
    await expectFocusOnGear(page, 'atlas');

    await openSettings(page, 'atlas');
    await closeSettings(page, 'atlas');
    await expectFocusOnGear(page, 'atlas');

    await openSettings(page, 'atlas');
    await page
      .locator('.app-settings-overlay')
      .click({ position: { x: 5, y: 5 } });
    await settingsFor(page, 'atlas').waitFor({ state: 'detached' });
    await expectFocusOnGear(page, 'atlas');

    expect(consoleErrors(page)).toEqual([]);
  });
}, 15000);

test('switch, restart, and site-link clicks do not open the modal', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/apps/forecast/publish', route =>
      route.fulfill(ok)
    );
    await page.route('**/api/v1/apps/atlas/restart', route =>
      route.fulfill(ok)
    );

    await rowFor(page, 'forecast')
      .locator('[data-part="switch-control"]')
      .click();
    expect(await anySettings(page).count()).toBe(0);

    await rowFor(page, 'atlas').locator('[aria-label="restart atlas"]').click();
    expect(await anySettings(page).count()).toBe(0);

    await rowFor(page, 'atlas').locator('a[target="_blank"]').first().click();
    expect(await anySettings(page).count()).toBe(0);

    // The negatives above only mean something if the gear does open it.
    await openSettings(page, 'atlas');
  });
}, 15000);

test('initial focus lands on the close button', async () => {
  await withBoard(async page => {
    await openSettings(page, 'atlas');
    await waitUntil(async () => (await activeLabel(page)) === 'close');
    expect(
      await page.evaluate(
        () =>
          document.activeElement
            ?.closest('[role="dialog"]')
            ?.getAttribute('aria-label') ?? null
      )
    ).toBe('settings for atlas');
  });
});

test("the header tunnel badge opens the tunnel row's modal; closing returns focus to the badge", async () => {
  await withBoard(async page => {
    await page.locator('button.tunnel-badge').click();
    await settingsFor(page, 'cloudflared').waitFor({
      state: 'visible',
      timeout: 2000,
    });
    await page.keyboard.press('Escape');
    await settingsFor(page, 'cloudflared').waitFor({ state: 'detached' });
    await waitUntil(async () =>
      page.evaluate(
        () =>
          document.activeElement?.classList.contains('tunnel-badge') ?? false
      )
    );
  });
});

test('a row vanishing while its modal is open closes the modal and focus lands on the page fallback', async () => {
  await withBoard(async page => {
    let dropLedger = false;
    await page.route('**/api/v1/status', async route => {
      if (!dropLedger) {
        await route.continue();
        return;
      }
      const next = structuredClone(fixture) as typeof fixture;
      next.apps = next.apps.filter(a => a.name !== 'ledger');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(next),
      });
    });

    await openSettings(page, 'ledger');
    dropLedger = true;
    await settingsFor(page, 'ledger').waitFor({
      state: 'detached',
      timeout: 8000,
    });

    expect(
      await page.evaluate(
        () => document.activeElement === document.querySelector('main.board')
      )
    ).toBe(true);
    expect(consoleErrors(page)).toEqual([]);
  });
}, 15000);

// ---------------------------------------------------------------------------
// Header, status pill, forms by kind
// ---------------------------------------------------------------------------

test('forms per row kind: an app gets every block, a service and the tunnel get the reduced forms', async () => {
  await withBoard(async page => {
    let dlg = await openSettings(page, 'atlas');
    for (const id of [
      'status',
      'code',
      'port',
      'errors',
      'reach',
      'gates',
      'danger',
    ])
      expect(await block(dlg, id).count()).toBe(1);
    for (const id of ['app', 'tunnel', 'service'])
      expect(await block(dlg, id).count()).toBe(0);
    await closeSettings(page, 'atlas');

    dlg = await openSettings(page, 'stray-agent');
    for (const id of ['status', 'errors', 'service'])
      expect(await block(dlg, id).count()).toBe(1);
    for (const id of [
      'code',
      'app',
      'port',
      'reach',
      'gates',
      'danger',
      'tunnel',
    ])
      expect(await block(dlg, id).count()).toBe(0);
    expect(await button(dlg, 'give it a route…').count()).toBe(1);
    expect(await button(dlg, 'restart stray-agent').count()).toBe(1);
    await closeSettings(page, 'stray-agent');

    dlg = await openSettings(page, 'cloudflared');
    for (const id of ['status', 'errors', 'tunnel'])
      expect(await block(dlg, id).count()).toBe(1);
    for (const id of [
      'code',
      'app',
      'port',
      'reach',
      'gates',
      'danger',
      'service',
    ])
      expect(await block(dlg, id).count()).toBe(0);
    expect(await block(dlg, 'tunnel').textContent()).toContain('*.mattstack');
    expect(await button(dlg, 'restart cloudflared').count()).toBe(1);
  });
}, 15000);

test('header: name, ownership badge, and a new-tab URL only while healthy', async () => {
  await withBoard(async page => {
    let dlg = await openSettings(page, 'atlas');
    expect(
      await dlg.locator('[data-part="modal-title"]').textContent()
    ).toContain('atlas');
    expect(
      await dlg.getByText('mattstack', { exact: true }).count()
    ).toBeGreaterThan(0);
    expect(await dlg.getByText('your app', { exact: true }).count()).toBe(0);
    expect(
      await block(dlg, 'status').locator('a[target="_blank"]').count()
    ).toBeGreaterThan(0);
    await closeSettings(page, 'atlas');

    dlg = await openSettings(page, 'orbit');
    expect(await dlg.getByText('your app', { exact: true }).count()).toBe(1);
    expect(await dlg.getByText('mattstack', { exact: true }).count()).toBe(0);
    await closeSettings(page, 'orbit');

    dlg = await openSettings(page, 'ledger');
    expect(
      await block(dlg, 'status').locator('a[target="_blank"]').count()
    ).toBe(0);
  });
}, 15000);

test('status pill: healthy with status, ms and pid; down; no route; the tunnel detail', async () => {
  await withBoard(async page => {
    let dlg = await openSettings(page, 'atlas');
    let pill = statusPill(dlg);
    expect(await pill.getAttribute('data-tone')).toBe('ok');
    let text = (await pill.textContent()) ?? '';
    expect(text).toMatch(/healthy/i);
    expect(text).toContain('200');
    expect(text).toContain('34');
    expect(text).toContain('5123');
    await closeSettings(page, 'atlas');

    dlg = await openSettings(page, 'ledger');
    pill = statusPill(dlg);
    expect(await pill.getAttribute('data-tone')).toBe('bad');
    text = (await pill.textContent()) ?? '';
    expect(text).toMatch(/down/i);
    expect(text).toMatch(/unreachable|exit 1/);
    await closeSettings(page, 'ledger');

    dlg = await openSettings(page, 'cloudflared');
    pill = statusPill(dlg);
    expect(await pill.getAttribute('data-tone')).toBe('ok');
    expect(await pill.textContent()).toContain('4 connections');
  });
}, 15000);

test("the service-without-route header keeps 'no route' (no health to gate it on)", async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'stray-agent');
    expect(await statusPill(dlg).textContent()).toMatch(/no route/i);
    expect(await statusPill(dlg).textContent()).toContain('exit 1');
  });
});

test("a broken app's modal shows the sync issue alert and its stderr in Recent errors", async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'ledger');
    const alerts = block(dlg, 'issues').locator(
      '[data-part="alert"][data-intent="bad"]'
    );
    expect(await alerts.count()).toBe(1);
    expect(await alerts.textContent()).toContain(
      'cloudflare sync failed · Access sync failed: 502 from Cloudflare API'
    );
    expect(await statusPill(dlg).getAttribute('data-tone')).toBe('bad');
    expect(await block(dlg, 'errors').textContent()).toContain(
      'Error: connect ECONNREFUSED'
    );
  });
});

test('restart in the header goes busy with a spinner and the status pill reads Restarting…', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/apps/atlas/restart', route =>
      route.fulfill(ok)
    );
    const dlg = await openSettings(page, 'atlas');
    const restart = button(dlg, 'restart atlas');
    await restart.click();

    await waitUntil(
      async () => (await restart.getAttribute('aria-busy')) === 'true'
    );
    expect(await restart.locator('[data-part="spinner"]').count()).toBe(1);
    const pill = statusPill(dlg);
    expect(await pill.getAttribute('data-tone')).toBe('warn');
    expect(await pill.textContent()).toMatch(/restarting…/i);
  });
});

test("a service-without-route's 'give it a route…' opens the add modal prefilled with its name", async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'stray-agent');
    await button(dlg, 'give it a route…').click();
    const add = page.getByRole('dialog', { name: 'Add an app', exact: true });
    await add.waitFor({ state: 'visible', timeout: 2000 });
    expect(await add.getByRole('textbox', { name: 'Name' }).inputValue()).toBe(
      'stray-agent'
    );
  });
});

test('an off app: the off status and none of what an off row hides', async () => {
  await withBoard(
    async page => {
      const dlg = await openSettings(page, 'ledger');
      const pill = statusPill(dlg);
      expect(await pill.getAttribute('data-tone')).toBe('muted');
      expect(await pill.textContent()).toMatch(/off/i);
      expect(await block(dlg, 'status').locator('.t-bad').count()).toBe(0);
      expect(await block(dlg, 'status').textContent()).not.toContain(
        'unreachable'
      );
      expect(await block(dlg, 'reach').count()).toBe(0);
      expect(
        await dlg.getByRole('switch', { name: 'publish ledger' }).count()
      ).toBe(0);
      expect(
        await dlg
          .getByRole('switch', { name: 'push ledger to Railway' })
          .count()
      ).toBe(0);
      expect(await button(dlg, 'restart ledger').count()).toBe(0);
      expect(consoleErrors(page)).toEqual([]);
    },
    { fixture: 'status-off.json' }
  );
});

test('public host shows no write control in the modal', async () => {
  await withBoard(
    async page => {
      const rows = [
        'atlas',
        'forecast',
        'ledger',
        'orbit',
        'cloudflared',
        'stray-agent',
      ];
      const commands = ['build', 'deploy'];
      const tableCommands = new Map<string, number>();
      for (const name of rows)
        for (const cmd of commands)
          tableCommands.set(
            `${cmd} ${name}`,
            await page
              .getByRole('button', { name: `${cmd} ${name}`, exact: true })
              .count()
          );

      for (const name of rows) {
        const dlg = await openSettings(page, name);
        expect(await dlg.getByRole('switch').count()).toBe(0);
        expect(await dlg.locator('input, textarea, select').count()).toBe(0);
        for (const label of [
          'relink',
          'unlink',
          'Remove app…',
          'give it a route…',
          'Route to it',
          'Save',
          'Save changes',
          'Apply',
          'replace password',
          'remove password',
          'Push to Railway',
        ])
          expect(await button(dlg, label).count()).toBe(0);
        expect(
          await dlg.getByRole('button', { name: /^revert to / }).count()
        ).toBe(0);
        // canRestart is false in this fixture.
        expect(
          await dlg.getByRole('button', { name: /^restart / }).count()
        ).toBe(0);
        for (const cmd of commands)
          expect(await button(dlg, `${cmd} ${name}`).count()).toBe(
            tableCommands.get(`${cmd} ${name}`)!
          );
        await page.keyboard.press('Escape');
        await settingsFor(page, name).waitFor({ state: 'detached' });
      }
    },
    { fixture: 'status-readonly.json' }
  );
}, 30000);

test('public host: restart follows canRestart, not canManage', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/status', async route => {
      const next = structuredClone(fixture) as typeof fixture;
      next.canManage = false;
      next.canRestart = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(next),
      });
    });
    // The first status landed before the route; wait for a poll to apply it.
    await waitUntil(
      async () => (await page.getByRole('switch').count()) === 0,
      8000
    );

    const dlg = await openSettings(page, 'atlas');
    expect(await button(dlg, 'restart atlas').count()).toBe(1);
    expect(await dlg.getByRole('switch').count()).toBe(0);
    expect(await dlg.locator('input, textarea, select').count()).toBe(0);
  });
}, 15000);

// ---------------------------------------------------------------------------
// Port block. orbit carries a live override (3007, base 11007) in the
// fixture; atlas has none; forecast is self.
// ---------------------------------------------------------------------------

test('port: an override shows the assigned port, the override in the warn role, revert and the public-follows switch', async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'orbit');
    const port = block(dlg, 'port');
    expect(await port.textContent()).toContain('11007');
    expect(await port.locator('.t-warn', { hasText: '3007' }).count()).toBe(1);
    expect(await button(port, 'revert to 11007').count()).toBe(1);
    const follows = port.getByRole('switch', {
      name: "serve orbit's dev port publicly",
      exact: true,
    });
    expect(await follows.count()).toBe(1);
    expect(await follows.isChecked()).toBe(false);
    expect(
      await port.getByRole('textbox', { name: 'dev port override' }).count()
    ).toBe(0);
  });
});

test('port: the public-follows-dev switch calls its mutation', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route(
      '**/api/v1/apps/orbit/public-follows-override',
      async route => {
        putBody = route.request().postDataJSON();
        await route.fulfill(ok);
      }
    );

    const dlg = await openSettings(page, 'orbit');
    await block(dlg, 'port')
      .getByRole('switch', { name: "serve orbit's dev port publicly" })
      .click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ follows: true });
  });
});

test('port: revert calls the override-clear mutation and the block falls back to the input', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route('**/api/v1/apps/orbit/override', async route => {
      putBody = route.request().postDataJSON();
      await route.fulfill(ok);
    });
    let reverted = false;
    await page.route('**/api/v1/status', async route => {
      if (!reverted) {
        await route.continue();
        return;
      }
      const next = structuredClone(fixture) as typeof fixture;
      const orbit = next.apps.find(a => a.name === 'orbit');
      if (!orbit) throw new Error('fixture missing orbit');
      orbit.override = null;
      orbit.port = 11007;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(next),
      });
    });

    const dlg = await openSettings(page, 'orbit');
    const port = block(dlg, 'port');
    reverted = true;
    await button(port, 'revert to 11007').click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ devPort: null });

    await waitUntil(
      async () =>
        (await port
          .getByRole('textbox', { name: 'dev port override' })
          .count()) === 1
    );
    expect(await button(port, 'revert to 11007').count()).toBe(0);
    expect(await port.locator('.t-warn').count()).toBe(0);
    expect(await port.textContent()).toContain('11007');
  });
});

test("port: deck's own row (self) shows its port and offers no override", async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'forecast');
    const port = block(dlg, 'port');
    expect(await port.textContent()).toContain('11003');
    expect(await port.textContent()).toContain(
      "overrides don't apply to deck itself"
    );
    // forecast defensively carries an override (devPort 3000) the server
    // would reject on self; the block must not surface it.
    expect(await port.locator('.t-warn').count()).toBe(0);
    expect(await port.textContent()).not.toContain('3000');
    expect(
      await port.getByRole('textbox', { name: 'dev port override' }).count()
    ).toBe(0);
    expect(await button(port, 'Route to it').count()).toBe(0);
    expect(
      await port.getByRole('button', { name: /^revert to / }).count()
    ).toBe(0);
    expect(await port.getByRole('switch').count()).toBe(0);
  });
});

test('port: no override offers an empty input and Route to it, disabled until there is text; Escape cancels without saving', async () => {
  await withBoard(async page => {
    let putCalled = false;
    await page.route('**/api/v1/apps/atlas/override', async route => {
      putCalled = true;
      await route.fulfill(ok);
    });

    const dlg = await openSettings(page, 'atlas');
    const port = block(dlg, 'port');
    expect(await port.textContent()).toContain('11001');
    const input = port.getByRole('textbox', { name: 'dev port override' });
    expect(await input.inputValue()).toBe('');
    const route = button(port, 'Route to it');
    expect(await route.isDisabled()).toBe(true);

    await input.pressSequentially('5173');
    expect(await route.isDisabled()).toBe(false);
    await input.press('Escape');

    expect(await input.inputValue()).toBe('');
    expect(await dlg.isVisible()).toBe(true);
    expect(putCalled).toBe(false);
  });
});

test('port: Route to it PUTs the override, then the block shows the override state', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route('**/api/v1/apps/atlas/override', async route => {
      putBody = route.request().postDataJSON();
      await route.fulfill(ok);
    });
    let saved = false;
    await page.route('**/api/v1/status', async route => {
      if (!saved) {
        await route.continue();
        return;
      }
      const next = structuredClone(fixture) as typeof fixture;
      const atlas = next.apps.find(a => a.name === 'atlas');
      if (!atlas) throw new Error('fixture missing atlas');
      atlas.override = { devPort: 5173, basePort: 11001 };
      atlas.port = 5173;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(next),
      });
    });

    const dlg = await openSettings(page, 'atlas');
    const port = block(dlg, 'port');
    await port
      .getByRole('textbox', { name: 'dev port override' })
      .pressSequentially('5173');
    saved = true;
    await button(port, 'Route to it').click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ devPort: 5173 });

    await waitUntil(
      async () => (await button(port, 'revert to 11001').count()) === 1
    );
    expect(await port.locator('.t-warn', { hasText: '5173' }).count()).toBe(1);
  });
});

test('port: Enter in the input submits like Route to it', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route('**/api/v1/apps/atlas/override', async route => {
      putBody = route.request().postDataJSON();
      await route.fulfill(ok);
    });

    const dlg = await openSettings(page, 'atlas');
    const input = block(dlg, 'port').getByRole('textbox', {
      name: 'dev port override',
    });
    await input.pressSequentially('5173');
    await input.press('Enter');

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ devPort: 5173 });
  });
});

test('polling continues while the modal is open with the dev port input empty', async () => {
  await withBoard(async page => {
    await openSettings(page, 'atlas');
    expect(await statusPollsDuring(page, 11000)).toBeGreaterThanOrEqual(2);
  });
}, 25000);

test('typing in the dev port input then closing the modal releases the draft', async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'atlas');
    const input = block(dlg, 'port').getByRole('textbox', {
      name: 'dev port override',
    });
    await input.pressSequentially('5173');

    await page.keyboard.press('Escape');
    expect(await dlg.isVisible()).toBe(true);
    expect(await input.inputValue()).toBe('');

    await page.keyboard.press('Escape');
    await settingsFor(page, 'atlas').waitFor({ state: 'detached' });

    expect(await statusPollsDuring(page, 11000)).toBeGreaterThanOrEqual(2);
  });
}, 25000);

test('closing with the close button while the dev port draft has text releases the draft', async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'atlas');
    await block(dlg, 'port')
      .getByRole('textbox', { name: 'dev port override' })
      .pressSequentially('5173');
    await closeSettings(page, 'atlas');

    expect(await statusPollsDuring(page, 11000)).toBeGreaterThanOrEqual(2);
  });
}, 25000);

test('dev port: reopening the modal after closing with a draft starts from an empty input', async () => {
  await withBoard(async page => {
    let dlg = await openSettings(page, 'atlas');
    await block(dlg, 'port')
      .getByRole('textbox', { name: 'dev port override' })
      .pressSequentially('5173');
    await closeSettings(page, 'atlas');

    dlg = await openSettings(page, 'atlas');
    expect(
      await block(dlg, 'port')
        .getByRole('textbox', { name: 'dev port override' })
        .inputValue()
    ).toBe('');
  });
});

test('blur with text keeps the draft until submit', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route('**/api/v1/apps/atlas/override', async route => {
      putBody = route.request().postDataJSON();
      await route.fulfill(ok);
    });

    const dlg = await openSettings(page, 'atlas');
    const port = block(dlg, 'port');
    const input = port.getByRole('textbox', { name: 'dev port override' });
    await input.pressSequentially('5173');
    await port.click({ position: { x: 4, y: 4 } });
    expect(await input.evaluate(el => el === document.activeElement)).toBe(
      false
    );
    expect(await input.inputValue()).toBe('5173');

    await button(port, 'Route to it').click();
    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ devPort: 5173 });
  });
});

// ---------------------------------------------------------------------------
// App block (user rows only; orbit is a user service in the fixture)
// ---------------------------------------------------------------------------

function appField(dlg: Locator, name: string) {
  return block(dlg, 'app').getByRole('textbox', { name, exact: true });
}

test('app: a user service row shows name, base port, command and directory, prefilled from the row', async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'orbit');
    expect(await appField(dlg, 'name').inputValue()).toBe('orbit');
    expect(await appField(dlg, 'base port').inputValue()).toBe('11007');
    expect(await appField(dlg, 'command').inputValue()).toBe('bun run dev');
    expect(await appField(dlg, 'directory').inputValue()).toBe(
      '/Users/matt/Documents/GitHub/orbit'
    );
    const save = button(block(dlg, 'app'), 'Save changes');
    expect(await save.isDisabled()).toBe(false);
    expect(await block(dlg, 'code').count()).toBe(0);
  });
});

test('app: an external row shows only name and base port', async () => {
  await withBoard(
    async page => {
      const dlg = await openSettings(page, 'atlas');
      expect(await appField(dlg, 'name').inputValue()).toBe('atlas');
      expect(await appField(dlg, 'base port').inputValue()).toBe('11001');
      expect(await appField(dlg, 'command').count()).toBe(0);
      expect(await appField(dlg, 'directory').count()).toBe(0);
    },
    { fixture: 'status-external.json' }
  );
});

test('app: the name field flags names the API would reject', async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'orbit');
    const name = appField(dlg, 'name');
    await name.fill('My App');
    expect(
      await name.evaluate(
        el => (el as HTMLInputElement).validity.patternMismatch
      )
    ).toBe(true);
    expect(consoleErrors(page)).toEqual([]);
  });
});

test('app: a managed row has no App block; Code takes its place', async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'atlas');
    expect(await block(dlg, 'app').count()).toBe(0);
    expect(await block(dlg, 'code').count()).toBe(1);
  });
});

test('app: Save changes PATCHes the edit payload', async () => {
  await withBoard(async page => {
    let patchBody: unknown = null;
    await page.route('**/api/v1/apps/orbit', async route => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      patchBody = route.request().postDataJSON();
      await route.fulfill(ok);
    });

    const dlg = await openSettings(page, 'orbit');
    await appField(dlg, 'base port').fill('12345');
    await button(block(dlg, 'app'), 'Save changes').click();

    await waitUntil(async () => patchBody !== null);
    expect(patchBody).toEqual({
      name: 'orbit',
      port: 12345,
      command: ['bun', 'run', 'dev'],
      workingDirectory: '/Users/matt/Documents/GitHub/orbit',
    });
  });
});

test('app: after Enter saves, the form stays mounted through the refresh and focus stays in the field', async () => {
  await withBoard(async page => {
    let patched = false;
    await page.route('**/api/v1/apps/orbit', async route => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      patched = true;
      await route.fulfill(ok);
    });

    const dlg = await openSettings(page, 'orbit');
    let release = () => {};
    const held = new Promise<void>(r => (release = r));
    await page.route('**/api/v1/status', async route => {
      if (patched) await held;
      await route.continue();
    });

    const port = appField(dlg, 'base port');
    await port.fill('12345');
    await port.press('Enter');
    await waitUntil(async () => patched);
    await new Promise(r => setTimeout(r, 100));
    expect(await appField(dlg, 'name').count()).toBe(1);
    expect(await port.inputValue()).toBe('12345');

    release();
    await new Promise(r => setTimeout(r, 200));
    expect(await activeLabel(page)).toBe('base port');
    expect(await port.inputValue()).toBe('12345');
  });
}, 12000);

test('app: an API validation error renders inline on the name field; the modal stays open', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/apps/orbit', async route => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'name taken' }),
      });
    });

    const dlg = await openSettings(page, 'orbit');
    await button(block(dlg, 'app'), 'Save changes').click();

    const fieldError = block(dlg, 'app').locator('[data-part="field-error"]');
    await fieldError.waitFor({ state: 'visible' });
    expect(await fieldError.textContent()).toBe('name taken');
    expect(await dlg.isVisible()).toBe(true);
  });
});

test('app: closing the modal discards the draft without saving', async () => {
  await withBoard(async page => {
    let patchCalled = false;
    await page.route('**/api/v1/apps/orbit', async route => {
      if (route.request().method() === 'PATCH') patchCalled = true;
      await route.continue();
    });

    const dlg = await openSettings(page, 'orbit');
    await appField(dlg, 'name').fill('scratch');
    await closeSettings(page, 'orbit');

    expect(patchCalled).toBe(false);
  });
});

test("app: reopening after close starts from the row's values, not the discarded draft", async () => {
  await withBoard(async page => {
    let dlg = await openSettings(page, 'orbit');
    await appField(dlg, 'name').fill('scratch');
    await appField(dlg, 'command').fill('garbage');
    await closeSettings(page, 'orbit');

    dlg = await openSettings(page, 'orbit');
    expect(await appField(dlg, 'name').inputValue()).toBe('orbit');
    expect(await appField(dlg, 'command').inputValue()).toBe('bun run dev');
  });
});

// ---------------------------------------------------------------------------
// Code block (managed rows; atlas is linked, ledger unlinked)
// ---------------------------------------------------------------------------

test('code: source path, command buttons, relink, and unlink PATCHes dev:null after its confirm', async () => {
  await withBoard(async page => {
    let patchBody: unknown = null;
    await page.route('**/api/v1/apps/atlas', async route => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      patchBody = route.request().postDataJSON();
      await route.fulfill(ok);
    });

    const dlg = await openSettings(page, 'atlas');
    const code = block(dlg, 'code');
    expect(await code.textContent()).toContain('Documents/GitHub/atlas');
    expect(await button(code, 'build atlas').count()).toBe(1);
    expect(await button(code, 'deploy atlas').count()).toBe(1);
    expect(await button(code, 'relink').count()).toBe(1);

    await button(code, 'unlink').click();
    const confirm = page.getByRole('dialog', {
      name: 'unlink atlas?',
      exact: true,
    });
    await confirm.waitFor({ state: 'visible' });
    await button(confirm, 'unlink').click();
    await waitUntil(async () => patchBody !== null);
    expect(patchBody).toEqual({ dev: null });
  });
});

test('code: relink opens the path input and Enter PATCHes the new checkout', async () => {
  await withBoard(async page => {
    let patchBody: unknown = null;
    await page.route('**/api/v1/apps/atlas', async route => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      patchBody = route.request().postDataJSON();
      await route.fulfill(ok);
    });

    const dlg = await openSettings(page, 'atlas');
    const code = block(dlg, 'code');
    await button(code, 'relink').click();
    const input = code.getByRole('textbox', { name: 'source path for atlas' });
    await input.fill('/Users/matt/src/atlas-two');
    await input.press('Enter');

    await waitUntil(async () => patchBody !== null);
    expect(patchBody).toEqual({
      dev: { workingDirectory: '/Users/matt/src/atlas-two' },
    });
  });
});

test("code: a refused relink shows the server's error inline and keeps the input", async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/apps/atlas', async route => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'no mattstack.deck.json in /nope' }),
      });
    });

    const dlg = await openSettings(page, 'atlas');
    const code = block(dlg, 'code');
    await button(code, 'relink').click();
    const input = code.getByRole('textbox', { name: 'source path for atlas' });
    await input.fill('/nope');
    await input.press('Enter');

    await waitUntil(async () =>
      ((await code.textContent()) ?? '').includes(
        'no mattstack.deck.json in /nope'
      )
    );
    expect(await input.count()).toBe(1);
    await waitUntil(
      async () => (await activeLabel(page)) === 'source path for atlas'
    );
  });
});

test('code: Escape in an empty relink input closes only the input, not the modal', async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'atlas');
    const code = block(dlg, 'code');
    const relink = button(code, 'relink');
    await relink.click();
    const input = code.getByRole('textbox', { name: 'source path for atlas' });
    await input.waitFor({ state: 'visible' });
    expect(await input.inputValue()).toBe('');

    await input.press('Escape');
    await input.waitFor({ state: 'detached', timeout: 2000 });
    await new Promise(r => setTimeout(r, 200));
    expect(await settingsFor(page, 'atlas').isVisible()).toBe(true);
    expect(await relink.getAttribute('aria-expanded')).toBe('false');
  });
});

test('code: Escape in the empty always-visible link input closes the modal', async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'ledger');
    const input = block(dlg, 'code').getByRole('textbox', {
      name: 'source path for ledger',
    });
    await input.focus();
    await input.press('Escape');
    await settingsFor(page, 'ledger').waitFor({
      state: 'detached',
      timeout: 2000,
    });
  });
});

test("code: an unlinked row shows the link input and today's footer instead of a path", async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'ledger');
    const code = block(dlg, 'code');
    expect(
      await code
        .getByRole('textbox', { name: 'source path for ledger' })
        .count()
    ).toBe(1);
    expect(await code.textContent()).toContain(
      'link a source checkout to get build/deploy here and source serving in dev mode'
    );
    expect(await button(code, 'unlink').count()).toBe(0);
  });
});

test('code: Deployed reads deployed → head with new code in source, or current when linked without new code', async () => {
  await withBoard(
    async page => {
      let dlg = await openSettings(page, 'atlas');
      let text = (await block(dlg, 'code').textContent()) ?? '';
      expect(text).toContain('a3f19c2');
      expect(text).toContain('e81d4b0');
      expect(text).toContain('new code in source');
      await closeSettings(page, 'atlas');

      dlg = await openSettings(page, 'zenith');
      text = (await block(dlg, 'code').textContent()) ?? '';
      expect(text).toContain('current');
      expect(text).not.toContain('new code in source');
    },
    { fixture: 'status-newcode.json' }
  );
});

// ---------------------------------------------------------------------------
// Remove (footer)
// ---------------------------------------------------------------------------

function removeConfirm(page: Page, name: string) {
  return page.getByRole('dialog', { name: `remove ${name}?`, exact: true });
}

async function confirmRemove(page: Page, name: string): Promise<void> {
  const dlg = await openSettings(page, name);
  await button(block(dlg, 'danger'), 'Remove app…').click();
  await button(removeConfirm(page, name), 'remove app').click();
}

async function boardAlert(page: Page, text: string): Promise<string | null> {
  const alert = page.locator('[data-part="alert"][data-intent="bad"]', {
    hasText: text,
  });
  await alert.waitFor({ state: 'visible' });
  return alert.textContent();
}

test("remove: Remove app… opens the confirm with today's blast-radius copy, stacked over the modal", async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'atlas');
    await button(block(dlg, 'danger'), 'Remove app…').click();

    const confirm = removeConfirm(page, 'atlas');
    await confirm.waitFor({ state: 'visible' });
    expect(
      await confirm.locator('[data-part="confirmdialog-body"]').textContent()
    ).toBe(
      'its route, launchd service, and access config are deleted. the code stays.'
    );
    expect(await dlg.count()).toBe(1);
  });
});

test('remove: cancel closes the confirm without deleting; the modal stays open', async () => {
  await withBoard(async page => {
    let deleteCalled = false;
    await page.route('**/api/v1/apps/atlas', async route => {
      if (route.request().method() === 'DELETE') deleteCalled = true;
      await route.continue();
    });

    const dlg = await openSettings(page, 'atlas');
    await button(block(dlg, 'danger'), 'Remove app…').click();
    await button(removeConfirm(page, 'atlas'), 'cancel').click();
    await removeConfirm(page, 'atlas').waitFor({ state: 'detached' });

    expect(deleteCalled).toBe(false);
    expect(await dlg.isVisible()).toBe(true);
  });
});

test('remove: Esc closes the confirm first and leaves the modal open', async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'atlas');
    await button(block(dlg, 'danger'), 'Remove app…').click();
    await removeConfirm(page, 'atlas').waitFor({ state: 'visible' });

    await page.keyboard.press('Escape');
    await removeConfirm(page, 'atlas').waitFor({ state: 'detached' });
    expect(await dlg.isVisible()).toBe(true);
  });
});

test('remove: confirm DELETEs the app and closes the modal', async () => {
  await withBoard(async page => {
    let deleteCalled = false;
    await page.route('**/api/v1/apps/atlas', async route => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      deleteCalled = true;
      await route.fulfill(ok);
    });
    let removed = false;
    await page.route('**/api/v1/status', async route => {
      if (!removed) {
        await route.continue();
        return;
      }
      const next = structuredClone(fixture) as typeof fixture;
      next.apps = next.apps.filter(a => a.name !== 'atlas');
      next.total -= 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(next),
      });
    });

    const dlg = await openSettings(page, 'atlas');
    await button(block(dlg, 'danger'), 'Remove app…').click();
    removed = true;
    await button(removeConfirm(page, 'atlas'), 'remove app').click();

    await waitUntil(async () => deleteCalled);
    await settingsFor(page, 'atlas').waitFor({
      state: 'detached',
      timeout: 8000,
    });
  });
}, 15000);

test("remove: deck's own row offers no Remove app…", async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'forecast');
    expect(await button(dlg, 'Remove app…').count()).toBe(0);
  });
});

test('remove: a 200 whose body says ok:false shows the error on the board', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/apps/atlas', async route => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: 'Error: EACCES: permission denied',
        }),
      });
    });

    await confirmRemove(page, 'atlas');

    expect(await boardAlert(page, 'removing atlas failed')).toContain(
      'removing atlas failed: Error: EACCES: permission denied'
    );
  });
}, 12000);

test('remove: a request that never answers shows an error on the board', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/apps/atlas', async route => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      await route.abort('connectionrefused');
    });

    await confirmRemove(page, 'atlas');

    expect(await boardAlert(page, 'removing atlas failed')).toContain(
      'removing atlas failed, the board did not answer.'
    );
  });
}, 12000);

test('remove: arrow keys never retarget the modal or the confirm', async () => {
  await withBoard(async page => {
    const dlg = await openSettings(page, 'atlas');
    await page.keyboard.press('ArrowDown');
    expect(await dlg.isVisible()).toBe(true);
    expect(await settingsFor(page, 'forecast').count()).toBe(0);

    await button(block(dlg, 'danger'), 'Remove app…').click();
    const confirm = removeConfirm(page, 'atlas');
    await confirm.waitFor({ state: 'visible' });
    await page.keyboard.press('ArrowDown');

    expect(await confirm.isVisible()).toBe(true);
    expect(await dlg.isVisible()).toBe(true);
    expect(await settingsFor(page, 'forecast').count()).toBe(0);
  });
});
