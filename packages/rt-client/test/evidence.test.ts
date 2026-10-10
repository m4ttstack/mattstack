import { describe, expect, test } from "bun:test";
import { evidenceShots, legacyItems, parseEvidence, readEvidence, resolveEvidencePath, uploadablePaths, validateEvidence } from "../src/evidence.ts";

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

  test("a path followed by sentence punctuation or a line number keeps the bare path", () => {
    const v = "Saved /tmp/ev/a.png. See /tmp/ev/b.png: ok, /tmp/ev/c.log:12 and /tmp/ev/d.png; also /tmp/ev/e.jpg, /tmp/ev/f.ts:4:2.";
    expect(parseEvidence(v)).toEqual({
      version: 0,
      links: ["/tmp/ev/a.png", "/tmp/ev/b.png", "/tmp/ev/c.log", "/tmp/ev/d.png", "/tmp/ev/e.jpg", "/tmp/ev/f.ts"],
    });
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

const V2 = {
  v: 2,
  cases: [
    {
      id: "shape2",
      label: "Shape 2 plate",
      before: { path: "/e/b.png", annotated: "/e/b-ann.png", caption: "Red box: blank plate" },
      after: {
        light: { path: "/e/a-light.png", annotated: "/e/a-light-ann.png", caption: "Arrow: plate shows" },
        dark: { path: "/e/a-dark.png", waiver: "Same marks as light" },
      },
    },
    { id: "empty", label: "Empty state", after: { path: "/e/empty.png" }, waiver: "Pixel-identical" },
  ],
  transcript: "/e/console.log",
  url: "http://localhost:4001/c/1",
};

describe("readEvidence", () => {
  test("v2 reads cases in order, themed slots light first, run keys carried", () => {
    const r = readEvidence(JSON.stringify(V2));
    expect(r.version).toBe(2);
    if (r.version !== 2) throw new Error("unreachable");
    expect(r.source).toBe(2);
    expect(r.transcript).toBe("/e/console.log");
    expect(r.url).toBe("http://localhost:4001/c/1");
    expect(r.cases.map((c) => c.id)).toEqual(["shape2", "empty"]);
    expect(r.cases[0]!.before).toEqual([{ path: "/e/b.png", annotated: "/e/b-ann.png", caption: "Red box: blank plate" }]);
    expect(r.cases[0]!.after).toEqual([
      { theme: "light", path: "/e/a-light.png", annotated: "/e/a-light-ann.png", caption: "Arrow: plate shows" },
      { theme: "dark", path: "/e/a-dark.png", waiver: "Same marks as light" },
    ]);
  });
  test("a case waiver becomes the effective waiver of its unannotated images only", () => {
    const value = { v: 2, cases: [{ id: "c", label: "C", waiver: "why", before: { path: "/b.png", annotated: "/ba.png", caption: "x" }, after: { path: "/a.png" } }] };
    const r = readEvidence(JSON.stringify(value));
    if (r.version !== 2) throw new Error("unreachable");
    expect(r.cases[0]!.waiver).toBe("why");
    expect(r.cases[0]!.before![0]!.waiver).toBeUndefined();
    expect(r.cases[0]!.after![0]!.waiver).toBe("why");
  });
  test("a slot with one theme reads as one themed shot", () => {
    const r = readEvidence(JSON.stringify({ v: 2, cases: [{ id: "c", label: "C", after: { dark: { path: "/d.png", waiver: "w" } } }] }));
    if (r.version !== 2) throw new Error("unreachable");
    expect(r.cases[0]!.after).toEqual([{ theme: "dark", path: "/d.png", waiver: "w" }]);
  });
  test("drops unreadable cases and repeated ids, keeping the first", () => {
    const value = { v: 2, cases: [{ id: "a", label: "A", after: { path: "/1.png" } }, { label: "no id" }, { id: "a", label: "A2", after: { path: "/2.png" } }, { id: "b", label: "B" }] };
    const r = readEvidence(JSON.stringify(value));
    if (r.version !== 2) throw new Error("unreachable");
    expect(r.cases.map((c) => c.label)).toEqual(["A"]);
  });
  test("v2 with no readable case falls back to the link scan", () => {
    expect(readEvidence(JSON.stringify({ v: 2, cases: [{ note: "/x/y.png" }] }))).toEqual({ version: 0, links: ["/x/y.png"] });
  });
  test("v1 reads as one case with id 'case', label from its case text", () => {
    const v1 = { v: 1, before: "/e/b.png", beforeAnnotated: "/e/ba.png", after: "/e/a.png", case: "hail claim", transcript: "/e/t.md", attach: "mr" };
    expect(readEvidence(JSON.stringify(v1))).toEqual({
      version: 2,
      source: 1,
      transcript: "/e/t.md",
      attach: "mr",
      cases: [{ id: "case", label: "hail claim", before: [{ path: "/e/b.png", annotated: "/e/ba.png" }], after: [{ path: "/e/a.png" }] }],
    });
  });
  test("v1 without case text is labelled Evidence", () => {
    const r = readEvidence(JSON.stringify({ v: 1, before: "/b.png" }));
    if (r.version !== 2) throw new Error("unreachable");
    expect(r.cases[0]!.label).toBe("Evidence");
  });
  test("legacy text and no evidence read as parseEvidence reads them", () => {
    expect(readEvidence("see /tmp/b.png")).toEqual({ version: 0, links: ["/tmp/b.png"] });
    for (const v of [null, "", "-", JSON.stringify({ plan: "none" })]) expect(readEvidence(v)).toEqual({ version: null });
  });
  test("parseEvidence is unchanged on a v2 value: it falls to links", () => {
    const r = parseEvidence(JSON.stringify(V2));
    expect(r.version).toBe(0);
    if (r.version !== 0) throw new Error("unreachable");
    expect(r.links).toContain("/e/a-dark.png");
    expect(r.links).toContain("/e/b-ann.png");
  });
});

describe("evidence helpers", () => {
  const record = readEvidence(JSON.stringify(V2));
  test("evidenceShots lists every shot with its case and slot", () => {
    expect(evidenceShots(record).map((s) => `${s.caseId}/${s.slot}/${s.shot.theme ?? "-"}`)).toEqual([
      "shape2/before/-", "shape2/after/light", "shape2/after/dark", "empty/after/-",
    ]);
    expect(evidenceShots({ version: null })).toEqual([]);
  });
  test("uploadablePaths: annotated images and waived bases, never a base with an annotated copy", () => {
    expect(uploadablePaths(record)).toEqual(["/e/b-ann.png", "/e/a-light-ann.png", "/e/a-dark.png", "/e/empty.png"]);
  });
  test("resolveEvidencePath addresses by case, slot, theme and variant", () => {
    expect(resolveEvidencePath(record, { case: "shape2", slot: "before" })).toEqual({ ok: true, path: "/e/b.png" });
    expect(resolveEvidencePath(record, { case: "shape2", slot: "before", annotated: true })).toEqual({ ok: true, path: "/e/b-ann.png" });
    expect(resolveEvidencePath(record, { case: "shape2", slot: "after", theme: "dark" })).toEqual({ ok: true, path: "/e/a-dark.png" });
  });
  test("resolveEvidencePath refuses a missing theme on a themed slot and a theme on an unthemed one", () => {
    expect(resolveEvidencePath(record, { case: "shape2", slot: "after" })).toEqual({ ok: false, error: "theme required: this slot has light and dark images" });
    expect(resolveEvidencePath(record, { case: "shape2", slot: "before", theme: "light" })).toEqual({ ok: false, error: "this slot has no themes" });
  });
  test("resolveEvidencePath answers no evidence for an unknown case, absent slot, absent theme or absent annotation", () => {
    for (const a of [
      { case: "nope", slot: "after" as const },
      { case: "empty", slot: "before" as const },
      { case: "shape2", slot: "after" as const, theme: "dark" as const, annotated: true },
    ]) expect(resolveEvidencePath(record, a)).toEqual({ ok: false, error: "no evidence" });
    const oneTheme = readEvidence(JSON.stringify({ v: 2, cases: [{ id: "c", label: "C", after: { dark: { path: "/d.png", waiver: "w" } } }] }));
    expect(resolveEvidencePath(oneTheme, { case: "c", slot: "after", theme: "light" })).toEqual({ ok: false, error: "no evidence" });
  });
});

describe("validateEvidence", () => {
  const ok = { ok: true };
  const bad = (value: unknown) => validateEvidence(JSON.stringify(value));
  const one = (c: object) => ({ v: 2, cases: [{ id: "c1", label: "Case", ...c }] });

  test("non-v2 values pass", () => {
    for (const v of ["", "-", "see /tmp/x.png", JSON.stringify({ plan: "none" }), JSON.stringify({ v: 1, before: "/b.png" })]) {
      expect(validateEvidence(v)).toEqual(ok);
    }
  });
  test("an annotated pair, an image waiver, a case waiver and a one-theme slot pass", () => {
    expect(bad(V2)).toEqual(ok);
    expect(bad(one({ after: { dark: { path: "/d.png", annotated: "/da.png", caption: "x" } } }))).toEqual(ok);
    expect(bad(one({ after: { path: "/a.png" }, waiver: "identical" }))).toEqual(ok);
  });
  test("a raw image with no annotation and no waiver is refused, naming case, slot and theme", () => {
    expect(bad(one({ after: { path: "/a.png" } }))).toEqual({
      ok: false,
      error: 'evidence@2: case "c1" after has no annotated image and no waiver; annotate it or add a waiver with a reason',
    });
    expect(bad(one({ before: { light: { path: "/l.png", waiver: "w" }, dark: { path: "/d.png" } } }))).toEqual({
      ok: false,
      error: 'evidence@2: case "c1" before (dark) has no annotated image and no waiver; annotate it or add a waiver with a reason',
    });
  });
  test("each structural problem is refused with its own message", () => {
    const cases: [unknown, string][] = [
      [{ v: 2 }, "cases must be a non-empty list"],
      [{ v: 2, cases: [] }, "cases must be a non-empty list"],
      [{ v: 2, cases: ["x"] }, "case 1 is not an object"],
      [{ v: 2, cases: [{ id: "Bad Id", label: "L", after: { path: "/a.png", waiver: "w" } }] }, "case 1 needs an id of lowercase letters, digits and dashes"],
      [{ v: 2, cases: [{ id: "a", label: "L", after: { path: "/a.png", waiver: "w" } }, { id: "a", label: "L", after: { path: "/b.png", waiver: "w" } }] }, 'case "a" appears twice'],
      [one({ label: " ", after: { path: "/a.png", waiver: "w" } }), 'case "c1" needs a label'],
      [one({}), 'case "c1" needs a before or an after'],
      [one({ after: "/a.png" }), 'case "c1" after must be an image or a {light, dark} pair'],
      [one({ after: {} }), 'case "c1" after must be an image or a {light, dark} pair'],
      [one({ after: { path: "a.png", waiver: "w" } }), 'case "c1" after path must be an absolute path'],
      [one({ after: { path: "/a.png", annotated: "aa.png", caption: "c" } }), 'case "c1" after annotated must be an absolute path'],
      [one({ after: { path: "/a.png", annotated: "/aa.png" } }), 'case "c1" after has an annotated image but no caption; say what the markers point at'],
      [one({ after: { path: "/a.png", annotated: "/aa.png", caption: "" } }), 'case "c1" after has an empty caption'],
      [one({ after: { path: "/a.png", annotated: "/aa.png", caption: "c", waiver: "w" } }), 'case "c1" after has both an annotated image and a waiver; keep one'],
      [one({ after: { path: "/a.png", waiver: " " } }), 'case "c1" after has an empty waiver; give a reason'],
      [one({ after: { path: "/a.png" }, waiver: "" }), 'case "c1" has an empty waiver; give a reason'],
      [{ ...one({ after: { path: "/a.png", waiver: "w" } }), transcript: "t.md" }, "transcript must be an absolute path"],
    ];
    for (const [value, message] of cases) expect(bad(value)).toEqual({ ok: false, error: `evidence@2: ${message}` });
  });
});
