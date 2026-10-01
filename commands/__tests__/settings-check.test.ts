/**
 * `rt settings check` CLI surface: --json envelope and the exit-code contract
 * (failing findings must exit non-zero, a clean audit must not).
 *
 * Bun does not clear a previously-set nonzero process.exitCode when a later
 * assignment is `undefined` (only a number sticks), so priming/restoring with
 * `undefined` would leak a failing exit code into the next test in this file;
 * priming with 0 keeps every run isolated.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { settingsCheck } from "../settings-keys.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { machineSettingsPath } from "../../lib/rt-paths.ts";
import { userSettingsPath } from "../../packages/rt-client/src/settings/paths.ts";
import { renameProperty } from "../../packages/rt-client/src/settings/migrations/helpers.ts";
import { withMigrationAsync } from "../../packages/rt-client/src/settings/__tests__/with-migration.ts";

describe("rt settings check", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cap: ReturnType<typeof captureOut>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-check-cli-")));
    process.env.HOME = home;
    process.exitCode = 0;
    cap = captureOut();
    out.__test__.setHuman(() => false);
  });

  afterEach(() => {
    cap.restore();
    process.env.HOME = origHome;
    process.exitCode = 0;
    rmSync(home, { recursive: true, force: true });
  });

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }

  test("--json reports findings and sets exitCode 1 on a seeded nonconforming store", async () => {
    write(machineSettingsPath(), { "rt.repoRoots": "nope" });

    await settingsCheck(["--json"]);

    const printed = cap.stdout();
    const parsed = JSON.parse(printed as string);
    expect(parsed.ok).toBe(false);
    expect(parsed.findings.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });

  test("human output prints each finding's file and every issue; a merged finding prints no scope or file", async () => {
    write(machineSettingsPath(), { "rt.homeSnapshot": { enabled: "yes", debounceSec: "soon" } });

    await settingsCheck([]);

    const lines = cap.stdout().split("\n");
    const layer = lines.findIndex((l) => l.includes("rt.homeSnapshot") && l.includes("nonconforming"));
    expect(lines[layer]).toContain("machine");
    expect(lines[layer]).toContain(machineSettingsPath());
    expect(lines[layer + 1]).toMatch(/^\s+enabled: expected boolean, got string$/);
    expect(lines[layer + 2]).toMatch(/^\s+debounceSec: expected number, got string$/);

    const merged = lines.findIndex((l) => l.includes("rt.homeSnapshot") && l.includes("merged"));
    expect(lines[merged]).toMatch(/^rt\.homeSnapshot\s+merged$/);
    expect(lines[merged + 1]).toMatch(/^\s+enabled: expected boolean, got string$/);
    expect(lines[merged + 2]).toMatch(/^\s+debounceSec: expected number, got string$/);
    expect(cap.stdout()).toMatch(/\n\[failed\] Some stored settings need fixing  \d+ failing, 0 unregistered, 0 stale or leftover\n$/);
    expect(process.exitCode).toBe(1);
  });

  test("clean stores print one done summary and nothing else", async () => {
    write(machineSettingsPath(), { "rt.repoRoots": ["~/Documents/GitHub"] });
    await settingsCheck([]);
    expect(cap.stdout()).toBe("[ok] Your stored settings check out  0 failing, 0 unregistered, 0 stale or leftover\n");
    expect(process.exitCode).toBe(0);
  });

  test("--json reports no findings and leaves the exit code alone on clean stores", async () => {
    write(machineSettingsPath(), { "rt.repoRoots": ["~/Documents/GitHub"] });

    await settingsCheck(["--json"]);

    const printed = cap.stdout();
    const parsed = JSON.parse(printed as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.findings).toEqual([]);
    expect(process.exitCode).toBe(0);
  });

  const EB = "rt.notify.eventBridges";
  const EB_BUMP = {
    storeVersion: 2,
    migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["[]"], "pattern", "match") }],
    schema: { type: "array", items: { type: "object", properties: { match: { type: "string" } }, required: ["match"] } },
  };

  test("a diverged older name exits 1 and prints both values", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: [{ pattern: "gate/*" }], [`${EB}@2`]: [{ match: "herd/*" }] });
      await settingsCheck([]);
      const text = cap.stdout();
      expect(text).toContain("diverged");
      expect(text).toContain('[{"match":"gate/*"}]');
      expect(text).toContain('[{"match":"herd/*"}]');
      expect(process.exitCode).toBe(1);
    });
  });

  test("--json carries storeName, olderValue and currentValue", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: [{ pattern: "gate/*" }], [`${EB}@2`]: [{ match: "herd/*" }] });
      await settingsCheck(["--json"]);
      const printed = cap.stdout();
      const f = (JSON.parse(printed as string) as { findings: Record<string, unknown>[] }).findings.find((x) => x.kind === "diverged");
      expect(f).toMatchObject({ storeName: EB, olderValue: [{ match: "gate/*" }], currentValue: [{ match: "herd/*" }] });
    });
  });
});
