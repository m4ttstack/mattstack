import { execFileSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { childEnv } from "../../lib/subprocess.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { cleanupOrgWorlds, orgWorld } from "../../lib/team/__tests__/org-world.ts";
import type { ConvergeOutcome } from "../../lib/team/rename.ts";
import * as orgFolder from "../../lib/setup/steps/org-folder.ts";
import { realTeamDeps, renameBlocks, teamRename, type TeamDeps } from "../team.ts";

afterEach(cleanupOrgWorlds);

function depsFor(p: TeamDeps["probes"], outcome: ConvergeOutcome = { state: "done" }) {
  const lines: string[] = [];
  const deps: TeamDeps = { probes: p, print: (s) => lines.push(s), renameSeams: { forgeToken: async () => null, converge: async () => outcome } };
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

describe("rt team rename", () => {
  test("--json prints ok, from, to and converged", async () => {
    const w = orgWorld();
    const { deps, lines } = depsFor(w.p);
    await teamRename(["gadgets", "--json"], {}, deps);
    expect(JSON.parse(lines[0]!)).toMatchObject({ ok: true, from: "acme", to: "gadgets", converged: true });
    expect(Object.keys(JSON.parse(lines[0]!)).sort()).toEqual(["at", "contract", "converged", "from", "ok", "to"]);
  }, 15_000);

  test("a converge that did not finish is converged false, and still exit 0", async () => {
    const w = orgWorld();
    const { deps, lines } = depsFor(w.p, { state: "failed", detail: "The rt daemon is running but did not answer", remedy: "Run rt daemon restart, then rt setup update --force" });
    expect(await exitCode(() => teamRename(["gadgets", "--json"], {}, deps))).toBeUndefined();
    expect(JSON.parse(lines[0]!)).toMatchObject({ ok: true, converged: false });
  }, 15_000);

  test("a non-admin sees a refused note, exit 2", async () => {
    const w = orgWorld("dev2");
    const { deps } = depsFor(w.p);
    const captured = captureOut();
    try {
      expect(await exitCode(() => teamRename(["gadgets"], {}, deps))).toBe(2);
      expect(captured.stderr()).toContain("[refused] Only an org admin can rename the org");
    } finally { captured.restore(); }
  });

  test("a behind clone shows the pull, then the rename to run after it", async () => {
    const w = orgWorld();
    const other = join(w.home, "other");
    execFileSync("git", ["clone", "-q", "-b", "main", w.remote, other], { env: childEnv() });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=dev2", "-c", "user.email=dev2@example.test", ...args], { cwd: other, env: childEnv() });
    writeFileSync(join(other, "later.txt"), "x\n");
    git("add", "later.txt");
    git("commit", "-q", "-m", "later");
    git("push", "-q", "origin", "main");
    const { deps } = depsFor(w.p);
    const captured = captureOut();
    try {
      expect(await exitCode(() => teamRename(["gadgets"], {}, deps))).toBe(2);
      expect(captured.stderr()).toContain("[refused]");
      expect(captured.stderr()).toContain("rt team pull --team acme");
      expect(captured.stderr()).toContain("rt team rename gadgets");
    } finally { captured.restore(); }
  }, 15_000);

  test("--json refusal carries the code", async () => {
    const w = orgWorld("dev2");
    const { deps, lines } = depsFor(w.p);
    expect(await exitCode(() => teamRename(["gadgets", "--json"], {}, deps))).toBe(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ error: { code: "rename-not-admin" } });
  });

  test("no name is a usage error, exit 2", async () => {
    const w = orgWorld();
    const { deps, lines } = depsFor(w.p);
    expect(await exitCode(() => teamRename(["--json"], {}, deps))).toBe(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ error: { code: "usage" } });
  });

  test("the human result names the move and what teammates do next", () => {
    const text = renderPlain(renameBlocks({ from: "acme", to: "gadgets", converged: true }));
    expect(text).toContain("Renamed your org to gadgets");
    expect(text).toContain("This Mac's org folder is now gadgets");
    expect(text).toContain("rt setup update --force");
  });

  test("the human result shows why this Mac did not move yet", () => {
    const text = renderPlain(renameBlocks({ from: "acme", to: "gadgets", converged: false, convergeDetail: "claude is missing", convergeRemedy: "Run claude plugin marketplace add" }));
    expect(text).toContain("This Mac's org folder has not moved yet");
    expect(text).toContain("claude is missing");
    expect(text).toContain("Run claude plugin marketplace add");
  });

  test("a partial converge says the folder moved and names the step left", () => {
    const text = renderPlain(renameBlocks({ from: "acme", to: "gadgets", converged: false, convergeState: "partial", convergeDetail: "Moved acme to /orgs/gadgets", convergeRemedy: "Run claude plugin marketplace add acme" }));
    expect(text).toContain("This Mac's org folder moved, with one step left for you");
    expect(text).toContain("Moved acme to /orgs/gadgets");
    expect(text).toContain("Run claude plugin marketplace add acme");
    expect(text).not.toContain("has not moved yet");
  });

  test("the real converge seam runs the org.folder step", async () => {
    const w = orgWorld();
    const spy = spyOn(orgFolder, "convergeOrgFolder").mockResolvedValue({ state: "done", detail: "Moved acme" });
    try {
      const lines: string[] = [];
      await teamRename(["gadgets", "--json"], {}, { ...realTeamDeps(), probes: w.p, print: (s) => lines.push(s), forgeToken: async () => null });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ converged: true });
    } finally { spy.mockRestore(); }
  }, 15_000);
});
