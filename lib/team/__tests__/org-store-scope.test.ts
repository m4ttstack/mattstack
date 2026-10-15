import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { OrgRole } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { ORG_STORE_REL, orgStoreInScope, readStoreAt, roleFromBase, storeReader, type BaseStore } from "../org-store-scope.ts";

const org = { owners: ["dev0"], admins: ["dev1"], teams: { widgets: { owners: ["dev2"] }, gadgets: { owners: ["dev3"] } } };
const roster = [
  { username: "dev4", name: "Dev Four", teams: ["gadgets"] },
  { username: "dev5", name: "Dev Five", teams: [] },
];
const text = (patch: Record<string, unknown> = {}) => JSON.stringify({ "mattstack.org": org, "mattstack.roster": roster, ...patch });
const withOrg = (patch: Record<string, unknown>) => text({ "mattstack.org": { ...org, ...patch } });
// null: the ref exists but holds no org store; "error": any other failure of the command.
const run = (head: string | null | "error") => async (argv: string[]) => {
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

const scoped = async (...args: Parameters<typeof orgStoreInScope>) => (await orgStoreInScope(...args)) === "in-scope";
const base = (head: string | null | "error"): Promise<BaseStore> => readStoreAt("/unused", "HEAD", run(head));
/** The commit-time call the daemon makes: base from HEAD, role from it (or the fallback), the working file as the change. */
const inScope = async (dirPath: string, username: string, fallback: OrgRole, head: string | null | "error") => {
  const b = await base(head);
  return scoped(dirPath, b, roleFromBase(b, username, fallback));
};

describe("orgStoreInScope", () => {
  test("a team owner's own-team roster change is in scope", async () => {
    write(dev4OnWidgets);
    expect(await inScope(dir, "dev2", OWNER, headText)).toBe(true);
  });

  test("a change that reaches another team is out of scope", async () => {
    write(dev4OnWidgetsOnly);
    expect(await inScope(dir, "dev2", OWNER, headText)).toBe(false);
  });

  test("an admin's change to the owners list is out of scope, an org owner's is in", async () => {
    write(withOrg({ owners: ["dev0", "dev1"] }));
    expect(await inScope(dir, "dev1", { kind: "admin" }, headText)).toBe(false);
    expect(await inScope(dir, "dev0", { kind: "org-owner" }, headText)).toBe(true);
  });

  test("an unchanged org store is in scope", async () => {
    write(headText);
    expect(await inScope(dir, "dev2", OWNER, headText)).toBe(true);
  });

  test("an unreadable working file is out of scope", async () => {
    expect(await inScope("/nonexistent", "dev1", { kind: "admin" }, headText)).toBe(false);
  });

  test("a team owner who adds themselves to the admins is judged by the base and stays out of scope", async () => {
    write(withOrg({ admins: ["dev1", "dev2"] }));
    expect(await inScope(dir, "dev2", { kind: "admin" }, headText)).toBe(false);
  });

  test("an admin who demotes themselves in the working store is still judged as an admin by the base", async () => {
    write(withOrg({ admins: [], teams: {} }));
    expect(await inScope(dir, "dev1", { kind: "member" }, headText)).toBe(true);
  });

  test("with no org store at the base the fallback role judges the change", async () => {
    write(withOrg({ owners: [] }));
    expect(await inScope(dir, "dev1", { kind: "admin" }, null)).toBe(true);
    expect(await inScope(dir, "dev2", OWNER, null)).toBe(false);
  });

  test("any other failure reading the base fails closed", async () => {
    write(headText);
    expect(await inScope(dir, "dev1", { kind: "org-owner" }, "error")).toBe(false);
    expect(roleFromBase(await base("error"), "dev1", { kind: "org-owner" })).toEqual({ kind: "unknown" });
  });

  test("a malformed base is unreadable, never an unclaimed org", async () => {
    write(withOrg({ admins: ["dev1", "dev2"] }));
    expect(roleFromBase(await base("{ not json"), "dev2", { kind: "admin" })).toEqual({ kind: "unknown" });
    expect(await scoped(dir, await base("{ not json"), { kind: "org-owner" })).toBe(false);
  });

  test("a malformed pending org store is out of scope, not read as everything deleted", async () => {
    write("{ not json");
    expect(await inScope(dir, "dev0", { kind: "member" }, headText)).toBe(false);
    const b = await base(headText);
    expect(await scoped(dir, b, { kind: "org-owner" }, "HEAD", run("{ not json"))).toBe(false);
  });

  test("a push compares the base with the committed file, not the working one", async () => {
    write(headText);
    const b = await base(headText);
    const committed = withOrg({ admins: ["dev1", "dev2"] });
    expect(await scoped(dir, b, roleFromBase(b, "dev2", OWNER), "HEAD", run(committed))).toBe(false);
    expect(await scoped(dir, b, roleFromBase(b, "dev1", OWNER), "HEAD", run(dev4OnWidgets))).toBe(true);
    expect(await scoped(dir, b, roleFromBase(b, "dev1", OWNER), "HEAD", run("error"))).toBe(false);
  });
});

describe("orgStoreInScope with a malformed roles block in the pending store", () => {
  test("is refused for an org owner, in the working file and in a committed one", async () => {
    const b = await base(headText);
    const malformed = withOrg({ admins: "dev1" });
    write(malformed);
    expect(await orgStoreInScope(dir, b, { kind: "org-owner" })).toBe("refused");
    expect(await orgStoreInScope(dir, b, { kind: "org-owner" }, "HEAD", run(withOrg({ owners: [1] })))).toBe("refused");
  });
});

describe("orgStoreInScope tells a failed read from a refused change", () => {
  test("a base or committed store that cannot be read is unreadable", async () => {
    write(headText);
    expect(await orgStoreInScope(dir, await base("error"), { kind: "org-owner" })).toBe("unreadable");
    const b = await base(headText);
    expect(await orgStoreInScope(dir, b, OWNER, "HEAD", run("error"))).toBe("unreadable");
    expect(await orgStoreInScope(dir, b, OWNER, "HEAD", async (argv) => (argv.includes("show") ? { code: 128, stdout: "" } : { code: 0, stdout: `${ORG_STORE_REL}\n` }))).toBe("unreadable");
  });

  test("a store that was read and whose change is not allowed is refused", async () => {
    const b = await base(headText);
    expect(await orgStoreInScope(dir, b, roleFromBase(b, "dev2", OWNER), "HEAD", run(withOrg({ admins: ["dev1", "dev2"] })))).toBe("refused");
    expect(await orgStoreInScope(dir, b, OWNER, "HEAD", run("{ not json"))).toBe("refused");
    expect(await orgStoreInScope(dir, b, roleFromBase(b, "dev1", OWNER), "HEAD", run(dev4OnWidgets))).toBe("in-scope");
  });
});

describe("storeReader", () => {
  const counting = (sha: { value: string }) => {
    const calls: string[] = [];
    const inner = run(headText);
    const fn = async (argv: string[]) => {
      calls.push(argv[3]!);
      return argv.includes("rev-parse") ? { code: 0, stdout: `${sha.value}\n` } : inner(argv);
    };
    return { fn, calls };
  };

  test("reads the store once per commit the ref names", async () => {
    const sha = { value: "a".repeat(40) };
    const { fn, calls } = counting(sha);
    const read = storeReader("/unused", fn);
    expect(await read("HEAD")).toEqual({ state: "text", text: headText });
    expect(await read("HEAD")).toEqual({ state: "text", text: headText });
    expect(calls).toEqual(["rev-parse", "ls-tree", "show", "rev-parse"]);
    sha.value = "b".repeat(40);
    await read("HEAD");
    expect(calls.slice(4)).toEqual(["rev-parse", "ls-tree", "show"]);
  });

  test("a ref that does not resolve is unreadable, and a failed read is not remembered", async () => {
    expect(await storeReader("/unused", run("error"))("HEAD")).toEqual({ state: "unreadable" });
    let fail = true;
    const calls: string[] = [];
    const read = storeReader("/unused", async (argv) => {
      calls.push(argv[3]!);
      if (argv.includes("rev-parse")) return { code: 0, stdout: "c".repeat(40) };
      return fail ? { code: 128, stdout: "" } : run(headText)(argv);
    });
    expect(await read("HEAD")).toEqual({ state: "unreadable" });
    fail = false;
    expect(await read("HEAD")).toEqual({ state: "text", text: headText });
    expect(calls).toEqual(["rev-parse", "ls-tree", "rev-parse", "ls-tree", "show"]);
  });
});

describe("roleFromBase with a malformed roles block", () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["admins as a string", { admins: "dev1", teams: {} }],
    ["owners as a number", { admins: [], owners: 7, teams: {} }],
    ["admins holding a non-string", { admins: ["dev1", 3], teams: {} }],
    ["teams as an array", { admins: [], teams: [] }],
  ];
  for (const [name, block] of bad) {
    test(`${name} is unknown, so a self-claim is out of scope`, async () => {
      const head = JSON.stringify({ "mattstack.org": block });
      expect(roleFromBase(await base(head), "dev1", { kind: "admin" })).toEqual({ kind: "unknown" });
      write(JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: {} } }));
      expect(await inScope(dir, "dev1", { kind: "admin" }, head)).toBe(false);
    });
  }

  test("a well-formed unclaimed base still lets the creator claim", async () => {
    const head = JSON.stringify({ "mattstack.org": { admins: [], owners: [], teams: {} } });
    write(JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: {} } }));
    expect(await inScope(dir, "dev1", { kind: "admin" }, head)).toBe(true);
  });
});

