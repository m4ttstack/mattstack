import { describe, test, expect } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { isSetupFinished, markSetupFinished, readSetupState, updateSetupState } from "../state.ts";

describe("readSetupState", () => {
  test("defaults to empty arrays when the state file is absent", () => {
    const p = fakeProbes();
    expect(readSetupState(p)).toEqual({ v: 2, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [], migrations: [] });
  });

  test("defaults to empty arrays when the state file is unparseable", () => {
    const p = fakeProbes({ files: { "/fake-home/.mattstack/rt/setup-state.json": "not json" } });
    expect(readSetupState(p)).toEqual({ v: 2, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [], migrations: [] });
  });

  test("backfills migrations to [] for a state file written before the field existed", () => {
    const p = fakeProbes({ files: { "/fake-home/.mattstack/rt/setup-state.json": JSON.stringify({ v: 2, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [] }) } });
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

// mattstack.app opens the wizard until this reads finished, so it must never
// read finished before the wizard's Finish, and an install that finished
// before the field existed must not be sent back through setup.
describe("setup finished", () => {
  const STATE = "/fake-home/.mattstack/rt/setup-state.json";

  test("a fresh Mac is not finished, even after Install runs", () => {
    const p = fakeProbes();
    expect(isSetupFinished(readSetupState(p))).toBe(false);
    updateSetupState(p, (s) => ({ ...s, lastApplyAt: "2026-09-30T00:00:00.000Z" }));
    expect(isSetupFinished(readSetupState(p))).toBe(false);
  });

  test("markSetupFinished records the moment Finish ran", () => {
    const p = fakeProbes({ now: new Date("2026-09-30T12:00:00.000Z") });
    markSetupFinished(p);
    const state = readSetupState(p);
    expect(state.finishedAt).toBe("2026-09-30T12:00:00.000Z");
    expect(isSetupFinished(state)).toBe(true);
  });

  test("a state file from before the field, with an Install behind it, reads finished", () => {
    const p = fakeProbes({ files: { [STATE]: JSON.stringify({ v: 1, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [], lastApplyAt: "2026-09-01T00:00:00.000Z" }) } });
    const state = readSetupState(p);
    expect(state.finishedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(isSetupFinished(state)).toBe(true);
  });

  test("a state file from before the field, with no Install behind it, is not finished", () => {
    const p = fakeProbes({ files: { [STATE]: JSON.stringify({ v: 1, marketplaces: ["core"], plugins: [], links: [], extensionEditors: [], forcedLinks: [] }) } });
    expect(isSetupFinished(readSetupState(p))).toBe(false);
  });

  test("the first write over an old file keeps it finished", () => {
    const p = fakeProbes({ files: { [STATE]: JSON.stringify({ v: 1, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [], lastApplyAt: "2026-09-01T00:00:00.000Z" }) } });
    updateSetupState(p, (s) => ({ ...s, lastApplyAt: "2026-09-30T00:00:00.000Z" }));
    const written = JSON.parse(p.readFile(STATE)!);
    expect(written.v).toBe(2);
    expect(written.finishedAt).toBe("2026-09-01T00:00:00.000Z");
  });
});
