import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { removeIndexRow } from "../../repo-index.ts";
import { setKvValue } from "../../state/index.ts";
import { serializeIdentity } from "../../settings/identity.ts";
import type { OrgRef, Row } from "../contract.ts";
import { markDeferred, recordCloneFailure, writePlacement } from "../repo-placement.ts";
import { updateSetupState } from "../state.ts";
import type { TeamSnapshot } from "../team-settings.ts";
import { repoPlacementRows } from "../validators/repos.ts";
import { gitRepo, realFsProbes } from "./fakes.ts";

const WIDGETS = "gitlab.com/acme/widgets";
const ACME_API = "gitlab.com/acme/acme-api";
const THEN = ["setup", "apply", "--only", "repos.clone"];
const TEAM: OrgRef = { slug: "acme", name: "acme", mode: "none" };

function snapshot(trackingIdentities: string[]): TeamSnapshot {
  return { slug: "acme", integrations: {}, trackingIdentities, marketplaces: [], plugins: [], remote: null };
}

type PlaceRepo = Extract<NonNullable<Row["action"]>, { type: "place-repo" }>;
const action = (r: Row | undefined): PlaceRepo => r!.action as PlaceRepo;
const byId = (rows: Row[], identity: string) => rows.find((r) => r.id === `repos.place:${identity}`);

let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-repos-rows-")));
});
afterEach(() => {
  for (const identity of [WIDGETS, ACME_API]) removeIndexRow(serializeIdentity({ kind: "remote", id: identity }));
  rmSync(home, { recursive: true, force: true });
});

/** The home repo the Join page creates before Install. */
function homeRepo(): void {
  mkdirSync(join(home, ".mattstack", "user", ".git"), { recursive: true });
}

/** After Install: Install stamped its start, so an answer lands right away. */
function installed(): void {
  homeRepo();
  updateSetupState(realFsProbes(home), (state) => ({ ...state, installRanAt: "2026-10-29T00:00:00.000Z" }));
}

