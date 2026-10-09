// bun:test's `expect` has no Playwright-locator matchers (toBeVisible,
// toHaveAttribute, expect.poll, ...) -- those live in @playwright/test's own
// expect. Assertions here read a value off the Locator/Page API directly
// (which auto-waits for attachment) and compare with bun's expect.
import { expect, test } from 'bun:test';
import type { Page } from 'playwright';

import { subline, type StatusData } from '../../core/board/logic.ts';
import fixture from '../fixture/status.json' with { type: 'json' };
import { consoleErrors, withBoard } from './rig.ts';

function rowFor(page: Page, name: string) {
  return page
    .locator('[data-part="table-row"]')
    .filter({ has: page.locator('strong', { hasText: name }) });
}

function gearFor(page: Page, name: string) {
  return page.getByRole('button', {
    name: `settings for ${name}`,
    exact: true,
  });
}

async function headerTexts(page: Page): Promise<string[]> {
  const texts = await page
    .locator('table')
    .first()
    .locator('[data-part="table-headcell"]')
    .allTextContents();
  return texts.map(t => t.trim()).filter(t => t !== '');
}

/** Found by header text, not a fixed index, so a column change cannot
    silently retarget the lookup. */
async function cellFor(page: Page, name: string, header: string) {
  const texts = await page
    .locator('table')
    .first()
    .locator('[data-part="table-headcell"]')
    .allTextContents();
  const index = texts.map(t => t.trim()).indexOf(header);
  if (index < 0) throw new Error(`no ${header} column: ${texts.join(', ')}`);
  return rowFor(page, name).locator('[data-part="table-cell"]').nth(index);
}

async function poll(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  if (!check()) throw new Error('poll() timed out waiting for condition');
}

test('renders one row per fixture app; site cell links name + suffix', async () => {
  await withBoard(async page => {
    const appsTable = page.locator('table').first();
    expect(await appsTable.locator('[data-part="table-row"]').count()).toBe(4);

    const atlasLink = rowFor(page, 'atlas').locator('a.unstyled');
    expect(await atlasLink.getAttribute('href')).toBe(
      'https://atlas.localhost'
    );
    const text = await atlasLink.textContent();
    expect(text).toContain('atlas');
    expect(text).toContain('.mattstack');

    expect(consoleErrors(page)).toEqual([]);
  });
});

test('health badges: status+ms for healthy, unreachable for down', async () => {
  await withBoard(async page => {
    const atlasBadge = rowFor(page, 'atlas').locator('[data-part="badge"]', {
      hasText: '200',
    });
    expect(await atlasBadge.textContent()).toContain('34ms');

    const ledgerBadge = rowFor(page, 'ledger').locator('[data-part="badge"]', {
      hasText: 'unreachable',
    });
    expect(await ledgerBadge.count()).toBeGreaterThan(0);
  });
});

test('no service column: header cells are site, port, health, public (plus version in dev mode)', async () => {
  await withBoard(async page => {
    expect(await headerTexts(page)).toEqual([
      'site',
      'port',
      'health',
      'public',
    ]);
  });
  await withBoard(
    async page => {
      expect(await headerTexts(page)).toEqual([
        'site',
        'port',
        'health',
        'version',
        'public',
      ]);
    },
    { fixture: 'status-newcode.json' }
  );
});

test('no leading health dot; the health badge carries tone', async () => {
  await withBoard(async page => {
    for (const name of ['atlas', 'ledger']) {
      const siteCell = rowFor(page, name)
        .locator('[data-part="table-cell"]')
        .first();
      expect(await siteCell.locator('[data-part="statusdot"]').count()).toBe(0);
    }
    const badgeIntent = async (name: string) =>
      (await cellFor(page, name, 'health'))
        .locator('[data-part="badge"]')
        .first()
        .getAttribute('data-intent');
    expect(await badgeIntent('atlas')).toBe('ok');
    expect(await badgeIntent('ledger')).toBe('bad');
  });
});

test('restart button is visible without hovering the row', async () => {
  await withBoard(async page => {
    const restart = rowFor(page, 'atlas').locator(
      '[aria-label="restart atlas"]'
    );
    expect(await restart.isVisible()).toBe(true);
  });
});

test('every row carries a settings gear in the tab order', async () => {
  await withBoard(async page => {
    const names = [
      ...fixture.apps.map(a => a.name),
      ...fixture.orphans.filter(o => !o.isTunnel).map(o => o.name),
    ];
    for (const name of names) {
      const gear = gearFor(page, name);
      expect(await gear.count()).toBe(1);
      expect(await gear.evaluate(el => (el as HTMLElement).tabIndex)).toBe(0);
      await gear.focus();
      expect(
        await page.evaluate(() =>
          document.activeElement?.getAttribute('aria-label')
        )
      ).toBe(`settings for ${name}`);
    }
  });
});

