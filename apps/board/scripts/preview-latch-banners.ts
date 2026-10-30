/**
 * Writes a static preview of every latch banner to a temp dir and prints its
 * path. Two sections: the seven approved prototype GIFs beside the runtime's
 * rendering of the same creature, then every variant as a GitLab comment
 * would show it: unsized, so stretched to the comment column. light.html and
 * dark.html hold the two page schemes.
 *
 *   bun run scripts/preview-latch-banners.ts
 */
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  PARITY_CASES,
  REFERENCE_DIR as REFERENCE,
} from '../src/__tests__/fixtures/latch-parity.ts';
import { PROTOTYPE_CREATURE } from '../src/__tests__/fixtures/latch-prototype-creature.ts';
import { latchBannerGif, renderBannerGif } from '../src/latch/banner.ts';
import {
  allVariantKeys,
  copyFor,
  variantOfKey,
} from '../src/latch/variants.ts';

const MR = 'https://gitlab.example.com/acme/widgets/-/merge_requests/42';
const EXTRA_ARMED = [
  'https://gitlab.example.com/acme/widgets/-/merge_requests/108',
  'https://gitlab.example.com/acme/gadgets/-/merge_requests/7',
  'https://gitlab.example.com/acme/sprockets/-/merge_requests/2317',
];

const SCHEMES = {
  light: {
    page: '#fbfafd',
    card: '#ffffff',
    text: '#28272d',
    muted: '#737278',
    border: '#dcdcde',
  },
  dark: {
    page: '#18171d',
    card: '#232128',
    text: '#ececef',
    muted: '#a4a3a8',
    border: '#3a383f',
  },
} as const;

const out = mkdtempSync(join(tmpdir(), 'latch-preview-'));
mkdirSync(join(out, 'gifs'));

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The markdown the note bodies use: blank-line paragraphs and bold. */
function markdown(s: string): string {
  return s
    .split(/\n\s*\n/)
    .map(
      p => `<p>${esc(p).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`
    )
    .join('\n  ');
}

function write(name: string, bytes: Uint8Array): string {
  writeFileSync(join(out, 'gifs', name), bytes);
  return `gifs/${name}`;
}

function card(src: string, sentence: string, caption?: string): string {
  return `<figure class="card">
  ${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}
  <div class="note-head"><span class="avatar"></span><b>Board reviewer</b> <span class="muted">@reviewer, just now</span></div>
  <img src="${src}" alt="">
  ${markdown(sentence)}
</figure>`;
}

const parityRows = PARITY_CASES.map(([name, variant]) => {
  copyFileSync(
    join(REFERENCE, `latch-${name}.gif`),
    join(out, 'gifs', `approved-${name}.gif`)
  );
  const runtime = write(
    `runtime-${name}.gif`,
    renderBannerGif(PROTOTYPE_CREATURE, variant)
  );
  const sentence = copyFor(variant).sentence;
  return `<h3>${esc(name)}</h3>
<div class="pair">
  ${card(`gifs/approved-${name}.gif`, sentence, 'approved')}
  ${card(runtime, sentence, 'runtime')}
</div>`;
}).join('\n');

const variantCards = allVariantKeys().map(key => {
  const variant = variantOfKey(key)!;
  const src = write(`variant-${key}.gif`, latchBannerGif(MR, variant));
  return card(src, copyFor(variant).sentence, key);
});
const armedCards = EXTRA_ARMED.map((url, i) => {
  const src = write(
    `armed-extra-${i}.gif`,
    latchBannerGif(url, { state: 'armed' })
  );
  return card(
    src,
    copyFor({ state: 'armed' }).sentence,
    `armed (${url.split('/-/')[0]!.split('/').pop()} !${url.split('/').pop()})`
  );
});

function page(scheme: keyof typeof SCHEMES): string {
  const c = SCHEMES[scheme];
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Latch banners (${scheme})</title>
<style>
  body { margin: 0; padding: 24px; background: ${c.page}; color: ${c.text};
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  h2 { margin: 32px 0 8px; } h3 { margin: 20px 0 6px; font-size: 13px; color: ${c.muted}; }
  .pair { display: flex; flex-direction: column; gap: 16px; }
  .grid { display: flex; flex-direction: column; gap: 16px; }
  .card { margin: 0; width: 820px; box-sizing: border-box; padding: 12px 16px;
    background: ${c.card}; border: 1px solid ${c.border}; border-radius: 4px; }
  .card img { display: block; max-width: 100%; height: auto; margin: 8px 0; }
  .card p { margin: 0; }
  .card p + p { margin-top: 8px; }
  figcaption { font: 600 11px/1 ui-monospace, monospace; color: ${c.muted}; margin-bottom: 8px; }
  .note-head { display: flex; align-items: center; gap: 6px; }
  .avatar { width: 24px; height: 24px; border-radius: 50%; background: ${c.border}; }
  .muted { color: ${c.muted}; }
</style></head>
<body>
<p><a href="index.html">index</a> &nbsp; <a href="${scheme === 'light' ? 'dark' : 'light'}.html">${scheme === 'light' ? 'dark' : 'light'}</a></p>
<h2>Parity</h2>
${parityRows}
<h2>All variants</h2>
<div class="grid">
${[...variantCards, ...armedCards].join('\n')}
</div>
</body></html>`;
}

writeFileSync(join(out, 'light.html'), page('light'));
writeFileSync(join(out, 'dark.html'), page('dark'));
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Latch banners</title>
<ul><li><a href="light.html">light</a></li><li><a href="dark.html">dark</a></li></ul>`
);

console.log(out);
