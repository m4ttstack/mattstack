import { describe, expect, test } from "bun:test";
import type { EnrichedBranch, MRInfo } from "../../enrich.ts";
import type { RestorableEntry } from "../restore.ts";
import { daysLeft, restoreListCells, restoreRows } from "../restore-rows.ts";

const NOW = new Date(2026, 9, 8, 8, 30);

function entry(overrides: Partial<RestorableEntry> = {}): RestorableEntry {
  return {
    name: "happy-oyster",
    path: "/trash/happy-oyster.1",
    branch: "launcher-at-prompt",
    reason: "auto",
    disposedAt: new Date(2026, 9, 8, 6, 0).toISOString(),
    keptUntil: new Date(2026, 9, 22, 6, 0).toISOString(),
    ...overrides,
  };
}

function mr(overrides: Partial<MRInfo> = {}): MRInfo {
  return { provider: "github", iid: 8, title: "Launcher shows at an empty prompt", state: "merged", pipeline: { status: "running" }, ...overrides } as MRInfo;
}

function enriched(e: RestorableEntry, overrides: Partial<EnrichedBranch> = {}): EnrichedBranch {
  return { path: e.path, dirName: "happy-oyster.1", branch: e.branch ?? "", linearId: null, ticket: null, mr: null, ...overrides };
}

describe("daysLeft", () => {
  test("counts whole days up to keptUntil", () => {
    expect(daysLeft(new Date(2026, 9, 22, 6, 0).toISOString(), NOW)).toBe("14d left");
    expect(daysLeft(new Date(2026, 9, 9, 6, 0).toISOString(), NOW)).toBe("1d left");
  });

  test("a tree past its keptUntil but not yet reaped reads as its last day", () => {
    expect(daysLeft(new Date(2026, 9, 8, 6, 0).toISOString(), NOW)).toBe("last day");
  });
});

describe("restoreRows", () => {
  test("before enrichment: the tree name, its branch, and the days left, under its cleanup date", () => {
    const [row] = restoreRows([entry()], undefined, NOW);
    expect(row).toEqual({
      value: "happy-oyster",
      left: [
        { text: "happy-oyster", bold: true, column: true },
        { text: "  ", tone: "faint" },
        { text: "launcher-at-prompt", tone: "dim" },
      ],
      right: [{ text: "14d left", tone: "dimmer" }],
      match: "happy-oyster launcher-at-prompt",
      group: "Today",
    });
  });

  test("after enrichment: rt cd's row with the tree name leading, then the days left", () => {
    const e = entry();
    const [row] = restoreRows([e], new Map([[e.path, enriched(e, { mr: mr() })]]), NOW);
    expect(row!.left).toEqual([
      { text: "happy-oyster", bold: true, column: true },
      { text: "  ", tone: "faint" },
      { text: "Launcher shows at an empty prompt", tone: "dim" },
    ]);
    expect(row!.right).toEqual([{ text: "#8 merged", tone: "dim" }, { text: "  " }, { text: "14d left", tone: "dimmer" }]);
    expect(row!.match).toContain("launcher-at-prompt");
  });

  test("a branch rt never saw an MR for shows no [Local Only] tag", () => {
    const e = entry();
    const [row] = restoreRows([e], new Map([[e.path, enriched(e)]]), NOW);
    expect(row!.right).toEqual([{ text: "14d left", tone: "dimmer" }]);
  });

  test("a detached tree shows its name alone", () => {
    const [row] = restoreRows([entry({ branch: null })], undefined, NOW);
    expect(row!.left).toEqual([{ text: "happy-oyster", bold: true, column: true }]);
  });

  test("rows group by cleanup date", () => {
    const rows = restoreRows([
      entry({ name: "a", disposedAt: new Date(2026, 9, 7, 12).toISOString() }),
      entry({ name: "b", disposedAt: new Date(2026, 9, 5, 12).toISOString() }),
      entry({ name: "c", disposedAt: new Date(2026, 9, 1, 12).toISOString() }),
    ], undefined, NOW);
    expect(rows.map((r) => r.group)).toEqual(["Yesterday", "Earlier this week", "Last week"]);
  });
});

describe("restoreListCells", () => {
  test("name, title, MR status and days left as plain text", () => {
    const e = entry();
    expect(restoreListCells(e, enriched(e, { mr: mr(), linearId: "MAT-423" }), NOW)).toEqual(["happy-oyster", "Launcher shows at an empty prompt", "#8 merged  MAT-423", "14d left"]);
  });

  test("with nothing enriched, the title falls back to the branch", () => {
    expect(restoreListCells(entry(), undefined, NOW)).toEqual(["happy-oyster", "launcher-at-prompt", "", "14d left"]);
    expect(restoreListCells(entry({ branch: null }), undefined, NOW)).toEqual(["happy-oyster", "(detached)", "", "14d left"]);
  });
});
