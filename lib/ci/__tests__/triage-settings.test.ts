import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import { settingsConfig, type TriageConfig } from "../triage-config.ts";

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

  test("an array key set at org and team scope resolves to their union, org first, duplicates dropped", () => {
    const previous = setSettingsNoticeSink(() => {});
    try {
      const seeded = seedOrg({
        org: "acme",
        username: "me",
        roster: [{ username: "me", teams: ["widgets"] }],
        roles: { admins: ["me"], teams: { widgets: { owners: ["me"] } } },
        teams: { widgets: {} },
      });
      const dir = join(home, ".mattstack", "orgs", seeded.org);
      mkdirSync(join(dir, ".git"), { recursive: true });
      writeFileSync(join(dir, ".git", "config"), "");
      setSetting("ci.triage.realPatterns", ["ORG_ONLY", "SHARED"], "org");
      setSetting("ci.triage.realPatterns", ["SHARED", "TEAM_ONLY"], "team", { team: "widgets" });
      const cfg = settingsConfig() as TriageConfig;
      expect(cfg.realPatterns).toEqual(["ORG_ONLY", "SHARED", "TEAM_ONLY"]);
    } finally {
      setSettingsNoticeSink(previous);
    }
  });
});
