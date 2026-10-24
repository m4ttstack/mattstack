import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../lib/state/db.ts";
import type { ProgressDeps } from "../../lib/progress/store.ts";
import { runProgress } from "../progress.ts";

let dir: string;
let clock: number;
let deps: ProgressDeps;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-progress-cmd-")));
  clock = 1_000_000;
  deps = { db: openStateDb(join(dir, "state.db"), "cli"), now: () => clock, branchOf: () => "a", exists: existsSync };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeLedger(tree: string, stem: string, doneTasks: number): void {
  const ledger = join(tree, ".superpowers", "sdd", stem);
  mkdirSync(ledger, { recursive: true });
  mkdirSync(join(tree, "docs", "superpowers", "plans"), { recursive: true });
  writeFileSync(join(tree, "docs", "superpowers", "plans", `${stem}.md`), "### Task 1: a\n### Task 2: b\n### Task 3: c\n");
  const lines = Array.from({ length: doneTasks }, (_, i) => `Task ${i + 1}: complete`);
  writeFileSync(join(ledger, "progress.md"), [`# SDD ledger plan: docs/superpowers/plans/${stem}.md`, ...lines, ""].join("\n"));
}

describe("rt progress", () => {
  test("record without --tree is the frozen usage error", () => {
    expect(runProgress(["record", "--json"], deps)).toEqual({ out: '{"ok":false,"error":"--tree is required"}', code: 2 });
  });

  test("record --json returns the records", () => {
    const tree = join(dir, "t");
    writeLedger(tree, "x", 2);
    const r = runProgress(["record", "--tree", tree, "--json"], deps);
    expect(r.code).toBe(0);
    const body = JSON.parse(r.out);
    expect(body.ok).toBe(true);
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({ tree, stem: "x", done: 2, total: 3 });
  });

  test("record without --json prints nothing", () => {
    const tree = join(dir, "t");
    writeLedger(tree, "x", 1);
    expect(runProgress(["record", "--tree", tree], deps)).toEqual({ out: "", code: 0 });
  });

  test("list --refresh sees a ledger written after the last record", () => {
    const tree = join(dir, "t");
    writeLedger(tree, "x", 1);
    runProgress(["record", "--tree", tree], deps);
    clock += 1000;
    writeLedger(tree, "x", 3);
    const r = runProgress(["list", "--tree", tree, "--refresh", "--json"], deps);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).plans[0]).toMatchObject({ stem: "x", done: 3, state: "running" });
  });

  test("list without --refresh reads what was recorded", () => {
    const tree = join(dir, "t");
    writeLedger(tree, "x", 1);
    runProgress(["record", "--tree", tree], deps);
    writeLedger(tree, "x", 3);
    const r = runProgress(["list", "--tree", tree, "--json"], deps);
    expect(JSON.parse(r.out).plans[0].done).toBe(1);
  });

  test("list puts the newest lastSeen first and filters by plan", () => {
    const a = join(dir, "a");
    const b = join(dir, "b");
    writeLedger(a, "old", 1);
    writeLedger(b, "new", 1);
    runProgress(["record", "--tree", a], deps);
    clock += 1000;
    runProgress(["record", "--tree", b], deps);
    const all = JSON.parse(runProgress(["list", "--json"], deps).out).plans;
    expect(all.map((p: { stem: string }) => p.stem)).toEqual(["new", "old"]);
    const one = JSON.parse(runProgress(["list", "--plan", "docs/superpowers/plans/old.md", "--json"], deps).out).plans;
    expect(one.map((p: { stem: string }) => p.stem)).toEqual(["old"]);
  });

  test("list --refresh without --tree is a usage error", () => {
    expect(runProgress(["list", "--refresh", "--json"], deps)).toEqual({
      out: '{"ok":false,"error":"--refresh requires --tree"}',
      code: 2,
    });
  });

  test("an unknown verb is a usage error", () => {
    expect(runProgress(["nope"], deps).code).toBe(2);
  });
});
