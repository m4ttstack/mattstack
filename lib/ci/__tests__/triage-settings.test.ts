import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getSetting } from "../../settings/resolve.ts";

describe("ci.triage settings", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-ci-triage-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("ci.triage keys are declared with their defaults", () => {
    expect(() => getSetting("ci.triage.baseDepth")).not.toThrow();
    expect(getSetting<string[]>("ci.triage.realPatterns").value).toEqual([]);
    expect(getSetting<string[]>("ci.triage.infraPatterns").value).toEqual([]);
    expect(getSetting<string[]>("ci.triage.noisyJobs").value).toEqual([]);
    expect(getSetting<number>("ci.triage.baseDepth").value).toBe(3);
    expect(getSetting<string>("ci.triage.baseRef").value).toBeUndefined();
    expect(getSetting<boolean>("ci.triage.skipBase").value).toBe(false);
  });
});
