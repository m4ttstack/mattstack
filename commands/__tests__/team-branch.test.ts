import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { dataBranchWorld } from "../../lib/team/__tests__/data-branch-world.ts";
import { cleanupOrgWorlds } from "../../lib/team/__tests__/org-world.ts";
import { branchUseBlocks, teamBranchUse, type TeamDeps } from "../team.ts";

afterEach(() => {
  out.__test__.reset();
  cleanupOrgWorlds();
});

function depsFor(p: TeamDeps["probes"]) {
  const lines: string[] = [];
  const deps: TeamDeps = { probes: p, print: (s) => lines.push(s), forgeToken: async () => null };
  return { deps, lines };
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

describe("rt team branch use", () => {
  test("--json prints the branch, whether it was created, and whether it is a trial", async () => {
    const w = dataBranchWorld();
    const { deps, lines } = depsFor(w.p);
    await teamBranchUse(["mattstack-layout-5", "--json"], {}, deps);
    const env = JSON.parse(lines[0]!);
    expect(env).toMatchObject({ ok: true, slug: "acme", branch: "mattstack-layout-5", created: true, trial: true });
    expect(Object.keys(env).sort()).toEqual(["at", "branch", "contract", "created", "ok", "slug", "trial"]);
  }, 30_000);

  test("--team names the org clone", async () => {
    const w = dataBranchWorld();
    const { deps, lines } = depsFor(w.p);
    await teamBranchUse(["try-it", "--team", "acme", "--json"], {}, deps);
    expect(JSON.parse(lines[0]!)).toMatchObject({ slug: "acme", branch: "try-it" });
  }, 30_000);

  test("a team owner sees a refused note, exit 2", async () => {
    const w = dataBranchWorld("dev2");
    const { deps } = depsFor(w.p);
    const captured = captureOut();
    try {
      expect(await exitCode(() => teamBranchUse(["try-it"], {}, deps))).toBe(2);
      expect(captured.stderr()).toContain("[refused] Only an org admin switches the org to a trial branch");
    } finally { captured.restore(); }
  }, 30_000);

  test("--json refusal carries the code", async () => {
    const w = dataBranchWorld("dev2");
    const { deps, lines } = depsFor(w.p);
    expect(await exitCode(() => teamBranchUse(["try-it", "--json"], {}, deps))).toBe(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ error: { code: "trial-branch-admin-only" } });
  }, 30_000);

  test("no branch name is a usage error, exit 2", async () => {
    const w = dataBranchWorld();
    const { deps, lines } = depsFor(w.p);
    expect(await exitCode(() => teamBranchUse(["--json"], {}, deps))).toBe(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ error: { code: "usage" } });
  });

  test("a trial says auto-commit runs on this Mac only", () => {
    const text = renderPlain(branchUseBlocks({ branch: "try-it", created: true, trial: true }));
    expect(text).toContain("Your copy of the org is on try-it");
    expect(text).toContain("auto-commit runs here on this Mac only");
  });

  test("the data branch says nothing about auto-commit", () => {
    const text = renderPlain(branchUseBlocks({ branch: "mattstack", created: false, trial: false }));
    expect(text).toContain("Your copy of the org is on mattstack");
    expect(text).not.toContain("auto-commit");
  });
});
