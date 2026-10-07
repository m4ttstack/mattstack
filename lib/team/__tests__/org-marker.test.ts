import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { markerOrg, ORG_MARKER_REL } from "../org-marker.ts";

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
