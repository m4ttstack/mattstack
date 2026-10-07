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
    const result = await renameOrg(w.p, "acme", "gadgets", seams());
    expect(result).toMatchObject({ converged: true });
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

describe("renameOrg", () => {
  test("writes the marker, commits it, publishes it and converges this Mac", async () => {
    const w = orgWorld();
    const s = seams();
    const result = await renameOrg(w.p, "acme", "gadgets", s);
    expect(result).toEqual({ from: "acme", to: "gadgets", converged: true });
    expect(marker(w.root)).toMatchObject({ role: "org", org: "gadgets" });
    expect(w.git("log", "-1", "--format=%s").trim()).toBe("org: rename to gadgets");
    expect(w.git("show", "--name-only", "--format=", "HEAD").trim()).toBe("mattstack/mattstack.jsonc");
    expect(w.atOrigin("log", "-1", "--format=%s", "main").trim()).toBe("org: rename to gadgets");
    expect(w.git("status", "--porcelain")).toBe("");
    expect(s.converged).toBe(1);
  });

  test("on a trial branch the origin has never seen, it publishes that branch and leaves main alone", async () => {
    const w = orgWorld();
    w.git("switch", "-q", "-c", "org-trial");
    await renameOrg(w.p, "acme", "gadgets", seams());
    expect(w.atOrigin("log", "-1", "--format=%s", "org-trial").trim()).toBe("org: rename to gadgets");
    expect(w.atOrigin("log", "-1", "--format=%s", "main").trim()).toBe("seed");
    expect(w.pushes.flat().join(" ")).not.toContain("refs/heads/main");
  });

  test("a push the origin refuses undoes the rename commit and converges nothing", async () => {
    const w = orgWorld();
    const hook = join(w.remote, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const s = seams();
    await expect(renameOrg(w.p, "acme", "gadgets", s)).rejects.toMatchObject({ code: "org-behind", thenRun: "rt team rename gadgets" });
    expect(marker(w.root).org).toBe("acme");
    expect(w.git("log", "-1", "--format=%s").trim()).toBe("seed");
    expect(w.git("status", "--porcelain")).toBe("");
    expect(s.converged).toBe(0);
  });

  test("a converge that does not finish still reports the rename, with its detail and remedy", async () => {
    const w = orgWorld();
    const result = await renameOrg(w.p, "acme", "gadgets", seams({ state: "partial", detail: "claude is missing", remedy: "Run claude plugin marketplace add" }));
    expect(result).toEqual({ from: "acme", to: "gadgets", converged: false, convergeDetail: "claude is missing", convergeRemedy: "Run claude plugin marketplace add" });
    expect(w.atOrigin("log", "-1", "--format=%s", "main").trim()).toBe("org: rename to gadgets");
  });

  test("a converge that throws still reports the published rename", async () => {
    const w = orgWorld();
    const result = await renameOrg(w.p, "acme", "gadgets", { forgeToken: async () => null, converge: async () => { throw new Error("the daemon went away"); } });
    expect(result).toMatchObject({ from: "acme", to: "gadgets", converged: false, convergeDetail: "the daemon went away" });
    expect(w.atOrigin("show", "main:mattstack/mattstack.jsonc")).toContain(`"org": "gadgets"`);
  });

  test("a marker with comments keeps them", async () => {
    const w = orgWorld();
    writeFileSync(join(w.root, "mattstack", "mattstack.jsonc"), `// the org marker\n{\n  "role": "org",\n  "org": "acme"\n}\n`);
    w.git("commit", "-q", "-am", "comment the marker");
    w.git("push", "-q", "origin", "main");
    await renameOrg(w.p, "acme", "gadgets", seams());
    const text = readFileSync(join(w.root, "mattstack", "mattstack.jsonc"), "utf8");
    expect(text).toContain("// the org marker");
    expect(text).toContain(`"org": "gadgets"`);
  });
});
