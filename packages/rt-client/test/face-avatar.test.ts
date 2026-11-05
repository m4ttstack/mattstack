import { expect, test } from "bun:test";

import { generatedFace } from "../src/face-avatar.ts";
import { FACE_TILES } from "../src/face-tiles.ts";

test("a seed always draws the same face", () => {
  expect(generatedFace("remy", 2).toString()).toBe(generatedFace("remy", 2).toString());
});

test("different seeds draw different faces", () => {
  expect(generatedFace("remy", 2).toString()).not.toBe(generatedFace("kit", 2).toString());
});

test("the tile is the background", () => {
  FACE_TILES.forEach((colour, tile) => {
    expect(generatedFace("remy", tile).toString()).toContain(`fill="#${colour}"`);
  });
});

test("the data URI and the SVG are the same face", () => {
  const face = generatedFace("remy", 2);
  expect(decodeURIComponent(face.toDataUri())).toContain(face.toString());
});
