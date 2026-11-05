import { expect, test } from 'bun:test';

import { sideBarShare, zoomForBars } from '../src/face-zoom.ts';

const SIZE = 10;

function image(paint: (x: number) => number[]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) pixels.set(paint(x), (y * SIZE + x) * 4);
  }
  return pixels;
}

const PHOTO = [90, 60, 40, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

test('a full photo has no bars', () => {
  expect(sideBarShare(image(() => PHOTO), SIZE)).toBe(0);
});

test('white bars on both sides are measured', () => {
  const barred = image(x => (x < 2 || x >= 8 ? WHITE : PHOTO));
  expect(sideBarShare(barred, SIZE)).toBe(0.2);
});

test('transparent bars count too', () => {
  const barred = image(x => (x < 1 || x >= 9 ? CLEAR : PHOTO));
  expect(sideBarShare(barred, SIZE)).toBe(0.1);
});

test('a pale edge on one side is the photo, not a bar', () => {
  const lopsided = image(x => (x < 3 ? WHITE : PHOTO));
  expect(sideBarShare(lopsided, SIZE)).toBe(0);
});

test('zoom fills the frame, within limits', () => {
  expect(zoomForBars(0.02)).toBe(1);
  expect(zoomForBars(0.25)).toBe(1.8);
  expect(zoomForBars(0.1)).toBeCloseTo(1.25);
});
