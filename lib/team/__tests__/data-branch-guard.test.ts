import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import type { ForgeAccessSeams } from "../forge-access-apply.ts";
import type { OrgForgeAccess, PushList } from "../forge-access.ts";
import { checkDataBranch, checkMainForOrgData, restoreDataBranch } from "../data-branch-guard.ts";
import { readTeamLocal, updateTeamLocal } from "../team-local.ts";
import { dataBranchWorld } from "./data-branch-world.ts";
import { cleanupOrgWorlds } from "./org-world.ts";

afterEach(() => cleanupOrgWorlds());

const noToken = { readToken: async () => null };

/** A forge whose data branch lost its protection with the branch, recording what rt asks of it. */
function forge(list: PushList = { kind: "unprotected" }) {
  const calls: string[] = [];
  const access = {
    provider: "github",
    readPushList: async (branch: string) => (calls.push(`read ${branch}`), { ok: true, value: list }),
    protect: async (branch: string) => (calls.push(`protect ${branch}`), { ok: true, value: "protected" }),
  } as unknown as OrgForgeAccess;
  const seams: ForgeAccessSeams = { forgeToken: async () => null, access: () => access };
  return { calls, seams };
}

/** A data-branch org whose copy remembers the branch, as join and the org.folder step leave it. */
function world(username = "dev1") {
  const w = dataBranchWorld(username);
  updateTeamLocal(w.p, "acme", { dataBranch: "mattstack" });
  const deleteOnOrigin = () => w.atOrigin("update-ref", "-d", "refs/heads/mattstack");
  return { ...w, deleteOnOrigin };
}

describe("checkDataBranch", () => {
  test("a branch origin has is present, and its tip is remembered", async () => {
    const w = world();
    const sha = w.atOrigin("rev-parse", "mattstack").trim();
    expect(await checkDataBranch(w.p, "acme", noToken)).toEqual({ kind: "present", branch: "mattstack", sha });
    expect(readTeamLocal(w.p, "acme").dataBranchTip).toBe(sha);
  });

  test("a branch deleted on origin is gone, naming this copy's tip of it", async () => {
    const w = world();
    w.deleteOnOrigin();
    expect(await checkDataBranch(w.p, "acme", noToken)).toEqual({ kind: "gone", branch: "mattstack", local: w.git("rev-parse", "mattstack").trim() });
  });

  test("an origin rt cannot reach is unknown, never gone", async () => {
    const w = world();
    w.git("remote", "set-url", "origin", join(w.home, "nowhere.git"));
    expect((await checkDataBranch(w.p, "acme", noToken))?.kind).toBe("unknown");
  });
});

describe("checkMainForOrgData", () => {
  test("a main holding only the pointer is clean", async () => {
    const w = world();
    w.pointMainAtData("root");
    expect(await checkMainForOrgData(w.p, "acme", noToken)).toEqual({ kind: "clean" });
  });

  test("a main holding the org's files is merged, naming them", async () => {
    const w = world();
    w.git("push", "-q", "--force", "origin", "mattstack:main");
    const check = await checkMainForOrgData(w.p, "acme", noToken);
    expect(check?.kind).toBe("merged");
    expect(check?.kind === "merged" ? check.files : []).toContain("mattstack/org/settings.org.jsonc");
  });
});

describe("restoreDataBranch", () => {
  test("a member is refused", async () => {
    const w = world("dev2");
    w.deleteOnOrigin();
    await expect(restoreDataBranch(w.p, "acme", { ...noToken, push: true, forgeAccessSeams: forge().seams })).rejects.toMatchObject({ code: "restore-not-admin" });
    expect(w.atOrigin("for-each-ref", "refs/heads/mattstack").trim()).toBe("");
  });

  test("without push it says what it would push and pushes nothing", async () => {
    const w = world();
    w.deleteOnOrigin();
    const result = await restoreDataBranch(w.p, "acme", { ...noToken, push: false, forgeAccessSeams: forge().seams });
    expect(result).toMatchObject({ pushed: false, plan: { branch: "mattstack", sha: w.git("rev-parse", "mattstack").trim(), subject: "data branch", ahead: 0 } });
    expect(w.atOrigin("for-each-ref", "refs/heads/mattstack").trim()).toBe("");
  });

  test("pushes the branch back and protects it again", async () => {
    const w = world();
    const sha = w.git("rev-parse", "mattstack").trim();
    w.deleteOnOrigin();
    const f = forge();
    const result = await restoreDataBranch(w.p, "acme", { ...noToken, push: true, forgeAccessSeams: f.seams });
    expect(result).toMatchObject({ pushed: true, protect: { kind: "protected" } });
    expect(w.atOrigin("rev-parse", "mattstack").trim()).toBe(sha);
    expect(f.calls).toEqual(["read mattstack", "protect mattstack"]);
  });

  test("a branch the forge still has is refused as nothing to restore", async () => {
    const w = world();
    await expect(restoreDataBranch(w.p, "acme", { ...noToken, push: true, forgeAccessSeams: forge().seams })).rejects.toMatchObject({ code: "restore-not-needed" });
  });

  test("a copy behind origin's last known tip is refused, even after a pruning fetch dropped the tracking ref", async () => {
    const w = world();
    writeFileSync(join(w.root, "mattstack", "org", "settings.org.jsonc"), `${w.git("show", "HEAD:mattstack/org/settings.org.jsonc")}\n`);
    w.git("commit", "-q", "-am", "a teammate's change");
    w.git("push", "-q", "origin", "mattstack");
    expect((await checkDataBranch(w.p, "acme", noToken))?.kind).toBe("present");
    w.git("reset", "-q", "--hard", "HEAD~1");
    w.git("update-ref", "-d", "refs/remotes/origin/mattstack");
    w.deleteOnOrigin();
    await expect(restoreDataBranch(w.p, "acme", { ...noToken, push: true, forgeAccessSeams: forge().seams })).rejects.toMatchObject({ code: "restore-behind" });
    expect(w.atOrigin("for-each-ref", "refs/heads/mattstack").trim()).toBe("");
  });
});
