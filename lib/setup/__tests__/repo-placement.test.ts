import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import { setKvValue } from "../../state/index.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import {
  checkCheckout,
  checkCloneTarget,
  clearCloneFailure,
  clearDeferred,
  clearPlacement,
  defaultPlacement,
  findCheckout,
  markDeferred,
  placementsPath,
  readPlacements,
  recordCloneFailure,
  resolvePlacements,
  takenFor,
  writePlacement,
} from "../repo-placement.ts";
import { fakeProbes, gitRepo, realFsProbes } from "./fakes.ts";

const WIDGETS = "gitlab.com/acme/widgets";
const ACME_API = "gitlab.com/acme/acme-api";

function linkedWorktree(main: string, linked: string): { main: string; linked: string } {
  gitRepo(main, { origin: "https://gitlab.com/acme/widgets.git" });
  execSync(`git -C ${JSON.stringify(main)} -c user.name=dev1 -c user.email=dev1@example.com commit -q --allow-empty -m init`);
  execSync(`git -C ${JSON.stringify(main)} worktree add -q -b feature ${JSON.stringify(linked)}`);
  return { main, linked };
}

let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-placement-")));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("checkCheckout", () => {
  test("a clone of the repo is accepted at the path given", async () => {
    const path = join(home, "code", "widgets");
    gitRepo(path, { origin: "https://gitlab.com/acme/widgets.git" });
    expect(await checkCheckout(realFsProbes(home), WIDGETS, path, { tracked: [] })).toEqual({ ok: true, path });
  });

  test("a linked worktree of the repo is refused, naming the main checkout", async () => {
    const { linked } = linkedWorktree(join(home, "code", "widgets"), join(home, "trees", "widgets-feature"));
    expect(await checkCheckout(realFsProbes(home), WIDGETS, linked, { tracked: [] })).toEqual({
      ok: false,
      detail: "~/trees/widgets-feature is a worktree of widgets. Choose your main checkout at ~/code/widgets.",
    });
  });

  test("a linked worktree with relative gitdir paths is refused the same way", async () => {
    const main = join(home, "code", "widgets");
    gitRepo(main, { origin: "https://gitlab.com/acme/widgets.git" });
    execSync(`git -C ${JSON.stringify(main)} -c user.name=dev1 -c user.email=dev1@example.com commit -q --allow-empty -m init`);
    const linked = join(home, "trees", "w");
    execSync(`git -C ${JSON.stringify(main)} -c worktree.useRelativePaths=true worktree add -q -b feature ${JSON.stringify(linked)}`);
    expect(await checkCheckout(realFsProbes(home), WIDGETS, linked, { tracked: [] })).toEqual({
      ok: false,
      detail: "~/trees/w is a worktree of widgets. Choose your main checkout at ~/code/widgets.",
    });
  });

  test("a clone whose git dir lives elsewhere is a main checkout", async () => {
    const path = join(home, "code", "widgets");
    gitRepo(path, { origin: "https://gitlab.com/acme/widgets.git" });
    const gitDir = join(home, "gitdirs", "widgets.git");
    mkdirSync(join(home, "gitdirs"), { recursive: true });
    execSync(`mv ${JSON.stringify(join(path, ".git"))} ${JSON.stringify(gitDir)}`);
    writeFileSync(join(path, ".git"), `gitdir: ${gitDir}\n`);
    execSync(`git --git-dir=${JSON.stringify(gitDir)} config core.worktree ${JSON.stringify(path)}`);
    expect(await checkCheckout(realFsProbes(home), WIDGETS, path, { tracked: [] })).toEqual({ ok: true, path });
  });

  test("a trailing slash and ~ are normalised", async () => {
    const path = join(home, "code", "widgets");
    gitRepo(path, { origin: "git@gitlab.com:acme/widgets.git" });
    const p = realFsProbes(home);
    expect(await checkCheckout(p, WIDGETS, `${path}/`, { tracked: [] })).toEqual({ ok: true, path });
    expect(await checkCheckout(p, WIDGETS, "~/code/widgets/", { tracked: [] })).toEqual({ ok: true, path });
  });

  test("a relative path is recorded absolute", async () => {
    const path = join(home, "code", "widgets");
    gitRepo(path, { origin: "https://gitlab.com/acme/widgets.git" });
    expect(await checkCheckout(realFsProbes(home), WIDGETS, relative(process.cwd(), path), { tracked: [] })).toEqual({ ok: true, path });
  });

  test("a symlink to the checkout is judged by the real path and returned as given", async () => {
    const real = join(home, "src", "widgets");
    gitRepo(real, { origin: "https://gitlab.com/acme/widgets.git" });
    const link = join(home, "widgets-link");
    symlinkSync(real, link);
    expect(await checkCheckout(realFsProbes(home), WIDGETS, link, { tracked: [] })).toEqual({ ok: true, path: link });
  });

  test("a folder that holds repos points at the one inside it", async () => {
    gitRepo(join(home, "code", "widgets"), { origin: "https://gitlab.com/acme/widgets.git" });
    expect(await checkCheckout(realFsProbes(home), WIDGETS, join(home, "code"), { tracked: [] })).toEqual({
      ok: false,
      detail: "~/code holds repos but isn't one. Choose the widgets folder inside it.",
    });
  });

  test("a checkout of another tracked repo names it by its basename", async () => {
    gitRepo(join(home, "code", "widgets"), { origin: "https://gitlab.com/acme/widgets.git" });
    expect(await checkCheckout(realFsProbes(home), ACME_API, join(home, "code", "widgets"), { tracked: [WIDGETS, ACME_API] })).toEqual({
      ok: false,
      detail: "~/code/widgets is your widgets checkout, not acme-api.",
    });
  });

  test("a checkout of an untracked repo names its identity", async () => {
    gitRepo(join(home, "code", "gadgets"), { origin: "https://github.com/acme/gadgets.git" });
    expect(await checkCheckout(realFsProbes(home), ACME_API, join(home, "code", "gadgets"), { tracked: [ACME_API] })).toEqual({
      ok: false,
      detail: "~/code/gadgets is a checkout of github.com/acme/gadgets, not acme-api.",
    });
  });

  test("any other folder is not a git checkout", async () => {
    mkdirSync(join(home, "foo"), { recursive: true });
    expect(await checkCheckout(realFsProbes(home), WIDGETS, "~/foo", { tracked: [] })).toEqual({ ok: false, detail: "~/foo isn't a git checkout." });
  });
});

