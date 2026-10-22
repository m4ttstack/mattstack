/**
 * Decides which Claude usage limits just crossed a configured threshold.
 *
 * `fired` records, per account and limit, the highest threshold already
 * notified. A limit that falls back below it (its window reset, or the limit
 * went up) re-arms the thresholds it cleared, so the next climb notifies again.
 */

import type { AccountUsage, UsageLimit, UsageRead } from "./read.ts";

export const USAGE_LIMIT_CATEGORY = "usage_limit";

export interface UsageAlertConfig {
  thresholds: number[];
  /** Per-account thresholds, keyed by account email or org UUID. */
  accounts: Record<string, number[]>;
  /** Appended to every alert, e.g. where to ask for more usage. */
  hint?: string;
}

export type FiredState = Record<string, number>;

export interface UsageAlert {
  account: string;
  limit: UsageLimit;
  threshold: number;
  title: string;
  message: string;
}

export function thresholdsFor(usage: AccountUsage, config: UsageAlertConfig): number[] {
  return config.accounts[usage.account]
    ?? (usage.orgUuid ? config.accounts[usage.orgUuid] : undefined)
    ?? config.thresholds;
}

export function evaluateUsage(
  usage: AccountUsage[],
  config: UsageAlertConfig,
  previous: FiredState,
): { alerts: UsageAlert[]; fired: FiredState } {
  const fired: FiredState = { ...previous };
  const alerts: UsageAlert[] = [];
  for (const acct of usage) {
    const thresholds = thresholdsFor(acct, config);
    for (const limit of acct.limits) {
      const key = `${acct.account}|${acct.orgUuid ?? ""}|${limit.kind}`;
      const reached = Math.max(0, ...thresholds.filter((t) => limit.pct >= t));
      if (reached > (fired[key] ?? 0)) {
        alerts.push({ account: acct.account, limit, threshold: reached, ...copy(acct.account, limit, config.hint) });
      }
      fired[key] = reached;
    }
  }
  return { alerts, fired };
}

function copy(account: string, limit: UsageLimit, hint?: string): { title: string; message: string } {
  const pct = Math.round(limit.pct);
  const detail = limit.kind === "spend" && limit.used !== undefined && limit.limit !== undefined
    ? `monthly spend ${money(limit.used, limit.currency)} of ${money(limit.limit, limit.currency)}.`
    : `${limitLabel(limit.kind)} at ${pct}%.`;
  return {
    title: `Claude usage at ${pct}%`,
    message: [`${account}: ${detail}`, hint].filter(Boolean).join(" "),
  };
}

function limitLabel(kind: string): string {
  if (kind === "spend") return "monthly spend";
  if (kind === "five_hour") return "5-hour limit";
  if (kind === "seven_day") return "weekly limit";
  if (kind.startsWith("scoped:")) return `weekly ${kind.slice("scoped:".length)} limit`;
  return kind;
}

function money(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export interface SweepDeps {
  read: () => Promise<UsageRead>;
  config: () => UsageAlertConfig;
  loadFired: () => FiredState;
  saveFired: (fired: FiredState) => void;
  notify: (alert: UsageAlert) => void;
}

/** One poll: read usage, notify each new crossing, persist what fired. */
export async function runUsageAlertSweep(deps: SweepDeps): Promise<UsageAlert[]> {
  const { accounts } = await deps.read();
  if (accounts.length === 0) return [];
  const { alerts, fired } = evaluateUsage(accounts, deps.config(), deps.loadFired());
  for (const alert of alerts) deps.notify(alert);
  deps.saveFired(fired);
  return alerts;
}
