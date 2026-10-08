import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readStore } from "../../../packages/rt-client/src/settings/stores.ts";
import { seedOrg, type SeedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { sdmResourcesKeyMigration } from "../migrations/sdm-resources-key.ts";
import { createRealProbes } from "../probes.ts";

const ENR = { "acme-db-qa": { label: "Acme QA" } };
const run = () => sdmResourcesKeyMigration.run({ p: { ...createRealProbes(), home: process.env.HOME! } } as Partial<ApplyContext> as ApplyContext);
function seedClone(opts: SeedOrg) {
  const seeded = seedOrg(opts);
  const dir = join(process.env.HOME!, ".mattstack", "orgs", seeded.org);
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), "");
  return seeded;
}
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

  test("a clone still on the one-team layout is skipped with the waiting words, and the key is left alone", async () => {
    const dir = join(home, ".mattstack", "orgs", "acme");
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, ".git", "config"), "");
    mkdirSync(join(dir, "mattstack"), { recursive: true });
    writeFileSync(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: "team", namespace: "widgets", org: "acme" }));
    writeFileSync(join(dir, "mattstack", "settings.team.jsonc"), JSON.stringify({ "rt.sdmEnrichment": ENR }));
    const result = await run();
    expect(result.state).toBe("skipped");
    expect(result.detail).toBe("Your org has not moved to its new layout yet; nothing to move on this Mac");
    expect(JSON.parse(readFileSync(join(dir, "mattstack", "settings.team.jsonc"), "utf8"))["rt.sdmEnrichment"]).toEqual(ENR);
  });

  test("is the last migration in the list", () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1]).toBe(sdmResourcesKeyMigration);
  });

  test("moves rt.sdmEnrichment to sdm.resources in a team this Mac owns", async () => {
    const { teamStores } = seedClone({ username: "me", roles, roster, teams: { gadgets: { "rt.sdmEnrichment": ENR } } });
    const result = await run();
    expect(result.state).toBe("done");
    const after = store(teamStores.gadgets!);
    expect(after["sdm.resources"]).toEqual(ENR);
    expect(after["rt.sdmEnrichment"]).toBeUndefined();
  });

  test("leaves a team this Mac does not own alone", async () => {
    const { teamStores } = seedClone({ username: "me", roles, roster, teams: { widgets: { "rt.sdmEnrichment": ENR } } });
    const result = await run();
    expect(result.state).toBe("skipped");
    expect(store(teamStores.widgets!)["rt.sdmEnrichment"]).toEqual(ENR);
  });

  test("never overwrites a team that already has sdm.resources", async () => {
    const kept = { "acme-db-qa": { label: "Already moved" } };
    const { teamStores } = seedClone({ username: "me", roles, roster, teams: { gadgets: { "rt.sdmEnrichment": ENR, "sdm.resources": kept } } });
    const result = await run();
    expect(result.state).toBe("skipped");
    expect(store(teamStores.gadgets!)["sdm.resources"]).toEqual(kept);
    expect(store(teamStores.gadgets!)["rt.sdmEnrichment"]).toEqual(ENR);
  });

  test("moves the value in the org store when this Mac owns it", async () => {
    const { orgStore } = seedClone({ username: "me", roles: { admins: ["me"], teams: {} }, roster, settings: { "rt.sdmEnrichment": ENR } });
    const result = await run();
    expect(result.state).toBe("done");
    expect(store(orgStore)["sdm.resources"]).toEqual(ENR);
    expect(store(orgStore)["rt.sdmEnrichment"]).toBeUndefined();
  });

  test("no org on this Mac -> skipped", async () => {
    expect((await run()).state).toBe("skipped");
  });
});