describe("checkCloneTarget", () => {
  test("a new folder under a missing parent is fine", () => {
    const path = join(home, "code", "acme-api");
    expect(checkCloneTarget(realFsProbes(home), "~/code/acme-api/", [])).toEqual({ ok: true, path });
  });

  test("an existing empty folder is fine", () => {
    const path = join(home, "code", "acme-api");
    mkdirSync(path, { recursive: true });
    expect(checkCloneTarget(realFsProbes(home), path, [])).toEqual({ ok: true, path });
  });

  test("an existing non-empty folder is refused", () => {
    const path = join(home, "code", "acme-api");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "notes.txt"), "");
    expect(checkCloneTarget(realFsProbes(home), path, [])).toEqual({
      ok: false,
      detail: "~/code/acme-api already exists. Choose an empty or new folder.",
    });
  });

  test("a relative path is made absolute", () => {
    const path = join(home, "code", "acme-api");
    expect(checkCloneTarget(realFsProbes(home), relative(process.cwd(), path), [])).toEqual({ ok: true, path });
  });

  test("two repos with one basename cannot share a destination", () => {
    const path = join(home, "code", "api");
    expect(checkCloneTarget(realFsProbes(home), path, [{ identity: "gitlab.com/a/api", path }])).toEqual({
      ok: false,
      detail: "~/code/api is where api goes. Choose another folder.",
    });
  });
});

describe("findCheckout and defaultPlacement", () => {
  test("a clone under ~/code is found with no repo roots configured", async () => {
    const path = join(home, "code", "widgets");
    gitRepo(path, { origin: "https://gitlab.com/acme/widgets.git" });
    expect(await findCheckout(realFsProbes(home), WIDGETS, { rootPaths: [] })).toBe(path);
  });

  test("the index row comes before a clone in a scanned folder", async () => {
    const indexed = join(home, "elsewhere", "w");
    gitRepo(indexed, { origin: "https://gitlab.com/acme/widgets.git" });
    gitRepo(join(home, "code", "widgets"), { origin: "https://gitlab.com/acme/widgets.git" });
    setKvValue("repo-index", serializeIdentity({ kind: "remote", id: WIDGETS }), indexed);
    expect(await findCheckout(realFsProbes(home), WIDGETS, { rootPaths: [join(home, "code")] })).toBe(indexed);
  });

  test("a linked worktree is never found; its main checkout is", async () => {
    const { main } = linkedWorktree(join(home, "elsewhere", "widgets"), join(home, "code", "widgets"));
    const p = realFsProbes(home);
    expect(await findCheckout(p, WIDGETS, { rootPaths: [] })).toBeNull();
    expect(await findCheckout(p, WIDGETS, { rootPaths: [join(home, "elsewhere")] })).toBe(main);
  });

  test("an index row pointing at a linked worktree is skipped", async () => {
    const { linked } = linkedWorktree(join(home, "elsewhere", "widgets"), join(home, "trees", "w"));
    setKvValue("repo-index", serializeIdentity({ kind: "remote", id: WIDGETS }), linked);
    expect(await findCheckout(realFsProbes(home), WIDGETS, { rootPaths: [] })).toBeNull();
  });

  test("a found checkout is the default", async () => {
    const path = join(home, "work", "widgets");
    gitRepo(path, { origin: "https://gitlab.com/acme/widgets.git" });
    expect(await defaultPlacement(realFsProbes(home), WIDGETS, { rootPaths: [join(home, "work")], placedParents: [] })).toEqual({ mode: "checkout", path, found: true });
  });

  test("otherwise a clone next to the placed repos, then the first root, then the detected folder", async () => {
    const p = realFsProbes(home);
    const placed = join(home, "placed");
    const root = join(home, "root");
    expect(await defaultPlacement(p, ACME_API, { rootPaths: [root], placedParents: [placed] })).toEqual({ mode: "clone", path: join(placed, "acme-api"), found: false });
    expect(await defaultPlacement(p, ACME_API, { rootPaths: [root], placedParents: [] })).toEqual({ mode: "clone", path: join(root, "acme-api"), found: false });
    mkdirSync(join(home, "src"), { recursive: true });
    expect(await defaultPlacement(p, ACME_API, { rootPaths: [], placedParents: [] })).toEqual({ mode: "clone", path: join(home, "src", "acme-api"), found: false });
  });

  test("with nothing to go by, Documents/GitHub under home", async () => {
    expect(await defaultPlacement(realFsProbes(home), ACME_API, { rootPaths: [], placedParents: [] })).toEqual({
      mode: "clone",
      path: join(home, "Documents", "GitHub", "acme-api"),
      found: false,
    });
  });
});

