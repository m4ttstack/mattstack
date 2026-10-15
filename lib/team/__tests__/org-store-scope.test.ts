import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { OrgRole } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { ORG_STORE_REL, orgStoreInScope, roleAtHead } from "../org-store-scope.ts";

const org = { owners: ["dev0"], admins: ["dev1"], teams: { widgets: { owners: ["dev2"] }, gadgets: { owners: ["dev3"] } } };
const roster = [
  { username: "dev4", name: "Dev Four", teams: ["gadgets"] },
  { username: "dev5", name: "Dev Five", teams: [] },
];
const text = (patch: Record<string, unknown> = {}) => JSON.stringify({ "mattstack.org": org, "mattstack.roster": roster, ...patch });
const withOrg = (patch: Record<string, unknown>) => text({ "mattstack.org": { ...org, ...patch } });
const run = (head: string | null) => (argv: string[]) => (argv.includes("show") && head !== null ? { code: 0, stdout: head } : { code: 1, stdout: "" });

const OWNER: OrgRole = { kind: "owner", teams: ["widgets"] };
const headText = text();
const dev4OnWidgets = text({ "mattstack.roster": [{ ...roster[0], teams: ["gadgets", "widgets"] }, roster[1]] });
const dev4OnWidgetsOnly = text({ "mattstack.roster": [{ ...roster[0], teams: ["widgets"] }, roster[1]] });

let dir: string;
const write = (body: string) => {
  const file = join(dir, ORG_STORE_REL);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
};

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-org-store-scope-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("orgStoreInScope", () => {
  test("a team owner's own-team roster change is in scope", () => {
    write(dev4OnWidgets);
    expect(orgStoreInScope(dir, "dev2", OWNER, run(headText))).toBe(true);
  });

  test("a change that reaches another team is out of scope", () => {
    write(dev4OnWidgetsOnly);
    expect(orgStoreInScope(dir, "dev2", OWNER, run(headText))).toBe(false);
  });

  test("an admin's change to the owners list is out of scope, an org owner's is in", () => {
    write(withOrg({ owners: ["dev0", "dev1"] }));
    expect(orgStoreInScope(dir, "dev1", { kind: "admin" }, run(headText))).toBe(false);
    expect(orgStoreInScope(dir, "dev0", { kind: "org-owner" }, run(headText))).toBe(true);
  });

  test("an unchanged org store is in scope", () => {
    write(headText);
    expect(orgStoreInScope(dir, "dev2", OWNER, run(headText))).toBe(true);
  });

  test("an unreadable working file is out of scope", () => {
    expect(orgStoreInScope("/nonexistent", "dev1", { kind: "admin" }, run(headText))).toBe(false);
  });

  test("a team owner who adds themselves to the admins is judged by HEAD and stays out of scope", () => {
    write(withOrg({ admins: ["dev1", "dev2"] }));
    expect(orgStoreInScope(dir, "dev2", { kind: "admin" }, run(headText))).toBe(false);
  });

  test("an admin who demotes themselves in the working store is still judged as an admin by HEAD", () => {
    write(withOrg({ admins: [], teams: {} }));
    expect(orgStoreInScope(dir, "dev1", { kind: "member" }, run(headText))).toBe(true);
  });

  test("with no org store at HEAD the role passed in judges the change", () => {
    write(withOrg({ owners: [] }));
    expect(orgStoreInScope(dir, "dev1", { kind: "admin" }, run(null))).toBe(true);
    expect(orgStoreInScope(dir, "dev2", OWNER, run(null))).toBe(false);
  });
});

describe("roleAtHead", () => {
  test("reads the user's role from HEAD's org store and falls back without one", () => {
    expect(roleAtHead(dir, "dev2", { kind: "member" }, run(headText))).toEqual({ kind: "owner", teams: ["widgets"] });
    expect(roleAtHead(dir, "dev2", { kind: "member" }, run(null))).toEqual({ kind: "member" });
  });
});
