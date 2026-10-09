// Who gets in: the password and Google sign-in controls of the settings
// modal's gates block, ported from access.spec.ts. atlas carries a password
// and oauth emails mode (2 entries) in the fixture; forecast carries neither.
import { expect, test } from 'bun:test';
import type { Locator, Page } from 'playwright';

import fixture from '../fixture/status.json' with { type: 'json' };
import { withBoard } from './rig.ts';

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

/** Opens the modal and returns its gates block. */
async function openGates(page: Page, name: string): Promise<Locator> {
  const dlg = await openSettings(page, name);
  return dlg.locator('[data-block="gates"]');
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

const ok = {
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true }),
};

test('gates: password set or not set, the sign-in switch, and who only while sign-in is on', async () => {
  await withBoard(async page => {
    let gates = await openGates(page, 'atlas');
    expect(await button(gates, 'replace password').count()).toBe(1);
    expect(await button(gates, 'remove password').count()).toBe(1);
    expect(
      await gates.getByLabel('new password', { exact: true }).count()
    ).toBe(0);
    const on = gates.getByRole('switch', {
      name: 'turn google sign-in off',
      exact: true,
    });
    expect(await on.isChecked()).toBe(true);
    expect(
      await button(gates, 'These people').getAttribute('data-active')
    ).not.toBeNull();
    expect(
      await button(gates, 'Anyone at these domains').getAttribute('data-active')
    ).toBeNull();
    expect(await button(gates, 'remove matt@example.com').count()).toBe(1);
    expect(await button(gates, 'remove guest@example.com').count()).toBe(1);

    await settingsFor(page, 'atlas')
      .getByRole('button', { name: 'close', exact: true })
      .click();
    await settingsFor(page, 'atlas').waitFor({ state: 'detached' });

    gates = await openGates(page, 'forecast');
    expect(
      await gates.getByLabel('new password', { exact: true }).count()
    ).toBe(1);
    expect(await button(gates, 'replace password').count()).toBe(0);
    const off = gates.getByRole('switch', {
      name: 'require google sign-in',
      exact: true,
    });
    expect(await off.isChecked()).toBe(false);
    expect(
      await gates.getByRole('textbox', { name: 'add email' }).count()
    ).toBe(0);
    expect(await button(gates, 'These people').count()).toBe(0);
    expect(await gates.textContent()).toContain(
      'forecast is open: anyone who can reach the tunnel gets in.'
    );
  });
}, 15000);

test('password: set flow, Save PUTs the password and the block then reads set', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route('**/api/v1/apps/forecast/password', async route => {
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
      const forecast = next.apps.find(a => a.name === 'forecast');
      if (!forecast) throw new Error('fixture missing forecast');
      forecast.hasPassword = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(next),
      });
    });

    const gates = await openGates(page, 'forecast');
    const save = button(gates, 'Save');
    expect(await save.isDisabled()).toBe(true);
    await gates.getByLabel('new password', { exact: true }).fill('s3cret');
    expect(await save.isDisabled()).toBe(false);
    saved = true;
    await save.click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ password: 's3cret' });

    await waitUntil(
      async () => (await button(gates, 'replace password').count()) === 1
    );
    expect(await button(gates, 'remove password').count()).toBe(1);
  });
});

test('password: change flow, replace reveals the input and Save PUTs the new value', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route('**/api/v1/apps/atlas/password', async route => {
      putBody = route.request().postDataJSON();
      await route.fulfill(ok);
    });

    const gates = await openGates(page, 'atlas');
    await button(gates, 'replace password').click();
    await gates.getByLabel('new password', { exact: true }).fill('newSecret1');
    await button(gates, 'Save').click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ password: 'newSecret1' });

    await waitUntil(
      async () => (await button(gates, 'replace password').count()) === 1
    );
    expect(await button(gates, 'remove password').count()).toBe(1);
  });
});

test('password: remove asks nothing and PUTs password:null immediately', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route('**/api/v1/apps/atlas/password', async route => {
      putBody = route.request().postDataJSON();
      await route.fulfill(ok);
    });
    let removed = false;
    await page.route('**/api/v1/status', async route => {
      if (!removed) {
        await route.continue();
        return;
      }
      const next = structuredClone(fixture) as typeof fixture;
      const atlas = next.apps.find(a => a.name === 'atlas');
      if (!atlas) throw new Error('fixture missing atlas');
      atlas.hasPassword = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(next),
      });
    });

    const gates = await openGates(page, 'atlas');
    const remove = button(gates, 'remove password');
    expect(await remove.count()).toBe(1);
    removed = true;
    await remove.click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ password: null });
    expect(await page.getByRole('dialog', { name: /^remove / }).count()).toBe(
      0
    );

    await waitUntil(async () => (await remove.count()) === 0);
    expect(
      await gates.getByLabel('new password', { exact: true }).count()
    ).toBe(1);
  });
});

