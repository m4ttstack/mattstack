import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { OrgRole } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { ORG_STORE_REL, orgStoreInScope, readStoreAt, roleFromBase, type BaseStore } from "../org-store-scope.ts";

const org = { owners: ["dev0"], admins: ["dev1"], teams: { widgets: { owners: ["dev2"] }, gadgets: { owners: ["dev3"] } } };
const roster = [
  { username: "dev4", name: "Dev Four", teams: ["gadgets"] },
  { username: "dev5", name: "Dev Five", teams: [] },
];
const text = (patch: Record<string, unknown> = {}) => JSON.stringify({ "mattstack.org": org, "mattstack.roster": roster, ...patch });
const withOrg = (patch: Record<string, unknown>) => text({ "mattstack.org": { ...org, ...patch } });
// null: the ref exists but holds no org store; "error": any other failure of the command.
const run = (head: string | null | "error") => (argv: string[]) => {
  if (head === "error") return { code: 128, stdout: "" };
  if (argv.includes("ls-tree")) return { code: 0, stdout: head === null ? "" : `${ORG_STORE_REL}\n` };
  return { code: 0, stdout: head ?? "" };
};

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

const base = (head: string | null | "error"): BaseStore => readStoreAt("/unused", "HEAD", run(head));
/** The commit-time call the daemon makes: base from HEAD, role from it (or the fallback), the working file as the change. */
const inScope = (dirPath: string, username: string, fallback: OrgRole, head: string | null | "error") => {
  const b = base(head);
  return orgStoreInScope(dirPath, b, roleFromBase(b, username, fallback));
};

describe("orgStoreInScope", () => {
  test("a team owner's own-team roster change is in scope", () => {
    write(dev4OnWidgets);
    expect(inScope(dir, "dev2", OWNER, headText)).toBe(true);
  });

  test("a change that reaches another team is out of scope", () => {
    write(dev4OnWidgetsOnly);
    expect(inScope(dir, "dev2", OWNER, headText)).toBe(false);
  });

  test("an admin's change to the owners list is out of scope, an org owner's is in", () => {
    write(withOrg({ owners: ["dev0", "dev1"] }));
    expect(inScope(dir, "dev1", { kind: "admin" }, headText)).toBe(false);
    expect(inScope(dir, "dev0", { kind: "org-owner" }, headText)).toBe(true);
  });

  test("an unchanged org store is in scope", () => {
    write(headText);
    expect(inScope(dir, "dev2", OWNER, headText)).toBe(true);
  });

  test("an unreadable working file is out of scope", () => {
    expect(inScope("/nonexistent", "dev1", { kind: "admin" }, headText)).toBe(false);
  });

  test("a team owner who adds themselves to the admins is judged by the base and stays out of scope", () => {
    write(withOrg({ admins: ["dev1", "dev2"] }));
    expect(inScope(dir, "dev2", { kind: "admin" }, headText)).toBe(false);
  });

  test("an admin who demotes themselves in the working store is still judged as an admin by the base", () => {
    write(withOrg({ admins: [], teams: {} }));
    expect(inScope(dir, "dev1", { kind: "member" }, headText)).toBe(true);
  });

  test("with no org store at the base the fallback role judges the change", () => {
    write(withOrg({ owners: [] }));
    expect(inScope(dir, "dev1", { kind: "admin" }, null)).toBe(true);
    expect(inScope(dir, "dev2", OWNER, null)).toBe(false);
  });

  test("any other failure reading the base fails closed", () => {
    write(headText);
    expect(inScope(dir, "dev1", { kind: "org-owner" }, "error")).toBe(false);
    expect(roleFromBase(base("error"), "dev1", { kind: "org-owner" })).toEqual({ kind: "unknown" });
  });

  test("a push compares the base with the committed file, not the working one", () => {
    write(headText);
    const b = base(headText);
    const committed = withOrg({ admins: ["dev1", "dev2"] });
    expect(orgStoreInScope(dir, b, roleFromBase(b, "dev2", OWNER), "HEAD", run(committed))).toBe(false);
    expect(orgStoreInScope(dir, b, roleFromBase(b, "dev1", OWNER), "HEAD", run(dev4OnWidgets))).toBe(true);
    expect(orgStoreInScope(dir, b, roleFromBase(b, "dev1", OWNER), "HEAD", run("error"))).toBe(false);
  });
});

describe("roleFromBase", () => {
  test("reads the user's role from the base store and falls back without one", () => {
    expect(roleFromBase(base(headText), "dev2", { kind: "member" })).toEqual({ kind: "owner", teams: ["widgets"] });
    expect(roleFromBase(base(null), "dev2", { kind: "member" })).toEqual({ kind: "member" });
  });
});
