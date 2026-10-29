/**
 * The per-MR latch banner: a committed text strip for the variant, with this
 * MR's invadrs creature, the title's dots and the running ring painted in per
 * frame, encoded as a looping GIF.
 *
 * The creature colour is the variant accent rather than the invadrs palette
 * pick, which can vanish on the dark strip; the per-MR character comes from
 * the creature's shape.
 */
import { readFileSync } from 'fs';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { resolveInvadr } from 'invadrs';
import { PNG } from 'pngjs';

import { LAYOUT, STRIPS } from '../../assets/latch/index.ts';
import {
  copyFor,
  DOT_GAP_PX,
  DOT_PX,
  variantKey,
  type BannerVariant,
} from './variants.ts';

export const GIF_W = 1040;
export const GIF_H = 128;

const CELL = 6;
const BOX_X = 28;
const BOX_W = 90;
const BOX_H = 66;
/** The approved prototype centred the 33px CSS box at y 15.5, which Chromium
    painted from device row 32, one below the arithmetic centre. */
const BOX_Y = (GIF_H - BOX_H) / 2 + 1;

const RING_X = 948;
const RING_Y = (GIF_H - 44) / 2;
const RING_CELL = 12;
const RING_PITCH = 16;
/** Clockwise from the top-left, in ring cells. */
const RING: [number, number][] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
];

const EYE = '#ece8f4';
const RING_UNLIT = '#5d5775';
const SPARKLES: [number, number][] = [
  [0, -3],
  [7, -5],
  [14, -2],
];

interface Frame {
  delay: number;
  legs?: 0 | 1;
  dx?: number;
  dy?: number;
  dots?: number;
  head?: number;
  blink?: boolean;
  spark?: boolean;
}

const MARCH = [0, 1, 2, 1, 0, -1, -2, -1];
const RETRY_DOTS = [1, 1, 2, 2, 2, 3, 3, 0];

function shake(dots: boolean): Frame[] {
  const frames: Frame[] = [
    { dx: 0, delay: 700 },
    { dx: 1, legs: 1, delay: 70 },
    { dx: -1, delay: 70 },
    { dx: 1, legs: 1, delay: 70 },
    { dx: 0, delay: 500 },
    { delay: 600 },
    { blink: true, delay: 140 },
    { delay: 600 },
  ];
  return dots ? frames.map((f, i) => ({ ...f, dots: RETRY_DOTS[i] })) : frames;
}

function hop(spark: boolean): Frame[] {
  return [
    { delay: 900 },
    { dy: 1, legs: 1, delay: 90 },
    { dy: 2, legs: 1, spark, delay: 140 },
    { dy: 1, legs: 1, spark, delay: 90 },
    { spark, delay: 220 },
    { delay: 900 },
    { blink: true, delay: 140 },
    { delay: 900 },
  ];
}

function framesFor(state: BannerVariant['state']): Frame[] {
  switch (state) {
    case 'armed':
      return [
        { delay: 900 },
        { legs: 1, delay: 900 },
        { delay: 900 },
        { blink: true, delay: 140 },
        { delay: 700 },
        { legs: 1, delay: 900 },
      ];
    case 'queued':
      return [0, 1, 2, 3, 0, 1, 2, 3].map((dots, i) => ({
        dots,
        legs: i < 4 ? 0 : 1,
        blink: i === 7,
        delay: 420,
      }));
    case 'running':
      return MARCH.map((dx, i) => ({
        dx,
        legs: (i % 2) as 0 | 1,
        head: i,
        delay: 130,
      }));
    case 'error-retrying':
      return shake(true);
    case 'error-stuck':
      return shake(false);
    case 'done-comments':
      return hop(false);
    case 'done-approved':
    case 'approved':
      return hop(true);
    case 'superseded':
      return [{ delay: 0 }];
  }
}

/** The second leg pose: the bottom two rows step one column toward the centre. */
export function legShuffle(grid: boolean[][]): boolean[][] {
  const out = grid.map(row => [...row]);
  for (let y = Math.max(0, grid.length - 2); y < grid.length; y++) {
    const row = grid[y]!;
    const w = row.length;
    const next = new Array<boolean>(w).fill(false);
    for (let x = 0; x < w; x++) {
      if (!row[x]) continue;
      const toCentre = 2 * x + 1 - w;
      next[x + (toCentre < 0 ? 1 : toCentre > 0 ? -1 : 0)] = true;
    }
    out[y] = next;
  }
  return out;
}

type Rgb = [number, number, number];