describe("resolvePlacements and takenFor", () => {
  test("two repos named api: the first keeps the default, the second's default clashes", async () => {
    const tracked = ["gitlab.com/a/api", "github.com/b/api"];
    const code = join(home, "code");
    const p = realFsProbes(home);
    const resolved = await resolvePlacements(p, tracked, [code]);
    expect(resolved["gitlab.com/a/api"]).toEqual({ mode: "clone", path: join(code, "api"), source: "default" });
    expect(resolved["github.com/b/api"]).toEqual({ mode: "clone", path: join(code, "api"), source: "default" });

    expect(takenFor(resolved, tracked, "gitlab.com/a/api")).toEqual([]);
    expect(checkCloneTarget(p, join(code, "api"), takenFor(resolved, tracked, "github.com/b/api"))).toEqual({
      ok: false,
      detail: "~/code/api is where api goes. Choose another folder.",
    });
  });

  test("a later repo's recorded folder is taken from an earlier one", async () => {
    const tracked = [WIDGETS, ACME_API];
    const p = realFsProbes(home);
    writePlacement(p, ACME_API, { mode: "clone", path: join(home, "x") });
    const resolved = await resolvePlacements(p, tracked, []);
    expect(takenFor(resolved, tracked, WIDGETS)).toEqual([{ identity: ACME_API, path: join(home, "x") }]);
  });

  test("a new clone lands next to a found checkout", async () => {
    gitRepo(join(home, "code", "widgets"), { origin: "https://gitlab.com/acme/widgets.git" });
    const resolved = await resolvePlacements(realFsProbes(home), [WIDGETS, ACME_API], []);
    expect(resolved[WIDGETS]).toEqual({ mode: "checkout", path: join(home, "code", "widgets"), source: "found" });
    expect(resolved[ACME_API]).toEqual({ mode: "clone", path: join(home, "code", "acme-api"), source: "default" });
  });
});

describe("the placements file", () => {
  test("starts empty", () => {
    expect(readPlacements(realFsProbes(home))).toEqual({ placements: {}, deferred: [], failed: {} });
  });

  test("records placements, deferrals and failures, private to the user", () => {
    const p = realFsProbes(home);
    markDeferred(p, WIDGETS);
    markDeferred(p, WIDGETS);
    writePlacement(p, WIDGETS, { mode: "clone", path: join(home, "code", "widgets") });
    recordCloneFailure(p, ACME_API, "auth failed");

    expect(readPlacements(p)).toEqual({
      placements: { [WIDGETS]: { mode: "clone", path: join(home, "code", "widgets") } },
      deferred: [WIDGETS],
      failed: { [ACME_API]: "auth failed" },
    });
    expect(statSync(placementsPath(home)).mode & 0o777).toBe(0o600);

    clearPlacement(p, WIDGETS);
    clearDeferred(p, WIDGETS);
    clearCloneFailure(p, ACME_API);
    expect(readPlacements(p)).toEqual({ placements: {}, deferred: [], failed: {} });
  });

  test("each write lands whole through a rename, and a looser existing file comes out private", () => {
    const target = placementsPath("/Users/dev1");
    const p = fakeProbes({ home: "/Users/dev1", files: { [target]: JSON.stringify({ placements: {}, deferred: [ACME_API], failed: {} }) }, modes: { [target]: 0o644 } });
    markDeferred(p, WIDGETS);

    expect(p.calls.renames).toHaveLength(1);
    const [from, to] = p.calls.renames[0]!;
    expect(to).toBe(target);
    expect(from).not.toBe(target);
    expect(p.readFile(from)).toBeNull();
    expect(p.fileMode(target)).toBe(0o600);
    expect(readPlacements(p).deferred).toEqual([ACME_API, WIDGETS]);
  });

  test("a garbled file reads as empty", () => {
    const p = realFsProbes(home);
    mkdirSync(join(home, ".mattstack", "rt"), { recursive: true });
    writeFileSync(placementsPath(home), "{ not json");
    expect(readPlacements(p)).toEqual({ placements: {}, deferred: [], failed: {} });
  });
});
