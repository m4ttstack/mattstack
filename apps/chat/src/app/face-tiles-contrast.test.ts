import { schema } from '@dicebear/personas';
import { FACE_TILES } from '@mattstack/rt-client/face-tiles';
import { expect, test } from 'vitest';

/** CIE76 distance, so the limits below read as how far apart two colours look. */
function lab(hex: string): readonly [number, number, number] {
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function distance(a: string, b: string): number {
  const [from, to] = [lab(a), lab(b)];
  return Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);
}

function colours(part: string): string[] {
  const { properties } = schema as unknown as {
    properties: Record<string, { default: string[] }>;
  };
  return properties[part]!.default;
}

const LIMITS = { skinColor: 40, hairColor: 15, clothingColor: 20 };
const BETWEEN_TILES = 15;

for (const [part, limit] of Object.entries(LIMITS)) {
  test(`every tile stands clear of the Personas' ${part}`, () => {
    for (const tile of FACE_TILES) {
      for (const colour of colours(part)) {
        expect(distance(tile, colour)).toBeGreaterThanOrEqual(limit);
      }
    }
  });
}

test('tiles read as different colours from each other', () => {
  FACE_TILES.forEach((tile, i) => {
    for (const other of FACE_TILES.slice(i + 1)) {
      expect(distance(tile, other)).toBeGreaterThanOrEqual(BETWEEN_TILES);
    }
  });
});
