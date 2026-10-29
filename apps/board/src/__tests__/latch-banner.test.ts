import { describe, expect, test } from 'bun:test';
import { INVADR_SPRITES, resolveInvadr } from 'invadrs';

import { LAYOUT } from '../../assets/latch/index.ts';
import { GIF_H, GIF_W, latchBannerGif, legShuffle } from '../latch/banner.ts';
import {
  allVariantKeys,
  copyFor,
  DOT_GAP_PX,
  DOT_PX,
  variantOfKey,
  type BannerVariant,
} from '../latch/variants.ts';

const MR_A = 'https://gitlab.com/acme/web/-/merge_requests/2317';
const MR_B = 'https://gitlab.com/acme/web/-/merge_requests/2318';

interface GifFrame {
  delay: number;
  pixels: Uint8Array;
}

interface Gif {
  width: number;
  height: number;
  palette: [number, number, number][];
  frames: GifFrame[];
}

function readSubBlocks(b: Uint8Array, p: number): [Uint8Array, number] {
  const parts: number[] = [];
  while (b[p] !== 0) {
    const n = b[p]!;
    for (let i = 1; i <= n; i++) parts.push(b[p + i]!);
    p += n + 1;
  }
  return [Uint8Array.from(parts), p + 1];
}

function lzwDecode(data: Uint8Array, minSize: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minSize;
  const end = clear + 1;
  let size = minSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[end] = [];
    size = minSize + 1;
  };
  reset();
  let prev: number[] | null = null;
  let o = 0;
  let bit = 0;
  while (o < count) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) {
      code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;
    }
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === end) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code]!;
    else entry = [...prev!, prev![0]!];
    for (const v of entry) out[o++] = v;
    if (prev) dict.push([...prev, entry[0]!]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  return out;
}

function parseGif(b: Uint8Array): Gif {
  const width = b[6]! | (b[7]! << 8);
  const height = b[8]! | (b[9]! << 8);
  const packed = b[10]!;
  let p = 13;
  const palette: [number, number, number][] = [];
  if (packed & 0x80) {
    const n = 1 << ((packed & 7) + 1);
    for (let i = 0; i < n; i++, p += 3) palette.push([b[p]!, b[p + 1]!, b[p + 2]!]);
  }
  const frames: GifFrame[] = [];
  let delay = 0;
  while (p < b.length) {
    const tag = b[p]!;
    if (tag === 0x3b) break;
    if (tag === 0x21) {
      const label = b[p + 1]!;
      if (label === 0xf9) delay = (b[p + 4]! | (b[p + 5]! << 8)) * 10;
      [, p] = readSubBlocks(b, p + 2);
    } else if (tag === 0x2c) {
      const w = b[p + 5]! | (b[p + 6]! << 8);
      const h = b[p + 7]! | (b[p + 8]! << 8);
      if (b[p + 9]! & 0x80) throw new Error('local colour tables not expected');
      const minSize = b[p + 10]!;
      const [data, next] = readSubBlocks(b, p + 11);
      frames.push({ delay, pixels: lzwDecode(data, minSize, w * h) });
      p = next;
    } else {
      throw new Error(`unexpected GIF block 0x${tag.toString(16)} at ${p}`);
    }
  }
  return { width, height, palette, frames };
}

