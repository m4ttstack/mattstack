import { expect, test } from "bun:test";

import { FACE_TILES, faceSeed, faceTiles, ownTile } from "../src/face-tiles.ts";

test("everyone in a group gets a different tile", () => {
  const handles = ["alexa.f8jq", "george.vd65", "matt", "xena.a1", "remy.b2"];
  expect(new Set(faceTiles(handles).values()).size).toBe(handles.length);
});

test("tiles do not depend on who spoke first", () => {
  expect(faceTiles(["max", "kai", "remy"])).toEqual(faceTiles(["kai", "remy", "max"]));
});

test("two people who share a name still get different tiles", () => {
  const tiles = faceTiles(["remy.a1", "remy.b2"]);
  expect(tiles.get("remy.a1")).not.toBe(tiles.get("remy.b2"));
});

test("a group past the list's length still gets a tile each", () => {
  const handles = Array.from({ length: FACE_TILES.length + 3 }, (_, i) => `agent-${i}`);
  expect(faceTiles(handles).size).toBe(handles.length);
});

test("an agent keeps its seed across sessions, a Slack handle stays its own", () => {
  expect(faceSeed("remy.k3f9")).toBe("remy");
  expect(faceSeed("slack.u0abc")).toBe("slack.u0abc");
});

test("own tiles spread across the list", () => {
  const names = ["alexa", "george", "xena", "lawson", "tobias", "shepherd", "axton", "deon", "dakota", "miriam", "matt", "leath"];
  expect(new Set(names.map(ownTile)).size).toBeGreaterThanOrEqual(4);
});
