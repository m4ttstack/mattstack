import { describe, test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, chmodSync } from "fs";
import { dirname, join } from "path";
import { createTestHome, rt } from "../harness.ts";

/**
 * Fake `sdm` CLI: enough of `status` and `access catalog` output for the
 * direct catalog scanner (lib/sdm/scan.ts) to discover two postgres
 * resources without a real StrongDM org. RT_SDM_BIN is spawned directly
 * (see lib/sdm/core.ts sdmBin()), so no PATH plumbing is needed.
 */
function writeFakeSdm(home: string): string {
  const binDir = join(home, "fakebin");
  mkdirSync(binDir, { recursive: true });
  const fakeSdm = join(binDir, "sdm");
  writeFileSync(
    fakeSdm,
    `#!/bin/bash
if [ "$1" = "status" ]; then
  echo "DATASOURCE             STATUS       ADDRESS"
  exit 0
fi
if [ "$1" = "access" ] && [ "$2" = "catalog" ]; then
  echo "rs-abc123def0  acme-alpha-staging  cluster-x  postgres  env=staging"
  echo "rs-def456abc1  acme-beta-qa-prod  cluster-y  postgres  env=prod"
  exit 0
fi
exit 0
`,
  );
  chmodSync(fakeSdm, 0o755);
  return fakeSdm;
}

describe("sdm enrichment", () => {
  const { path: home, cleanup } = createTestHome();
  const fakeSdm = writeFakeSdm(home);
  const enrichmentPath = join(home, ".mattstack", "rt", "sdm", "enrichment.jsonc");
  afterAll(() => cleanup());

  test("the count says how many connections have labels, with no file path", async () => {
    const res = await rt(["sdm", "enrichment"], { home, env: { RT_SDM_BIN: fakeSdm } });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Labels on 0 of 2 connections");
    expect(res.stdout).not.toContain("enrichment.jsonc");
  });

  test("an old labels file is not read, and rt says how to move it", async () => {
    mkdirSync(dirname(enrichmentPath), { recursive: true });
    writeFileSync(enrichmentPath, '{ "acme-alpha-staging": { "label": "Alpha" } }');
    const res = await rt(["sdm", "enrichment"], { home, env: { RT_SDM_BIN: fakeSdm } });
    expect(res.stdout).toContain("Labels on 0 of 2 connections");
    expect(res.stderr).toContain("Your old StrongDM labels file is no longer read");
    expect(res.stderr).toContain(`rt settings set sdm.resources '{"acme-alpha-staging":{"label":"Alpha"}}' --scope team`);
  });
});
