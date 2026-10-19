import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { markerOrg, markerState, ORG_LAYOUT, ORG_LAYOUT_ABSENT_DEFAULT, ORG_MARKER_REL, parseMarker, POINTER_REL, pointerText, READABLE_LAYOUTS } from "../org-marker.ts";

const dir = "/h/.mattstack/orgs/acme";
const at = (raw: string) => fakeProbes({ home: "/h", files: { [`${dir}/${ORG_MARKER_REL}`]: raw } });

describe("the root pointer", () => {
  const both = (root: string | null, folder: string | null) =>
    fakeProbes({ home: "/h", files: { ...(root !== null ? { [`${dir}/${POINTER_REL}`]: root } : {}), ...(folder !== null ? { [`${dir}/${ORG_MARKER_REL}`]: folder } : {}) } });

  test("is a single file at the root of main", () => {
    expect(POINTER_REL).toBe(".mattstack.jsonc");
  });
  test("a copy holding only the root pointer reads as the org it names", () => {
    expect(markerState(both('{ "role": "org", "org": "acme", "layout": 4, "dataBranch": "mattstack" }', null), dir)).toEqual({ kind: "org", org: "acme", layout: 4, dataBranch: "mattstack" });
  });
  test("the root pointer is read before the folder file", () => {
    expect(markerState(both('{ "role": "org", "org": "acme", "layout": 4, "dataBranch": "data" }', '{ "role": "org", "org": "acme", "layout": 4, "dataBranch": "mattstack" }'), dir)).toMatchObject({ dataBranch: "data" });
  });
  test("only the old folder file still reads", () => {
    expect(markerState(both(null, '{ "role": "org", "org": "acme", "layout": 4, "dataBranch": "mattstack" }'), dir)).toMatchObject({ kind: "org", dataBranch: "mattstack" });
  });
  test("the pointer text says what the branch is and parses back to the same marker", () => {
    const text = pointerText("acme", "mattstack");
    expect(text).toContain("Never delete it or merge it into main.");
    expect(text).toContain("the mattstack branch");
    expect(parseMarker(text)).toEqual({ kind: "org", org: "acme", layout: 4, dataBranch: "mattstack" });
  });
});

describe("markerOrg", () => {
  test("reads an org marker", () => {
    expect(markerOrg(at('{ "role": "org", "org": "acme" }'), dir)).toBe("acme");
  });
  test("accepts the old one-team marker when it names an org", () => {
    expect(markerOrg(at('// legacy\n{ "role": "team", "org": "widgets" }'), dir)).toBe("widgets");
  });
  test("rejects a marker with another role, no org, a bad slug, bad JSON or no file", () => {
    expect(markerOrg(at('{ "role": "pack", "org": "acme" }'), dir)).toBeNull();
    expect(markerOrg(at('{ "role": "org" }'), dir)).toBeNull();
    expect(markerOrg(at('{ "role": "org", "org": "Not A Slug" }'), dir)).toBeNull();
    expect(markerOrg(at("{ nope"), dir)).toBeNull();
    expect(markerOrg(fakeProbes({ home: "/h" }), dir)).toBeNull();
  });
});

describe("markerState", () => {
  test("tells no marker and another role apart from a marker rt could not read", () => {
    expect(markerState(fakeProbes({ home: "/h" }), dir)).toEqual({ kind: "none" });
    expect(markerState(at('{ "role": "pack", "org": "acme" }'), dir)).toEqual({ kind: "none" });
    expect(markerState(at("{ nope"), dir)).toEqual({ kind: "invalid", why: "it is not valid JSON" });
    expect(markerState(at("[]"), dir)).toEqual({ kind: "invalid", why: "it is not a JSON object" });
    expect(markerState(at('{ "role": "org" }'), dir)).toEqual({ kind: "invalid", why: "it names no org" });
    expect(markerState(at('{ "role": "org", "org": "Not A Slug" }'), dir)).toEqual({ kind: "invalid", why: '"Not A Slug" is not a valid org name' });
    expect(markerState(at('{ "role": "org", "org": "acme" }'), dir)).toEqual({ kind: "org", org: "acme", layout: 2, dataBranch: null });
  });
});

