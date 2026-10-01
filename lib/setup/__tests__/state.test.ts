import { describe, test, expect } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { readSetupState, updateSetupState } from "../state.ts";

describe("readSetupState", () => {
  test("defaults to empty arrays when the state file is absent", () => {
    const p = fakeProbes();
    expect(readSetupState(p)).toEqual({ v: 1, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [], migrations: [] });
  });

  test("defaults to empty arrays when the state file is unparseable", () => {
    const p = fakeProbes({ files: { "/fake-home/.mattstack/rt/setup-state.json": "not json" } });
    expect(readSetupState(p)).toEqual({ v: 1, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [], migrations: [] });
  });

  test("backfills migrations to [] for a state file written before the field existed", () => {
    const p = fakeProbes({ files: { "/fake-home/.mattstack/rt/setup-state.json": JSON.stringify({ v: 1, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [] }) } });
    const s = readSetupState(p);
    expect(s.migrations).toEqual([]);
    expect(s.lastUpdate).toBeUndefined();
  });
});

describe("updateSetupState", () => {
  test("round-trips a patched state through the probe", () => {
    const p = fakeProbes();
    const result = updateSetupState(p, (s) => ({ ...s, marketplaces: ["core"] }));
    expect(result.marketplaces).toEqual(["core"]);
    expect(readSetupState(p).marketplaces).toEqual(["core"]);
  });

  test("sets lastApplyAt when the patch adds it", () => {
    const p = fakeProbes();
    const result = updateSetupState(p, (s) => ({ ...s, lastApplyAt: "2026-08-21T00:00:00.000Z" }));
    expect(result.lastApplyAt).toBe("2026-08-21T00:00:00.000Z");
  });

  test("dedupes arrays via [...new Set]", () => {
    const p = fakeProbes();
    updateSetupState(p, (s) => ({ ...s, plugins: ["a", "b"] }));
    const result = updateSetupState(p, (s) => ({ ...s, plugins: [...s.plugins, "b", "c"] }));
    expect(result.plugins).toEqual(["a", "b", "c"]);
  });

  test("a state file written before forcedLinks existed backfills it to [] instead of undefined", () => {
    const p = fakeProbes({ files: { "/fake-home/.mattstack/rt/setup-state.json": JSON.stringify({ v: 1, marketplaces: [], plugins: [], links: [], extensionEditors: [] }) } });
    expect(readSetupState(p).forcedLinks).toEqual([]);
  });

  test("dedupes forcedLinks the same way as the other arrays", () => {
    const p = fakeProbes();
    updateSetupState(p, (s) => ({ ...s, forcedLinks: ["gh"] }));
    const result = updateSetupState(p, (s) => ({ ...s, forcedLinks: [...s.forcedLinks, "gh", "fast-browser"] }));
    expect(result.forcedLinks).toEqual(["gh", "fast-browser"]);
  });

  test("dedupes migrations and round-trips lastUpdate", () => {
    const p = fakeProbes();
    const result = updateSetupState(p, (s) => ({
      ...s,
      migrations: ["2026-09-30-a", "2026-09-30-a", "2026-10-01-b"],
      lastUpdate: { version: "2.15.0", at: "2026-09-30T00:00:00.000Z" },
    }));
    expect(result.migrations).toEqual(["2026-09-30-a", "2026-10-01-b"]);
    expect(readSetupState(p).lastUpdate).toEqual({ version: "2.15.0", at: "2026-09-30T00:00:00.000Z" });
  });
});