describe("roleFromBase", () => {
  test("reads the user's role from the base store and falls back without one", async () => {
    expect(roleFromBase(await base(headText), "dev2", { kind: "member" })).toEqual({ kind: "owner", teams: ["widgets"] });
    expect(roleFromBase(await base(null), "dev2", { kind: "member" })).toEqual({ kind: "member" });
  });

  test("an unclaimed base (no admins, no owners) falls back; a claimed base does not", async () => {
    const unclaimed = JSON.stringify({ "mattstack.org": { admins: [], teams: {} } });
    expect(roleFromBase(await base(unclaimed), "dev1", { kind: "admin" })).toEqual({ kind: "admin" });
    expect(roleFromBase(await base(headText), "dev2", { kind: "admin" })).toEqual({ kind: "owner", teams: ["widgets"] });
  });

  test("the creator's claim of an unclaimed org is in scope, a self-grant on a claimed org is not", async () => {
    write(JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: {} } }));
    expect(await inScope(dir, "dev1", { kind: "admin" }, JSON.stringify({ "mattstack.org": { admins: [], teams: {} } }))).toBe(true);
    write(withOrg({ admins: ["dev1", "dev2"] }));
    expect(await inScope(dir, "dev2", { kind: "admin" }, headText)).toBe(false);
  });
});
