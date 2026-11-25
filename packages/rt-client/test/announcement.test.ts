import { expect, test } from "bun:test";

import { ANNOUNCEMENT_PLACEHOLDER, announcementBinding, parseAnnouncementPayload } from "../src/announcement.ts";

test("accepts a title and message", () => {
  expect(parseAnnouncementPayload({ title: "Update rt", message: "Today please" })).toEqual({
    title: "Update rt",
    message: "Today please",
  });
});
test("keeps sealed text and rejects one that is not a string", () => {
  expect(parseAnnouncementPayload({ ...ANNOUNCEMENT_PLACEHOLDER, sealed: "YWdl" })).toEqual({ ...ANNOUNCEMENT_PLACEHOLDER, sealed: "YWdl" });
  expect(parseAnnouncementPayload({ ...ANNOUNCEMENT_PLACEHOLDER, sealed: 7 })).toBeNull();
});
test("the binding names the envelope and its sender", () => {
  expect(announcementBinding("e-1", "dev1")).toEqual({ type: "announcement", from: "dev1", subject: "e-1" });
});
test("rejects non-objects, missing fields and non-strings", () => {
  for (const bad of [null, "x", {}, { title: "a" }, { title: 1, message: "b" }])
    expect(parseAnnouncementPayload(bad)).toBeNull();
});
test("rejects whitespace-only text", () => {
  expect(parseAnnouncementPayload({ title: "   ", message: "b" })).toBeNull();
  expect(parseAnnouncementPayload({ title: "a", message: " \n " })).toBeNull();
});
test("caps at 80 and 500 characters", () => {
  expect(parseAnnouncementPayload({ title: "a".repeat(80), message: "b".repeat(500) })).not.toBeNull();
  expect(parseAnnouncementPayload({ title: "a".repeat(81), message: "b" })).toBeNull();
  expect(parseAnnouncementPayload({ title: "a", message: "b".repeat(501) })).toBeNull();
});
