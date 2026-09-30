import { describe, test, expect } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { readFileSync } from "fs";
import { join } from "path";
import { isSetupFinished, markSetupFinished, parseSetupState, readSetupState, updateSetupState } from "../state.ts";

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

  test("a daemon installed from the terminal before the app, with no setup files, reads finished and stays so", () => {
    const p = fakeProbes({ files: { "/fake-home/.mattstack/rt/daemon.json": "{}" }, now: new Date("2026-09-30T12:00:00.000Z") });
    expect(isSetupFinished(readSetupState(p))).toBe(true);
    updateSetupState(p, (s) => ({ ...s, links: ["gh"] }));
    expect(JSON.parse(p.readFile(STATE)!).finishedAt).toBe("2026-09-30T12:00:00.000Z");
  });

  test("a daemon mid-setup, with the team choice on disk, is not finished", () => {
    const p = fakeProbes({ files: { "/fake-home/.mattstack/rt/daemon.json": "{}", "/fake-home/.mattstack/rt/setup-intent.json": "{}" } });
    expect(isSetupFinished(readSetupState(p))).toBe(false);
  });

  test("a v2 file never falls back to the daemon rule", () => {
    const p = fakeProbes({ files: { "/fake-home/.mattstack/rt/daemon.json": "{}", [STATE]: JSON.stringify({ v: 2, lastApplyAt: "2026-09-30T00:00:00.000Z" }) } });
    expect(isSetupFinished(readSetupState(p))).toBe(false);
  });

  test("a state file that is not an object reads as empty", () => {
    for (const raw of ["null", "[]", "42", '"x"']) {
      const p = fakeProbes({ files: { [STATE]: raw } });
      expect(readSetupState(p)).toEqual({ v: 2, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [], migrations: [] });
    }
  });

  test("writes land through a temp file and a rename, so a crash never leaves half a file", () => {
    const p = fakeProbes();
    updateSetupState(p, (s) => ({ ...s, links: ["gh"] }));
    expect(p.calls.renames).toHaveLength(1);
    expect(p.calls.renames[0]![1]).toBe(STATE);
    expect(p.exists(p.calls.renames[0]![0])).toBe(false);
    expect(JSON.parse(p.readFile(STATE)!).links).toEqual(["gh"]);
  });

  // Shared with rt-tray's SetupCompletion check, which reads the same file.
  test("agrees with the shared fixture mattstack.app is checked against", () => {
    const cases = JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "setup-finished.json"), "utf8")) as {
      why: string;
      state: string | null;
      daemonInstalled: boolean;
      intent: boolean;
      finished: boolean;
    }[];
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const k of cases) {
      const state = parseSetupState(k.state, { daemonInstalled: k.daemonInstalled, intentExists: k.intent, now: () => new Date("2026-09-30T12:00:00.000Z") });
      expect({ why: k.why, finished: isSetupFinished(state) }).toEqual({ why: k.why, finished: k.finished });
    }
  });
});
