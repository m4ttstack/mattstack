import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface LedgerReading {
  planRef: string;
  done: number;
  total: number;
  latest: string;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function planRefOf(ledgerText: string, markerText: string): string {
  const marker = markerText.trim();
  if (marker) return marker;
  return /plan:\s*(\S+)/.exec(ledgerText.split("\n", 1)[0] ?? "")?.[1] ?? "";
}

export function countPlanTasks(planText: string): number {
  const numbers = new Set<string>();
  for (const m of planText.matchAll(/^#+\s*Task\s+(\d+)\b/gm)) numbers.add(m[1]!);
  return numbers.size;
}

/** Only a line that starts with `Task N[a-z]: complete` counts, so prose that mentions "complete" never does. */
export function countDoneTasks(ledgerText: string): number {
  const explicit = new Set<string>();
  const mentionedParts = new Map<string, Set<string>>();
  const completeParts = new Map<string, Set<string>>();
  for (const line of ledgerText.split("\n")) {
    const m = /^Task\s+(\d+)([a-z]?):\s*(complete\b)?/.exec(line);
    if (!m) continue;
    const [, n, letter, complete] = m as unknown as [string, string, string, string | undefined];
    if (!letter) {
      if (complete) explicit.add(n);
      continue;
    }
    if (!mentionedParts.has(n)) mentionedParts.set(n, new Set());
    mentionedParts.get(n)!.add(letter);
    if (complete) {
      if (!completeParts.has(n)) completeParts.set(n, new Set());
      completeParts.get(n)!.add(letter);
    }
  }
  const done = new Set(explicit);
  for (const [n, parts] of mentionedParts) {
    if (completeParts.get(n)?.size === parts.size) done.add(n);
  }
  return done.size;
}

export function latestLine(ledgerText: string): string {
  const lines = ledgerText
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !/^(#|\||Spec:)/.test(l));
  const last = lines[lines.length - 1];
  return last === undefined ? "" : last.replace(/^Task\s+(\d+[a-z]?):\s*/, "T$1 ");
}

export function readLedger(tree: string, ledgerDir: string): LedgerReading {
  const ledgerText = readText(join(ledgerDir, "progress.md"));
  const planRef = planRefOf(ledgerText, readText(join(ledgerDir, "plan-path")));
  const planPath = planRef && (isAbsolute(planRef) ? planRef : join(tree, planRef));
  return {
    planRef,
    done: countDoneTasks(ledgerText),
    total: planPath ? countPlanTasks(readText(planPath)) : 0,
    latest: latestLine(ledgerText),
  };
}
