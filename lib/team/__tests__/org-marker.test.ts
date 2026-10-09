import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { markerOrg, markerState, ORG_LAYOUT, ORG_LAYOUT_ABSENT_DEFAULT, ORG_MARKER_REL, parseMarker } from "../org-marker.ts";

const dir = "/h/.mattstack/orgs/acme";
const at = (raw: string) => fakeProbes({ home: "/h", files: { [`${dir}/${ORG_MARKER_REL}`]: raw } });

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
    expect(markerState(at('{ "role": "org", "org": "acme" }'), dir)).toEqual({ kind: "org", org: "acme", layout: 2 });
  });
});

describe("layout", () => {
  test("an org marker without the field reads as 2, a one-team marker as 1", () => {
    expect(markerState(at('{ "role": "org", "org": "acme" }'), dir)).toEqual({ kind: "org", org: "acme", layout: 2 });
    expect(markerState(at('{ "role": "team", "namespace": "widgets", "org": "acme" }'), dir)).toEqual({ kind: "org", org: "acme", layout: 1 });
  });
  test("an explicit positive integer wins over the default", () => {
    expect(parseMarker('{ "role": "org", "org": "acme", "layout": 3 }')).toEqual({ kind: "org", org: "acme", layout: 3 });
    expect(parseMarker('{ "role": "team", "org": "acme", "layout": 2 }')).toEqual({ kind: "org", org: "acme", layout: 2 });
  });
  test("a layout that is not a positive integer is invalid", () => {
    for (const bad of ['"2"', "0", "-1", "2.5", "null", "[]"]) {
      expect(parseMarker(`{ "role": "org", "org": "acme", "layout": ${bad} }`)).toEqual({ kind: "invalid", why: "its layout is not a positive whole number" });
    }
  });
  test("parseMarker of null is none", () => {
    expect(parseMarker(null)).toEqual({ kind: "none" });
  });
  test("ORG_LAYOUT is 3", () => {
    expect(ORG_LAYOUT).toBe(3);
  });
  test("the absent default is the literal 2, apart from ORG_LAYOUT", () => {
    expect(ORG_LAYOUT_ABSENT_DEFAULT).toBe(2);
  });
  test("after ORG_LAYOUT moves to 4, a marker without the field still reads 2 for an org and 1 for one team", async () => {
    const source = readFileSync(join(import.meta.dir, "..", "org-marker.ts"), "utf8");
    const bumped = source
      .replace(/^export const ORG_LAYOUT = 3;$/m, "export const ORG_LAYOUT = 4;")
      .replaceAll('from "../', `from "${join(import.meta.dir, "..", "..")}/`);
    expect(bumped).toContain("export const ORG_LAYOUT = 4;");
    const scratch = mkdtempSync(join(tmpdir(), "org-marker-bump-"));
    try {
      writeFileSync(join(scratch, "org-marker.ts"), bumped);
      const next = (await import(join(scratch, "org-marker.ts"))) as typeof import("../org-marker.ts");
      expect(next.ORG_LAYOUT).toBe(4);
      expect(next.parseMarker('{ "role": "org", "org": "acme" }')).toEqual({ kind: "org", org: "acme", layout: 2 });
      expect(next.parseMarker('{ "role": "team", "org": "acme" }')).toEqual({ kind: "org", org: "acme", layout: 1 });
      expect(next.parseMarker('{ "role": "org", "org": "acme", "layout": 3 }')).toEqual({ kind: "org", org: "acme", layout: 3 });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
