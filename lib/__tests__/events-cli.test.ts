import { describe, test, expect } from "bun:test";
import { nextWaitMs } from "../../commands/events.ts";

describe("nextWaitMs", () => {
  test("no deadline → full daemon cap", () => expect(nextWaitMs(null, 1_000)).toBe(240_000));
  test("distant deadline → clamped to cap", () => expect(nextWaitMs(1_000_000, 0)).toBe(240_000));
  test("near deadline → remaining time", () => expect(nextWaitMs(5_000, 2_000)).toBe(3_000));
  test("passed deadline → 0", () => expect(nextWaitMs(1_000, 5_000)).toBe(0));
});
