import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadRepoIndex, REPO_INDEX_NS } from "../repo-index.ts";
import { applyLocate, isRefusal, planLocate } from "../repo-locate.ts";
import { reidentify } from "../repo-reidentify.ts";
import { closeStateDb, setKvValue } from "../state/index.ts";
import { saveRegistry, loadRegistry, type TreeRecord } from "../worktree/registry.ts";

const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

describe("reidentify then locate", () => {
  const origHome = process.env.HOME;
  let home: string;
  let scratch: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reid-locate-home-")));
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "rt-reid-locate-repos-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  function repo(remote: string): string {
    const dir = join(scratch, "checkout");
    mkdirSync(dir, { recursive: true });
    execSync(`git init -q -b main && git remote add origin ${remote} && git commit -q --allow-empty -m init`, { cwd: dir });
    return dir;
  }

  test("locate refuses before reidentify and re-points after", async () => {
    const path = repo("https://github.com/acme/old.git");
    setKvValue(REPO_INDEX_NS, OLD, path);
    saveRegistry(OLD, [{ name: "main", path, kind: "main", branch: "main", state: "claimed", createdAt: "2026-01-01T00:00:00.000Z" } as TreeRecord]);
    execSync("git remote set-url origin https://github.com/acme/new.git", { cwd: path });
    const moved = join(scratch, "moved");
    renameSync(path, moved);

    const before = await planLocate({ newPath: moved });
    expect(isRefusal(before) && before.refusal).toBe("identity-mismatch");

    const r = await reidentify("github.com/acme/old", "github.com/acme/new");
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(true);

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(plan.message);
    expect(plan.identity).toBe(NEW);
    const result = await applyLocate(plan);
    expect(result.ok).toBe(true);
    expect(loadRepoIndex()[NEW]).toBe(moved);
    expect(loadRegistry(NEW)[0]!.path).toBe(moved);
  });
});