describe("layout", () => {
  test("an org marker without the field reads as 2, a one-team marker as 1", () => {
    expect(markerState(at('{ "role": "org", "org": "acme" }'), dir)).toEqual({ kind: "org", org: "acme", layout: 2, dataBranch: null });
    expect(markerState(at('{ "role": "team", "namespace": "widgets", "org": "acme" }'), dir)).toEqual({ kind: "org", org: "acme", layout: 1, dataBranch: null });
  });
  test("an explicit positive integer wins over the default", () => {
    expect(parseMarker('{ "role": "org", "org": "acme", "layout": 3 }')).toEqual({ kind: "org", org: "acme", layout: 3, dataBranch: null });
    expect(parseMarker('{ "role": "team", "org": "acme", "layout": 2 }')).toEqual({ kind: "org", org: "acme", layout: 2, dataBranch: null });
  });
  test("a layout that is not a positive integer is invalid", () => {
    for (const bad of ['"2"', "0", "-1", "2.5", "null", "[]"]) {
      expect(parseMarker(`{ "role": "org", "org": "acme", "layout": ${bad} }`)).toEqual({ kind: "invalid", why: "its layout is not a positive whole number" });
    }
  });
  test("parseMarker of null is none", () => {
    expect(parseMarker(null)).toEqual({ kind: "none" });
  });
  test("ORG_LAYOUT is 4 and layouts 3 and 4 are readable", () => {
    expect(ORG_LAYOUT).toBe(4);
    expect(READABLE_LAYOUTS).toEqual([3, 4]);
  });
  test("the absent default is the literal 2, apart from ORG_LAYOUT", () => {
    expect(ORG_LAYOUT_ABSENT_DEFAULT).toBe(2);
  });
  test("after ORG_LAYOUT moves to 5, a marker without the field still reads 2 for an org and 1 for one team", async () => {
    const source = readFileSync(join(import.meta.dir, "..", "org-marker.ts"), "utf8");
    const bumped = source
      .replace(/^export const ORG_LAYOUT = 4;$/m, "export const ORG_LAYOUT = 5;")
      .replaceAll('from "../', `from "${join(import.meta.dir, "..", "..")}/`);
    expect(bumped).toContain("export const ORG_LAYOUT = 5;");
    const scratch = mkdtempSync(join(tmpdir(), "org-marker-bump-"));
    try {
      writeFileSync(join(scratch, "org-marker.ts"), bumped);
      const next = (await import(join(scratch, "org-marker.ts"))) as typeof import("../org-marker.ts");
      expect(next.ORG_LAYOUT).toBe(5);
      expect(next.parseMarker('{ "role": "org", "org": "acme" }')).toEqual({ kind: "org", org: "acme", layout: 2, dataBranch: null });
      expect(next.parseMarker('{ "role": "team", "org": "acme" }')).toEqual({ kind: "org", org: "acme", layout: 1, dataBranch: null });
      expect(next.parseMarker('{ "role": "org", "org": "acme", "layout": 3 }')).toEqual({ kind: "org", org: "acme", layout: 3, dataBranch: null });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

test("a marker's dataBranch is read, and absent reads as null", () => {
  expect(parseMarker('{"role":"org","org":"acme","layout":4,"dataBranch":"mattstack"}')).toEqual({ kind: "org", org: "acme", layout: 4, dataBranch: "mattstack" });
  expect(parseMarker('{"role":"org","org":"acme"}')).toEqual({ kind: "org", org: "acme", layout: 2, dataBranch: null });
});
test("a dataBranch that is not a plain branch name makes the marker invalid", () => {
  for (const bad of ["", "-x", "a..b", "a b", "../x", "/x", "x/", 7, "team//data", "team/.hidden", "team.lock", "team.", "a/b.lock"]) {
    expect(parseMarker(JSON.stringify({ role: "org", org: "acme", dataBranch: bad })).kind).toBe("invalid");
  }
});
test("a dataBranch with several plain components is valid", () => {
  expect(parseMarker('{"role":"org","org":"acme","layout":4,"dataBranch":"trial/layout-4"}')).toMatchObject({ kind: "org", dataBranch: "trial/layout-4" });
});
