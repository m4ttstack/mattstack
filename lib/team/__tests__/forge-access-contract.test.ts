import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { ForgeMember, ForgeResult, OrgForgeAccess } from "../forge-access.ts";
import { githubForgeAccess } from "../forge-access-github.ts";
import { fakeGitHub, type FakeForge, type FakeForgeOpts } from "./forge-fakes.ts";

export type World = { forge: FakeForge; access: OrgForgeAccess };

export const WORLDS: Record<string, (opts: FakeForgeOpts) => World> = {
  github: (opts) => {
    const forge = fakeGitHub(opts);
    const p = fakeProbes({ exec: forge.exec });
    return { forge, access: githubForgeAccess(p, "git@github.com:acme/widgets.git", "acme", "widgets", "token") };
  },
};

const USERS = ["dev1", "dev2", "dev3", "dev4"];
const valueOf = <T>(r: ForgeResult<T>): T => {
  if (!r.ok) throw new Error(`forge refused: ${r.manualSteps.join(" | ")}`);
  return r.value;
};
const levelOf = async (access: OrgForgeAccess, username: string) => valueOf(await access.readMembers()).find((m: ForgeMember) => m.username === username)?.level;

for (const [name, world] of Object.entries(WORLDS)) {
  describe(`OrgForgeAccess contract: ${name}`, () => {
    test("reads members with their level, and whether it is inherited or still an invitation", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" }, dev2: { level: "write" }, dev3: { level: "read", inherited: true }, dev4: { level: "read", pending: true } } });
      const byName = Object.fromEntries(valueOf(await access.readMembers()).map((m) => [m.username, m]));
      expect(byName.dev1).toMatchObject({ level: "admin", inherited: false, pending: false });
      expect(byName.dev2).toMatchObject({ level: "write", inherited: false, pending: false });
      expect(byName.dev3).toMatchObject({ level: "read", inherited: true });
      expect(byName.dev4).toMatchObject({ pending: true });
    });

    test("grant raises a direct member's level", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" }, dev2: { level: "read" }, dev3: { level: "guest" } } });
      expect(await access.grant("dev2", "write")).toEqual({ ok: true, value: "granted" });
      expect(await levelOf(access, "dev2")).toBe("write");
      expect(await access.grant("dev3", "read")).toEqual({ ok: true, value: "granted" });
      expect(await levelOf(access, "dev3")).toBe("read");
    });

    test("grant adds someone new, at once or by invitation", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" } } });
      const r = await access.grant("dev3", "read");
      expect(r.ok && ["granted", "invited"].includes(r.value)).toBe(true);
      expect(valueOf(await access.readMembers()).some((m) => m.username === "dev3")).toBe(true);
    });

    test("an account the forge does not know is a refusal with a step, never a throw", async () => {
      const { access } = world({ users: USERS, members: {} });
      const r = await access.grant("ghost", "read");
      expect(r.ok).toBe(false);
      expect(r.ok ? [] : r.manualSteps).not.toEqual([]);
    });

    test("revoke removes a member, and revoking someone who is not one is fine", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" }, dev2: { level: "read" } } });
      expect(await access.revoke("dev2")).toEqual({ ok: true, value: "revoked" });
      expect(await levelOf(access, "dev2")).toBeUndefined();
      expect(await access.revoke("dev3")).toEqual({ ok: true, value: "revoked" });
    });

    test("an unprotected branch reads so; protect, then setPushList names exactly the people given", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" }, dev2: { level: "write" }, dev3: { level: "write" } } });
      expect(await access.readPushList("mattstack")).toEqual({ ok: true, value: { kind: "unprotected" } });
      expect(await access.protect("mattstack")).toEqual({ ok: true, value: "protected" });
      expect(await access.setPushList("mattstack", ["dev1", "dev2", "dev3"])).toEqual({ ok: true, value: "set" });
      const first = valueOf(await access.readPushList("mattstack"));
      expect(first.kind === "named" ? [...first.users].sort() : first).toEqual(["dev1", "dev2", "dev3"]);
      expect(await access.setPushList("mattstack", ["dev1", "dev2"])).toEqual({ ok: true, value: "set" });
      const second = valueOf(await access.readPushList("mattstack"));
      expect(second.kind === "named" ? [...second.users].sort() : second).toEqual(["dev1", "dev2"]);
    });

    test("where the forge cannot name people, setPushList says so and the branch reads as open", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "admin" }, dev2: { level: "write" } }, cannotNameUsers: true });
      expect(valueOf(await access.protect("mattstack"))).toBe("protected");
      expect(await access.setPushList("mattstack", ["dev1", "dev2"])).toEqual({ ok: true, value: "cannot-name-users" });
      expect(valueOf(await access.readPushList("mattstack")).kind).toBe("open");
    });

    test("a token that cannot change access gets a step naming the forge page on every write, never a throw", async () => {
      const { access } = world({ users: USERS, members: { dev1: { level: "write" } }, readOnly: true });
      for (const r of [await access.grant("dev2", "write"), await access.protect("mattstack"), await access.setPushList("mattstack", ["dev1"])]) {
        expect(r.ok).toBe(false);
        expect(r.ok ? "" : r.manualSteps.join(" ")).toContain("https://");
      }
    });

    test("a branch the repo does not have is a refusal that says to push it", async () => {
      const { access } = world({ users: USERS, members: {} });
      const r = await access.readPushList("nope");
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.manualSteps.join(" ")).toContain("Push the nope branch");
    });

    test("defaultBranch reads the repo's default branch", async () => {
      expect(await world({ users: USERS, defaultBranch: "trunk" }).access.defaultBranch()).toEqual({ ok: true, value: "trunk" });
    });

    test.if(name === "github")("a plan that cannot protect a private repo's branch reads as unavailable", async () => {
      const { access, forge } = world({ users: USERS, members: { dev1: { level: "admin" } }, cannotProtect: true });
      expect(valueOf(await access.readPushList("mattstack")).kind).toBe("unavailable");
      expect(await access.protect("mattstack")).toEqual({ ok: true, value: "unavailable" });
      expect(forge.writes.every((w) => w.startsWith("PUT"))).toBe(true);
    });
  });
}
