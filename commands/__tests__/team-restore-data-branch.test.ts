import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import type { ForgeAccessSeams } from "../../lib/team/forge-access-apply.ts";
import type { OrgForgeAccess } from "../../lib/team/forge-access.ts";
import { updateTeamLocal } from "../../lib/team/team-local.ts";
import { dataBranchWorld } from "../../lib/team/__tests__/data-branch-world.ts";
import { cleanupOrgWorlds } from "../../lib/team/__tests__/org-world.ts";
import { restoreBlocks, teamRestoreDataBranch, type TeamDeps } from "../team.ts";

afterEach(() => {
  out.__test__.reset();
  cleanupOrgWorlds();
});

const forgeAccessSeams: ForgeAccessSeams = {
  forgeToken: async () => null,
  access: () => ({
    provider: "github",
    readPushList: async () => ({ ok: true, value: { kind: "unprotected" } }),
    protect: async () => ({ ok: true, value: "protected" }),
  }) as unknown as OrgForgeAccess,
};

function lostWorld(username = "dev1") {
  const w = dataBranchWorld(username);
  updateTeamLocal(w.p, "acme", { dataBranch: "mattstack" });
  w.atOrigin("update-ref", "-d", "refs/heads/mattstack");
  const lines: string[] = [];
  const deps: TeamDeps = { probes: w.p, print: (s) => lines.push(s), forgeToken: async () => null, forgeAccessSeams, interactive: () => false };
  return { ...w, deps, lines };
}

async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  const spy = spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
  try {
    await fn();
    return undefined;
  } catch {
    return spy.mock.calls.at(-1)?.[0] as number | undefined;
  } finally {
    spy.mockRestore();
  }
}

describe("rt team restore-data-branch", () => {
  test("without --yes it shows what it would push and pushes nothing", async () => {
    const w = lostWorld();
    const captured = captureOut();
    try {
      await teamRestoreDataBranch([], {}, w.deps);
      expect(captured.stdout()).toContain("The forge lost the mattstack branch. rt can push your copy back");
      expect(captured.stdout()).toContain("rt team restore-data-branch --yes");
    } finally { captured.restore(); }
    expect(w.atOrigin("for-each-ref", "refs/heads/mattstack").trim()).toBe("");
  }, 30_000);

  test("--yes pushes the branch back and protects it", async () => {
    const w = lostWorld();
    const sha = w.git("rev-parse", "mattstack").trim();
    await teamRestoreDataBranch(["--yes", "--json"], {}, w.deps);
    expect(JSON.parse(w.lines[0]!)).toMatchObject({ ok: true, slug: "acme", pushed: true, plan: { branch: "mattstack", sha }, protect: { kind: "protected" } });
    expect(w.atOrigin("rev-parse", "mattstack").trim()).toBe(sha);
  }, 30_000);

  test("a member sees a refused note, exit 2", async () => {
    const w = lostWorld("dev2");
    const captured = captureOut();
    try {
      expect(await exitCode(() => teamRestoreDataBranch(["--yes"], {}, w.deps))).toBe(2);
      expect(captured.stderr()).toContain("[refused] Only an org owner or admin can restore the org's data branch");
    } finally { captured.restore(); }
  }, 30_000);

  test("the done blocks say it was pushed and protected", () => {
    const text = renderPlain(restoreBlocks("acme", { plan: { branch: "mattstack", sha: "a".repeat(40), subject: "seed", ahead: 0 }, pushed: true, protect: { kind: "protected" }, pushList: "skipped" }));
    expect(text).toContain("Pushed your copy of the mattstack branch back to the forge");
    expect(text).toContain("Protected the mattstack branch again");
  });
});
