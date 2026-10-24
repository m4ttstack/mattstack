import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countDoneTasks, countPlanTasks, latestLine, planRefOf, readLedger } from "../ledger.ts";

describe("ledger parser", () => {
  test("counts plain complete lines once each", () => {
    expect(countDoneTasks("# SDD ledger plan: p.md\nTask 1: complete (abc)\nTask 1: complete (again)\nTask 2: complete\n")).toBe(2);
  });
  test("a lettered task counts only when every part is complete", () => {
    const half = "Task 8a: complete\nTask 8b: dispatched\n";
    expect(countDoneTasks(half)).toBe(0);
    expect(countDoneTasks(half + "Task 8b: complete\n")).toBe(1);
  });
  test("an explicit Task N complete wins over parts", () => {
    expect(countDoneTasks("Task 5a: dispatched\nTask 5: complete\n")).toBe(1);
  });
  test("free-text mentions of complete do not count", () => {
    expect(countDoneTasks("Task 6: dispatched (complete code in brief)\n")).toBe(0);
  });
  test("plan task count is distinct Task N headings", () => {
    expect(countPlanTasks("### Task 1: a\n### Task 2: b\n## Task 2: dup\n")).toBe(2);
  });
  test("marker file beats the ledger's first line", () => {
    expect(planRefOf("# SDD ledger plan: a.md", "docs/b.md\n")).toBe("docs/b.md");
    expect(planRefOf("# SDD ledger plan: a.md", "")).toBe("a.md");
    expect(planRefOf("# no plan here", "  \n")).toBe("");
  });
  test("latest line rewrites Task N and skips headings, tables and the spec line", () => {
    expect(latestLine("# SDD ledger plan: p.md\nTask 7: complete\nRuling: x\nTask 8b: in progress\n## next\n| a |\nSpec: s.md\n")).toBe("T8b in progress");
  });
  test("latest line keeps a ruling", () => {
    expect(latestLine("# SDD ledger plan: p.md\nTask 7: complete\nRuling: keep the flag\n")).toBe("Ruling: keep the flag");
  });
  test("latest line is empty when the ledger has only a header", () => {
    expect(latestLine("# SDD ledger plan: p.md\n")).toBe("");
  });
});

describe("readLedger", () => {
  let tree: string;
  let ledgerDir: string;
  beforeEach(() => {
    tree = mkdtempSync(join(tmpdir(), "ledger-"));
    ledgerDir = join(tree, ".superpowers", "sdd", "x");
    mkdirSync(ledgerDir, { recursive: true });
  });
  afterEach(() => rmSync(tree, { recursive: true, force: true }));

  test("missing plan file gives total 0", () => {
    writeFileSync(join(ledgerDir, "progress.md"), "# SDD ledger plan: docs/nope.md\nTask 1: complete\n");
    const r = readLedger(tree, ledgerDir);
    expect(r.total).toBe(0);
    expect(r.done).toBe(1);
    expect(r.planRef).toBe("docs/nope.md");
  });

  test("a relative plan path resolves against the tree", () => {
    mkdirSync(join(tree, "docs"));
    writeFileSync(join(tree, "docs", "p.md"), "### Task 1: a\n### Task 2: b\n");
    writeFileSync(join(ledgerDir, "progress.md"), "# SDD ledger plan: docs/p.md\nTask 1: complete\nTask 2: started\n");
    expect(readLedger(tree, ledgerDir)).toEqual({ planRef: "docs/p.md", done: 1, total: 2, latest: "T2 started" });
  });

  test("a plan-path marker overrides the first line", () => {
    writeFileSync(join(tree, "real.md"), "## Task 1: a\n");
    writeFileSync(join(ledgerDir, "plan-path"), "real.md\n");
    writeFileSync(join(ledgerDir, "progress.md"), "# SDD ledger plan: other.md\n");
    expect(readLedger(tree, ledgerDir).total).toBe(1);
  });

  test("a missing ledger reads as empty", () => {
    expect(readLedger(tree, ledgerDir)).toEqual({ planRef: "", done: 0, total: 0, latest: "" });
  });
});
