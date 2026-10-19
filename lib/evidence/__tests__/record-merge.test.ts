import { describe, expect, test } from "bun:test";
import { validateEvidence } from "../../../packages/rt-client/src/evidence.ts";
import {
  type RawRecord,
  imageAddresses,
  importedTicketEntries,
  markKnownTickets,
  mergeRecord,
  parseCurrent,
  serializeRecord,
  stampTicketBytes,
  ticketEntries,
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

describe("ticket source", () => {
  const first = () => {
    const r = mergeRecord(parseCurrent(null), { images: [{ case: "t", label: "Ticket", slot: "before", path: "/run/t.png", source: "ticket" }] });
    if (!r.ok) throw new Error(r.error);
    return r.record;
  };
  test("a new image keeps its source", () => {
    expect(first().cases[0]!.before).toEqual({ path: "/run/t.png", source: "ticket" });
  });
  test("a later call on the same path without source keeps the mark", () => {
    const r = mergeRecord(first(), { images: [{ case: "t", slot: "before", path: "/run/t.png", annotated: "/run/t-board.png", caption: "c" }] });
    if (!r.ok) throw new Error(r.error);
    expect(r.record.cases[0]!.before).toEqual({ path: "/run/t.png", source: "ticket", annotated: "/run/t-board.png", caption: "c" });
  });
  test("a recapture at a new path clears it", () => {
    const r = mergeRecord(first(), { images: [{ case: "t", slot: "before", path: "/run/live.png", annotated: "/run/b.png", caption: "c" }] });
    if (!r.ok) throw new Error(r.error);
    expect(r.record.cases[0]!.before).toEqual({ path: "/run/live.png", annotated: "/run/b.png", caption: "c" });
  });
});

describe("stampTicketBytes", () => {
  const SHA = "c".repeat(64);
  const at = { case: "t", slot: "before" as const };
  const ticket = (extra: object = {}) => parseCurrent(JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: { path: "/run/t.png", source: "ticket", ...extra } }] }));
  const measured: string[] = [];
  const measure = (p: string) => { measured.push(p); return { size: 7, sha256: SHA }; };

  test("stamps a touched ticket image from its recorded path", () => {
    const record = ticket();
    measured.length = 0;
    expect(stampTicketBytes(record, [at], measure)).toEqual({ ok: true });
    expect(record.cases[0]!.before).toEqual({ path: "/run/t.png", source: "ticket", size: 7, sha256: SHA });
    expect(measured).toEqual(["/run/t.png"]);
  });
  test("keeps a recorded hash, leaves untouched and non-ticket images alone", () => {
    const kept = ticket({ size: 1, sha256: "d".repeat(64) });
    measured.length = 0;
    stampTicketBytes(kept, [at], measure);
    expect(kept.cases[0]!.before).toMatchObject({ size: 1, sha256: "d".repeat(64) });
    const untouched = ticket();
    stampTicketBytes(untouched, [], measure);
    const plain = parseCurrent(JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: { path: "/run/p.png", waiver: "w" } }] }));
    stampTicketBytes(plain, [at], measure);
    expect(measured).toEqual([]);
  });
  test("a sticky same-path merge keeps size and sha256; a recapture drops them for restamping", () => {
    const same = mergeRecord(ticket({ size: 1, sha256: SHA }), { images: [{ ...at, path: "/run/t.png", caption: "c" }] });
    expect(same.ok && same.record.cases[0]!.before).toMatchObject({ size: 1, sha256: SHA });
    const moved = mergeRecord(ticket({ size: 1, sha256: SHA }), { images: [{ ...at, path: "/run/t2.png", source: "ticket" }] });
    expect(moved.ok && moved.record.cases[0]!.before).toEqual({ path: "/run/t2.png", source: "ticket" });
  });
  test("an unreadable ticket image refuses, naming where it sits", () => {
    const r = stampTicketBytes(ticket(), [at], () => { throw new Error("ENOENT"); });
    expect(r).toEqual({ ok: false, error: 'case "t" before: the ticket image could not be read to record its size and sha256 (ENOENT); recapture it' });
  });
});

