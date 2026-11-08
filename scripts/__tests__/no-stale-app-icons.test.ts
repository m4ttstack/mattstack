import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { appIconSvg, type AppName } from '@mattstack/app-icons';
import { ICON_DIRS, SITE_APPS, SITE_ASSETS } from '../gen-app-icons';

const ROOT = resolve(import.meta.dir, '../..');

describe('app icon files', () => {
  for (const [app, dir] of Object.entries(ICON_DIRS) as [AppName, string][]) {
    test(`${app}'s favicon.svg is the one @mattstack/app-icons draws`, () => {
      const onDisk = readFileSync(join(ROOT, dir, 'favicon.svg'), 'utf8');
      expect(
        onDisk,
        `${dir}/favicon.svg drifted from @mattstack/app-icons; run bun scripts/gen-app-icons.ts`
      ).toBe(appIconSvg(app));
    });
  }
  for (const app of SITE_APPS) {
    test(`mattstack.dev's ${app}.svg is the one @mattstack/app-icons draws`, () => {
      const onDisk = readFileSync(join(ROOT, SITE_ASSETS, `${app}.svg`), 'utf8');
      expect(
        onDisk,
        `${SITE_ASSETS}/${app}.svg drifted from @mattstack/app-icons; run bun scripts/gen-app-icons.ts`
      ).toBe(appIconSvg(app));
    });
  }
});
