import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath } from "../../packages/rt-client/src/settings/paths.ts";
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

  test("an unparseable machine store is refused and left untouched", () => {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    const body = `{ "rt.repoTracking": { "${OLD}": { "mode": "full" } }\n`;
    writeFileSync(machineSettingsPath(), body);
    expect(moveRepoTrackingEntry(OLD, NEW)).toMatchObject({ status: "refused", detail: `unparseable store ${machineSettingsPath()}` });
    expect(readFileSync(machineSettingsPath(), "utf8")).toBe(body);
  });

  test("refused leaves both differing entries in place", () => {
    saveRepoTrackingRaw({ [OLD]: { mode: "full" }, [NEW]: { mode: "off" } });
    expect(moveRepoTrackingEntry(OLD, NEW)).toMatchObject({ status: "refused", detail: "both populated" });
    const raw = loadMachineRepoTrackingRaw();
    expect(raw[OLD]).toEqual({ mode: "full" });
    expect(raw[NEW]).toEqual({ mode: "off" });
  });
});
