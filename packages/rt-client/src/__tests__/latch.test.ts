import { describe, expect, test } from "bun:test";
import { LATCH_MARKER, LATCH_MARKER_SPENT, latchKindOf } from "../latch.ts";

describe("latchKindOf", () => {
  test("recognizes an armed latch", () => {
    expect(latchKindOf(`${LATCH_MARKER}\n\nbanner`)).toBe("armed");
  });

  test("recognizes a spent latch", () => {
    expect(latchKindOf(`${LATCH_MARKER_SPENT}\n\nbanner`)).toBe("spent");
  });

  test("returns null for an ordinary comment", () => {
    expect(latchKindOf("looks good to me")).toBeNull();
  });

  // A spent body that also quotes the armed marker must still read as spent.
  // This is what actually forces the spent-first check: flip the order in
  // latchKindOf and this test fails.
  test("classifies a body carrying both markers as spent", () => {
    expect(latchKindOf(`${LATCH_MARKER_SPENT}\n\nquoted: ${LATCH_MARKER}`)).toBe("spent");
  });

  // Version skew: a v1 reader must ignore a marker it does not understand
  // rather than acting on it with v1 rules.
  test("ignores a v2 marker", () => {
    expect(latchKindOf("<!-- mattstack:board re-review-latch v2 -->\n\nhi")).toBeNull();
  });

  // A quote further down the body is not a latch: only the first line counts.
  test("returns null when a marker only appears quoted on a later line", () => {
    expect(latchKindOf(`what is this thread about?\n\nsomeone pasted: ${LATCH_MARKER}`)).toBeNull();
  });
});
