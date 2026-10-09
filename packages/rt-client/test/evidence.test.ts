import { describe, expect, test } from "bun:test";
import { legacyItems, parseEvidence } from "../src/evidence.ts";

describe("parseEvidence", () => {
  test("v1 lists image keys in fixed order, skipping absent ones", () => {
    const r = parseEvidence(JSON.stringify({ v: 1, before: "/e/b.png", after: "/e/a.png", case: "hail" }));
    expect(r.version).toBe(1);
    if (r.version !== 1) throw new Error("unreachable");
    expect(r.images).toEqual([{ key: "before", path: "/e/b.png" }, { key: "after", path: "/e/a.png" }]);
    expect(r.evidence.case).toBe("hail");
  });
  test("v1 drops optional fields that are not strings", () => {
    const r = parseEvidence('{"v":1,"before":"/b.png","case":5,"url":null}');
    expect(r.version).toBe(1);
    if (r.version !== 1) throw new Error("unreachable");
    expect(r.evidence).toEqual({ v: 1, before: "/b.png" });
    expect(r.images).toEqual([{ key: "before", path: "/b.png" }]);
  });
  test("v1 without before falls back to links", () => {
    expect(parseEvidence(JSON.stringify({ v: 1, after: "/e/a.png" }))).toEqual({ version: 0, links: ["/e/a.png"] });
  });
  test("legacy JSON without v yields every absolute path and url", () => {
    const legacy = JSON.stringify({ before: "/Users/x/b.png", url: "http://localhost:4001/c/1", note: "plain" });
    expect(parseEvidence(legacy)).toEqual({ version: 0, links: ["/Users/x/b.png", "http://localhost:4001/c/1"] });
  });
  test("free text yields embedded paths and urls", () => {
    expect(parseEvidence("before at /tmp/b.png and https://x.dev/y")).toEqual({ version: 0, links: ["/tmp/b.png", "https://x.dev/y"] });
  });
  test("empty, '-', null and {plan: none} are no evidence", () => {
    for (const v of [null, undefined, "", "-", JSON.stringify({ plan: "none" })]) {
      expect(parseEvidence(v)).toEqual({ version: null });
    }
  });
});

describe("legacy evidence paths", () => {
  test("prose fractions and route patterns are not paths", () => {
    const v = JSON.stringify({
      before: "52/52 loads in the crawl; see https://tracker.example/WEB-1",
      after: "capture titles on /c/:id, /cases/:id and /orders/:id at ship",
    });
    expect(parseEvidence(v)).toEqual({ version: 0, links: ["https://tracker.example/WEB-1"] });
  });

  test("absolute file paths with an extension survive, mid-token slashes do not", () => {
    const v = "Evidence: /Users/acme/.mattstack/evidence/web-412/before.png and docs/a/b.md and x/y/z";
    expect(parseEvidence(v)).toEqual({ version: 0, links: ["/Users/acme/.mattstack/evidence/web-412/before.png"] });
  });

  test("a path inside quotes or brackets still starts a token", () => {
    const v = `["/tmp/ev/after.webp", "(/tmp/ev/log.txt)"]`;
    expect(parseEvidence(v)).toEqual({ version: 0, links: ["/tmp/ev/after.webp", "/tmp/ev/log.txt"] });
  });

  test("nothing but prose is no evidence", () => {
    expect(parseEvidence("screenshot -- /c/:id before/after")).toEqual({ version: null });
  });

  test("legacyItems sorts images, files and urls", () => {
    expect(legacyItems(["/a/b.PNG", "/a/c.log", "http://localhost:4001/orders/1#x"])).toEqual([
      { kind: "image", value: "/a/b.PNG" },
      { kind: "file", value: "/a/c.log" },
      { kind: "url", value: "http://localhost:4001/orders/1#x" },
    ]);
  });
});
