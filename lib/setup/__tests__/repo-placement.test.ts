import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
  writePlacement,
} from "../repo-placement.ts";
import { gitRepo, realFsProbes } from "./fakes.ts";

const WIDGETS = "gitlab.com/acme/widgets";
const ACME_API = "gitlab.com/acme/acme-api";

let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-placement-")));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("checkCheckout", () => {
  test("a clone of the repo is accepted at the path given", async () => {
    const path = join(home, "code", "widgets");
    gitRepo(path, { origin: "https://gitlab.com/acme/widgets.git" });
    expect(await checkCheckout(realFsProbes(home), WIDGETS, path)).toEqual({ ok: true, path });
  });

  test("a trailing slash and ~ are normalised", async () => {
    const path = join(home, "code", "widgets");
    gitRepo(path, { origin: "git@gitlab.com:acme/widgets.git" });
    const p = realFsProbes(home);
    expect(await checkCheckout(p, WIDGETS, `${path}/`)).toEqual({ ok: true, path });
    expect(await checkCheckout(p, WIDGETS, "~/code/widgets/")).toEqual({ ok: true, path });
  });

  test("a symlink to the checkout is judged by the real path and returned as given", async () => {
    const real = join(home, "src", "widgets");
    gitRepo(real, { origin: "https://gitlab.com/acme/widgets.git" });
    const link = join(home, "widgets-link");
    symlinkSync(real, link);
    expect(await checkCheckout(realFsProbes(home), WIDGETS, link)).toEqual({ ok: true, path: link });
  });

  test("a folder that holds repos points at the one inside it", async () => {
    gitRepo(join(home, "code", "widgets"), { origin: "https://gitlab.com/acme/widgets.git" });
    expect(await checkCheckout(realFsProbes(home), WIDGETS, join(home, "code"))).toEqual({
      ok: false,
      detail: "~/code holds repos but isn't one. Choose the widgets folder inside it.",
    });
  });

  test("a checkout of another tracked repo names it by its basename", async () => {
    gitRepo(join(home, "code", "widgets"), { origin: "https://gitlab.com/acme/widgets.git" });
    expect(await checkCheckout(realFsProbes(home), ACME_API, join(home, "code", "widgets"), [WIDGETS, ACME_API])).toEqual({
      ok: false,
      detail: "~/code/widgets is your widgets checkout, not acme-api.",
    });
  });

  test("a checkout of an untracked repo names its identity", async () => {
    gitRepo(join(home, "code", "gadgets"), { origin: "https://github.com/acme/gadgets.git" });
    expect(await checkCheckout(realFsProbes(home), ACME_API, join(home, "code", "gadgets"), [ACME_API])).toEqual({
      ok: false,
      detail: "~/code/gadgets is a checkout of github.com/acme/gadgets, not acme-api.",
    });
  });

  test("any other folder is not a git checkout", async () => {
    mkdirSync(join(home, "foo"), { recursive: true });
    expect(await checkCheckout(realFsProbes(home), WIDGETS, "~/foo")).toEqual({ ok: false, detail: "~/foo isn't a git checkout." });
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

  test("the index row comes first", async () => {
    const path = join(home, "elsewhere", "w");
    gitRepo(path, { origin: "https://gitlab.com/acme/widgets.git" });
    setKvValue("repo-index", serializeIdentity({ kind: "remote", id: WIDGETS }), path);
    expect(await findCheckout(realFsProbes(home), WIDGETS, { rootPaths: [] })).toBe(path);
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

  test("a garbled file reads as empty", () => {
    const p = realFsProbes(home);
    mkdirSync(join(home, ".mattstack", "rt"), { recursive: true });
    writeFileSync(placementsPath(home), "{ not json");
    expect(readPlacements(p)).toEqual({ placements: {}, deferred: [], failed: {} });
  });
});
