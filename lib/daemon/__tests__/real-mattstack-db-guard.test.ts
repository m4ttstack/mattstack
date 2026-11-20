/**
 * A test run never opens a database under the account's real ~/.mattstack.
 * Every case names a scratch dir as the account home, so a guard that
 * regresses reaches that dir and never the real files.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import { __test__ as isolation } from "../../../packages/rt-client/src/test-isolation.ts";
import { createRunDb, openRunDb } from "../../runs/write.ts";
import { createBgClaimsStore } from "../bg-claims-store.ts";
import { createEventsBus } from "../events-bus.ts";
import { createGatesStore } from "../gates-store.ts";
import { createHerdStore } from "../herd-store.ts";

const log = pino({ level: "silent" });
let account: string;

beforeEach(() => {
  account = realpathSync(mkdtempSync(join(tmpdir(), "rt-real-mattstack-guard-")));
  isolation.setAccountHome(account);
});

afterEach(() => {
  isolation.setAccountHome(undefined);
  rmSync(account, { recursive: true, force: true });
});

const real = (...parts: string[]) => join(account, ".mattstack", ...parts);

test.each([
  ["herds.db", () => createHerdStore({ dbPath: real("rt", "herds.db"), log })],
  ["gates.db", () => createGatesStore({ dbPath: real("rt", "gates.db"), log })],
  ["events.db", () => createEventsBus({ dbPath: real("rt", "events.db"), log })],
  ["bg-claims.db", () => createBgClaimsStore({ dbPath: real("rt", "bg-claims.db"), log })],
  ["a new run db", () => createRunDb(real("runs", "repo", "20261120-1", "run.db"))],
  ["an existing run db", () => openRunDb(real("runs", "repo", "20261120-1", "run.db"))],
])("opening %s under the real ~/.mattstack is refused and creates nothing", (_name, open) => {
  expect(open).toThrow(/refusing to write/);
  expect(existsSync(real())).toBe(false);
});
