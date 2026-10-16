import { describe, expect, test } from "bun:test";
import type { OrgRoles, RosterEntry } from "../../../packages/rt-client/src/settings/active-team.ts";
import type { ForgeMember } from "../forge-access.ts";
import { accessDiff, diffLines, fingerprintOf, hasChanges, limitSentence, wantedAccess } from "../forge-access-plan.ts";

const roles: OrgRoles = { owners: ["dev0"], admins: ["dev1"], teams: { widgets: { owners: ["dev2"] }, gadgets: { owners: [] } } };
const roster: RosterEntry[] = [
  { username: "dev0", teams: [] },
  { username: "dev1", teams: ["widgets"] },
  { username: "Dev2", teams: ["widgets"] },
  { username: "dev3", teams: ["widgets"] },
  { username: "dev4", teams: [] },
];
const member = (username: string, level: ForgeMember["level"], more: Partial<ForgeMember> = {}): ForgeMember => ({ username, level, inherited: false, pending: false, ...more });

describe("wantedAccess", () => {
  test("org owners, admins and team owners get write and push; members and people on no team get read", () => {
    const wanted = wantedAccess(roles, roster);
    expect(wanted.members).toEqual([
      { username: "dev0", level: "write" },
      { username: "dev1", level: "write" },
      { username: "Dev2", level: "write" },
      { username: "dev3", level: "read" },
      { username: "dev4", level: "read" },
    ]);
    expect(wanted.pushers).toEqual(["dev0", "dev1", "Dev2"]);
  });
  test("a role holder missing from the roster is still wanted, once, whatever the case", () => {
    const wanted = wantedAccess({ ...roles, admins: ["dev1", "DEV9"] }, [...roster, { username: "dev9" }]);
    expect(wanted.members.filter((m) => m.username.toLowerCase() === "dev9")).toEqual([{ username: "dev9", level: "write" }]);
  });
  test("a name that is not a forge username never becomes wanted", () => {
    const wanted = wantedAccess(roles, [...roster, { username: "../x" }, { username: "a b" }, { username: "-x" }, { username: "  " }]);
    expect(wanted.members.map((m) => m.username)).not.toContain("../x");
    expect(wanted.invalid).toEqual(["../x", "a b", "-x"]);
  });
});

describe("accessDiff", () => {
  const wanted = wantedAccess(roles, roster);
  const named = (users: string[]) => ({ kind: "named" as const, users });

  test("raises who lacks their level, and never lowers anyone: a member with write keeps it, forge admins stay", () => {
    const diff = accessDiff(wanted, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "read"), member("dev3", "write"), member("dev4", "admin")], named(["dev0", "dev1", "dev2"]));
    expect(diff.grant).toEqual([{ username: "Dev2", level: "write" }]);
    expect(diff.addPush).toEqual([]);
    expect(diff.removePush).toEqual([]);
    expect(hasChanges(diff)).toBe(true);
    expect(Object.keys(diff).sort()).toEqual(["addPush", "grant", "removePush", "waiting"]);
  });
  test("someone with no access at all, or only guest access, is granted read", () => {
    const diff = accessDiff(wanted, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write"), member("dev3", "guest")], named(["dev0", "dev1", "dev2"]));
    expect(diff.grant).toEqual([{ username: "dev3", level: "read" }, { username: "dev4", level: "read" }]);
  });
  test("write that comes from a group or team, or is held by someone off the roster, is left as it is", () => {
    const diff = accessDiff(wanted, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write"), member("dev3", "write", { inherited: true }), member("dev4", "read"), member("dev7", "write")], named(["dev0", "dev1", "dev2"]));
    expect(diff.grant).toEqual([]);
    expect(hasChanges(diff)).toBe(false);
  });
  test("the push list is the pushers, by name without case, and drops anyone else", () => {
    const diff = accessDiff(wanted, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write"), member("dev3", "read"), member("dev4", "read")], named(["DEV1", "dev7"]));
    expect(diff.addPush).toEqual(["dev0", "Dev2"]);
    expect(diff.removePush).toEqual(["dev7"]);
  });
  test("an unprotected branch needs every pusher; an open or unavailable one has no list to change", () => {
    const members = [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write"), member("dev3", "read"), member("dev4", "read")];
    expect(accessDiff(wanted, members, { kind: "unprotected" }).addPush).toEqual(["dev0", "dev1", "Dev2"]);
    expect(accessDiff(wanted, members, { kind: "open", why: "x" }).addPush).toEqual([]);
    expect(accessDiff(wanted, members, { kind: "unavailable", why: "x" }).addPush).toEqual([]);
  });
  test("an invitation not yet accepted is waiting, never granted again", () => {
    const diff = accessDiff(wanted, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write", { pending: true }), member("dev3", "read"), member("dev4", "read")], named(["dev0", "dev1"]));
    expect(diff.grant).toEqual([]);
    expect(diff.waiting).toEqual(["Dev2"]);
  });
  test("someone who left the roster or lost a role comes off the push list only, and keeps their repo level", () => {
    const short = wantedAccess({ ...roles, teams: { widgets: { owners: [] } } }, roster.filter((e) => e.username !== "dev3"));
    const diff = accessDiff(short, [member("dev0", "admin"), member("dev1", "write"), member("dev2", "write"), member("dev3", "write"), member("dev4", "read")], named(["dev0", "dev1", "dev2", "dev3"]));
    expect(diff.removePush).toEqual(["dev2", "dev3"]);
    expect(diff.grant).toEqual([]);
  });
});

describe("fingerprintOf", () => {
  test("ignores order and case, and moves with a level or the branch", () => {
    const a = wantedAccess(roles, roster);
    const b = wantedAccess(roles, [...roster].reverse().map((e) => ({ ...e, username: e.username.toUpperCase() })));
    expect(fingerprintOf(a, "mattstack")).toBe(fingerprintOf(b, "mattstack"));
    expect(fingerprintOf(a, "mattstack")).not.toBe(fingerprintOf(a, "trial"));
    expect(fingerprintOf(a, "mattstack")).not.toBe(fingerprintOf(wantedAccess({ ...roles, admins: ["dev1", "dev3"] }, roster), "mattstack"));
  });
});

describe("copy", () => {
  test("diffLines names each change in plain words", () => {
    const diff = { grant: [{ username: "dev2", level: "write" as const }], addPush: ["dev2"], removePush: ["dev7"], waiting: [] };
    expect(diffLines(diff, "mattstack")).toEqual(["Give dev2 write access", "Let dev2 push mattstack", "Stop dev7 pushing mattstack"]);
  });
  test("limitSentence says plainly who can push when the forge cannot name people", () => {
    expect(limitSentence({ kind: "named", users: [] }, "mattstack")).toBeNull();
    expect(limitSentence({ kind: "unprotected" }, "mattstack")).toBeNull();
    expect(limitSentence({ kind: "open", why: "The mattstack branch lets every Developer push" }, "mattstack")).toBe(
      "The mattstack branch lets every Developer push. Anyone with write access can push mattstack, and only rt limits what they change there.",
    );
  });
});
