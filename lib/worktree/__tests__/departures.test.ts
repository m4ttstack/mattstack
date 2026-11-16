import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { departedAt, recordDepartures } from "../departures.ts";

function freshTreePath(): string {
  return join(mkdtempSync(join(tmpdir(), "rtdepart-")), "tree");
}

describe("departures", () => {
  test("recordDepartures then departedAt returns the time", () => {
    const path = freshTreePath();
    recordDepartures(path, ["s1", "s2"], "2026-11-14T10:00:00.000Z");
    expect(departedAt(path, "s1")).toBe("2026-11-14T10:00:00.000Z");
    expect(departedAt(path, "s2")).toBe("2026-11-14T10:00:00.000Z");
  });

  test("departedAt is null for another session or path", () => {
    const path = freshTreePath();
    recordDepartures(path, ["s1"], "2026-11-14T10:00:00.000Z");
    expect(departedAt(path, "other")).toBeNull();
    expect(departedAt(freshTreePath(), "s1")).toBeNull();
  });

  test("a departure older than 14 days is dropped on the next write", () => {
    const path = freshTreePath();
    recordDepartures(path, ["old"], "2026-10-01T00:00:00.000Z");
    recordDepartures(path, ["new"], "2026-11-14T10:00:00.000Z");
    expect(departedAt(path, "old")).toBeNull();
    expect(departedAt(path, "new")).toBe("2026-11-14T10:00:00.000Z");
  });

  test("recording twice keeps the earliest time for a session", () => {
    const path = freshTreePath();
    recordDepartures(path, ["s1"], "2026-11-14T10:00:00.000Z");
    recordDepartures(path, ["s1"], "2026-11-14T11:00:00.000Z");
    expect(departedAt(path, "s1")).toBe("2026-11-14T10:00:00.000Z");
  });
});