function hex(c: string): Rgb {
  const n = parseInt(c.slice(1, 7), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Ids for every colour painted in one GIF, shared across its frames. */
class PaintedColours {
  readonly ids = new Map<string, number>();
  readonly colours: Rgb[] = [];

  idOf(c: Rgb): number {
    const key = c.join(',');
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.colours.length;
      this.ids.set(key, id);
      this.colours.push(c);
    }
    return id;
  }
}

class Canvas {
  /** The painted colour id per pixel, or -1 where the strip shows through. */
  readonly owner = new Int16Array(GIF_W * GIF_H).fill(-1);

  constructor(
    readonly data: Uint8Array,
    private readonly painted: PaintedColours
  ) {}

  rect(x0: number, y0: number, w: number, h: number, colour: Rgb, alpha = 1) {
    for (let y = Math.max(0, y0); y < Math.min(GIF_H, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(GIF_W, x0 + w); x++) {
        const p = y * GIF_W + x;
        const i = p << 2;
        const c: Rgb = [0, 1, 2].map(k =>
          Math.round(colour[k]! * alpha + this.data[i + k]! * (1 - alpha))
        ) as Rgb;
        this.data[i] = c[0];
        this.data[i + 1] = c[1];
        this.data[i + 2] = c[2];
        this.data[i + 3] = 0xff;
        this.owner[p] = this.painted.idOf(c);
      }
    }
  }
}

/** A creature to paint: its two leg poses and its eye cells as [col, row]. */
export interface Creature {
  frames: [boolean[][], boolean[][]];
  eyes: [number, number][];
}

export function latchBannerGif(
  mrUrl: string,
  variant: BannerVariant
): Uint8Array {
  const { grid, accent } = resolveInvadr(mrUrl, { accent: true });
  return renderBannerGif(
    { frames: [grid, legShuffle(grid)], eyes: accent?.cells ?? [] },
    variant
  );
}

export function renderBannerGif(
  creature: Creature,
  variant: BannerVariant
): Uint8Array {
  const key = variantKey(variant);
  const copy = copyFor(variant);
  const stripPath = STRIPS[key];
  const layout = (
    LAYOUT as Record<string, { dotsX: number; dotsY: number } | undefined>
  )[key];
  if (!stripPath || !layout) throw new Error(`no latch strip for ${key}`);
  const strip = PNG.sync.read(readFileSync(stripPath));
  const [grid, shuffled] = creature.frames;
  const body = hex(copy.accent);
  const eye = hex(EYE);

  const spriteW = grid[0]!.length * CELL;
  const restX = BOX_X + Math.floor((BOX_W - spriteW) / CELL / 2) * CELL;
  const restY = BOX_Y;

  const plan = framesFor(variant.state);
  const painted = new PaintedColours();
  const canvases = plan.map(f => {
    const canvas = new Canvas(new Uint8Array(strip.data), painted);
    const cells = f.legs ? shuffled : grid;
    const ox = Math.min(
      Math.max(restX + (f.dx ?? 0) * CELL, BOX_X),
      BOX_X + BOX_W - spriteW
    );
    const oy = restY - (f.dy ?? 0) * CELL;
    cells.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) canvas.rect(ox + x * CELL, oy + y * CELL, CELL, CELL, body);
      })
    );
    // invadrs' accent cells hold every enclosed hole, mouths included; only
    // the upper-half ones are eyes, so only those close on a blink.
    for (const [x, y] of creature.eyes) {
      if (cells[y]?.[x]) continue;
      const shut = f.blink && y < grid.length / 2;
      canvas.rect(ox + x * CELL, oy + y * CELL, CELL, CELL, shut ? body : eye);
    }
    if (f.spark) {
      for (const [x, y] of SPARKLES) {
        canvas.rect(BOX_X + x * CELL, BOX_Y + y * CELL, CELL, CELL, eye);
      }
    }
    if (copy.indicator === 'dots') {
      for (let i = 0; i < (f.dots ?? 0); i++) {
        const x = layout.dotsX + i * (DOT_PX + DOT_GAP_PX);
        canvas.rect(x, layout.dotsY, DOT_PX, DOT_PX, body);
      }
    }
    if (copy.indicator === 'ring') {
      RING.forEach(([cx, cy], k) => {
        const d = ((((f.head ?? 0) - k) % 8) + 8) % 8;
        const x = RING_X + cx * RING_PITCH;
        const y = RING_Y + cy * RING_PITCH;
        if (d === 0) canvas.rect(x, y, RING_CELL, RING_CELL, body);
        else if (d === 1)
          canvas.rect(x, y, RING_CELL, RING_CELL, body, 0xe0 / 255);
        else if (d === 2)
          canvas.rect(x, y, RING_CELL, RING_CELL, body, 0xb0 / 255);
        else canvas.rect(x, y, RING_CELL, RING_CELL, hex(RING_UNLIT));
      });
    }
    return canvas;
  });

  const size = GIF_W * GIF_H * 4;
  const all = new Uint8Array(canvases.length * size);
  canvases.forEach((c, i) => all.set(c.data, i * size));
  const quantized = quantize(all, 256 - painted.colours.length);
  const palette = [...quantized, ...painted.colours];

  const gif = GIFEncoder();
  canvases.forEach((c, i) => {
    // applyPalette caches its nearest match per rgb565 bucket, so a strip
    // pixel can hand a painted colour the wrong index; painted pixels get
    // their own exact entry instead.
    const index = applyPalette(c.data, palette);
    for (let p = 0; p < c.owner.length; p++) {
      if (c.owner[p]! >= 0) index[p] = quantized.length + c.owner[p]!;
    }
    gif.writeFrame(index, GIF_W, GIF_H, {
      palette: i === 0 ? palette : undefined,
      delay: plan[i]!.delay,
      repeat: 0,
    });
  });
  gif.finish();
  return gif.bytes();
}