describe("repoPlacementRows: one row per tracked repo", () => {
  test("a found checkout reads ready; the other repo's clone goes next to it", async () => {
    const widgets = join(home, "code", "widgets");
    gitRepo(widgets, { origin: "https://gitlab.com/acme/widgets.git" });
    const rows = await repoPlacementRows(realFsProbes(home), TEAM, snapshot([WIDGETS, ACME_API]));

    expect(rows.map((r) => r.id)).toEqual([`repos.place:${WIDGETS}`, `repos.place:${ACME_API}`]);
    expect(byId(rows, WIDGETS)).toMatchObject({ kind: "tool", title: "widgets", why: "gitlab.com/acme", required: true, recheck: "on-activate", status: "ready", detail: "Found your widgets checkout" });
    expect(action(byId(rows, WIDGETS))).toMatchObject({ type: "place-repo", label: "Locate…", identity: WIDGETS, repo: "widgets", mode: "checkout", checkoutPath: widgets, problem: null, then: null, oneClick: null, segmentRecords: true, awaitsRun: false });
    // The other segment never offers the checkout's own folder as a clone location.
    expect(action(byId(rows, WIDGETS)).clonePath).toBe(join(home, "Documents", "GitHub", "widgets"));

    expect(byId(rows, ACME_API)).toMatchObject({ title: "acme-api", status: "ready", detail: "rt clones it here when setup runs" });
    expect(action(byId(rows, ACME_API))).toEqual({
      type: "place-repo",
      label: "Choose…",
      identity: ACME_API,
      repo: "acme-api",
      mode: "clone",
      checkoutPath: null,
      clonePath: join(home, "code", "acme-api"),
      note: "rt clones it here when setup runs",
      problem: null,
      then: null,
      oneClick: null,
      segmentRecords: true,
      board: null,
      awaitsRun: false,
    });
    expect(rows.every((r) => !r.finishGated)).toBe(true);
  });

  test("the board repo's row says the board's agents start there, and its then repoints the board", async () => {
    installed();
    const rows = await repoPlacementRows(realFsProbes(home), TEAM, { ...snapshot([WIDGETS, ACME_API]), boardRepo: ACME_API });

    expect(action(byId(rows, ACME_API))).toMatchObject({ board: "The board starts here", then: ["setup", "apply", "--only", "board.restart"] });
    expect(action(byId(rows, WIDGETS))).toMatchObject({ board: null, then: THEN });
  });

  test("a checkout in the only repo folder still gets a clone location of its own", async () => {
    const widgets = join(home, "Documents", "GitHub", "widgets");
    gitRepo(widgets, { origin: "https://gitlab.com/acme/widgets.git" });
    const r = byId(await repoPlacementRows(realFsProbes(home), TEAM, snapshot([WIDGETS])), WIDGETS);

    expect(action(r)).toMatchObject({ mode: "checkout", checkoutPath: widgets, clonePath: join(home, "Documents", "GitHub", "widgets-2") });
  });

  test("a recorded checkout that moved since shows the problem and offers Locate again", async () => {
    const p = realFsProbes(home);
    mkdirSync(join(home, "old", "widgets"), { recursive: true });
    writePlacement(p, WIDGETS, { mode: "checkout", path: join(home, "old", "widgets") });
    const r = byId(await repoPlacementRows(p, TEAM, snapshot([WIDGETS])), WIDGETS);

    expect(r).toMatchObject({ status: "needs-you", detail: "~/old/widgets isn't a git checkout." });
    expect(action(r)).toMatchObject({ label: "Locate again…", mode: "checkout", problem: "~/old/widgets isn't a git checkout." });
  });

  test("two repos sharing a basename: the second row shows the clash", async () => {
    mkdirSync(join(home, "code"), { recursive: true });
    const rows = await repoPlacementRows(realFsProbes(home), TEAM, snapshot(["gitlab.com/a/api", "github.com/b/api"]));

    expect(rows.map((r) => [r.title, r.why, r.status])).toEqual([
      ["api", "gitlab.com/a", "ready"],
      ["api", "github.com/b", "needs-you"],
    ]);
    expect(action(rows[1]).problem).toBe("~/code/api is where api goes. Choose another folder.");
  });

  test("a joiner before Install has no tracked list, so no rows", async () => {
    expect(await repoPlacementRows(realFsProbes(home), { slug: "", name: "", mode: "join" }, snapshot([]))).toEqual([]);
  });

  test("a repo RT_SKIP_REPOS names gets no row", async () => {
    const p = { ...realFsProbes(home), env: { RT_SKIP_REPOS: "widgets" } };
    expect((await repoPlacementRows(p, TEAM, snapshot([WIDGETS, ACME_API]))).map((r) => r.title)).toEqual(["acme-api"]);
  });

  test("before Install there is no follow-up and the segment records; after it, the follow-up runs and the segment only flips the view", async () => {
    const p = realFsProbes(home);
    expect(action((await repoPlacementRows(p, TEAM, snapshot([ACME_API])))[0])).toMatchObject({ then: null, segmentRecords: true });
    installed();
    expect(action((await repoPlacementRows(p, TEAM, snapshot([ACME_API])))[0])).toMatchObject({ then: THEN, segmentRecords: false });
  });
  test("a home repo the Join page created is not Install: no follow-up, the segment records, the board is not repointed", async () => {
    homeRepo();
    const rows = await repoPlacementRows(realFsProbes(home), TEAM, { ...snapshot([WIDGETS, ACME_API]), boardRepo: ACME_API });

    expect(rows.map((r) => action(r))).toMatchObject([
      { then: null, segmentRecords: true },
      { then: null, segmentRecords: true },
    ]);
  });
});

