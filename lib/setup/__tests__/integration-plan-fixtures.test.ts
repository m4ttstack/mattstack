/**
 * The tray decodes `lib/setup/fixtures/integration-plans.json` as the plan rt
 * sends for each harness profile, so the file has to be what rt composes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { closeStateDb } from "../../state/index.ts";
import { PROFILES, composeProfile } from "./integration-plan-profiles.ts";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "integration-plans.json");

describe("the tray's harness-profile plan fixtures", () => {
  const origCi = process.env.CI;
  beforeAll(() => {
    delete process.env.CI;
    closeStateDb();
  });
  afterAll(() => {
    if (origCi === undefined) delete process.env.CI;
    else process.env.CI = origCi;
    closeStateDb();
  });

  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;

  test("the fixture holds exactly the supported profiles", () => {
    expect(Object.keys(fixture)).toEqual([...PROFILES]);
  });

  for (const profile of PROFILES) {
    test(`${profile}: the fixture is the plan rt composes`, async () => {
      expect(JSON.parse(JSON.stringify(await composeProfile(profile)))).toEqual(fixture[profile] as object);
    });
  }
});
