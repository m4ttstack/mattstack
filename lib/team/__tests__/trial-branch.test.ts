import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { UserActionableError } from "../../errors.ts";
import { readTeamLocal } from "../team-local.ts";
import { useBranch } from "../trial-branch.ts";
import { cleanupOrgWorlds } from "./org-world.ts";
import { dataBranchWorld } from "./data-branch-world.ts";

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

  test("a clone with an unsaved edit is held with the file named, and nothing is pushed", async () => {
    const w = dataBranchWorld();
    const file = "mattstack/teams/widgets/settings.team.jsonc";
    writeFileSync(join(w.root, file), "{ /* edit */ }");
    const err = await refusal(useBranch(w.p, "acme", "try-it", noToken));
    expect(err.code).toBe("trial-branch-held");
    expect(err.message).toContain(file);
    expect(w.git("symbolic-ref", "--short", "HEAD").trim()).toBe("mattstack");
    expect(readTeamLocal(w.p, "acme").trialBranch).toBeUndefined();
  }, 30_000);

  test("a clone whose marker names no data branch has nothing to branch from", async () => {
    const w = dataBranchWorld();
    writeFileSync(join(w.root, "mattstack", "mattstack.jsonc"), '{"role":"org","org":"acme","layout":3}\n');
    w.git("commit", "-aq", "-m", "legacy marker");
    const err = await refusal(useBranch(w.p, "acme", "try-it", noToken));
    expect(err.code).toBe("trial-branch-not-moved");
    expect(err.next).toBe("rt team pull --team acme");
  }, 30_000);

  test("a name git does not accept as a branch is refused before anything runs", async () => {
    const w = dataBranchWorld();
    for (const name of ["a b", "-x", "a..b", "x.lock"]) {
      const err = await refusal(useBranch(w.p, "acme", name, noToken));
      expect(err.code).toBe("bad-branch-name");
    }
    expect(w.pushes).toEqual([]);
  }, 30_000);
});
