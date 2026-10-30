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
  BANNER_CSS_H,
  BANNER_CSS_W,
  BANNER_SCALE,
  copyFor,
  DOT_GAP_PX,
  DOT_PX,
  variantKey,
  type BannerVariant,
} from './variants.ts';

export const GIF_W = BANNER_CSS_W * BANNER_SCALE;
export const GIF_H = BANNER_CSS_H * BANNER_SCALE;

// Geometry in CSS px, multiplied by the strip set's scale when painting.
const CELL = 3;
const BOX_X = 14;
const BOX_W = 45;
/** The approved prototype centred the 33px box at y 15.5, which Chromium
    painted from y 16. */
const BOX_Y = 16;
const RING_X = 474;
const RING_Y = 21;
const RING_CELL = 6;
const RING_PITCH = 8;
const CORNER_RADIUS = 6;
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
const STRIP_BG = '#2a2638';
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
  readonly owner: Int16Array;

  constructor(
    readonly data: Uint8Array,
    readonly width: number,
    readonly height: number,
    private readonly painted: PaintedColours
  ) {
    this.owner = new Int16Array(width * height).fill(-1);
  }

  rect(x0: number, y0: number, w: number, h: number, colour: Rgb, alpha = 1) {
    for (let y = Math.max(0, y0); y < Math.min(this.height, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x0 + w); x++) {
        const p = y * this.width + x;
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

/** 1 for each pixel outside the banner's rounded corners, at `scale`. */
export function outsideCorners(scale: number): Uint8Array {
  const w = BANNER_CSS_W * scale;
  const h = BANNER_CSS_H * scale;
  const r = CORNER_RADIUS * scale;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const dy = y < r ? r - y - 0.5 : y >= h - r ? y + 0.5 - (h - r) : 0;
    if (dy === 0) continue;
    for (let x = 0; x < w; x++) {
      const dx = x < r ? r - x - 0.5 : x >= w - r ? x + 0.5 - (w - r) : 0;
      if (dx * dx + dy * dy > r * r) out[y * w + x] = 1;
    }
  }
  return out;
}

export interface StripLayout {
  dotsX: number;
  dotsY: number;
}

/** Text strips rendered at `scale` by scripts/build-latch-band.ts, with each
    key's dots origin in that scale's px. */
export interface StripSet {
  scale: number;
  strips: Record<string, string>;
  layout: Record<string, StripLayout | undefined>;
}

export const BANNER_STRIPS: StripSet = {
  scale: BANNER_SCALE,
  strips: STRIPS,
  layout: LAYOUT,
};

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
  variant: BannerVariant,
  strips: StripSet = BANNER_STRIPS
): Uint8Array {
  const key = variantKey(variant);
  const copy = copyFor(variant);
  const stripPath = strips.strips[key];
  const layout = strips.layout[key];
  if (!stripPath || !layout) throw new Error(`no latch strip for ${key}`);
  const s = strips.scale;
  const width = BANNER_CSS_W * s;
  const height = BANNER_CSS_H * s;
  const strip = PNG.sync.read(readFileSync(stripPath));
  if (strip.width !== width || strip.height !== height) {
    throw new Error(
      `latch strip ${key} is ${strip.width}x${strip.height}, not ${width}x${height}`
    );
  }
  const [grid, shuffled] = creature.frames;
  const body = hex(copy.accent);
  const eye = hex(EYE);

  const cell = CELL * s;
  const boxX = BOX_X * s;
  const boxY = BOX_Y * s;
  const boxW = BOX_W * s;
  const spriteW = grid[0]!.length * cell;
  const restX = boxX + Math.floor((boxW - spriteW) / cell / 2) * cell;

  const plan = framesFor(variant.state);
  const painted = new PaintedColours();
  const canvases = plan.map(f => {
    const canvas = new Canvas(
      new Uint8Array(strip.data),
      width,
      height,
      painted
    );
    const cells = f.legs ? shuffled : grid;
    const ox = Math.min(
      Math.max(restX + (f.dx ?? 0) * cell, boxX),
      boxX + boxW - spriteW
    );
    const oy = boxY - (f.dy ?? 0) * cell;
    cells.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) canvas.rect(ox + x * cell, oy + y * cell, cell, cell, body);
      })
    );
    // invadrs' accent cells hold every enclosed hole, mouths included; only
    // the upper-half ones are eyes, so only those close on a blink.
    for (const [x, y] of creature.eyes) {
      if (cells[y]?.[x]) continue;
      const shut = f.blink && y < grid.length / 2;
      canvas.rect(ox + x * cell, oy + y * cell, cell, cell, shut ? body : eye);
    }
    if (f.spark) {
      for (const [x, y] of SPARKLES) {
        canvas.rect(boxX + x * cell, boxY + y * cell, cell, cell, eye);
      }
    }
    if (copy.indicator === 'dots') {
      const dot = DOT_PX * s;
      for (let i = 0; i < (f.dots ?? 0); i++) {
        const x = layout.dotsX + i * (DOT_PX + DOT_GAP_PX) * s;
        canvas.rect(x, layout.dotsY, dot, dot, body);
      }
    }
    if (copy.indicator === 'ring') {
      const size = RING_CELL * s;
      RING.forEach(([cx, cy], k) => {
        const d = ((((f.head ?? 0) - k) % 8) + 8) % 8;
        const x = (RING_X + cx * RING_PITCH) * s;
        const y = (RING_Y + cy * RING_PITCH) * s;
        if (d === 0) canvas.rect(x, y, size, size, body);
        else if (d === 1) canvas.rect(x, y, size, size, body, 0xe0 / 255);
        else if (d === 2) canvas.rect(x, y, size, size, body, 0xb0 / 255);
        else canvas.rect(x, y, size, size, hex(RING_UNLIT));
      });
    }
    return canvas;
  });

  const size = width * height * 4;
  const all = new Uint8Array(canvases.length * size);
  canvases.forEach((c, i) => all.set(c.data, i * size));
  const quantized = quantize(all, 255 - painted.colours.length);
  const palette = [...quantized, ...painted.colours];
  const clear = palette.length;
  const bg = hex(STRIP_BG);
  const corners = outsideCorners(s);

  const gif = GIFEncoder();
  canvases.forEach((c, i) => {
    // applyPalette caches its nearest match per rgb565 bucket, so a strip
    // pixel can hand a painted colour the wrong index; painted pixels get
    // their own exact entry instead.
    const index = applyPalette(c.data, palette);
    for (let p = 0; p < c.owner.length; p++) {
      if (corners[p]) index[p] = clear;
      else if (c.owner[p]! >= 0) index[p] = quantized.length + c.owner[p]!;
    }
    // Frames are whole and every one carries the clear corners, so leaving
    // the last frame in place never shows a corner. The clear slot holds the
    // strip background for viewers that ignore transparency.
    gif.writeFrame(index, width, height, {
      palette: i === 0 ? [...palette, bg] : undefined,
      delay: plan[i]!.delay,
      repeat: 0,
      transparent: true,
      transparentIndex: clear,
      dispose: 1,
    });
  });
  gif.finish();
  return gif.bytes();
}