test('ownership chip: this board vs managed by', async () => {
  await withBoard(async page => {
    const forecastChip = rowFor(page, 'forecast').locator(
      '[data-part="chip"]',
      { hasText: 'this board' }
    );
    expect(await forecastChip.count()).toBe(1);

    const atlasChip = rowFor(page, 'atlas').locator('[data-part="chip"]', {
      hasText: 'managed',
    });
    expect(await atlasChip.textContent()).toContain('mattstack');
  });
});

test('publish switch carries the parity aria-label and fires PUT then a refresh GET', async () => {
  await withBoard(async page => {
    let putBody: unknown = null;
    await page.route('**/api/v1/apps/forecast/publish', async route => {
      putBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
    let statusRequests = 0;
    await page.route('**/api/v1/status', async route => {
      statusRequests++;
      await route.continue();
    });

    const toggle = rowFor(page, 'forecast').locator(
      '[data-part="switch-control"]'
    );
    expect(await toggle.getAttribute('aria-label')).toBe(
      'make forecast private'
    );

    const before = statusRequests;
    await toggle.click();
    await poll(() => statusRequests > before);
    expect(putBody).toEqual({ published: false });
  });
});

test('strays section and tunnel section render', async () => {
  await withBoard(async page => {
    expect(
      await page.locator('h2', { hasText: 'services without routes' }).count()
    ).toBe(1);
    expect(
      await page.locator('h2', { hasText: 'cloudflare tunnel' }).count()
    ).toBe(1);
    expect(await page.getByText('carries *.mattstack').count()).toBe(1);
  });
});

test('subline matches logic.subline of the fixture', async () => {
  await withBoard(async page => {
    const expected = subline(fixture as unknown as StatusData);
    expect(await page.locator('.board-subline').textContent()).toBe(expected);
  });
});

test('subline: healthy fraction renders in bad tone when an app is down (3/4 fixture)', async () => {
  await withBoard(async page => {
    const fraction = page.locator('.board-subline .t-bad', {
      hasText: 'healthy',
    });
    expect(await fraction.textContent()).toBe('3/4 healthy');

    const fractionColor = await fraction.evaluate(
      el => getComputedStyle(el).color
    );
    const redProbe = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--red)';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(fractionColor).toBe(redProbe);
  });
});

test('restart button posts and flips the row to a restarting badge with a spinner', async () => {
  await withBoard(async page => {
    let posted = false;
    await page.route('**/api/v1/apps/atlas/restart', async route => {
      posted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    const atlasRow = rowFor(page, 'atlas');
    await atlasRow.locator('[aria-label="restart atlas"]').click();
    expect(posted).toBe(true);

    const healthCell = atlasRow.locator('[data-part="table-cell"]').nth(2);
    await healthCell
      .locator('[data-part="badge"]', { hasText: 'restarting' })
      .waitFor({ state: 'visible' });
    const spinner = healthCell.locator('[data-part="spinner"]');
    expect(await spinner.count()).toBe(1);
    // Computed `animation-name` is the specified ident even when no matching
    // `@keyframes` exists (the ring then sits on frame zero). Walk the sheets
    // so a hash-mismatch (Bun CSS modules vs. the kit Spinner) fails this.
    const keyframes = await spinner.evaluate(el => {
      const name = getComputedStyle(el).animationName;
      if (!name || name === 'none') return { name, found: false };
      const walk = rules => {
        for (const rule of rules) {
          if (rule instanceof CSSKeyframesRule && rule.name === name)
            return true;
          if ('cssRules' in rule && rule.cssRules && walk(rule.cssRules))
            return true;
        }
        return false;
      };
      for (const sheet of document.styleSheets) {
        try {
          if (walk(sheet.cssRules)) return { name, found: true };
        } catch {
          /* opaque sheet */
        }
      }
      return { name, found: false };
    });
    expect(keyframes.found).toBe(true);
  });
});

test('issues render a bad badge and the raw message', async () => {
  await withBoard(async page => {
    const ledgerRow = rowFor(page, 'ledger');
    expect(
      await ledgerRow
        .locator('[data-part="badge"]', { hasText: 'cloudflare sync failed' })
        .count()
    ).toBe(1);
    expect(await ledgerRow.locator('code').textContent()).toContain(
      'Access sync failed: 502 from Cloudflare API'
    );
  });
});

test('external-link anchor appears only when publicUrl differs, with parity aria-label', async () => {
  await withBoard(async page => {
    const atlasExtLink = rowFor(page, 'atlas').locator('a[target="_blank"]');
    expect(await atlasExtLink.getAttribute('aria-label')).toBe(
      'open atlas.mattstack'
    );

    const ledgerExtLink = rowFor(page, 'ledger').locator('a[target="_blank"]');
    expect(await ledgerExtLink.count()).toBe(0);
  });
});

test('an off app: muted off badge with the settings hint, no restart, no commands, and the count skips it', async () => {
  await withBoard(
    async page => {
      const ledger = rowFor(page, 'ledger');
      const healthCell = await cellFor(page, 'ledger', 'health');
      const badge = healthCell.locator('[data-part="badge"]', {
        hasText: 'off',
      });
      expect(await badge.count()).toBe(1);
      const tooltip = healthCell.locator(
        '[data-part="tooltip"][data-tip="Turned off. Turn it on in mattstack.app, Settings > Apps."]'
      );
      expect(await tooltip.count()).toBe(1);
      expect(
        await ledger.locator('button[aria-label^="restart"]').count()
      ).toBe(0);
      // The actions cell is the row's last and has no header text; the gear
      // is its only button on an off row.
      const actionsCell = ledger.locator('[data-part="table-cell"]').last();
      expect(await actionsCell.locator('button').count()).toBe(1);
      expect(
        await actionsCell.locator('button').getAttribute('aria-label')
      ).toBe('settings for ledger');
      // An off app's launchd job is uninstalled, so a leftover exit
      // status/pid would misreport it as broken.
      expect(await ledger.locator('.t-bad').count()).toBe(0);
      expect(await ledger.textContent()).not.toContain('exit');
      expect(await ledger.textContent()).not.toContain('pid');
      const fraction = page.locator('.board-subline .t-ok', {
        hasText: 'healthy',
      });
      expect(await fraction.textContent()).toBe('3 of 3 healthy');
      expect(await ledger.locator('[role="switch"]').count()).toBe(0);

      await gearFor(page, 'ledger').click();
      const dlg = page.getByRole('dialog', {
        name: 'settings for ledger',
        exact: true,
      });
      await dlg.waitFor({ state: 'visible' });
      const header = dlg.locator('[data-block="status"]');
      const headerBadge = header.locator(
        '[data-part="status-pill"] [data-part="badge"]',
        { hasText: 'Off' }
      );
      expect(await headerBadge.count()).toBe(1);
      expect(
        await header
          .locator(
            '[data-part="tooltip"][data-tip="Turned off. Turn it on in mattstack.app, Settings > Apps."]'
          )
          .count()
      ).toBe(1);
      expect(await header.locator('[data-part="statusdot"]').count()).toBe(0);
      expect(await header.locator('.t-bad').count()).toBe(0);
      expect(await header.textContent()).not.toContain('unreachable');
      expect(await dlg.locator('[aria-label="publish ledger"]').count()).toBe(
        0
      );
      expect(
        await dlg.getByRole('button', { name: 'restart ledger' }).count()
      ).toBe(0);
      expect(
        await dlg.locator('[aria-label="push ledger to Railway"]').count()
      ).toBe(0);
      for (const section of await dlg.locator('[data-block]').all())
        expect((await section.textContent())?.trim()).not.toBe('');
      expect(consoleErrors(page)).toEqual([]);
    },
    { fixture: 'status-off.json' }
  );
});

test('public switch flips optimistically before the PUT resolves, and reverts when the server never confirms', async () => {
  await withBoard(async page => {
    // ledger is unpublished in the fixture; hold the PUT open long enough to
    // observe the optimistic state, then let the poll (still serving the
    // unchanged fixture) act as the server refusing to confirm.
    let releasePut: () => void = () => {};
    const putHeld = new Promise<void>(r => (releasePut = r));
    await page.route('**/api/v1/apps/ledger/publish', async route => {
      await putHeld;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
    const sw = rowFor(page, 'ledger').locator('[role="switch"]');
    expect(await sw.isChecked()).toBe(false);
    await sw.click();
    // Optimistic: shown state flips while the request is still in flight.
    await poll(() => true, 50);
    expect(await sw.isChecked()).toBe(true);
    releasePut();
    // Canonical hand-off: the refresh returns the unchanged fixture, so the
    // switch snaps back instead of lying about the server's state.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && (await sw.isChecked())) {
      await new Promise(r => setTimeout(r, 50));
    }
    expect(await sw.isChecked()).toBe(false);
  });
});

const REDEPLOY_TIP =
  "Runs this app's deploy command from its linked checkout, so the running app picks up the new code.";
const BUILD_TIP =
  'Runs the build command only. The running app does not change until you redeploy.';

function commandButton(page: Page, label: string) {
  return page.getByRole('button', { name: label, exact: true });
}

/** The tip of the kit Tooltip wrapping `button`. */
function tipOf(button: ReturnType<typeof commandButton>) {
  return button
    .locator('xpath=ancestor::*[@data-part="tooltip"][1]')
    .getAttribute('data-tip');
}

async function settledOpacity(
  locator: ReturnType<typeof commandButton>,
  want: string
): Promise<string> {
  const deadline = Date.now() + 2000;
  let last = '';
  while (Date.now() < deadline) {
    last = await locator.evaluate(el => getComputedStyle(el).opacity);
    if (last === want) return last;
    await new Promise(r => setTimeout(r, 25));
  }
  return last;
}

test('version column: behind shows deployed → head, linked-current shows current, others not tracked', async () => {
  await withBoard(
    async page => {
      const atlas = await cellFor(page, 'atlas', 'version');
      const atlasText = (await atlas.textContent()) ?? '';
      expect(atlasText).toContain('a3f19c2');
      expect(atlasText).toContain('e81d4b0');
      expect(
        await atlas.locator('.t-warn', { hasText: 'e81d4b0' }).count()
      ).toBe(1);
      expect(
        (await (await cellFor(page, 'zenith', 'version')).textContent())?.trim()
      ).toBe('current');
      expect(
        (await (await cellFor(page, 'ledger', 'version')).textContent())?.trim()
      ).toBe('not tracked');
    },
    { fixture: 'status-newcode.json' }
  );
});

test('deploy icon carries the warn role when the row has new code', async () => {
  await withBoard(
    async page => {
      const atlasDeploy = commandButton(page, 'deploy atlas');
      const zenithDeploy = commandButton(page, 'deploy zenith');
      expect(await atlasDeploy.getAttribute('class')).toContain('t-warn');
      expect(await zenithDeploy.getAttribute('class')).not.toContain('t-warn');
      expect(await tipOf(atlasDeploy)).toBe(
        `New code since last deploy: a3f19c2 to e81d4b0. ${REDEPLOY_TIP}`
      );
      expect(await tipOf(zenithDeploy)).toBe(REDEPLOY_TIP);
      expect(await tipOf(commandButton(page, 'build zenith'))).toBe(BUILD_TIP);
    },
    { fixture: 'status-newcode.json' }
  );
});

test('update strip shows the behind count and hides when none', async () => {
  await withBoard(
    async page => {
      const strip = page.locator('[data-block="update-strip"]');
      expect(await strip.count()).toBe(1);
      expect((await strip.textContent())?.trim()).toBe(
        'New code for 3 apps since their last deploy'
      );
    },
    { fixture: 'status-newcode.json' }
  );
  await withBoard(async page => {
    expect(await page.locator('[data-block="update-strip"]').count()).toBe(0);
  });
});

test('row gear is hidden until hover or focus', async () => {
  await withBoard(async page => {
    const gear = gearFor(page, 'atlas');
    await page.mouse.move(0, 0);
    expect(await settledOpacity(gear, '0')).toBe('0');

    await rowFor(page, 'atlas').hover();
    expect(await settledOpacity(gear, '1')).toBe('1');

    await page.mouse.move(0, 0);
    expect(await settledOpacity(gear, '0')).toBe('0');

    // Shift+Tab from the next row's site link lands on the gear itself, so
    // nothing else in atlas's row holds focus first.
    await rowFor(page, 'ledger').locator('a.unstyled').focus();
    await page.keyboard.press('Shift+Tab');
    expect(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-label')
      )
    ).toBe('settings for atlas');
    expect(await settledOpacity(gear, '1')).toBe('1');
  });
});

test('header settings button is icon-only with its tooltip', async () => {
  await withBoard(async page => {
    const button = page.getByRole('button', {
      name: 'Deck settings',
      exact: true,
    });
    const box = await button.boundingBox();
    const glyph = await button.locator('svg').boundingBox();
    if (!box || !glyph)
      throw new Error('settings button or glyph not laid out');
    expect(glyph.x).toBeGreaterThanOrEqual(box.x);
    expect(glyph.y).toBeGreaterThanOrEqual(box.y);
    expect(glyph.x + glyph.width).toBeLessThanOrEqual(box.x + box.width);
    expect(glyph.y + glyph.height).toBeLessThanOrEqual(box.y + box.height);

    await button.hover();
    await page
      .locator('[data-part="tooltip-card"]', { hasText: 'Deck settings' })
      .waitFor({ state: 'visible', timeout: 2000 });
  });
});

test('a running command shows busy, its tooltip reads the phase, and a second click does not post again', async () => {
  await withBoard(async page => {
    let posts = 0;
    await page.route('**/api/v1/apps/atlas/commands/deploy', async route => {
      posts++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ started: true, runId: 'held' }),
      });
    });
    let release: () => void = () => {};
    const held = new Promise<void>(r => (release = r));
    await page.route(
      '**/api/v1/apps/atlas/commands/deploy/held',
      async route => {
        await held;
        await route
          .fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'exited', exitCode: 0 }),
          })
          .catch(() => {});
      }
    );

    try {
      const deploy = commandButton(page, 'deploy atlas');
      await deploy.click();
      await poll(() => posts === 1);
      await page.waitForSelector(
        '[aria-label="deploy atlas"][aria-busy="true"]',
        { timeout: 2000 }
      );
      expect(await deploy.isDisabled()).toBe(true);

      await page.mouse.move(0, 0);
      await deploy.hover();
      const card = page.locator('[data-part="tooltip-card"]', {
        hasText: 'deploy',
      });
      await card.waitFor({ state: 'visible', timeout: 2000 });
      expect(await card.textContent()).toBe('deploy…');

      await deploy.dispatchEvent('click');
      await new Promise(r => setTimeout(r, 300));
      expect(posts).toBe(1);
    } finally {
      release();
    }
  });
}, 12000);

