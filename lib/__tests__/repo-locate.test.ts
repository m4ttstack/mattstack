/**
 * The locate core: plan a move by identity, then apply index + registry +
 * claim + git-admin rewrites as one unit.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { repoDataDir } from "../rt-paths.ts";
import { closeStateDb, listEndpointClaims, setKvValue } from "../state/index.ts";
import { loadRepoIndex, REPO_INDEX_NS } from "../repo-index.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../worktree/registry.ts";
import { saveClaims } from "../endpoint/store.ts";
import { deriveRepoIdentity, serializeIdentity } from "../settings/identity.ts";
import { classifyLocate } from "../team/org-folder-move.ts";
import { applyLocate, findLocateCandidates, isRefusal, parseRefusalText, planLocate, refusalWithNext, splitRefusalNext, __test__ as locateTest } from "../repo-locate.ts";

const LONG_DASH = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
/** A refusal a person reads: no long dash and no flag in the sentence. */
const plainWords = (message: string) => !LONG_DASH.test(message) && !message.includes("--");

describe("repo locate", () => {
  const origHome = process.env.HOME;
  let home: string;
  let scratch: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-locate-home-")));
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "rt-locate-repos-")));
    process.env.HOME = home;
    closeStateDb();
  });

  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  /** A repo with an origin remote, so its identity is remote-kind and survives the move. */
  function repoWithRemote(name: string): string {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    execSync(`git remote add origin https://gitlab.com/g/${name}.git`, { cwd: dir, stdio: "pipe" });
    execSync("git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init", { cwd: dir, stdio: "pipe" });
    return realpathSync(dir);
  }

  function localRepo(name: string): string {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    execSync("git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init", { cwd: dir, stdio: "pipe" });
    return realpathSync(dir);
  }

  function rec(over: Partial<TreeRecord> & { path: string }): TreeRecord {
    return { name: "t", kind: "unmanaged", branch: null, createdAt: "2026-01-01T00:00:00.000Z", ...over };
  }

  test("a directory that is not a git repo is refused", async () => {
    const plain = join(scratch, "plain");
    mkdirSync(plain);
    const out = await planLocate({ newPath: plain });
    expect(isRefusal(out) && out.refusal).toBe("not-a-git-repo");
    expect(isRefusal(out) && plainWords(out.message)).toBe(true);
  });

  test("nothing lost in the index is refused", async () => {
    const repo = repoWithRemote("alpha");
    const out = await planLocate({ newPath: repo });
    expect(isRefusal(out) && out.refusal).toBe("nothing-lost");
    expect(isRefusal(out) && plainWords(out.message)).toBe(true);
  });

  test("a derived identity matching no lost row refuses and names both sides", async () => {
    setKvValue(REPO_INDEX_NS, "remote:gitlab.com%2Fg%2Fsomething-else", join(scratch, "gone"));
    const repo = repoWithRemote("beta");

    const out = await planLocate({ newPath: repo });

    expect(isRefusal(out) && out.refusal).toBe("identity-mismatch");
    expect(isRefusal(out) && plainWords(out.message)).toBe(true);
    expect(isRefusal(out) && out.message).toBe(
      `${repo} holds gitlab.com/g/beta, and no missing repo rt knows is gitlab.com/g/beta. The missing ones are gitlab.com/g/something-else.`,
    );
  });

  test("a lost repo with the same name on another host is told apart from the one found", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Fg%2Fbeta", join(scratch, "gone"));
    const repo = repoWithRemote("beta");

    const out = await planLocate({ newPath: repo });

    expect(isRefusal(out) && out.refusal).toBe("identity-mismatch");
    expect(isRefusal(out) && out.message).toBe(
      `${repo} holds gitlab.com/g/beta, and no missing repo rt knows is gitlab.com/g/beta. The missing ones are github.com/g/beta.`,
    );
    expect(isRefusal(out) && out.message).not.toContain("remote:");
  });

  test("a named repo that is not the one found is named in full, host and all", async () => {
    const repo = repoWithRemote("beta");
    setKvValue(REPO_INDEX_NS, serializeIdentity(await deriveRepoIdentity(repo)), join(scratch, "gone-here"));
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Fg%2Fbeta", join(scratch, "gone-there"));

    const out = await planLocate({ newPath: repo, repo: "remote:github.com%2Fg%2Fbeta" });

    expect(isRefusal(out) && out.refusal).toBe("identity-mismatch");
    expect(isRefusal(out) && out.message).toBe(
      `${repo} holds gitlab.com/g/beta, but the repo you named is github.com/g/beta. rt matches a move by what a repo is, not by its name.`,
    );
  });

  test("a remote-less repo is refused: its identity IS its path, so a move mints a new one", async () => {
    setKvValue(REPO_INDEX_NS, `path:${encodeURIComponent(join(scratch, "gone"))}`, join(scratch, "gone"));
    const repo = localRepo("gamma");

    const out = await planLocate({ newPath: repo });

    expect(isRefusal(out) && out.refusal).toBe("identity-changed");
    expect(isRefusal(out) && plainWords(out.message)).toBe(true);
    expect(isRefusal(out) && out.message).toEndWith(`instead: rt repos register ${repo}`);
    expect(isRefusal(out) && splitRefusalNext(out.message)).toEqual({
      sentence: `${repo} has no remote, so rt knows a repo like this by its folder, and moving it makes it a new repo. Register the new folder instead.`,
      next: `rt repos register ${repo}`,
    });
  });

  test("a remote-less repo in a folder with a space gets a register command that pastes", async () => {
    setKvValue(REPO_INDEX_NS, `path:${encodeURIComponent(join(scratch, "gone"))}`, join(scratch, "gone"));
    const repo = localRepo("my repo");

    const out = await planLocate({ newPath: repo });

    expect(isRefusal(out) && out.message).toEndWith(`instead: rt repos register '${repo}'`);
    expect(isRefusal(out) && splitRefusalNext(out.message).next).toBe(`rt repos register '${repo}'`);
    expect(isRefusal(out) && splitRefusalNext(out.message).sentence).toStartWith(`${repo} has no remote`);
  });

  test("an old path that still exists is a second clone, not a move", async () => {
    const original = repoWithRemote("delta");
    const clone = join(scratch, "delta-clone");
    execSync(`git clone -q ${original} ${clone}`, { stdio: "pipe" });
    execSync(`git remote set-url origin https://gitlab.com/g/delta.git`, { cwd: clone, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, serializeIdentity(await deriveRepoIdentity(original)), original);

    const out = await planLocate({ newPath: realpathSync(clone) });

    expect(isRefusal(out) && out.refusal).toBe("old-path-exists");
    expect(isRefusal(out) && plainWords(out.message)).toBe(true);
  });

  test("a named repo whose row already points at this folder has nothing to move, not a second copy", async () => {
    const repo = repoWithRemote("widgets");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    setKvValue(REPO_INDEX_NS, identity, repo);

    const out = await planLocate({ newPath: repo, repo: identity });

    expect(isRefusal(out) && out.refusal).toBe("nothing-lost");
    expect(isRefusal(out) && out.message).toBe(`rt already knows widgets at ${repo}`);
  });

  test("the org folder step reads a clone already at its folder, row and all, as done", async () => {
    const repo = repoWithRemote("acme");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    setKvValue(REPO_INDEX_NS, identity, repo);

    const out = await planLocate({ newPath: repo, repo: identity });

    expect(isRefusal(out) && classifyLocate(`${out.refusal}: ${out.message}`)).toBe("done");
  });

  test("a named legacy row that already points at this folder has nothing to move", async () => {
    const repo = repoWithRemote("gadgets");
    setKvValue(REPO_INDEX_NS, "gadgets-legacy", repo);

    const out = await planLocate({ newPath: repo, repo: "gadgets-legacy" });

    expect(isRefusal(out) && out.refusal).toBe("nothing-lost");
  });

  test("plans the index keys, registry rewrite, claim rewrite and repair paths of a moved repo", async () => {
    const repo = repoWithRemote("epsilon");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const treePath = join(repo, ".worktrees", "t1");
    execSync(`git worktree add -q -b feat ${treePath}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, repo);
    setKvValue(REPO_INDEX_NS, "epsilon-legacy", repo);
    saveRegistry(identity, [rec({ name: "main", path: repo, kind: "main", branch: "main" })]);
    saveRegistry("epsilon-legacy", [rec({ name: "t1", path: treePath, kind: "ephemeral", state: "on-deck", branch: "feat" })]);
    saveClaims(identity, [{ worktree: treePath, role: "web", port: 4001, ts: "2026-01-01T00:00:00.000Z" }]);

    const moved = join(scratch, "epsilon-moved");
    renameSync(repo, moved);

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(`unexpected refusal: ${plan.message}`);

    expect(plan.identity).toBe(identity);
    expect(plan.oldPath).toBe(repo);
    expect(plan.newPath).toBe(moved);
    expect(plan.indexKeys.sort()).toEqual([identity, "epsilon-legacy"].sort());
    expect(plan.legacyKeys).toEqual(["epsilon-legacy"]);
    expect(plan.gitRepairPaths).toEqual([join(moved, ".worktrees", "t1")]);
    expect(plan.claimRewrites).toEqual([
      { repoKey: identity, worktree: treePath, newWorktree: join(moved, ".worktrees", "t1") },
    ]);
  });

  test("apply re-points the index, merges the pair's registries, rewrites claims and repairs git", async () => {
    const repo = repoWithRemote("zeta");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const treePath = join(repo, ".worktrees", "t1");
    execSync(`git worktree add -q -b feat ${treePath}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, repo);
    setKvValue(REPO_INDEX_NS, "zeta-legacy", repo);
    saveRegistry(identity, [rec({ name: "main", path: repo, kind: "main", branch: "main" })]);
    saveRegistry("zeta-legacy", [rec({ name: "t1", path: treePath, kind: "ephemeral", state: "claimed", owner: "matt", branch: "feat" })]);
    saveClaims(identity, [{ worktree: treePath, role: "web", port: 4001, ts: "2026-01-01T00:00:00.000Z" }]);

    const moved = join(scratch, "zeta-moved");
    renameSync(repo, moved);
    const newTree = join(moved, ".worktrees", "t1");

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(`unexpected refusal: ${plan.message}`);
    const result = await applyLocate(plan);

    expect(result.ok).toBe(true);
    expect(loadRepoIndex()[identity]).toBe(moved);
    expect(loadRepoIndex()["zeta-legacy"]).toBeUndefined();
    expect(loadRegistry(identity).map((t) => t.path).sort()).toEqual([moved, newTree].sort());
    expect(loadRegistry(identity).find((t) => t.path === newTree)).toMatchObject({ state: "claimed", owner: "matt" });
    expect(listEndpointClaims(identity)[0]?.worktree).toBe(newTree);
    expect(
      execSync("git worktree list --porcelain", { cwd: moved, encoding: "utf8" }),
    ).toContain(newTree);
    expect(result.legacyRows).toEqual([{ key: "zeta-legacy", outcome: "collapsed" }]);
  });

  test("a worktree outside the moved tree keeps its own path", async () => {
    const repo = repoWithRemote("iota");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const inTree = join(repo, ".worktrees", "t1");
    const external = join(scratch, "iota-external");
    execSync(`git worktree add -q -b feat ${inTree}`, { cwd: repo, stdio: "pipe" });
    execSync(`git worktree add -q -b other ${external}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, repo);
    saveRegistry(identity, [
      rec({ name: "main", path: repo, kind: "main", branch: "main" }),
      rec({ name: "t1", path: inTree, kind: "ephemeral", state: "on-deck", branch: "feat" }),
      rec({ name: "ext", path: external, kind: "ephemeral", state: "claimed", owner: "matt", branch: "other" }),
    ]);

    const moved = join(scratch, "iota-moved");
    renameSync(repo, moved);

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(`unexpected refusal: ${plan.message}`);
    const result = await applyLocate(plan);

    expect(plan.gitRepairPaths).toEqual([join(moved, ".worktrees", "t1")]);
    expect(result.ok).toBe(true);
    expect(loadRegistry(identity).find((t) => t.name === "ext")).toMatchObject({
      path: external,
      state: "claimed",
      owner: "matt",
    });
  });

  test("a registry record whose tree is gone is reported stale, not a failure", async () => {
    const repo = repoWithRemote("eta");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    setKvValue(REPO_INDEX_NS, identity, repo);
    saveRegistry(identity, [
      rec({ name: "main", path: repo, kind: "main", branch: "main" }),
      rec({ name: "ghost", path: join(repo, ".worktrees", "ghost"), kind: "ephemeral", state: "on-deck" }),
    ]);

    const moved = join(scratch, "eta-moved");
    renameSync(repo, moved);

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(`unexpected refusal: ${plan.message}`);
    const result = await applyLocate(plan);

    expect(result.ok).toBe(true);
    expect(result.stalePaths).toEqual([join(moved, ".worktrees", "ghost")]);
    expect(loadRepoIndex()[identity]).toBe(moved);
  });

  test("a failed verification writes nothing to state.db", async () => {
    const repo = repoWithRemote("theta");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const treePath = join(repo, ".worktrees", "t1");
    execSync(`git worktree add -q -b feat ${treePath}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, repo);
    saveRegistry(identity, [rec({ name: "main", path: repo, kind: "main", branch: "main" })]);
    saveClaims(identity, [{ worktree: treePath, role: "web", port: 4001, ts: "2026-01-01T00:00:00.000Z" }]);

    const moved = join(scratch, "theta-moved");
    renameSync(repo, moved);

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(`unexpected refusal: ${plan.message}`);
    // A directory that exists but git will never list: the exact shape a
    // failed `git worktree repair` leaves behind.
    const decoy = join(moved, "decoy");
    mkdirSync(decoy, { recursive: true });
    plan.registryRewrites[0]!.movedPaths.push(decoy);

    const result = await applyLocate(plan);

    expect(result.ok).toBe(false);
    expect(result.error).toContain(decoy);
    expect(loadRepoIndex()[identity]).toBe(repo);
    expect(loadRegistry(identity)[0]?.path).toBe(repo);
    expect(listEndpointClaims(identity)[0]?.worktree).toBe(treePath);
  });

  test("a linked worktree is refused as the new root", async () => {
    const repo = repoWithRemote("lambda");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const treePath = join(repo, ".worktrees", "t1");
    execSync(`git worktree add -q -b feat ${treePath}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, join(scratch, "gone"));

    const out = await planLocate({ newPath: treePath });

    expect(isRefusal(out) && out.refusal).toBe("not-main-worktree");
    expect(isRefusal(out) && plainWords(out.message)).toBe(true);
  });

  test("a registry record written between plan and apply is moved, not overwritten", async () => {
    const repo = repoWithRemote("pi");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const treePath = join(repo, ".worktrees", "t1");
    execSync(`git worktree add -q -b feat ${treePath}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, repo);
    saveRegistry(identity, [rec({ name: "main", path: repo, kind: "main", branch: "main" })]);

    const moved = join(scratch, "pi-moved");
    renameSync(repo, moved);

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(`unexpected refusal: ${plan.message}`);
    // The daemon provisioning a tree while the operator confirms the move: it
    // writes the pre-move spelling, because the index still says so.
    saveRegistry(identity, [
      ...loadRegistry(identity),
      rec({ name: "t1", path: treePath, kind: "ephemeral", state: "claimed", owner: "matt", branch: "feat" }),
    ]);

    const result = await applyLocate(plan);

    expect(result.ok).toBe(true);
    expect(loadRegistry(identity).map((t) => t.path).sort()).toEqual(
      [moved, join(moved, ".worktrees", "t1")].sort(),
    );
    expect(loadRegistry(identity).find((t) => t.name === "t1")).toMatchObject({ state: "claimed", owner: "matt" });
  });

  test("a failed git repair aborts before anything is written", async () => {
    const repo = repoWithRemote("omicron");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const treePath = join(repo, ".worktrees", "t1");
    execSync(`git worktree add -q -b feat ${treePath}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, repo);
    saveRegistry(identity, [rec({ name: "main", path: repo, kind: "main", branch: "main" })]);

    const moved = join(scratch, "omicron-moved");
    renameSync(repo, moved);

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(`unexpected refusal: ${plan.message}`);
    // A real directory git cannot repair — `git worktree repair` exits 1 on it.
    const decoy = join(moved, "decoy");
    mkdirSync(decoy, { recursive: true });
    plan.gitRepairPaths.push(decoy);

    const result = await applyLocate(plan);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("git worktree repair failed");
    expect(result.repaired).toEqual([]);
    expect(loadRepoIndex()[identity]).toBe(repo);
    expect(loadRegistry(identity)[0]?.path).toBe(repo);
  });

  test("verification rejects a plan rooted at a linked worktree, whatever built it", async () => {
    const repo = repoWithRemote("xi");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const treePath = join(repo, ".worktrees", "t1");
    execSync(`git worktree add -q -b feat ${treePath}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, join(scratch, "gone"));

    const result = await applyLocate({
      identity,
      oldPath: join(scratch, "gone"),
      newPath: treePath,
      indexKeys: [identity],
      legacyKeys: [],
      registryRewrites: [],
      claimRewrites: [],
      gitRepairPaths: [],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not the main worktree");
    expect(loadRepoIndex()[identity]).toBe(join(scratch, "gone"));
  });

  test("a claim whose worktree lies outside the moved root is left untouched", async () => {
    const repo = repoWithRemote("nu");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const inTree = join(repo, ".worktrees", "t1");
    const external = join(scratch, "nu-external");
    execSync(`git worktree add -q -b feat ${inTree}`, { cwd: repo, stdio: "pipe" });
    execSync(`git worktree add -q -b other ${external}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, repo);
    saveRegistry(identity, [rec({ name: "main", path: repo, kind: "main", branch: "main" })]);
    saveClaims(identity, [
      { worktree: inTree, role: "web", port: 4001, ts: "2026-01-01T00:00:00.000Z" },
      { worktree: external, role: "web", port: 4002, ts: "2026-01-01T00:00:00.000Z" },
    ]);

    const moved = join(scratch, "nu-moved");
    renameSync(repo, moved);

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(`unexpected refusal: ${plan.message}`);
    const result = await applyLocate(plan);

    expect(result.ok).toBe(true);
    expect(result.claimsRewritten).toBe(1);
    expect(listEndpointClaims(identity).map((c) => c.worktree).sort()).toEqual(
      [external, join(moved, ".worktrees", "t1")].sort(),
    );
  });

  test("a legacy key's claims land on the identity, re-rooted, and are left nowhere else", async () => {
    const repo = repoWithRemote("rho");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const treePath = join(repo, ".worktrees", "t1");
    execSync(`git worktree add -q -b feat ${treePath}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, repo);
    setKvValue(REPO_INDEX_NS, "rho-legacy", repo);
    saveRegistry(identity, [rec({ name: "main", path: repo, kind: "main", branch: "main" })]);
    saveClaims(identity, [{ worktree: treePath, role: "web", port: 4001, ts: "2026-01-01T00:00:00.000Z" }]);
    // The `web` row collides with the identity's on (worktree, role); `api` does not.
    saveClaims("rho-legacy", [
      { worktree: treePath, role: "web", port: 4999, ts: "2026-01-01T00:00:00.000Z" },
      { worktree: treePath, role: "api", port: 4002, ts: "2026-01-01T00:00:00.000Z" },
    ]);

    const moved = join(scratch, "rho-moved");
    renameSync(repo, moved);
    const newTree = join(moved, ".worktrees", "t1");

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(`unexpected refusal: ${plan.message}`);
    const result = await applyLocate(plan);

    expect(result.ok).toBe(true);
    expect(listEndpointClaims("rho-legacy")).toEqual([]);
    expect(listEndpointClaims(identity).map((c) => [c.worktree, c.role, c.port])).toEqual([
      [newTree, "api", 4002],
      [newTree, "web", 4001],
    ]);
  });

  test("a legacy row whose data dir cannot all move keeps naming the OLD path", async () => {
    const repo = repoWithRemote("sigma");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    const treePath = join(repo, ".worktrees", "t1");
    execSync(`git worktree add -q -b feat ${treePath}`, { cwd: repo, stdio: "pipe" });
    setKvValue(REPO_INDEX_NS, identity, repo);
    setKvValue(REPO_INDEX_NS, "sigma-legacy", repo);
    saveRegistry(identity, [rec({ name: "main", path: repo, kind: "main", branch: "main" })]);
    saveRegistry("sigma-legacy", [rec({ name: "t1", path: treePath, kind: "ephemeral", state: "on-deck", branch: "feat" })]);
    // The one collision migrateRepoData refuses to guess at: the same filename
    // under both names.
    for (const key of [identity, "sigma-legacy"]) {
      mkdirSync(repoDataDir(key), { recursive: true });
      writeFileSync(join(repoDataDir(key), "notes.json"), "{}");
    }

    const moved = join(scratch, "sigma-moved");
    renameSync(repo, moved);
    const newTree = join(moved, ".worktrees", "t1");

    const plan = await planLocate({ newPath: moved });
    if (isRefusal(plan)) throw new Error(`unexpected refusal: ${plan.message}`);
    const result = await applyLocate(plan);

    expect(result.ok).toBe(true);
    expect(result.legacyRows).toEqual([
      { key: "sigma-legacy", outcome: "retained", reason: "both names hold notes.json" },
    ]);
    expect(loadRepoIndex()["sigma-legacy"]).toBe(repo);
    expect(loadRepoIndex()[identity]).toBe(moved);
    expect(loadRegistry(identity).map((t) => t.path).sort()).toEqual([moved, newTree].sort());
    expect(loadRegistry("sigma-legacy")).toEqual([]);
  });

  test("candidates pair a scanned directory with the lost row it derives", async () => {
    const repo = repoWithRemote("kappa");
    const identity = serializeIdentity(await deriveRepoIdentity(repo));
    setKvValue(REPO_INDEX_NS, identity, repo);

    const moved = join(scratch, "kappa-moved");
    renameSync(repo, moved);

    expect(await findLocateCandidates()).toEqual([{ path: moved, identity }]);
  });

  test("a lost legacy row named after the moved folder does not hide it from the candidates", async () => {
    // The live anchor is what makes `scratch` a scan root once the pair's own
    // parent stops naming one.
    const anchor = repoWithRemote("anchor");
    setKvValue(REPO_INDEX_NS, serializeIdentity(await deriveRepoIdentity(anchor)), anchor);

    const nest = join(scratch, "nest");
    mkdirSync(nest, { recursive: true });
    const repo = join(nest, "mu");
    mkdirSync(repo, { recursive: true });
    execSync("git init -q -b main", { cwd: repo, stdio: "pipe" });
    execSync("git remote add origin https://gitlab.com/g/mu.git", { cwd: repo, stdio: "pipe" });
    execSync("git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init", { cwd: repo, stdio: "pipe" });
    const identity = serializeIdentity(await deriveRepoIdentity(realpathSync(repo)));
    setKvValue(REPO_INDEX_NS, identity, realpathSync(repo));
    setKvValue(REPO_INDEX_NS, "mu", realpathSync(repo));

    const moved = join(scratch, "mu");
    renameSync(repo, moved);

    expect(await findLocateCandidates()).toEqual([{ path: moved, identity }]);
  });
});

test("a refusal sent as its code and message reads back; any other error does not", () => {
  expect(parseRefusalText("old-path-exists: widgets is still at /x, so this folder is a second copy, not a move")).toEqual({
    refusal: "old-path-exists",
    message: "widgets is still at /x, so this folder is a second copy, not a move",
  });
  expect(parseRefusalText("git worktree repair failed: exit 1")).toBeNull();
  expect(parseRefusalText("The rt daemon is running but did not answer")).toBeNull();
});

test("a command joined to a refusal reads back apart from its sentence", () => {
  const message = refusalWithNext("Register the new folder instead", "rt repos register /a/b");
  expect(message).toBe("Register the new folder instead: rt repos register /a/b");
  expect(splitRefusalNext(message)).toEqual({ sentence: "Register the new folder instead.", next: "rt repos register /a/b" });
  expect(splitRefusalNext("widgets is still at /x, so this folder is a second copy, not a move")).toEqual({
    sentence: "widgets is still at /x, so this folder is a second copy, not a move",
  });
});

test("a command that is not an rt command is refused rather than joined where it cannot be found again", () => {
  expect(() => refusalWithNext("Do this", "git status")).toThrow();
});

test("a kept legacy row names each reason in plain words", () => {
  const base = { moved: [], merged: [], refused: [], removedDir: false };
  expect(locateTest.retentionReason({ ...base, registry: "refused" })).toBe("rt could not carry over its worktrees");
  expect(locateTest.retentionReason({ ...base, refused: ["notes.json"], registry: "refused" })).toBe("both names hold notes.json; rt could not carry over its worktrees");
});
