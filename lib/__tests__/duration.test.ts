import { describe, test, expect } from "bun:test";
import { parseDuration } from "../duration.ts";
import { parseDuration as fromEvents } from "../../commands/events.ts";

describe("parseDuration", () => {
  test("suffixes", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
  });
  test("bare number = seconds", () => expect(parseDuration("45")).toBe(45_000));
  test("garbage is null", () => {
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("-5s")).toBeNull();
  });
  test("commands/events.ts re-exports the same function", () => {
    expect(fromEvents).toBe(parseDuration);
  });
});
