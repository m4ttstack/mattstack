import { describe, expect, test } from "bun:test";
import { join } from "path";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { markerState, ORG_LAYOUT, ORG_MARKER_REL, parseMarker, updateSentence } from "../org-marker.ts";

describe("parseMarker", () => {
  test("this rt reads up to layout 1", () => {
    expect(ORG_LAYOUT).toBe(1);
  });

  test("the one-team marker defaults to layout 1", () => {
    expect(parseMarker(JSON.stringify({ role: "team", namespace: "widgets", org: "acme" }))).toEqual({ kind: "org", org: "acme", layout: 1 });
  });

  test("the org marker with no layout field defaults to layout 2", () => {
    expect(parseMarker(JSON.stringify({ role: "org", org: "acme" }))).toEqual({ kind: "org", org: "acme", layout: 2 });
  });

  test("an explicit positive integer layout wins over the role default", () => {
    expect(parseMarker(JSON.stringify({ role: "org", org: "acme", layout: 3 }))).toEqual({ kind: "org", org: "acme", layout: 3 });
    expect(parseMarker(JSON.stringify({ role: "team", org: "acme", layout: 1 }))).toEqual({ kind: "org", org: "acme", layout: 1 });
  });

  test("a layout that is present and not a positive integer is invalid", () => {
    for (const layout of [0, -1, 1.5, "2", null, true]) {
      expect(parseMarker(JSON.stringify({ role: "org", org: "acme", layout })).kind).toBe("invalid");
    }
  });

  test("jsonc comments are allowed", () => {
    expect(parseMarker(`// marker\n{ "role": "org", "org": "acme" }`)).toEqual({ kind: "org", org: "acme", layout: 2 });
  });

  test("absent, another role, bad JSON, no org, a bad org name", () => {
    expect(parseMarker(null)).toEqual({ kind: "none" });
    expect(parseMarker(JSON.stringify({ role: "home" }))).toEqual({ kind: "none" });
    expect(parseMarker("{ nope").kind).toBe("invalid");
    expect(parseMarker("[]").kind).toBe("invalid");
    expect(parseMarker(JSON.stringify({ role: "team", namespace: "widgets" })).kind).toBe("invalid");
    expect(parseMarker(JSON.stringify({ role: "org", org: "../acme" })).kind).toBe("invalid");
  });
});

describe("markerState", () => {
  test("reads mattstack/mattstack.jsonc under the clone", () => {
    const dir = "/h/.mattstack/teams/widgets";
    const p = fakeProbes({ files: { [join(dir, ORG_MARKER_REL)]: JSON.stringify({ role: "team", namespace: "widgets", org: "acme" }) } });
    expect(markerState(p, dir)).toEqual({ kind: "org", org: "acme", layout: 1 });
    expect(markerState(p, "/h/.mattstack/teams/gadgets")).toEqual({ kind: "none" });
  });
});

describe("updateSentence", () => {
  test("names the org's layout and the highest this app reads", () => {
    expect(updateSentence(2)).toBe("Your org uses layout 2 and this app reads up to 1. Update the app.");
  });
});
