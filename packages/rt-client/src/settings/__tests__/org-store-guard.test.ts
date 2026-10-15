import { describe, expect, test } from "bun:test";
import { parseStoreText } from "../stores.ts";
import { orgStoreChangeRefusal } from "../org-store-guard.ts";

const org = { owners: ["dev0"], admins: ["dev1"], teams: { widgets: { owners: ["dev2"] }, gadgets: { owners: ["dev3"] } } };
const roster = [
  { username: "dev4", name: "Dev Four", teams: ["gadgets"] },
  { username: "dev5", name: "Dev Five", teams: [] },
];
const store = (patch: Record<string, unknown> = {}) =>
  parseStoreText("org.jsonc", JSON.stringify({ "mattstack.org": org, "mattstack.roster": roster, "board.tabs": ["a"], ...patch }));
const withRoster = (r: unknown) => store({ "mattstack.roster": r });
const OWNER = { kind: "owner", teams: ["widgets"] } as const;

describe("a team owner", () => {
  test("may add an existing member to their own team", () => {
    expect(orgStoreChangeRefusal(OWNER, store(), withRoster([{ ...roster[0], teams: ["gadgets", "widgets"] }, roster[1]]))).toBeNull();
  });
  test("may take a member off their own team", () => {
    const before = withRoster([{ ...roster[0], teams: ["gadgets", "widgets"] }, roster[1]]);
    expect(orgStoreChangeRefusal(OWNER, before, store())).toBeNull();
  });
  test("may not touch another team's membership, even alongside their own", () => {
    expect(orgStoreChangeRefusal(OWNER, store(), withRoster([{ ...roster[0], teams: ["widgets"] }, roster[1]]))).toMatch(/gadgets/);
  });
  test("may not rename a member, add or remove an entry, or change a key", () => {
    expect(orgStoreChangeRefusal(OWNER, store(), withRoster([{ ...roster[0], name: "X" }, roster[1]]))).not.toBeNull();
    expect(orgStoreChangeRefusal(OWNER, store(), withRoster([roster[0]]))).not.toBeNull();
    expect(orgStoreChangeRefusal(OWNER, store(), withRoster([...roster, { username: "dev6", teams: ["widgets"] }]))).not.toBeNull();
    expect(orgStoreChangeRefusal(OWNER, store(), withRoster([{ ...roster[0], agePublicKey: "age1x" }, roster[1]]))).not.toBeNull();
  });
  test("may not change anything else in the same write", () => {
    const after = store({ "mattstack.roster": [{ ...roster[0], teams: ["gadgets", "widgets"] }, roster[1]], "board.tabs": ["b"] });
    expect(orgStoreChangeRefusal(OWNER, store(), after)).not.toBeNull();
  });
  test("matches entries without case", () => {
    const before = withRoster([{ ...roster[0], username: "Dev4" }, roster[1]]);
    const after = withRoster([{ ...roster[0], username: "Dev4", teams: ["gadgets", "widgets"] }, roster[1]]);
    expect(orgStoreChangeRefusal(OWNER, before, after)).toBeNull();
  });
  test("an unchanged store is always fine", () => {
    expect(orgStoreChangeRefusal(OWNER, store(), store())).toBeNull();
  });
});

describe("admins and org owners", () => {
  const owners = (list: string[]) => store({ "mattstack.org": { ...org, owners: list } });
  test("an admin may change anything but the owners list", () => {
    expect(orgStoreChangeRefusal({ kind: "admin" }, store(), store({ "board.tabs": ["b"] }))).toBeNull();
    expect(orgStoreChangeRefusal({ kind: "admin" }, store(), owners(["dev0", "dev1"]))).toMatch(/owner/);
  });
  test("an org owner may change the owners list", () => {
    expect(orgStoreChangeRefusal({ kind: "org-owner" }, store(), owners(["dev0", "dev1"]))).toBeNull();
  });
});

describe("members and unknown", () => {
  test("may change nothing", () => {
    expect(orgStoreChangeRefusal({ kind: "member" }, store(), store({ "board.tabs": ["b"] }))).not.toBeNull();
    expect(orgStoreChangeRefusal({ kind: "unknown" }, store(), withRoster([]))).not.toBeNull();
  });
});