describe("importedTicketEntries", () => {
  const SHA = "e".repeat(64);
  const record = (before: object, after?: object) => parseCurrent(JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before, ...(after && { after }) }] }));
  const captures = (board: string) => (board === "/run/b.png" ? ["/run/b.c1.png"] : []);
  const measure = (p: string) => ({ size: p.length, sha256: SHA });

  test("remembers the import captures of a ticket image's board, and only a ticket image's", () => {
    const r = record({ path: "/run/t.png", source: "ticket", annotated: "/run/b.png", caption: "c" }, { path: "/run/p.png", annotated: "/run/b.png", caption: "c" });
    expect(importedTicketEntries(r, captures, measure)).toEqual({ ok: true, entries: [{ path: "/run/b.c1.png", size: "/run/b.c1.png".length, sha256: SHA }] });
    const plain = record({ path: "/run/p.png", annotated: "/run/b.png", caption: "c" });
    expect(importedTicketEntries(plain, captures, measure)).toEqual({ ok: true, entries: [] });
  });
  test("an unreadable import capture refuses, naming where it sits", () => {
    const r = record({ path: "/run/t.png", source: "ticket", annotated: "/run/b.png", caption: "c" });
    expect(importedTicketEntries(r, captures, () => { throw new Error("EACCES"); })).toEqual({
      ok: false,
      error: 'case "t" before: the import capture /run/b.c1.png of the ticket image could not be read to record its size and sha256 (EACCES); recapture it',
    });
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

describe("markKnownTickets", () => {
  const SHA = "e".repeat(64);
  const known = [{ path: "/run/t.png", size: 5, sha256: SHA }];
  const one = (before: object) => parseCurrent(JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before }] }));
  const files = (o: Record<string, { size: number; sha256: string }>) => ({
    real: (p: string) => p.replace("/link/", "/run/"),
    size: (p: string) => o[p]?.size ?? null,
    sha256: (p: string) => o[p]?.sha256 ?? null,
  });

  test("an unmarked image at a known ticket path takes the mark and the recorded bytes, the file unread", () => {
    for (const path of ["/run/t.png", "/link/t.png"]) {
      const record = one({ path, annotated: "/run/b.png", caption: "c" });
      markKnownTickets(record, known, files({}));
      expect(record.cases[0]!.before).toEqual({ path, source: "ticket", size: 5, sha256: SHA, annotated: "/run/b.png", caption: "c" });
    }
  });

  test("an unmarked image with a known ticket's bytes at any path takes the mark", () => {
    const record = one({ path: "/run/elsewhere.png", waiver: "w" });
    markKnownTickets(record, known, files({ "/run/elsewhere.png": { size: 5, sha256: SHA } }));
    expect(record.cases[0]!.before).toMatchObject({ source: "ticket", size: 5, sha256: SHA });
  });

  test("other bytes stay unmarked, a size that matches no ticket is never hashed, and a gone file is skipped", () => {
    const hashed: string[] = [];
    const deps = { ...files({}), size: (p: string) => (p === "/run/same-size.png" ? 5 : p === "/run/big.png" ? 9 : null), sha256: (p: string) => { hashed.push(p); return "f".repeat(64); } };
    for (const path of ["/run/same-size.png", "/run/big.png", "/run/gone.png"]) {
      const record = one({ path, waiver: "w" });
      markKnownTickets(record, known, deps);
      expect(record.cases[0]!.before).toEqual({ path, waiver: "w" });
    }
    expect(hashed).toEqual(["/run/same-size.png"]);
  });

  test("ticketEntries lists each ticket image with recorded bytes", () => {
    const record = parseCurrent(JSON.stringify({ v: 2, cases: [
      { id: "t", label: "T", before: { path: "/run/t.png", source: "ticket", size: 5, sha256: SHA, waiver: "x" }, after: { path: "/run/a.png", waiver: "w" } },
      { id: "u", label: "U", before: { light: { path: "/run/legacy.png", source: "ticket" } } },
    ] }));
    expect(ticketEntries(record)).toEqual(known);
  });
});
