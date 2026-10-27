import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { join } from "path";
import { UserActionableError } from "../../errors.ts";
import { readTeamLocal } from "../team-local.ts";
import { useBranch } from "../trial-branch.ts";
import { cleanupOrgWorlds } from "./org-world.ts";
import { approvedBranches } from "../approved-branch.ts";
import { dataBranchWorld, layout3World } from "./data-branch-world.ts";

afterEach(cleanupOrgWorlds);

const noToken = { readToken: async () => null };

async function refusal(run: Promise<unknown>): Promise<UserActionableError> {
  try {
    await run;
  } catch (err) {
    if (err instanceof UserActionableError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("useBranch", () => {
  test("an admin on the data branch creates a branch from it, pushes it, switches and records the trial", async () => {
    const w = dataBranchWorld();
    const tip = w.git("rev-parse", "mattstack").trim();
    const result = await useBranch(w.p, "acme", "mattstack-layout-5", noToken);
    expect(result).toEqual({ branch: "mattstack-layout-5", created: true, trial: true });
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("mattstack-layout-5");
    expect(w.atOrigin("rev-parse", "refs/heads/mattstack-layout-5").trim()).toBe(tip);
    expect(readTeamLocal(w.p, "acme").trialBranch).toBe("mattstack-layout-5");
  }, 30_000);

  test("a record with no data branch gets the published one, so a trial naming itself stays a trial", async () => {
    const w = dataBranchWorld();
    w.pushUnrelated("mattstack-layout-5", { dataBranch: "mattstack-layout-5" });
    expect(readTeamLocal(w.p, "acme").dataBranch).toBeUndefined();
    await useBranch(w.p, "acme", "mattstack-layout-5", noToken);
    expect(readTeamLocal(w.p, "acme").dataBranch).toBe("mattstack");
    expect(approvedBranches(w.p, "acme", w.root)).toEqual(["mattstack", "mattstack-layout-5"]);
  }, 30_000);

  test("a branch already on the remote with unrelated history is fetched and switched to", async () => {
    const w = dataBranchWorld();
    w.pushUnrelated("mattstack-layout-5");
    const result = await useBranch(w.p, "acme", "mattstack-layout-5", noToken);
    expect(result).toEqual({ branch: "mattstack-layout-5", created: false, trial: true });
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("mattstack-layout-5");
    expect(w.git("log", "-1", "--format=%s").trim()).toBe("trial root");
    expect(readTeamLocal(w.p, "acme").trialBranch).toBe("mattstack-layout-5");
  }, 30_000);

  test("going back to the data branch clears the trial", async () => {
    const w = dataBranchWorld();
    await useBranch(w.p, "acme", "try-it", noToken);
    const back = await useBranch(w.p, "acme", "mattstack", noToken);
    expect(back).toEqual({ branch: "mattstack", created: false, trial: false });
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("mattstack");
    expect(readTeamLocal(w.p, "acme").trialBranch).toBeUndefined();
  }, 30_000);

  test("a trial created from a trial's clone still starts from the data branch", async () => {
    const w = dataBranchWorld();
    await useBranch(w.p, "acme", "first", noToken);
    writeFileSync(join(w.root, "mattstack/teams/widgets/settings.team.jsonc"), '{"board.title":"trial"}');
    w.git("commit", "-aq", "-m", "trial only");
    w.git("push", "-q", "origin", "first");
    const second = await useBranch(w.p, "acme", "second", noToken);
    expect(second.created).toBe(true);
    expect(w.atOrigin("rev-parse", "refs/heads/second").trim()).toBe(w.atOrigin("rev-parse", "refs/heads/mattstack").trim());
  }, 30_000);

  test("choosing the branch the copy is already on still records it", async () => {
    const w = dataBranchWorld();
    await useBranch(w.p, "acme", "try-it", noToken);
    const again = await useBranch(w.p, "acme", "try-it", noToken);
    expect(again).toEqual({ branch: "try-it", created: false, trial: true });
  }, 30_000);

  test("a team owner is refused and nothing moves", async () => {
    const w = dataBranchWorld("dev2");
    const err = await refusal(useBranch(w.p, "acme", "try-it", noToken));
    expect(err.code).toBe("trial-branch-admin-only");
    expect(err.message).toBe("Only an org admin switches the org to a trial branch");
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("mattstack");
    expect(() => w.atOrigin("rev-parse", "--verify", "-q", "refs/heads/try-it")).toThrow();
  }, 30_000);

  test("a clone with an unsaved edit is held with the file named, and nothing is pushed or recorded", async () => {
    const w = dataBranchWorld();
    const file = "mattstack/teams/widgets/settings.team.jsonc";
    writeFileSync(join(w.root, file), "{ /* edit */ }");
    const err = await refusal(useBranch(w.p, "acme", "try-it", noToken));
    expect(err.code).toBe("trial-branch-held");
    expect(err.message).toContain(file);
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("mattstack");
    expect(w.pushes).toEqual([]);
    expect(() => w.atOrigin("rev-parse", "--verify", "-q", "refs/heads/try-it")).toThrow();
    expect(readTeamLocal(w.p, "acme").trialBranch).toBeUndefined();
  }, 30_000);

  test("a detached clone is held before anything is pushed", async () => {
    const w = dataBranchWorld();
    w.git("checkout", "-q", "--detach");
    const err = await refusal(useBranch(w.p, "acme", "try-it", noToken));
    expect(err.code).toBe("trial-branch-held");
    expect(w.pushes).toEqual([]);
    expect(() => w.atOrigin("rev-parse", "--verify", "-q", "refs/heads/try-it")).toThrow();
  }, 30_000);

  test("unpushed trial commits hold the switch back to the data branch, and stay where they are", async () => {
    const w = dataBranchWorld();
    await useBranch(w.p, "acme", "try-it", noToken);
    writeFileSync(join(w.root, "mattstack/teams/widgets/settings.team.jsonc"), '{"board.title":"trial"}');
    w.git("commit", "-aq", "-m", "trial only");
    const trialTip = w.git("rev-parse", "HEAD").trim();
    const dataTip = w.atOrigin("rev-parse", "refs/heads/mattstack").trim();
    const err = await refusal(useBranch(w.p, "acme", "mattstack", noToken));
    expect(err.code).toBe("trial-branch-held");
    expect(err.message).toBe("Your copy of the org has 1 commit on try-it that is not pushed yet, so rt did not switch");
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("try-it");
    expect(w.git("rev-parse", "HEAD").trim()).toBe(trialTip);
    expect(w.atOrigin("rev-parse", "refs/heads/mattstack").trim()).toBe(dataTip);
    expect(w.git("rev-parse", "mattstack").trim()).toBe(dataTip);
    expect(readTeamLocal(w.p, "acme").trialBranch).toBe("try-it");
  }, 30_000);

  test("a branch that holds no org data (main's pointer) is refused and nothing changes", async () => {
    const w = dataBranchWorld();
    await useBranch(w.p, "acme", "try-it", noToken);
    w.pointMainAtData();
    const err = await refusal(useBranch(w.p, "acme", "main", noToken));
    expect(err.code).toBe("trial-branch-no-org-data");
    expect(err.message).toBe("The main branch holds no org data, so rt did not switch");
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("try-it");
    expect(readTeamLocal(w.p, "acme").trialBranch).toBe("try-it");
  }, 30_000);

  test("a missing clone is not called admin-only", async () => {
    const w = dataBranchWorld();
    rmSync(w.root, { recursive: true, force: true });
    const err = await refusal(useBranch(w.p, "acme", "try-it", noToken));
    expect(err.code).toBe("no-team-zone");
  }, 30_000);

  test("a name git does not accept as a branch is refused before anything runs", async () => {
    const w = dataBranchWorld();
    for (const name of ["a b", "-x", "a..b", "x.lock", "@{-1}", "a@{b"]) {
      const err = await refusal(useBranch(w.p, "acme", name, noToken));
      expect(err.code).toBe("bad-branch-name");
    }
    expect(w.pushes).toEqual([]);
  }, 30_000);
});

describe("useBranch on a layout 3 clone", () => {
  test("switches to a script-made orphan trial, records it, and approves it", async () => {
    const w = layout3World();
    w.pushTrial("mattstack-trial");
    const mainTip = w.atOrigin("rev-parse", "refs/heads/main").trim();
    const result = await useBranch(w.p, "acme", "mattstack-trial", noToken);
    expect(result).toEqual({ branch: "mattstack-trial", created: false, trial: true });
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("mattstack-trial");
    expect(w.git("log", "-1", "--format=%s").trim()).toBe("trial root");
    expect(readTeamLocal(w.p, "acme").trialBranch).toBe("mattstack-trial");
    expect(approvedBranches(w.p, "acme", w.root)).toEqual(["main", "mattstack-trial"]);
    expect(w.atOrigin("rev-parse", "refs/heads/main").trim()).toBe(mainTip);
    expect(w.pushes).toEqual([]);
  }, 30_000);

  test("switching back to main restores the layout 3 clone and clears the trial", async () => {
    const w = layout3World();
    w.pushTrial("mattstack-trial");
    const mainTip = w.git("rev-parse", "main").trim();
    await useBranch(w.p, "acme", "mattstack-trial", noToken);
    const back = await useBranch(w.p, "acme", "main", noToken);
    expect(back).toEqual({ branch: "main", created: false, trial: false });
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("main");
    expect(w.git("rev-parse", "HEAD").trim()).toBe(mainTip);
    expect(readTeamLocal(w.p, "acme").trialBranch).toBeUndefined();
    expect(approvedBranches(w.p, "acme", w.root)).toEqual(["main"]);
  }, 30_000);

  test("creating a new branch is refused, because there is no data branch to start from", async () => {
    const w = layout3World();
    const err = await refusal(useBranch(w.p, "acme", "try-it", noToken));
    expect(err.code).toBe("trial-branch-not-moved");
    expect(err.message).toBe("The org has no data branch yet to start a new branch from");
    expect(w.pushes).toEqual([]);
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("main");
  }, 30_000);

  test("unpushed commits on main hold the switch onto the trial", async () => {
    const w = layout3World();
    w.pushTrial("mattstack-trial");
    w.git("commit", "-q", "--allow-empty", "-m", "mine");
    const err = await refusal(useBranch(w.p, "acme", "mattstack-trial", noToken));
    expect(err.code).toBe("trial-branch-held");
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("main");
  }, 30_000);
});
