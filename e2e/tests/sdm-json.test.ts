import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { createTestHome, rt } from "../harness.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "sdm-json.json");

function writeFake(home: string, name: string, script: string): string {
  const binDir = join(home, "fakebin");
  mkdirSync(binDir, { recursive: true });
  const path = join(binDir, name);
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

/** The same fake `sdm` the enrichment e2e uses: a status header and a two-row catalog. */
const LOGGED_IN = `#!/bin/bash
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
`;

/** A logged-out CLI: every call fails with the login text interpretSdmStatus reads as not-authenticated. */
const LOGGED_OUT = `#!/bin/bash
echo "You are not authenticated. Please run: sdm login"
exit 1
`;

describe("sdm --json envelopes (read by the sdm skill)", () => {
  const { path: home, cleanup } = createTestHome();
  const loggedIn = writeFake(home, "sdm", LOGGED_IN);
  const loggedOut = writeFake(home, "sdm-logged-out", LOGGED_OUT);
  afterAll(() => cleanup());

  test("status, connections and connect write the bytes they wrote before the output layer", async () => {
    const got: Record<string, { exitCode: number; stdout: string; stderr: string }> = {};
    const run = async (name: string, args: string[], bin: string): Promise<void> => {
      const r = await rt(args, { home, env: { RT_SDM_BIN: bin } });
      // Whether the StrongDM app is running is this machine's business, not the envelope's shape.
      got[name] = { exitCode: r.exitCode, stdout: r.stdout.replace(/"appRunning": (true|false)/, '"appRunning": "<machine>"'), stderr: r.stderr };
    };
    await run("status", ["sdm", "status", "--json"], loggedIn);
    await run("connections", ["sdm", "connections", "--json"], loggedIn);
    await run("connect-no-key", ["sdm", "connect", "--json"], loggedIn);
    await run("connect-unknown-key", ["sdm", "connect", "no-such-key", "--json"], loggedIn);
    await run("status-logged-out", ["sdm", "status", "--json"], loggedOut);
    await run("connections-logged-out", ["sdm", "connections", "--json"], loggedOut);

    if (process.env.RT_UPDATE_SDM_JSON) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(got, null, 2) + "\n");
    }
    expect(got).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
