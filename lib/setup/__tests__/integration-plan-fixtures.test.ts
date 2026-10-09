/**
 * The tray decodes `lib/setup/fixtures/integration-plans.json` as the plan rt
 * sends for each harness profile, so what the tray asserts about it has to be
 * what rt composes. UPDATE_INTEGRATION_PLANS=1 rewrites the file from rt.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { closeStateDb } from "../../state/index.ts";
import type { Plan } from "../contract.ts";
import { PROFILES, composeProfile, composeProfiles, trayView } from "./integration-plan-profiles.ts";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "integration-plans.json");
const REGENERATE = "UPDATE_INTEGRATION_PLANS=1 bun test lib/setup/__tests__/integration-plan-fixtures.test.ts";

describe("the tray's harness-profile plan fixtures", () => {
  const origCi = process.env.CI;
  let fixture: Record<string, Plan>;
  beforeAll(async () => {
    delete process.env.CI;
    closeStateDb();
    if (process.env.UPDATE_INTEGRATION_PLANS === "1") {
      writeFileSync(FIXTURE, JSON.stringify(await composeProfiles(), null, 2) + "\n");
    }
    fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, Plan>;
  });
  afterAll(() => {
    if (origCi === undefined) delete process.env.CI;
    else process.env.CI = origCi;
    closeStateDb();
  });

  test("the fixture holds exactly the supported profiles", () => {
    expect(Object.keys(fixture)).toEqual([...PROFILES]);
  });

  for (const profile of PROFILES) {
    test(`${profile}: what the tray asserts matches the plan rt composes`, async () => {
      const composed = trayView(JSON.parse(JSON.stringify(await composeProfile(profile))) as Plan);
      try {
        expect(composed).toEqual(trayView(fixture[profile]!));
      } catch (err) {
        throw new Error(`lib/setup/fixtures/integration-plans.json is out of date for ${profile}. Regenerate it: ${REGENERATE}\n${(err as Error).message}`);
      }
    });
  }

  test("at least one profile is installable, so canInstall is a real signal", () => {
    expect(PROFILES.some((p) => fixture[p]!.canInstall)).toBe(true);
  });
});
