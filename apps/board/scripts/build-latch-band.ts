/**
 * Renders the text strip behind every latch banner variant to
 * assets/latch/<key>.png, once, at build time. Text is the only reason a
 * browser is involved: the runtime compositor paints the creature and the
 * indicator and cannot render glyphs. Re-run by hand after changing the
 * copy or the look, and commit the result.
 *
 *   bun run scripts/build-latch-band.ts
 *
 * Also writes assets/latch/layout.json (where the runtime paints the dots,
 * in BANNER_SCALE px) and assets/latch/index.ts, which embeds each strip by
 * file: `bun build --compile` embeds single files, never a directory. The
 * parity variants are rendered a second time at the approved prototype's
 * 2x into the parity test's fixtures.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium, type Browser } from 'playwright';
import { format, resolveConfig } from 'prettier';

import {
  PARITY_CASES,
  PARITY_SCALE,
  PARITY_STRIPS_DIR,
} from '../src/__tests__/fixtures/latch-parity.ts';
import {
  allVariantKeys,
  BANNER_SCALE,
  copyFor,
  DOT_GAP_PX,
  DOT_PX,
  BANNER_CSS_H as H,
  variantKey,
  variantOfKey,
  BANNER_CSS_W as W,
} from '../src/latch/variants.ts';

const OUT = join(import.meta.dir, '..', 'assets', 'latch');

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen&family=IBM+Plex+Mono:wght@400&display=swap">
<style>
  html, body { margin: 0; padding: 0; background: #2a2638; }
  /* The sprite and ring boxes stay bare background: the runtime paints into them. */
  .band { width: ${W}px; height: ${H}px; box-sizing: border-box; display: flex; align-items: center;
          gap: 10px; padding: 0 24px 0 14px; background: #2a2638; }
  .sprite { width: 45px; height: 33px; flex: none; }
  .copy { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 0; }
  /* The title row lays the dots out as the approved prototype did: flex
     children 4px apart, bottom-aligned 2px above the title's line box. */
  .titlerow { display: flex; align-items: flex-end; gap: ${DOT_GAP_PX}px; }
  .title { font-family: 'Silkscreen'; font-size: 18px; letter-spacing: 1px; color: #ece8f4;
           line-height: 1; white-space: nowrap; }
  .dot { width: ${DOT_PX}px; height: ${DOT_PX}px; margin-bottom: 2px; flex: none; }
  .sub { font-family: 'IBM Plex Mono'; font-size: 13px; color: #b7b0c8; line-height: 1;
         white-space: nowrap; }
  .ring { width: 22px; height: 22px; flex: none; }
</style>
<div class="band" id="band"></div>`;

type Layout = Record<string, { dotsX: number; dotsY: number }>;

async function renderStrips(
  browser: Browser,
  scale: number,
  keys: string[],
  out: string
): Promise<Layout> {
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: scale,
  });
  await page.setContent(html, { waitUntil: 'networkidle' });
  // FontFaceSet.check() is true when no face is registered at all, which is
  // what a failed stylesheet fetch leaves, so require each load to find a face.
  const fontsOk = await page.evaluate(async () => {
    const fonts = (
      globalThis as unknown as {
        document: {
          fonts: { load(f: string): Promise<{ status: string }[]> };
        };
      }
    ).document.fonts;
    const silkscreen = await fonts.load("18px 'Silkscreen'");
    const plex = await fonts.load("13px 'IBM Plex Mono'");
    return [silkscreen, plex].every(
      faces => faces.length > 0 && faces.every(f => f.status === 'loaded')
    );
  });
  if (!fontsOk) {
    await browser.close();
    throw new Error(
      'Google Fonts did not load; refusing to render strips with fallback fonts'
    );
  }

  mkdirSync(out, { recursive: true });
  const layout: Layout = {};
  for (const key of keys) {
    const copy = copyFor(variantOfKey(key)!);
    const inner = `<div class="sprite"></div>
    <div class="copy"><div class="titlerow"><div class="title">${escape(
      copy.title.toUpperCase()
    )}</div>${'<div class="dot"></div>'.repeat(3)}</div>
    <div class="sub">${escape(copy.sub)}</div></div>${
      copy.indicator === 'ring' ? '<div class="ring"></div>' : ''
    }`;
    const m = await page.evaluate(markup => {
      const doc = (globalThis as unknown as { document: any }).document;
      const band = doc.getElementById('band');
      band.innerHTML = markup;
      const box = (sel: string) =>
        band.querySelector(sel).getBoundingClientRect();
      const copyBox = box('.copy');
      const dots = [...band.querySelectorAll('.dot')].map((d: any) =>
        d.getBoundingClientRect()
      );
      const sub = box('.sub');
      return {
        copyRight: copyBox.right,
        titleRight: box('.title').right,
        dotsLeft: dots[0].left,
        dotsTop: dots[0].top,
        dotsRight: dots[2].right,
        subRight: sub.right,
      };
    }, inner);

    const titleEnd = copy.indicator === 'dots' ? m.dotsRight : m.titleRight;
    if (titleEnd > m.copyRight || m.subRight > m.copyRight) {
      throw new Error(`${key}: copy overflows its box`);
    }
    layout[key] = {
      dotsX: Math.round(m.dotsLeft * scale),
      dotsY: Math.round(m.dotsTop * scale),
    };
    await page.locator('#band').screenshot({ path: join(out, `${key}.png`) });
  }
  await page.close();
  writeFileSync(
    join(out, 'layout.json'),
    `${JSON.stringify(layout, null, 2)}\n`
  );
  return layout;
}

const browser = await chromium.launch();
const keys = allVariantKeys();
await renderStrips(browser, BANNER_SCALE, keys, OUT);
await renderStrips(
  browser,
  PARITY_SCALE,
  PARITY_CASES.map(([, v]) => variantKey(v)),
  PARITY_STRIPS_DIR
);
await browser.close();

const imports = keys.map(
  (k, i) => `import s${i} from './${k}.png' with { type: 'file' };`
);
const entries = keys.map((k, i) => `  '${k}': s${i},`);
const indexPath = join(OUT, 'index.ts');
const indexSource = [
  '// generated by scripts/build-latch-band.ts; do not edit',
  ...imports,
  '',
  'export const STRIPS: Record<string, string> = {',
  ...entries,
  '};',
  '',
  "export { default as LAYOUT } from './layout.json';",
  '',
].join('\n');
// format:check covers this file, so it is written in the repo's Prettier shape.
writeFileSync(
  indexPath,
  await format(indexSource, {
    ...(await resolveConfig(indexPath)),
    filepath: indexPath,
  })
);
console.log(
  `wrote ${keys.length} strips to assets/latch (${W * BANNER_SCALE}x${H * BANNER_SCALE}) and ${PARITY_CASES.length} parity strips (${W * PARITY_SCALE}x${H * PARITY_SCALE})`
);
