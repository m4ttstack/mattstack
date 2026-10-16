/**
 * Per-job budgets the herd tools report: how many times each costly action
 * has run against its cap. Counting only; nothing here refuses an action.
 */
import type { HerdBudget, HerdJobBudgets } from "../../packages/rt-client/src/commands.ts";

export type BudgetCounter = "respawns" | "blockedNotices" | "nudges" | "reviewerRounds" | "unmergedReports";

export const BUDGET_CAPS: Record<BudgetCounter, number> = {
  respawns: 2,
  blockedNotices: 3,
  nudges: 2,
  reviewerRounds: 2,
  unmergedReports: 2,
};

export function budgetView(used: number, counter: BudgetCounter): HerdBudget {
  const cap = BUDGET_CAPS[counter];
  return { used, cap, spent: used >= cap };
}

export function jobBudgets(rows: Array<{ counter: BudgetCounter; key: string; used: number }>): HerdJobBudgets {
  const total = (counter: BudgetCounter) => rows.filter((r) => r.counter === counter).reduce((n, r) => n + r.used, 0);
  const byKey = (counter: BudgetCounter) =>
    Object.fromEntries(rows.filter((r) => r.counter === counter).map((r) => [r.key, budgetView(r.used, counter)]));
  return {
    respawns: budgetView(total("respawns"), "respawns"),
    blockedNotices: budgetView(total("blockedNotices"), "blockedNotices"),
    unmergedReports: budgetView(rows.filter((r) => r.counter === "unmergedReports").length, "unmergedReports"),
    nudges: byKey("nudges"),
    reviewerRounds: byKey("reviewerRounds"),
  };
}
