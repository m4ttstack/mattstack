import { describe, expect, test } from "bun:test";
import { validateEvidence } from "../../../packages/rt-client/src/evidence.ts";
import {
  type RawRecord,
  imageAddresses,
  mergeRecord,
  parseCurrent,
  serializeRecord,
  uncoveredImages,
} from "../record-merge.ts";

function merged(current: RawRecord, input: Parameters<typeof mergeRecord>[1]): RawRecord {
  const r = mergeRecord(current, input);
  if (!r.ok) throw new Error(r.error);
  return r.record;
}

describe("parseCurrent", () => {
  test("v2 keeps a case-level waiver on the case, not on its images", () => {
    const rec = parseCurrent('{"v":2,"cases":[{"id":"a","label":"A","waiver":"w","before":{"path":"/x.png"}}]}');
    expect(rec.cases[0]).toEqual({ id: "a", label: "A", waiver: "w", before: { path: "/x.png" } });
  });

  test("v1 becomes one case and keeps the url", () => {
    const rec = parseCurrent('{"v":1,"before":"/b.png","beforeAnnotated":"/ba.png","case":"Badge","url":"https://t"}');
    expect(rec.cases).toEqual([{ id: "case", label: "Badge", before: { path: "/b.png", annotated: "/ba.png" } }]);
    expect(rec.url).toBe("https://t");
  });

  test("v1 without beforeAnnotated leaves no annotated key", () => {
    const rec = parseCurrent('{"v":1,"before":"/b.png"}');
    expect(rec.cases[0]).toEqual({ id: "case", label: "Evidence", before: { path: "/b.png" } });
    expect("annotated" in (rec.cases[0]!.before as object)).toBe(false);
  });

  test.each([[""], ["-"], [null], ['{"plan":"none"}']])("%p is empty", (v) => {
    const rec = parseCurrent(v);
    expect(rec.cases).toEqual([]);
    expect(rec.attach).toBeUndefined();
  });

  test("plan:text keeps transcript and url", () => {
    const rec = parseCurrent('{"plan":"text","transcript":"/t.txt","url":"https://t"}');
    expect(rec.cases).toEqual([]);
    expect(rec.transcript).toBe("/t.txt");
    expect(rec.url).toBe("https://t");
  });

  test("legacy text is carried in attach", () => {
    const rec = parseCurrent("see /a.png and https://x");
    expect(rec.cases).toEqual([]);
    expect(rec.attach).toBe("see /a.png and https://x");
  });
});

const two = '{"v":2,"cases":[{"id":"a","label":"A","before":{"path":"/b.png","annotated":"/ba.png","caption":"c"},"after":{"light":{"path":"/l.png","waiver":"w"},"dark":{"path":"/d.png","waiver":"w"}}}]}';

