import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { UserActionableError } from "../../errors.ts";
import { orgStoreFile } from "../org-store.ts";
import { assertMayWrite, roleFor, rolesFor } from "../roles.ts";
import { teamLocalPath } from "../team-local.ts";

const HOME = "/fake-home";
const ORG_STORE = orgStoreFile(HOME, "acme");
const roles = { "mattstack.org": { admins: ["Dev1"], teams: { widgets: { owners: ["dev2"] } } } };

function probes(username: string | null, orgStore: string | null = `// org\n${JSON.stringify(roles)}`) {
  return fakeProbes({
    home: HOME,
    files: {
      ...(orgStore === null ? {} : { [ORG_STORE]: orgStore }),
      ...(username ? { [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: username }) } : {}),
    },
  });
}

describe("orgStoreFile", () => {
  test("is the org clone's settings file under the given home", () => {
    expect(ORG_STORE).toBe("/fake-home/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc");
  });
});

describe("roleFor", () => {
  test("reads the stored username and the org's roles through probes", () => {
    expect(roleFor(probes("dev1"), "acme")).toEqual({ kind: "admin" });
    expect(roleFor(probes("dev2"), "acme")).toEqual({ kind: "owner", teams: ["widgets"] });
    expect(roleFor(probes("dev9"), "acme")).toEqual({ kind: "member" });
    expect(roleFor(probes(null), "acme")).toEqual({ kind: "unknown" });
  });
  test("a stored username that differs only in case is the same person", () => {
    expect(roleFor(probes("DEV1"), "acme")).toEqual({ kind: "admin" });
    expect(roleFor(probes("Dev2"), "acme")).toEqual({ kind: "owner", teams: ["widgets"] });
  });
  test("an org store that is missing or malformed leaves everyone a member", () => {
    expect(roleFor(probes("dev1", null), "acme")).toEqual({ kind: "member" });
    expect(roleFor(probes("dev1", "{ not json"), "acme")).toEqual({ kind: "member" });
    expect(roleFor(probes("dev1", JSON.stringify({ "mattstack.org": { admins: "dev1", teams: 3 } })), "acme")).toEqual({ kind: "member" });
  });
  test("an unreadable username record is unknown, never a throw", () => {
    const p = fakeProbes({ home: HOME, files: { [ORG_STORE]: JSON.stringify(roles), [teamLocalPath(HOME, "acme")]: "{ not json" } });
    expect(roleFor(p, "acme")).toEqual({ kind: "unknown" });
  });
});

describe("an owner listed under a key that is not a plain team name", () => {
  test("is a member through the store text", () => {
    for (const key of ["Widgets", "a/b", "../org"]) {
      const store = JSON.stringify({ "mattstack.org": { admins: [], teams: { [key]: { owners: ["dev2"] } } } });
      expect(roleFor(probes("dev2", store), "acme")).toEqual({ kind: "member" });
    }
  });
});

describe("rolesFor", () => {
  test("names nobody when the org store is missing", () => {
    expect(rolesFor(probes("dev1", null), "acme")).toEqual({ admins: [], teams: {} });
  });
});

describe("assertMayWrite", () => {
  test("passes for an owner inside their folder", () => {
    expect(() => assertMayWrite(probes("dev2"), "acme", "mattstack/teams/widgets/settings.team.jsonc")).not.toThrow();
  });
  test("refuses with team-pull-only, naming who can", () => {
    try {
      assertMayWrite(probes("dev2"), "acme", ".claude-plugin/marketplace.json");
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(UserActionableError);
      expect((err as UserActionableError).code).toBe("team-pull-only");
      expect((err as UserActionableError).message).toBe("The org's shared files belong to its admins");
      expect((err as UserActionableError).why).toBe("Ask Dev1 (an org admin) to make this change.");
    }
  });
  test("a Mac with no recorded username refuses and says to connect", () => {
    try {
      assertMayWrite(probes(null), "acme", "mattstack/org/settings.org.jsonc");
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(UserActionableError);
      expect((err as UserActionableError).code).toBe("team-pull-only");
      expect((err as UserActionableError).message).toBe("rt can't tell who you are, so it will not change the org's shared files");
      expect((err as UserActionableError).why).toBe("Connect your forge account in Setup, then try again.");
    }
  });
  test("a malformed org store warns once per refusal, not once per read", () => {
    const warn = console.warn;
    const lines: string[] = [];
    console.warn = (line: string) => void lines.push(line);
    try {
      expect(() => assertMayWrite(probes("dev1", "{ not json"), "acme", "mattstack/org/settings.org.jsonc")).toThrow(UserActionableError);
    } finally {
      console.warn = warn;
    }
    expect(lines.filter((l) => l.includes("malformed settings store"))).toHaveLength(1);
  });
});
