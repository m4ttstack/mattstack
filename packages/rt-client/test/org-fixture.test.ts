import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { seedOrg } from "./org-fixture.ts";

let home: string;
const savedHome = process.env.HOME;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-org-fixture-")));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

test("seedOrg refuses to seed an org into the account's real home, before writing anything", () => {
  expect(() => seedOrg({ org: "acme", settings: { "board.title": "x" }, account: home })).toThrow(/refusing to write/);
  expect(existsSync(join(home, ".mattstack"))).toBe(false);
});

test("seedOrg seeds a scratch HOME", () => {
  const { orgStore } = seedOrg({ org: "acme", settings: { "board.title": "x" } });
  expect(existsSync(orgStore)).toBe(true);
});
