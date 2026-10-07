import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { childEnv } from "../../subprocess.ts";
import { renameOrg, type ConvergeOutcome, type RenameSeams } from "../rename.ts";
import { teamLocalPath } from "../team-local.ts";
import { cleanupOrgWorlds, orgWorld } from "./org-world.ts";

afterEach(cleanupOrgWorlds);

function seams(outcome: ConvergeOutcome = { state: "done", detail: "Moved acme" }): RenameSeams & { converged: number } {
  const s = { converged: 0, forgeToken: async () => null, converge: async () => { s.converged += 1; return outcome; } };
  return s;
}

const marker = (root: string) => JSON.parse(readFileSync(join(root, "mattstack", "mattstack.jsonc"), "utf8")) as { org: string };

describe("renameOrg refusals", () => {
  test("a member who is not an admin is refused and nothing is written", async () => {
    const w = orgWorld("dev2");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "rename-not-admin", why: "Ask dev1 to rename it." });
    expect(marker(w.root).org).toBe("acme");
  });

  test("a name that breaks the slug rule is refused before anything is written", async () => {
    const w = orgWorld();
    await expect(renameOrg(w.p, "acme", "Acme Labs", seams())).rejects.toMatchObject({ code: "bad-org-name" });
    expect(marker(w.root).org).toBe("acme");
    expect(w.git("status", "--porcelain")).toBe("");
  });

  test("the current name is refused", async () => {
    const w = orgWorld();
    await expect(renameOrg(w.p, "acme", "acme", seams())).rejects.toMatchObject({ code: "rename-same-name" });
  });

  test("a name another folder under orgs already holds is refused", async () => {
    const w = orgWorld();
    mkdirSync(join(w.home, ".mattstack", "orgs", "gadgets"), { recursive: true });
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "rename-name-taken" });
  });

  test("a name with a leftover rt record is refused", async () => {
    const w = orgWorld();
    writeFileSync(teamLocalPath(w.home, "gadgets"), "{}\n");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "rename-name-taken" });
  });

  test("a clone whose marker already names another org is refused until it converges", async () => {
    const w = orgWorld();
    writeFileSync(join(w.root, "mattstack", "mattstack.jsonc"), `${JSON.stringify({ role: "org", org: "widgets" }, null, 2)}\n`);
    w.git("commit", "-q", "-am", "marker moved elsewhere");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "org-not-converged", next: "rt setup update --force" });
  });

  test("uncommitted changes to tracked files are refused", async () => {
    const w = orgWorld();
    writeFileSync(join(w.root, ".claude-plugin", "marketplace.json"), "{}\n");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "org-uncommitted" });
  });

  test("an untracked file is not an uncommitted change", async () => {
    const w = orgWorld();
    writeFileSync(join(w.root, "notes.txt"), "mine\n");
    const result = await renameOrg(w.p, "acme", "gadgets", seams()).catch((err: unknown) => err);
    expect(result).not.toMatchObject({ code: "org-uncommitted" });
  });

  test("a clone behind its origin is refused and pointed at a pull", async () => {
    const w = orgWorld();
    const other = join(w.home, "other");
    execFileSync("git", ["clone", "-q", w.remote, other], { env: childEnv() });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=dev2", "-c", "user.email=dev2@example.test", ...args], { cwd: other, env: childEnv() });
    writeFileSync(join(other, "later.txt"), "x\n");
    git("add", "later.txt");
    git("commit", "-q", "-m", "later");
    git("push", "-q", "origin", "main");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "org-behind", next: "rt team pull --team acme", thenRun: "rt team rename gadgets" });
    expect(marker(w.root).org).toBe("acme");
  });

  test("a detached clone is refused", async () => {
    const w = orgWorld();
    w.git("checkout", "-q", "--detach");
    await expect(renameOrg(w.p, "acme", "gadgets", seams())).rejects.toMatchObject({ code: "org-detached" });
  });
});
