import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { orgDirUnder } from "../../rt-paths.ts";
import type { SecretsSeams } from "../../secrets/store.ts";
import { applyForgeAccess, applyForgeAccessAndFollow, readForgeAccess, wantedFingerprint, type ForgeAccessSeams } from "../forge-access-apply.ts";
import { githubForgeAccess } from "../forge-access-github.ts";
import { gitlabForgeAccess } from "../forge-access-gitlab.ts";
import { readTeamLocal, teamLocalPath } from "../team-local.ts";
import { fakeGitHub, fakeGitLab, type FakeForge, type FakeForgeOpts } from "./forge-fakes.ts";

const HOME = "/h";
const DIR = orgDirUnder(HOME, "acme");
const REMOTES = { github: "git@github.com:acme/widgets.git", gitlab: "https://gitlab.com/acme/widgets.git" } as const;
const ORG = { owners: ["dev1"], admins: [], teams: { widgets: { owners: ["dev2"] } } };
const ROSTER = [
  { username: "dev1", teams: ["widgets"] },
  { username: "dev2", teams: ["widgets"] },
  { username: "dev3", teams: ["widgets"] },
];

function setup(provider: "github" | "gitlab", forgeOpts: FakeForgeOpts, opts: { me?: string; latch?: boolean; dataBranch?: string | null; roster?: unknown[]; local?: Record<string, unknown> } = {}) {
  const forge: FakeForge = provider === "github" ? fakeGitHub(forgeOpts) : fakeGitLab(forgeOpts);
  const marker = { role: "org", org: "acme", layout: 4, ...(opts.dataBranch === null ? {} : { dataBranch: opts.dataBranch ?? "mattstack" }) };
  const p = fakeProbes({
    home: HOME,
    exec: forge.exec,
    files: {
      [`${DIR}/.git/config`]: `[remote "origin"]\n\turl = ${REMOTES[provider]}\n`,
      [`${DIR}/mattstack/mattstack.jsonc`]: JSON.stringify(marker),
      [`${DIR}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": ORG, "mattstack.roster": opts.roster ?? ROSTER }),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.me ?? "dev1", rtMayManageMembership: opts.latch ?? true, ...opts.local }),
    },
  });
  const seams: ForgeAccessSeams = {
    forgeToken: async () => "token",
    access: (probes, remote, token) => (provider === "github" ? githubForgeAccess(probes, remote, "acme", "widgets", token) : gitlabForgeAccess(probes, remote, "gitlab.com", "acme/widgets", token)),
  };
  return { p, forge, seams };
}

const USERS = ["dev1", "dev2", "dev3", "dev5"];
const MEMBERS = { dev1: { level: "admin" as const }, dev2: { level: "read" as const }, dev3: { level: "write" as const }, dev5: { level: "write" as const } };

for (const provider of ["github", "gitlab"] as const) {
  describe(`forge access on ${provider}`, () => {
    test("a Mac that does not run the org gets nothing, and the forge is never asked", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS }, { me: "dev3" });
      expect(await readForgeAccess(p, "acme", seams)).toEqual({ kind: "not-admin" });
      expect(p.calls.exec.filter((argv) => argv.includes("api"))).toEqual([]);
      expect(forge.writes).toEqual([]);
    });

    test("an org whose data has no branch of its own is left alone, main included", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS }, { dataBranch: null });
      expect((await applyForgeAccess(p, "acme", seams)).report.kind).toBe("not-yet");
      expect(p.calls.exec.filter((argv) => argv.includes("api"))).toEqual([]);
      expect(forge.writes).toEqual([]);
    });

    test("a data branch that is main or the repo's default branch is a shared branch rt leaves alone, and nothing is written", async () => {
      for (const [dataBranch, defaultBranch] of [["main", "main"], ["trunk", "trunk"], ["master", "trunk"]] as const) {
        const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS, defaultBranch, branches: [dataBranch, defaultBranch] }, { dataBranch });
        const { report, applied } = await applyForgeAccess(p, "acme", seams);
        expect(report).toEqual({ kind: "shared-branch", branch: dataBranch });
        expect(applied).toBeNull();
        expect(forge.writes).toEqual([]);
      }
    });

    test("while this Mac is on its trial branch, nothing is asked of the forge or written", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS }, { dataBranch: "mattstack-trial", local: { trialBranch: "mattstack-trial" } });
      expect((await applyForgeAccess(p, "acme", seams)).report).toEqual({ kind: "trial", branch: "mattstack-trial" });
      expect(p.calls.exec.filter((argv) => argv.includes("api"))).toEqual([]);
      expect(forge.writes).toEqual([]);
      expect(await wantedFingerprint(p, "acme")).toBeNull();
    });

    test("a trial branch made from the data branch, whose marker still names the data branch, waits too", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS }, { local: { trialBranch: "try-roles" } });
      expect((await applyForgeAccess(p, "acme", seams)).report).toEqual({ kind: "trial", branch: "try-roles" });
      expect(forge.writes).toEqual([]);
    });

    test("the report names who to raise and put on the push list, and lowers no one", async () => {
      const { p, seams } = setup(provider, { users: USERS, members: MEMBERS });
      const report = await readForgeAccess(p, "acme", seams);
      if (report.kind !== "ready") throw new Error(report.kind);
      expect(report.diff.grant).toEqual([{ username: "dev2", level: "write" }]);
      expect(report.diff.addPush).toEqual(["dev1", "dev2"]);
      expect(JSON.stringify(report.diff)).not.toContain("dev3");
      expect(JSON.stringify(report.diff)).not.toContain("dev5");
    });

    test("without the latch nothing is written", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS }, { latch: false });
      expect((await applyForgeAccess(p, "acme", seams)).applied).toBeNull();
      expect(forge.writes).toEqual([]);
    });

    test("with the latch rt applies the difference, records it, keeps everyone's level, and a second look finds nothing to do", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: MEMBERS, addedDirectly: USERS });
      const { applied } = await applyForgeAccess(p, "acme", seams);
      expect(applied?.manualSteps).toEqual([]);
      expect(applied?.heldOff).toEqual([]);
      expect(forge.members()).toMatchObject({ dev2: { level: "write" }, dev3: { level: "write" }, dev5: { level: "write" } });
      const after = await readForgeAccess(p, "acme", seams);
      expect(after.kind === "ready" ? [after.pushList, after.diff.grant] : after).toEqual([{ kind: "named", users: expect.arrayContaining(["dev1", "dev2"]) }, []]);
      expect(readTeamLocal(p, "acme").forgeAccess?.fingerprint).toBe((await wantedFingerprint(p, "acme"))!);
    });

    test("someone who left a role and the roster comes off the push list only, and keeps their repo level", async () => {
      const { p, forge, seams } = setup(provider, { users: USERS, members: { ...MEMBERS, dev2: { level: "write" }, dev3: { level: "write" } }, addedDirectly: USERS });
      await applyForgeAccess(p, "acme", seams);
      p.writeFile(`${DIR}/mattstack/org/settings.org.jsonc`, JSON.stringify({ "mattstack.org": { ...ORG, teams: { widgets: { owners: [] } } }, "mattstack.roster": ROSTER.filter((e) => e.username !== "dev3") }));
      const { applied } = await applyForgeAccess(p, "acme", seams);
      expect(applied?.done.some((line) => line.startsWith("Set who can push mattstack"))).toBe(true);
      expect(forge.members()).toMatchObject({ dev2: { level: "write" }, dev3: { level: "write" } });
      const after = await readForgeAccess(p, "acme", seams);
      expect(after.kind === "ready" && after.pushList.kind === "named" ? after.pushList.users : null).toEqual(["dev1"]);
    });

    test("a forge that refuses every write gives steps, records them, and never throws", async () => {
      const { p, seams } = setup(provider, { users: USERS, members: MEMBERS, readOnly: true });
      const { applied } = await applyForgeAccess(p, "acme", seams);
      expect(applied?.manualSteps.length).toBeGreaterThan(0);
      expect(readTeamLocal(p, "acme").forgeAccess?.manualSteps).toEqual(applied!.manualSteps);
    });

    test("where the forge cannot name people, the run says plainly that anyone with write can push", async () => {
      const { p, seams } = setup(provider, { users: USERS, members: MEMBERS, cannotNameUsers: true, addedDirectly: USERS });
      const { applied } = await applyForgeAccess(p, "acme", seams);
      expect(applied?.limit).toContain("Anyone with write access can push mattstack, and only rt limits what they change there.");
    });

    test("the fingerprint moves with the roster and is null until the data has its own branch", async () => {
      const a = setup(provider, { users: USERS, members: MEMBERS });
      const b = setup(provider, { users: USERS, members: MEMBERS }, { roster: [...ROSTER, { username: "dev4", teams: [] }] });
      expect(await wantedFingerprint(a.p, "acme")).not.toBe(await wantedFingerprint(b.p, "acme"));
      expect(await wantedFingerprint(setup(provider, { users: USERS }, { dataBranch: null }).p, "acme")).toBeNull();
    });
  });
}

test("github: someone whose grant is still an invitation stays off the push list, and the rest applies", async () => {
  const { p, forge, seams } = setup("github", { users: USERS, members: { dev1: { level: "admin" }, dev3: { level: "guest" } }, addedDirectly: ["dev1", "dev3"] });
  const { applied } = await applyForgeAccess(p, "acme", seams);
  expect(applied?.done).toContain("Invited dev2 to the repo with write access");
  expect(applied?.manualSteps).toEqual([]);
  expect(applied?.heldOff).toEqual(["dev2"]);
  const after = await readForgeAccess(p, "acme", seams);
  expect(after.kind === "ready" && after.pushList.kind === "named" ? after.pushList.users : null).toEqual(["dev1"]);
  expect(forge.members().dev3).toMatchObject({ level: "read" });
});

describe("applyForgeAccessAndFollow", () => {
  const secrets = {} as SecretsSeams;
  const recorder = () => {
    const calls: { slug: string; orgStore: Record<string, unknown> }[] = [];
    const follow = async (_p: unknown, slug: string, orgStore: Record<string, unknown>) => {
      calls.push({ slug, orgStore });
      return { reencrypted: ["mattstack/org/admin-secrets/rt.sops.json"], failure: null };
    };
    return { calls, follow };
  };

  test("follows the roster change once when the wanted access moved, then not again", async () => {
    const { p, seams } = setup("gitlab", { users: USERS, members: MEMBERS, addedDirectly: USERS });
    const { calls, follow } = recorder();
    const first = await applyForgeAccessAndFollow(p, "acme", secrets, seams, follow);
    expect(first.admin).toEqual({ reencrypted: ["mattstack/org/admin-secrets/rt.sops.json"], failure: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.orgStore["mattstack.org"]).toEqual(ORG);
    expect((await applyForgeAccessAndFollow(p, "acme", secrets, seams, follow)).admin).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("does not follow when nothing was applied: no latch, or a trial branch", async () => {
    for (const opts of [{ latch: false }, { dataBranch: "mattstack-trial", local: { trialBranch: "mattstack-trial" } }]) {
      const { p, seams } = setup("gitlab", { users: USERS, members: MEMBERS }, opts);
      const { calls, follow } = recorder();
      expect((await applyForgeAccessAndFollow(p, "acme", secrets, seams, follow)).admin).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  test("a follow that fails is retried on the next run, and not again once it succeeds", async () => {
    const { p, seams } = setup("gitlab", { users: USERS, members: MEMBERS, addedDirectly: USERS });
    let calls = 0;
    const follow = async () => (++calls === 1 ? { reencrypted: [], failure: "sops refused" } : { reencrypted: ["x"], failure: null });
    await applyForgeAccessAndFollow(p, "acme", secrets, seams, follow);
    expect(calls).toBe(1);
    expect((await applyForgeAccessAndFollow(p, "acme", secrets, seams, follow)).admin).toEqual({ reencrypted: ["x"], failure: null });
    expect(calls).toBe(2);
    expect((await applyForgeAccessAndFollow(p, "acme", secrets, seams, follow)).admin).toBeNull();
    expect(calls).toBe(2);
  });

  test("a follow that reports a failure is passed back, never thrown", async () => {
    const { p, seams } = setup("gitlab", { users: USERS, members: MEMBERS, addedDirectly: USERS });
    const result = await applyForgeAccessAndFollow(p, "acme", secrets, seams, async () => ({ reencrypted: [], failure: "sops refused" }));
    expect(result.admin).toEqual({ reencrypted: [], failure: "sops refused" });
  });
});
