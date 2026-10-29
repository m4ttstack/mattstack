import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';
import { GifReader } from 'omggif';
import { PNG } from 'pngjs';

import { renderBannerGif } from '../latch/banner.ts';
import type { BannerVariant } from '../latch/variants.ts';
import { PROTOTYPE_CREATURE } from './fixtures/latch-prototype-creature.ts';

const REFERENCE = join(import.meta.dir, 'fixtures', 'latch-reference');
const OUT = process.env.LATCH_PARITY_OUT ?? join(tmpdir(), 'latch-parity');

/** A pixel differs when any channel is off by more than this. */
const CHANNEL_TOLERANCE = 24;
/** The share of pixels per frame allowed to differ. */
const MAX_DIFFERING = 0.005;

const CASES: [string, BannerVariant][] = [
  ['armed', { state: 'armed' }],
  ['queued', { state: 'queued', wait: 'next-sweep' }],
  ['running', { state: 'running' }],
  ['done-comments', { state: 'done-comments', count: 3 }],
  ['done-approved', { state: 'done-approved' }],
  ['error-retrying', { state: 'error-retrying', wait: 'next-sweep' }],
  ['error-stuck', { state: 'error-stuck' }],
];

interface Decoded {
  width: number;
  height: number;
  delays: number[];
  frames: Uint8Array[];
}

function decode(bytes: Uint8Array): Decoded {
  const gif = new GifReader(bytes);
  const { width, height } = gif;
  const canvas = new Uint8Array(width * height * 4);
  const delays: number[] = [];
  const frames: Uint8Array[] = [];
  for (let i = 0; i < gif.numFrames(); i++) {
    const info = gif.frameInfo(i);
    const before = info.disposal === 3 ? canvas.slice() : null;
    gif.decodeAndBlitFrameRGBA(i, canvas);
    frames.push(canvas.slice());
    delays.push(info.delay * 10);
    if (info.disposal === 2) {
      for (let y = info.y; y < info.y + info.height; y++) {
        canvas.fill(
          0,
          (y * width + info.x) * 4,
          (y * width + info.x + info.width) * 4
        );
      }
    } else if (before) {
      canvas.set(before);
    }
  }
  return { width, height, delays, frames };
}

function writePng(
  path: string,
  width: number,
  height: number,
  rgba: Uint8Array
) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  writeFileSync(path, PNG.sync.write(png));
}

interface Verdict {
  share: number;
  /** 2x2 blocks where every pixel differs: a missing or moved feature cell. */
  blocks: number;
  diff: Uint8Array;
}

function compare(ref: Uint8Array, got: Uint8Array, width: number): Verdict {
  const diff = new Uint8Array(ref.length);
  const bad = new Uint8Array(ref.length / 4);
  for (let p = 0; p < bad.length; p++) {
    const i = p * 4;
    const off = Math.max(
      Math.abs(ref[i]! - got[i]!),
      Math.abs(ref[i + 1]! - got[i + 1]!),
      Math.abs(ref[i + 2]! - got[i + 2]!)
    );
    bad[p] = off > CHANNEL_TOLERANCE ? 1 : 0;
    diff[i] = bad[p] ? 255 : got[i]! >> 2;
    diff[i + 1] = bad[p] ? 0 : got[i + 1]! >> 2;
    diff[i + 2] = bad[p] ? 0 : got[i + 2]! >> 2;
    diff[i + 3] = 255;
  }
  let differing = 0;
  let blocks = 0;
  for (let p = 0; p < bad.length; p++) {
    if (!bad[p]) continue;
    differing++;
    const x = p % width;
    if (x + 1 < width && bad[p + 1] && bad[p + width] && bad[p + width + 1])
      blocks++;
  }
  return { share: differing / bad.length, blocks, diff };
}

const passes = (v: Verdict) => v.share <= MAX_DIFFERING && v.blocks === 0;

const pct = (share: number) => `${(share * 100).toFixed(3)}%`;

describe('latch banner parity with the approved prototype', () => {
  for (const [name, variant] of CASES) {
    test(name, () => {
      const ref = decode(readFileSync(join(REFERENCE, `latch-${name}.gif`)));
      const got = decode(renderBannerGif(PROTOTYPE_CREATURE, variant));
      expect([got.width, got.height]).toEqual([ref.width, ref.height]);
      expect(got.frames.length).toBe(ref.frames.length);
      expect(got.delays).toEqual(ref.delays);

      const failures: string[] = [];
      const shares: string[] = [];
      ref.frames.forEach((refFrame, i) => {
        const v = compare(refFrame, got.frames[i]!, ref.width);
        shares.push(`${pct(v.share)}/${v.blocks}`);
        if (passes(v)) return;
        mkdirSync(OUT, { recursive: true });
        const stem = join(OUT, `${name}-f${i}`);
        writePng(`${stem}-reference.png`, ref.width, ref.height, refFrame);
        writePng(`${stem}-runtime.png`, ref.width, ref.height, got.frames[i]!);
        writePng(`${stem}-diff.png`, ref.width, ref.height, v.diff);
        failures.push(
          `frame ${i}: ${pct(v.share)} differ, ${v.blocks} whole 2x2 blocks; see ${stem}-{reference,runtime,diff}.png`
        );
      });
      if (process.env.LATCH_PARITY_REPORT)
        console.log(`${name}: ${shares.join(' ')}`);
      expect(failures).toEqual([]);
    });
  }
});

// Each pair is two frames of one approved GIF that differ by a single
// feature, so the gate must reject either as a stand-in for the other.
const FEATURE_PAIRS: [string, string, number, number][] = [
  ['one queued dot', 'queued', 0, 1],
  ['three queued dots', 'queued', 0, 3],
  ['the approved sparkles', 'done-approved', 0, 4],
  ['the blink', 'armed', 2, 3],
  ['the second leg pose', 'armed', 0, 1],
];

describe('the parity gate rejects a missing feature', () => {
  for (const [feature, name, a, b] of FEATURE_PAIRS) {
    test(feature, () => {
      const ref = decode(readFileSync(join(REFERENCE, `latch-${name}.gif`)));
      const v = compare(ref.frames[a]!, ref.frames[b]!, ref.width);
      expect(v.share).toBeLessThanOrEqual(MAX_DIFFERING);
      expect(passes(v)).toBe(false);
    });
  }
});