test('password: a failed save shows the error inline and keeps the modal open', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/apps/forecast/password', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'boom' }),
      });
    });

    const gates = await openGates(page, 'forecast');
    await gates.getByLabel('new password', { exact: true }).fill('s3cret');
    await button(gates, 'Save').click();

    const alert = gates.locator('[data-part="alert"]', {
      hasText: 'saving the password failed',
    });
    await alert.waitFor({ state: 'visible' });
    expect(await alert.textContent()).toContain(
      'saving the password failed, the board did not answer.'
    );
    expect(await settingsFor(page, 'forecast').isVisible()).toBe(true);
  });
});

test('password: Escape in the input clears it and leaves the modal open; a second Escape closes it', async () => {
  await withBoard(async page => {
    const gates = await openGates(page, 'forecast');
    const input = gates.getByLabel('new password', { exact: true });
    await input.pressSequentially('s3cret');

    await page.keyboard.press('Escape');
    expect(await settingsFor(page, 'forecast').isVisible()).toBe(true);
    expect(await input.inputValue()).toBe('');

    await page.keyboard.press('Escape');
    await settingsFor(page, 'forecast').waitFor({ state: 'detached' });
  });
});

test('who: mode switch clears entries; entries add and remove; Apply disabled while empty', async () => {
  await withBoard(async page => {
    const gates = await openGates(page, 'forecast');
    await gates
      .getByRole('switch', { name: 'require google sign-in', exact: true })
      .click();

    const apply = button(gates, 'Apply');
    expect(await apply.isDisabled()).toBe(true);

    const draft = gates.getByRole('textbox', { name: 'add email' });
    await draft.fill('a@x.dev');
    await draft.press('Enter');
    expect(await button(gates, 'remove a@x.dev').count()).toBe(1);
    expect(await apply.isDisabled()).toBe(false);
    expect(await draft.inputValue()).toBe('');

    await button(gates, 'Anyone at these domains').click();
    expect(await button(gates, 'remove a@x.dev').count()).toBe(0);
    expect(await apply.isDisabled()).toBe(true);
    const domain = gates.getByRole('textbox', { name: 'add domain' });
    expect(await domain.count()).toBe(1);

    await domain.fill('corp.co');
    await domain.press('Enter');
    expect(await button(gates, 'remove corp.co').count()).toBe(1);

    await button(gates, 'remove corp.co').click();
    expect(await button(gates, 'remove corp.co').count()).toBe(0);
    expect(await apply.isDisabled()).toBe(true);
  });
});

test('who: Apply PUTs mode and the composed entries', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route('**/api/v1/apps/forecast/access', async route => {
      putBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, cfSynced: true }),
      });
    });

    const gates = await openGates(page, 'forecast');
    await gates
      .getByRole('switch', { name: 'require google sign-in', exact: true })
      .click();
    const draft = gates.getByRole('textbox', { name: 'add email' });
    await draft.fill('a@x.dev');
    await draft.press('Enter');
    await draft.fill('b@y.dev');
    await draft.press('Enter');
    await button(gates, 'Apply').click();

    await waitUntil(async () => putBody !== null);
    expect(putBody).toEqual({ mode: 'emails', emails: ['a@x.dev', 'b@y.dev'] });
  });
});

test('who: an apply error renders inline and the modal stays open', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/apps/forecast/access', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Cloudflare rejected the request' }),
      });
    });

    const gates = await openGates(page, 'forecast');
    await gates
      .getByRole('switch', { name: 'require google sign-in', exact: true })
      .click();
    const draft = gates.getByRole('textbox', { name: 'add email' });
    await draft.fill('a@x.dev');
    await draft.press('Enter');
    await button(gates, 'Apply').click();

    const alert = gates.locator('[data-part="alert"]', {
      hasText: 'Cloudflare rejected the request',
    });
    await alert.waitFor({ state: 'visible' });
    expect(await settingsFor(page, 'forecast').isVisible()).toBe(true);
  });
});