describe("mergeRecord", () => {
  test("recapture replaces the slot with exactly the new entries", () => {
    const rec = merged(parseCurrent(two), { images: [{ case: "a", slot: "after", theme: "light", path: "/new.png", waiver: "w" }] });
    expect(rec.cases[0]!.after).toEqual({ light: { path: "/new.png", waiver: "w" } });
  });

  test("cover update sets the pair, removes waiver and keeps other keys", () => {
    const cur = parseCurrent('{"v":2,"cases":[{"id":"a","label":"A","before":{"path":"/b.png","waiver":"w","z":1}}]}');
    const rec = merged(cur, { images: [{ case: "a", slot: "before", path: "/b.png", annotated: "/ba.png", caption: "c" }] });
    expect(rec.cases[0]!.before).toEqual({ path: "/b.png", annotated: "/ba.png", caption: "c", z: 1 });
  });

  test("cover update without a path patches the image", () => {
    const rec = merged(parseCurrent(two), { images: [{ case: "a", slot: "after", theme: "dark", annotated: "/da.png", caption: "c" }] });
    expect(imageAddresses(rec).find((a) => a.theme === "dark")!.image).toEqual({ path: "/d.png", annotated: "/da.png", caption: "c" });
  });

  test("waiver on a cover update clears annotated and caption", () => {
    const rec = merged(parseCurrent(two), { images: [{ case: "a", slot: "before", waiver: "skip" }] });
    expect(rec.cases[0]!.before).toEqual({ path: "/b.png", waiver: "skip" });
  });

  test("case waiver moves onto existing images when a recapture adds an uncovered after", () => {
    const cur = parseCurrent('{"v":2,"cases":[{"id":"a","label":"A","waiver":"w","before":{"path":"/b.png"}}]}');
    const rec = merged(cur, { images: [{ case: "a", slot: "after", path: "/a.png" }] });
    expect(rec.cases[0]!.before).toEqual({ path: "/b.png", waiver: "w" });
    expect("waiver" in rec.cases[0]!).toBe(false);
    expect(uncoveredImages(rec)).toEqual([{ case: "a", slot: "after", path: "/a.png", why: "no-cover" }]);
  });

  test("a case waiver written with its images stays on the case and covers them", () => {
    const rec = merged(parseCurrent(null), {
      cases: [{ id: "a", label: "A", waiver: "w" }],
      images: [{ case: "a", slot: "before", path: "/b.png" }],
    });
    expect(rec.cases[0]!.waiver).toBe("w");
    expect(uncoveredImages(rec)).toEqual([]);
  });

  test("a new case waiver replaces an old one without migrating it", () => {
    const cur = parseCurrent('{"v":2,"cases":[{"id":"a","label":"A","waiver":"old","before":{"path":"/b.png"}}]}');
    const rec = merged(cur, { cases: [{ id: "a", waiver: "new" }], images: [{ case: "a", slot: "after", path: "/a.png" }] });
    expect(rec.cases[0]!.waiver).toBe("new");
    expect(rec.cases[0]!.before).toEqual({ path: "/b.png" });
  });

  test("a missing-image error says when the slot is recaptured in the same call", () => {
    const r = mergeRecord(parseCurrent(two), {
      images: [{ case: "a", slot: "after", theme: "light", path: "/n.png", waiver: "w" }, { case: "a", slot: "after", theme: "dark", caption: "c" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("replaced by this call's recapture");
  });

  test("an entry with annotated and waiver is refused, naming the address", () => {
    const r = mergeRecord(parseCurrent(two), { images: [{ case: "a", slot: "before", annotated: "/x.png", waiver: "w" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('case "a" before');
  });

  test("a cover update for a missing image is refused", () => {
    const cur = parseCurrent('{"v":2,"cases":[{"id":"a","label":"A","before":{"path":"/b.png","waiver":"w"}}]}');
    const r = mergeRecord(cur, { images: [{ case: "a", slot: "after", caption: "c" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('case "a" after');
  });

  test("a new case without a label is refused", () => {
    const r = mergeRecord(parseCurrent(null), { images: [{ case: "retry-badge", slot: "before", path: "/b.png", waiver: "w" }] });
    expect(r.ok).toBe(false);
  });

  test("a new case takes its label from cases[]", () => {
    const rec = merged(parseCurrent(null), {
      cases: [{ id: "retry-badge", label: "Retry badge" }],
      images: [{ case: "retry-badge", slot: "before", path: "/b.png", waiver: "w" }],
    });
    expect(rec.cases[0]!.label).toBe("Retry badge");
  });

  test("remove without slot deletes the case, with slot the slot, with theme one image", () => {
    expect(merged(parseCurrent(two), { remove: [{ case: "a" }] }).cases).toEqual([]);
    const noAfter = merged(parseCurrent(two), { remove: [{ case: "a", slot: "after" }] });
    expect(noAfter.cases[0]!.after).toBeUndefined();
    expect(noAfter.cases[0]!.before).toBeDefined();
    const noDark = merged(parseCurrent(two), { remove: [{ case: "a", slot: "after", theme: "dark" }] });
    expect(noDark.cases[0]!.after).toEqual({ light: { path: "/l.png", waiver: "w" } });
  });

  test("an explicit recapture flag wins over path comparison", () => {
    const cur = parseCurrent('{"v":2,"cases":[{"id":"a","label":"A","before":{"path":"/b.png","annotated":"/ba.png","caption":"old"}}]}');
    const same = merged(cur, { images: [{ case: "a", slot: "before", path: "/b.png", recapture: true }] });
    expect(same.cases[0]!.before).toEqual({ path: "/b.png" });
    const moved = merged(cur, { images: [{ case: "a", slot: "before", path: "/elsewhere/b.png", recapture: false, caption: "new" }] });
    expect(moved.cases[0]!.before).toEqual({ path: "/b.png", annotated: "/ba.png", caption: "new" });
  });

  test("transcript and url set run-level keys", () => {
    const rec = merged(parseCurrent(two), { transcript: "/t.txt", url: "https://t" });
    expect(rec.transcript).toBe("/t.txt");
    expect(rec.url).toBe("https://t");
  });
});

describe("uncoveredImages", () => {
  test("annotated without caption is no-caption", () => {
    const rec = parseCurrent('{"v":2,"cases":[{"id":"a","label":"A","before":{"path":"/b.png","annotated":"/ba.png"}}]}');
    expect(uncoveredImages(rec)).toEqual([{ case: "a", slot: "before", path: "/b.png", why: "no-caption" }]);
  });
});

describe("serializeRecord", () => {
  test("images serialize as evidence@2 that validates", () => {
    const r = serializeRecord(parseCurrent(two));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.encoding).toBe("evidence@2");
      expect(r.value.startsWith('{"v":2')).toBe(true);
      expect(validateEvidence(r.value)).toEqual({ ok: true });
    }
  });

  test("transcript only is plan:text", () => {
    const r = serializeRecord({ cases: [], transcript: "/t.txt", extra: {} });
    expect(r).toEqual({ ok: true, encoding: "plan:text", value: '{"plan":"text","transcript":"/t.txt"}' });
  });

  test("url only is plan:ticket", () => {
    const r = serializeRecord({ cases: [], url: "https://t", extra: {} });
    expect(r).toEqual({ ok: true, encoding: "plan:ticket", value: '{"plan":"ticket","url":"https://t"}' });
  });

  test("plan none is plan:none", () => {
    const r = serializeRecord({ cases: [], extra: {} }, "none");
    expect(r).toEqual({ ok: true, encoding: "plan:none", value: '{"plan":"none"}' });
  });

  test("nothing, or attach only, is refused", () => {
    expect(serializeRecord({ cases: [], extra: {} }).ok).toBe(false);
    expect(serializeRecord({ cases: [], attach: "see /a.png", extra: {} }).ok).toBe(false);
  });

  test("round trip keeps unknown keys at record, case and image level", () => {
    const v = '{"v":2,"z":1,"cases":[{"id":"a","label":"A","z":1,"before":{"path":"/b.png","waiver":"w","z":1}}]}';
    const r = serializeRecord(parseCurrent(v));
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.value)).toEqual(JSON.parse(v));
  });
});