function rgbAt(gif: Gif, frame: number, x: number, y: number): string {
  const [r, g, b] = gif.palette[gif.frames[frame]!.pixels[y * gif.width + x]!]!;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const cache = new Map<string, Uint8Array>();
function gifFor(key: string, mrUrl = MR_A): Uint8Array {
  const id = `${mrUrl} ${key}`;
  let bytes = cache.get(id);
  if (!bytes) {
    bytes = latchBannerGif(mrUrl, variantOfKey(key)!);
    cache.set(id, bytes);
  }
  return bytes;
}

const FRAMES: Record<BannerVariant['state'], number> = {
  armed: 6,
  queued: 8,
  running: 8,
  'error-retrying': 8,
  'error-stuck': 8,
  'done-comments': 8,
  'done-approved': 8,
  approved: 8,
  superseded: 1,
};

function toGrid(rows: readonly string[]): boolean[][] {
  return rows.map((row) => [...row].map((c) => c === '#'));
}

/** Centre of sprite cell (col, row) at rest, for the 11-wide creatures. */
function cellCentre(col: number, row: number): [number, number] {
  return [28 + (2 + col) * 6 + 3, 31 + row * 6 + 3];
}

describe('latchBannerGif', () => {
  test('encodes a 1040x128 GIF for every variant key', () => {
    for (const key of allVariantKeys()) {
      const b = gifFor(key);
      expect(String.fromCharCode(...b.slice(0, 6))).toBe('GIF89a');
      expect(b[6]! | (b[7]! << 8)).toBe(GIF_W);
      expect(b[8]! | (b[9]! << 8)).toBe(GIF_H);
    }
  }, 60_000);

  test('frame count matches the plan', () => {
    for (const key of allVariantKeys()) {
      const v = variantOfKey(key)!;
      expect({ key, frames: parseGif(gifFor(key)).frames.length }).toEqual({
        key,
        frames: FRAMES[v.state],
      });
    }
  }, 60_000);

  test('every GIF is under 80 KB', () => {
    for (const key of allVariantKeys()) {
      expect({ key, small: gifFor(key).length < 80 * 1024 }).toEqual({
        key,
        small: true,
      });
    }
  }, 60_000);

  test('deterministic for one MR', () => {
    const again = latchBannerGif(MR_A, { state: 'running' });
    expect(Buffer.from(again).equals(Buffer.from(gifFor('running')))).toBe(true);
  });

  test('differs between MRs', () => {
    expect(
      Buffer.from(gifFor('running', MR_B)).equals(Buffer.from(gifFor('running')))
    ).toBe(false);
  });

  test('paints the creature in the variant accent', () => {
    const { grid, accent } = resolveInvadr(MR_A, { accent: true });
    const row = grid.findIndex((r) => r.some(Boolean));
    const col = grid[row]!.findIndex(Boolean);
    const [ex, ey] = accent!.cells[0]!;
    for (const key of ['armed', 'running', 'done-approved']) {
      const gif = parseGif(gifFor(key));
      expect(rgbAt(gif, 0, ...cellCentre(col, row))).toBe(
        copyFor(variantOfKey(key)!).accent
      );
      expect(rgbAt(gif, 0, ...cellCentre(ex, ey))).toBe('#ece8f4');
    }
  });

  test('lights the queued dots beside the title', () => {
    const gif = parseGif(gifFor('queued-cooldown'));
    const { dotsX, dotsY } = (LAYOUT as Record<string, { dotsX: number; dotsY: number }>)[
      'queued-cooldown'
    ]!;
    const dot = (i: number, frame: number) =>
      rgbAt(gif, frame, dotsX + i * (DOT_PX + DOT_GAP_PX) + 4, dotsY + 4);
    expect([0, 1, 2].map((i) => dot(i, 0))).toEqual(Array(3).fill('#2a2638'));
    expect([0, 1, 2].map((i) => dot(i, 3))).toEqual(Array(3).fill('#e6b860'));
    expect(gif.frames.map((f) => f.delay)).toEqual(Array(8).fill(420));
  });

  test('moves the running ring head clockwise', () => {
    const gif = parseGif(gifFor('running'));
    const topLeft: [number, number] = [948 + 6, 42 + 6];
    const topMid: [number, number] = [964 + 6, 42 + 6];
    expect(rgbAt(gif, 0, ...topLeft)).toBe('#7fbfe8');
    expect(rgbAt(gif, 0, ...topMid)).toBe('#5d5775');
    expect(rgbAt(gif, 1, ...topMid)).toBe('#7fbfe8');
  });
});

describe('legShuffle', () => {
  test('changes the bottom rows of all 16 INVADR_SPRITES and nothing above them', () => {
    expect(INVADR_SPRITES).toHaveLength(16);
    for (const rows of INVADR_SPRITES) {
      const grid = toGrid(rows);
      const out = legShuffle(grid);
      const h = grid.length;
      expect(out.slice(0, h - 2)).toEqual(grid.slice(0, h - 2));
      expect(out.slice(h - 2)).not.toEqual(grid.slice(h - 2));
      expect(grid).toEqual(toGrid(rows));
    }
  });

  test('moves cells toward the centre and keeps the centre column', () => {
    const grid = toGrid(['.....', '#.#.#', '##.##']);
    expect(legShuffle(grid)).toEqual(toGrid(['.....', '.###.', '.###.']));
  });
});