test('an apply error does not survive closing the modal', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/apps/forecast/access', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Cloudflare rejected the request' }),
      });
    });

    let gates = await openGates(page, 'forecast');
    await gates
      .getByRole('switch', { name: 'require google sign-in', exact: true })
      .click();
    const draft = gates.getByRole('textbox', { name: 'add email' });
    await draft.fill('a@x.dev');
    await draft.press('Enter');
    await button(gates, 'Apply').click();
    await gates
      .locator('[data-part="alert"]', {
        hasText: 'Cloudflare rejected the request',
      })
      .waitFor({ state: 'visible' });

    await settingsFor(page, 'forecast')
      .getByRole('button', { name: 'close', exact: true })
      .click();
    await settingsFor(page, 'forecast').waitFor({ state: 'detached' });

    gates = await openGates(page, 'forecast');
    expect(await gates.locator('[data-part="alert"]').count()).toBe(0);
    expect(
      await page
        .locator('[data-part="alert"]', {
          hasText: 'Cloudflare rejected the request',
        })
        .count()
    ).toBe(0);
  });
});

test('who: Escape in the add-entry input clears it and leaves the modal open; a second Escape closes it', async () => {
  await withBoard(async page => {
    const gates = await openGates(page, 'forecast');
    await gates
      .getByRole('switch', { name: 'require google sign-in', exact: true })
      .click();
    const draft = gates.getByRole('textbox', { name: 'add email' });
    await draft.pressSequentially('a@x');

    await page.keyboard.press('Escape');
    expect(await settingsFor(page, 'forecast').isVisible()).toBe(true);
    expect(await draft.inputValue()).toBe('');
    expect(await button(gates, 'remove a@x').count()).toBe(0);

    await page.keyboard.press('Escape');
    await settingsFor(page, 'forecast').waitFor({ state: 'detached' });
  });
});

test('gates: a teardown failure on turn-off stays visible even though the switch already reads off', async () => {
  await withBoard(async page => {
    await page.route('**/api/v1/apps/atlas/access', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, cfSynced: false }),
      });
    });

    const gates = await openGates(page, 'atlas');
    await gates
      .getByRole('switch', { name: 'turn google sign-in off', exact: true })
      .click();

    const alert = gates.locator('[data-part="alert"]', {
      hasText: 'Cloudflare was not updated',
    });
    await alert.waitFor({ state: 'visible' });
    expect(await alert.textContent()).toContain(
      'sign-in is off here, but Cloudflare was not updated, so visitors may still be asked to sign in.'
    );
    expect(
      await gates
        .getByRole('switch', { name: 'require google sign-in', exact: true })
        .count()
    ).toBe(1);
    expect(
      await gates.getByRole('textbox', { name: 'add email' }).count()
    ).toBe(0);
    expect(await button(gates, 'These people').count()).toBe(0);
  });
});

test('gates: flipping sign-in on keeps the open warning until Apply, and a close discards the intent', async () => {
  await withBoard(async page => {
    let gates = await openGates(page, 'forecast');
    const OPEN = 'forecast is open: anyone who can reach the tunnel gets in.';
    const HINT = 'Not on yet. Add people or domains and Apply.';
    expect(await gates.textContent()).not.toContain(HINT);

    await gates
      .getByRole('switch', { name: 'require google sign-in', exact: true })
      .click();
    const draft = gates.getByRole('textbox', { name: 'add email' });
    await draft.fill('a@x.dev');
    await draft.press('Enter');
    expect(await gates.textContent()).toContain(OPEN);
    expect(await gates.textContent()).toContain(HINT);
    expect(
      await settingsFor(page, 'forecast')
        .locator('.settings-footer-note')
        .textContent()
    ).toBe(
      'Switches save as you flip them. Google sign-in saves when you Apply.'
    );

    await settingsFor(page, 'forecast')
      .getByRole('button', { name: 'close', exact: true })
      .click();
    await settingsFor(page, 'forecast').waitFor({ state: 'detached' });

    gates = await openGates(page, 'forecast');
    const off = gates.getByRole('switch', {
      name: 'require google sign-in',
      exact: true,
    });
    expect(await off.isChecked()).toBe(false);
    expect(await gates.textContent()).toContain(OPEN);
    expect(await gates.textContent()).not.toContain(HINT);
  });
}, 15000);

test('gates: a sign-in gate already on shows no not-on-yet hint', async () => {
  await withBoard(async page => {
    const gates = await openGates(page, 'atlas');
    expect(await gates.textContent()).not.toContain('Not on yet.');
  });
});