test('on a touch screen the row gear shows without hover or focus', async () => {
  await withBoard(
    async page => {
      expect(
        await page.evaluate(() => matchMedia('(hover: none)').matches)
      ).toBe(true);
      expect(await settledOpacity(gearFor(page, 'atlas'), '1')).toBe('1');
    },
    {
      context: {
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    }
  );
});

test('site mark: a row with an icon shows its brand image, a row without shows its letter tile', async () => {
  await withBoard(
    async page => {
      const atlasSite = rowFor(page, 'atlas')
        .locator('[data-part="table-cell"]')
        .first();
      expect(await atlasSite.locator('img.site-mark').getAttribute('src')).toBe(
        '/favicon.svg'
      );
      expect(await atlasSite.locator('.site-mark-letter').count()).toBe(0);

      const orbitSite = rowFor(page, 'orbit')
        .locator('[data-part="table-cell"]')
        .first();
      expect(await orbitSite.locator('img').count()).toBe(0);
      expect(
        (await orbitSite.locator('.site-mark-letter').textContent())?.trim()
      ).toBe('o');
    },
    { fixture: 'status-newcode.json' }
  );
});

test('the table has no access glyph cell and no access column', async () => {
  await withBoard(async page => {
    expect(await page.locator('[aria-label$=", change access"]').count()).toBe(
      0
    );
    expect(await page.locator('th', { hasText: 'access' }).count()).toBe(0);
  });
});

test('no Access modal and no stderr trigger exist on the board at rest', async () => {
  await withBoard(async page => {
    expect(await page.locator('[aria-label^="Access ·"]').count()).toBe(0);
    expect(
      await page.locator('[aria-label^="show recent stderr for"]').count()
    ).toBe(0);
    expect(await page.locator('[data-part="modal"]').count()).toBe(0);
  });
});

test('public host: no write controls in the table', async () => {
  await withBoard(
    async page => {
      expect(await page.locator('[role="switch"]').count()).toBe(0);
      expect(await page.locator('button[aria-label^="restart"]').count()).toBe(
        0
      );
      expect(
        await page.locator('button', { hasText: 'Link source' }).count()
      ).toBe(0);

      await gearFor(page, 'atlas').click();
      const dlg = page.getByRole('dialog', {
        name: 'settings for atlas',
        exact: true,
      });
      await dlg.waitFor({ state: 'visible' });
      expect(await dlg.getByRole('switch').count()).toBe(0);
      expect(await dlg.locator('input, textarea, select').count()).toBe(0);
      expect(await dlg.locator('button[aria-label^="restart"]').count()).toBe(
        0
      );
      for (const label of ['relink', 'unlink', 'Route to it', 'Remove app…'])
        expect(
          await dlg.getByRole('button', { name: label, exact: true }).count()
        ).toBe(0);
    },
    { fixture: 'status-readonly.json' }
  );
});