describe("repoPlacementRows: a repo Install left for you", () => {
  test("every repos.place row is required before Install", async () => {
    installed();
    mkdirSync(join(home, "code"), { recursive: true });
    gitRepo(join(home, "code", "widgets"), { origin: "https://gitlab.com/acme/widgets.git" });
    const p = realFsProbes(home);
    markDeferred(p, ACME_API);
    const rows = await repoPlacementRows(p, TEAM, snapshot([WIDGETS, ACME_API]));

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.required)).toBe(true);
    expect(byId(rows, ACME_API)).toMatchObject({ required: true, finishGated: true });
  });

  test("unanswered: finish-gated, not waivable, with Clone here at the shown location", async () => {
    installed();
    mkdirSync(join(home, "code"), { recursive: true });
    const p = realFsProbes(home);
    markDeferred(p, ACME_API);
    const r = byId(await repoPlacementRows(p, TEAM, snapshot([ACME_API])), ACME_API);

    expect(r).toMatchObject({ status: "needs-you", finishGated: true, waivable: false, detail: "Choose where your repos go" });
    expect(action(r)).toMatchObject({ then: THEN, note: "Choose where your repos go", oneClick: { label: "Clone here", mode: "clone", path: join(home, "code", "acme-api") }, awaitsRun: false });
  });

  test("unanswered, but the shown location is another repo's: the problem, and no Clone here", async () => {
    installed();
    mkdirSync(join(home, "code"), { recursive: true });
    const p = realFsProbes(home);
    markDeferred(p, "github.com/b/api");
    const r = byId(await repoPlacementRows(p, TEAM, snapshot(["gitlab.com/a/api", "github.com/b/api"])), "github.com/b/api");

    expect(r).toMatchObject({ status: "needs-you", finishGated: true, detail: "~/code/api is where api goes. Choose another folder." });
    expect(action(r)).toMatchObject({ note: "Choose where your repos go", problem: "~/code/api is where api goes. Choose another folder.", oneClick: null, awaitsRun: false });
  });

  test("a recorded answer wins over the index, as it does for repos.clone", async () => {
    const p = realFsProbes(home);
    const widgets = join(home, "elsewhere", "widgets");
    gitRepo(widgets, { origin: "https://gitlab.com/acme/widgets.git" });
    setKvValue("repo-index", serializeIdentity({ kind: "remote", id: WIDGETS }), widgets);
    writePlacement(p, WIDGETS, { mode: "clone", path: join(home, "work", "widgets") });
    const r = byId(await repoPlacementRows(p, TEAM, snapshot([WIDGETS])), WIDGETS);

    expect(r).toMatchObject({ status: "ready", detail: "rt clones it here when setup runs" });
    expect(action(r)).toMatchObject({ mode: "clone", clonePath: join(home, "work", "widgets"), checkoutPath: null });
  });

  test("answered: still gated until the repo lands, and says where it goes next", async () => {
    installed();
    const p = realFsProbes(home);
    markDeferred(p, ACME_API);
    writePlacement(p, ACME_API, { mode: "clone", path: join(home, "work", "acme-api") });
    const r = byId(await repoPlacementRows(p, TEAM, snapshot([ACME_API])), ACME_API);

    expect(r).toMatchObject({ status: "needs-you", finishGated: true, waivable: false, detail: "rt clones it to ~/work/acme-api next" });
    expect(action(r)).toMatchObject({ mode: "clone", clonePath: join(home, "work", "acme-api"), oneClick: null, then: THEN, awaitsRun: true });
  });

  test("after a failed clone: the reason, and Retry with the recorded answer", async () => {
    installed();
    const p = realFsProbes(home);
    markDeferred(p, ACME_API);
    writePlacement(p, ACME_API, { mode: "clone", path: join(home, "work", "acme-api") });
    recordCloneFailure(p, ACME_API, "The last clone failed: fatal: repository not found (git exited 128)");
    const r = byId(await repoPlacementRows(p, TEAM, snapshot([ACME_API])), ACME_API);

    expect(r).toMatchObject({ status: "needs-you", finishGated: true, detail: "The last clone failed: fatal: repository not found (git exited 128)" });
    expect(action(r).oneClick).toEqual({ label: "Retry", mode: "clone", path: join(home, "work", "acme-api") });
    expect(action(r).problem).toBe("The last clone failed: fatal: repository not found (git exited 128)");
    expect(action(r).awaitsRun).toBe(false);
  });

  test("once the repo is in the index it reads ready", async () => {
    installed();
    const p = realFsProbes(home);
    const widgets = join(home, "elsewhere", "widgets");
    gitRepo(widgets, { origin: "https://gitlab.com/acme/widgets.git" });
    markDeferred(p, WIDGETS);
    setKvValue("repo-index", serializeIdentity({ kind: "remote", id: WIDGETS }), widgets);
    const r = byId(await repoPlacementRows(p, TEAM, snapshot([WIDGETS])), WIDGETS);

    expect(r).toMatchObject({ status: "ready", detail: "Found your widgets checkout" });
    expect(r!.finishGated).toBeFalsy();
    expect(action(r)).toMatchObject({ mode: "checkout", checkoutPath: widgets });
  });
});
