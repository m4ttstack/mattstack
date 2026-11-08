#!/usr/bin/env bun
// Writes every app's icon files from @mattstack/app-icons: the favicon.svg
// its deck manifest names (which deck serves to the viewer and its own
// table), the PNG sizes its index.html links (rasterised with
// rsvg-convert), and mattstack.dev's copy in sites/home/assets.
//
//   bun scripts/gen-app-icons.ts

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { appIconSvg, type AppName } from '@mattstack/app-icons';

const ROOT = resolve(import.meta.dir, '..');

/** Where each app's icon files live; deck's own icon is served from code. */
export const ICON_DIRS: Partial<Record<AppName, string>> = {
  chat: 'apps/chat/public',
  console: 'apps/console/public',
  boxscore: 'apps/boxscore/public',
  board: 'apps/board/src',
};

/** mattstack.dev's own copy of each mark it shows. */
export const SITE_ASSETS = 'sites/home/assets';
export const SITE_APPS: AppName[] = ['chat', 'console', 'board', 'deck'];

const PNG_SIZES: Record<string, number> = {
  'favicon-16.png': 16,
  'favicon-32.png': 32,
  'apple-touch-icon.png': 180,
  'icon-512.png': 512,
};

function rasterise(svg: string, file: string, size: number): void {
  const run = Bun.spawnSync(
    ['rsvg-convert', '-w', String(size), '-h', String(size), '-o', file],
    { stdin: new TextEncoder().encode(svg) }
  );
  if (run.exitCode !== 0)
    throw new Error(`rsvg-convert failed for ${file}: ${run.stderr.toString()}`);
}

if (import.meta.main) {
  for (const [app, dir] of Object.entries(ICON_DIRS) as [AppName, string][]) {
    const svg = appIconSvg(app);
    writeFileSync(join(ROOT, dir, 'favicon.svg'), svg);
    for (const [name, size] of Object.entries(PNG_SIZES)) {
      const file = join(ROOT, dir, name);
      if (existsSync(file)) rasterise(svg, file, size);
    }
    console.log(`${app}: ${dir}`);
  }
  for (const app of SITE_APPS)
    writeFileSync(join(ROOT, SITE_ASSETS, `${app}.svg`), appIconSvg(app));
  console.log(`mattstack.dev: ${SITE_ASSETS}`);
}
