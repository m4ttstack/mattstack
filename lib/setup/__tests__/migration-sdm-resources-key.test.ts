import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readStore } from "../../../packages/rt-client/src/settings/stores.ts";
import { seedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { sdmResourcesKeyMigration } from "../migrations/sdm-resources-key.ts";

const ENR = { "acme-db-qa": { label: "Acme QA" } };
const run = () => sdmResourcesKeyMigration.run({} as Partial<ApplyContext> as ApplyContext);
const store = (file: string) => readStore(file).global as Record<string, unknown>;
const roles = { admins: [], teams: { gadgets: { owners: ["me"] }, widgets: { owners: ["someone-else"] } } };
const roster = [{ username: "me", teams: ["gadgets"] }];

describe("2026-10-07-sdm-resources-key", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "sdm-mig-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("is the last migration in the list", () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1]).toBe(sdmResourcesKeyMigration);
  });

  test("moves rt.sdmEnrichment to sdm.resources in a team this Mac owns", async () => {
    const { teamStores } = seedOrg({ username: "me", roles, roster, teams: { gadgets: { "rt.sdmEnrichment": ENR } } });
    const result = await run();
    expect(result.state).toBe("done");
    const after = store(teamStores.gadgets!);
    expect(after["sdm.resources"]).toEqual(ENR);
    expect(after["rt.sdmEnrichment"]).toBeUndefined();
  });

  test("leaves a team this Mac does not own alone", async () => {
    const { teamStores } = seedOrg({ username: "me", roles, roster, teams: { widgets: { "rt.sdmEnrichment": ENR } } });
    const result = await run();
    expect(result.state).toBe("skipped");
    expect(store(teamStores.widgets!)["rt.sdmEnrichment"]).toEqual(ENR);
  });

  test("never overwrites a team that already has sdm.resources", async () => {
    const kept = { "acme-db-qa": { label: "Already moved" } };
    const { teamStores } = seedOrg({ username: "me", roles, roster, teams: { gadgets: { "rt.sdmEnrichment": ENR, "sdm.resources": kept } } });
    const result = await run();
    expect(result.state).toBe("skipped");
    expect(store(teamStores.gadgets!)["sdm.resources"]).toEqual(kept);
    expect(store(teamStores.gadgets!)["rt.sdmEnrichment"]).toEqual(ENR);
  });

  test("moves the value in the org store when this Mac owns it", async () => {
    const { orgStore } = seedOrg({ username: "me", roles: { admins: ["me"], teams: {} }, roster, settings: { "rt.sdmEnrichment": ENR } });
    const result = await run();
    expect(result.state).toBe("done");
    expect(store(orgStore)["sdm.resources"]).toEqual(ENR);
    expect(store(orgStore)["rt.sdmEnrichment"]).toBeUndefined();
  });

  test("no org on this Mac -> skipped", async () => {
    expect((await run()).state).toBe("skipped");
  });
});
