import { describe, test, expect } from "bun:test";
import { BUDGET_CAPS, budgetView, jobBudgets } from "../herd-budgets.ts";

describe("herd-budgets", () => {
  test("caps match the counts the skill draws", () => {
    expect(BUDGET_CAPS).toEqual({ respawns: 2, blockedNotices: 3, nudges: 2, reviewerRounds: 2, unmergedReports: 2 });
  });

  test("budgetView marks spent at the cap and keeps counting past it", () => {
    expect(budgetView(1, "respawns")).toEqual({ used: 1, cap: 2, spent: false });
    expect(budgetView(2, "respawns")).toEqual({ used: 2, cap: 2, spent: true });
    expect(budgetView(3, "respawns")).toEqual({ used: 3, cap: 2, spent: true });
  });

  test("jobBudgets defaults absent counters to zero", () => {
    expect(jobBudgets([])).toEqual({
      respawns: { used: 0, cap: 2, spent: false },
      blockedNotices: { used: 0, cap: 3, spent: false },
      unmergedReports: { used: 0, cap: 2, spent: false },
      nudges: {},
      reviewerRounds: {},
    });
  });

  test("jobBudgets maps nudges and reviewer rounds by key and counts unmerged report rows", () => {
    const b = jobBudgets([
      { counter: "respawns", key: "", used: 1 },
      { counter: "nudges", key: "gt-1", used: 2 },
      { counter: "reviewerRounds", key: "docs/plan.md", used: 1 },
      { counter: "unmergedReports", key: "41", used: 1 },
      { counter: "unmergedReports", key: "57", used: 1 },
    ]);
    expect(b.respawns).toEqual({ used: 1, cap: 2, spent: false });
    expect(b.nudges).toEqual({ "gt-1": { used: 2, cap: 2, spent: true } });
    expect(b.reviewerRounds).toEqual({ "docs/plan.md": { used: 1, cap: 2, spent: false } });
    expect(b.unmergedReports).toEqual({ used: 2, cap: 2, spent: true });
  });
});
