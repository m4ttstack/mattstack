import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../state/db.ts";
import { listPlans, recordTree, type ProgressDeps } from "../store.ts";

const DAY = 24 * 60 * 60 * 1000;
let dir: string;
let clock: number;
let branch: string | null;
let deps: ProgressDeps;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-progress-store-")));
  clock = 1_000_000;
  branch = "a";
  deps = { db: openStateDb(join(dir, "state.db"), "cli"), now: () => clock, branchOf: () => branch, exists: existsSync };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeTree(name: string, stem = "x", doneTasks = 2): string {
  const tree = join(dir, name);
  const ledger = join(tree, ".superpowers", "sdd", stem);
  mkdirSync(ledger, { recursive: true });
  mkdirSync(join(tree, "docs", "superpowers", "plans"), { recursive: true });
  writeFileSync(join(tree, "docs", "superpowers", "plans", `${stem}.md`), "### Task 1: a\n### Task 2: b\n### Task 3: c\n");
  const lines = Array.from({ length: doneTasks }, (_, i) => `Task ${i + 1}: complete`);
  writeFileSync(join(ledger, "progress.md"), [`# SDD ledger plan: docs/superpowers/plans/${stem}.md`, ...lines, ""].join("\n"));
  return tree;
}

const ledgerOf = (tree: string, stem = "x") => join(tree, ".superpowers", "sdd", stem);

describe("plan record store", () => {
  test("records a live ledger", () => {
    const tree = makeTree("t1");
    const recorded = recordTree(tree, deps);
    expect(recorded).toHaveLength(1);
    const [view] = listPlans({}, deps);
    expect(view).toMatchObject({ tree, branch: "a", stem: "x", done: 2, total: 3, finishedAt: null, state: "running" });
  });

  test("ledger gone on same branch is done with full count", () => {
    const tree = makeTree("t1");
    recordTree(tree, deps);
    rmSync(ledgerOf(tree), { recursive: true });
    clock += 1000;
    recordTree(tree, deps);
    expect(listPlans({}, deps)[0]).toMatchObject({ finishedAt: clock, done: 3, total: 3, state: "done" });
  });

  test("reprovisioned tree on another branch reads tree-gone", () => {
    const tree = makeTree("t1");
    recordTree(tree, deps);
    rmSync(ledgerOf(tree), { recursive: true });
    branch = "b";
    recordTree(tree, deps);
    expect(listPlans({}, deps)[0]).toMatchObject({ finishedAt: null, state: "tree-gone" });
  });

  test("done survives the tree moving branch later", () => {
    const tree = makeTree("t1");
    recordTree(tree, deps);
    rmSync(ledgerOf(tree), { recursive: true });
    recordTree(tree, deps);
    branch = "b";
    recordTree(tree, deps);
    expect(listPlans({}, deps)[0]?.state).toBe("done");
  });

  test("tree removed reads tree-gone", () => {
    const tree = makeTree("t1");
    recordTree(tree, deps);
    rmSync(tree, { recursive: true });
    expect(listPlans({}, deps)[0]?.state).toBe("tree-gone");
  });

  test("records older than 30 days are dropped on record", () => {
    const tree = makeTree("t1");
    recordTree(tree, deps);
    expect(listPlans({}, deps)).toHaveLength(1);
    clock += 31 * DAY;
    rmSync(tree, { recursive: true });
    recordTree(tree, deps);
    expect(listPlans({}, deps)).toEqual([]);
  });

  test("a symlinked alias of the tree hits the same record", () => {
    const tree = makeTree("t1");
    const alias = join(dir, "alias");
    symlinkSync(tree, alias);
    recordTree(alias, deps);
    recordTree(tree, deps);
    expect(listPlans({}, deps)).toHaveLength(1);
    expect(listPlans({ tree: alias }, deps)[0]).toMatchObject({ tree, stem: "x" });
  });

  test("a ledger directory without progress.md is not a ledger", () => {
    const tree = makeTree("t1");
    mkdirSync(join(tree, ".superpowers", "sdd", "scratch"), { recursive: true });
    expect(recordTree(tree, deps).map((r) => r.stem)).toEqual(["x"]);
    expect(listPlans({}, deps).map((p) => p.stem)).toEqual(["x"]);
  });

  test("a ledger directory that lost its progress.md is not finished", () => {
    const tree = makeTree("t1");
    recordTree(tree, deps);
    rmSync(join(ledgerOf(tree), "progress.md"));
    recordTree(tree, deps);
    expect(listPlans({ tree }, deps)[0]!.finishedAt).toBeNull();
  });

  test("a disposed tree reached through a symlinked parent still matches its record", () => {
    const real = join(dir, "real");
    mkdirSync(real);
    const tree = makeTree(join("real", "t1"));
    recordTree(tree, deps);
    symlinkSync(real, join(dir, "link"));
    rmSync(tree, { recursive: true });
    expect(listPlans({ tree: join(dir, "link", "t1") }, deps)).toHaveLength(1);
  });

  test("plan filter matches path or stem within one tree", () => {
    const t1 = makeTree("t1");
    const t2 = makeTree("t2");
    recordTree(t1, deps);
    recordTree(t2, deps);
    expect(listPlans({ tree: t1, plan: "docs/superpowers/plans/x.md" }, deps).map((p) => p.tree)).toEqual([t1]);
    expect(listPlans({ tree: t2, plan: "x" }, deps).map((p) => p.tree)).toEqual([t2]);
    expect(listPlans({ tree: t1, plan: join(t1, "docs/superpowers/plans/x.md") }, deps)).toHaveLength(1);
    expect(listPlans({ plan: "x" }, deps)).toHaveLength(2);
  });
});
