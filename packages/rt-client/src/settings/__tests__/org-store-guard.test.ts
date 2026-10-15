import { describe, expect, test } from "bun:test";
import type { OrgRole } from "../org-roles.ts";
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
const OWNER: OrgRole = { kind: "owner", teams: ["widgets"] };

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

describe("roster bypasses", () => {
  const add = (extra: unknown[]) => withRoster([...roster, ...extra]);
  test("an owner may not append junk entries", () => {
    expect(orgStoreChangeRefusal(OWNER, store(), add(["junk", { name: "x" }]))).not.toBeNull();
  });
  test("a member may not append a malformed entry", () => {
    expect(orgStoreChangeRefusal({ kind: "member" }, store(), add([{ username: 7, teams: ["gadgets"] }]))).not.toBeNull();
  });
  test("an owner may not use non-string teams", () => {
    expect(orgStoreChangeRefusal(OWNER, store(), withRoster([{ ...roster[0], teams: ["gadgets", 5, null] }, roster[1]]))).not.toBeNull();
  });
  test("duplicate usernames under sameUser are refused", () => {
    const dup = { ...roster[0], username: "DEV4" };
    const before = withRoster([roster[0], dup, roster[1]]);
    const after = withRoster([roster[0], { ...dup, agePublicKey: "age1x", teams: [] }, roster[1]]);
    expect(orgStoreChangeRefusal(OWNER, before, after)).not.toBeNull();
  });
  test("an owner may not change only a username's case", () => {
    expect(orgStoreChangeRefusal(OWNER, store(), withRoster([{ ...roster[0], username: "DEV4" }, roster[1]]))).not.toBeNull();
  });
  test("an owner may not reorder a member's other teams, which changes the team they start on", () => {
    const before = withRoster([{ ...roster[0], teams: ["gadgets", "tools"] }, roster[1]]);
    expect(orgStoreChangeRefusal(OWNER, before, withRoster([{ ...roster[0], teams: ["tools", "gadgets"] }, roster[1]]))).toMatch(/gadgets/);
  });
  test("an owner may not duplicate a team they do not own", () => {
    expect(orgStoreChangeRefusal(OWNER, store(), withRoster([{ ...roster[0], teams: ["gadgets", "gadgets"] }, roster[1]]))).toMatch(/gadgets/);
  });
  test("an owner may append or remove their own team around other teams", () => {
    const before = withRoster([{ ...roster[0], teams: ["gadgets", "tools"] }, roster[1]]);
    const after = withRoster([{ ...roster[0], teams: ["gadgets", "tools", "widgets"] }, roster[1]]);
    expect(orgStoreChangeRefusal(OWNER, before, after)).toBeNull();
    expect(orgStoreChangeRefusal(OWNER, after, before)).toBeNull();
  });
  describe("the order of a member's teams", () => {
    const change = (owner: string[], from: string[], to: string[]) =>
      orgStoreChangeRefusal({ kind: "owner", teams: owner }, withRoster([{ ...roster[0], teams: from }, roster[1]]), withRoster([{ ...roster[0], teams: to }, roster[1]]));
    test("an owner may not move their own team to the front", () => {
      expect(change(["widgets"], ["gadgets", "widgets"], ["widgets", "gadgets"])).toMatch(/order/);
    });
    test("an owner may append their own team", () => {
      expect(change(["widgets"], ["gadgets"], ["gadgets", "widgets"])).toBeNull();
    });
    test("an owner may remove their own team from the front", () => {
      expect(change(["widgets"], ["widgets", "gadgets"], ["gadgets"])).toBeNull();
    });
    test("an owner may not insert their own team at the front", () => {
      expect(change(["widgets"], ["gadgets"], ["widgets", "gadgets"])).toMatch(/order/);
    });
    test("an owner of two teams may not reorder them among the rest", () => {
      expect(change(["widgets", "tools"], ["widgets", "gadgets", "tools"], ["tools", "widgets", "gadgets"])).toMatch(/order/);
    });
    test("an owner of two teams may remove one and keep the rest in place", () => {
      expect(change(["widgets", "tools"], ["gadgets", "widgets", "tools"], ["gadgets", "tools"])).toBeNull();
    });
    test("an owner may not duplicate their own team", () => {
      expect(change(["widgets"], ["gadgets", "widgets"], ["gadgets", "widgets", "widgets"])).toMatch(/order/);
    });
  });
  test("an owner may reorder entries", () => {
    expect(orgStoreChangeRefusal(OWNER, store(), withRoster([roster[1], roster[0]]))).toBeNull();
  });
  test("the nested spelling works for a valid owner change", () => {
    const nested = (r: unknown) => parseStoreText("org.jsonc", JSON.stringify({ mattstack: { org, roster: r } }));
    expect(orgStoreChangeRefusal(OWNER, nested(roster), nested([{ ...roster[0], teams: ["gadgets", "widgets"] }, roster[1]]))).toBeNull();
  });
});
