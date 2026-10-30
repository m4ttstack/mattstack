/**
 * The variants the approved prototype GIFs (latch-reference/) show, and the
 * 2x strips scripts/build-latch-band.ts renders for them (latch-strips-2x/),
 * so the parity test can composite at the prototype's scale.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import type { StripLayout, StripSet } from '../../latch/banner.ts';
import { variantKey, type BannerVariant } from '../../latch/variants.ts';

export const REFERENCE_DIR = join(import.meta.dir, 'latch-reference');
export const PARITY_STRIPS_DIR = join(import.meta.dir, 'latch-strips-2x');
export const PARITY_SCALE = 2;

export const PARITY_CASES: [string, BannerVariant][] = [
  ['armed', { state: 'armed' }],
  ['queued', { state: 'queued', wait: 'next-sweep' }],
  ['running', { state: 'running' }],
  ['done-comments', { state: 'done-comments', count: 3 }],
  ['done-approved', { state: 'done-approved' }],
  ['error-retrying', { state: 'error-retrying', wait: 'next-sweep' }],
  ['error-stuck', { state: 'error-stuck' }],
];

export function parityStrips(): StripSet {
  const keys = PARITY_CASES.map(([, v]) => variantKey(v));
  return {
    scale: PARITY_SCALE,
    strips: Object.fromEntries(
      keys.map(k => [k, join(PARITY_STRIPS_DIR, `${k}.png`)])
    ),
    layout: JSON.parse(
      readFileSync(join(PARITY_STRIPS_DIR, 'layout.json'), 'utf8')
    ) as Record<string, StripLayout>,
  };
}
