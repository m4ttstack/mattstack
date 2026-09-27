import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../state/index.ts";
import { loadMachineRepoTrackingRaw, moveRepoTrackingEntry, saveRepoTrackingRaw } from "../repo-tracking.ts";

const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

describe("moveRepoTrackingEntry", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-tracking-move-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("moves the entry and re-reads it under the new key", () => {
    saveRepoTrackingRaw({ [OLD]: { mode: "full" }, other: { mode: "off" } });
    expect(moveRepoTrackingEntry(OLD, NEW)).toMatchObject({ store: "rt.repoTracking", status: "moved", count: 1 });
    const raw = loadMachineRepoTrackingRaw();
    expect(raw[NEW]).toEqual({ mode: "full" });
    expect(raw[OLD]).toBeUndefined();
    expect(raw.other).toEqual({ mode: "off" });
  });

  test("already, none and refused", () => {
    saveRepoTrackingRaw({ [NEW]: { mode: "full" } });
    expect(moveRepoTrackingEntry(OLD, NEW).status).toBe("already");
    saveRepoTrackingRaw({});
    expect(moveRepoTrackingEntry(OLD, NEW).status).toBe("none");
    saveRepoTrackingRaw({ [OLD]: { mode: "full" }, [NEW]: { mode: "off" } });
    expect(moveRepoTrackingEntry(OLD, NEW).status).toBe("refused");
    expect(loadMachineRepoTrackingRaw()[OLD]).toEqual({ mode: "full" });
  });

  test("finishes an interrupted move when both entries are equal", () => {
    saveRepoTrackingRaw({ [OLD]: { mode: "full", caches: ["mrs"] }, [NEW]: { mode: "full", caches: ["mrs"] } });
    expect(moveRepoTrackingEntry(OLD, NEW, { dryRun: true }).status).toBe("moved");
    expect(loadMachineRepoTrackingRaw()[OLD]).toEqual({ mode: "full", caches: ["mrs"] });
    expect(moveRepoTrackingEntry(OLD, NEW)).toMatchObject({ status: "moved", count: 1 });
    const raw = loadMachineRepoTrackingRaw();
    expect(raw[OLD]).toBeUndefined();
    expect(raw[NEW]).toEqual({ mode: "full", caches: ["mrs"] });
  });

  test("refused leaves both differing entries in place", () => {
    saveRepoTrackingRaw({ [OLD]: { mode: "full" }, [NEW]: { mode: "off" } });
    expect(moveRepoTrackingEntry(OLD, NEW)).toMatchObject({ status: "refused", detail: "both populated" });
    const raw = loadMachineRepoTrackingRaw();
    expect(raw[OLD]).toEqual({ mode: "full" });
    expect(raw[NEW]).toEqual({ mode: "off" });
  });
});
