import { parseStoreText } from "./stores.ts";

export interface PendingKey {
  key: string;
  repo?: string;
  change: "added" | "changed" | "removed";
}

/**
 * The store keys that differ between two texts of one settings store file:
 * `before` at origin's tip (null when absent there), `after` in the working
 * tree (null when deleted). Formatting, comments and object key order do not
 * count as changes. Global keys come first, then each repo section by
 * identity, each sorted by key.
 */
export function diffStoreKeys(file: string, before: string | null, after: string | null): PendingKey[] {
  const a = before === null ? null : parseStoreText(file, before);
  const b = after === null ? null : parseStoreText(file, after);
  const out = diffSection(a?.global ?? {}, b?.global ?? {}, undefined);
  const repos = new Set([...Object.keys(a?.repos ?? {}), ...Object.keys(b?.repos ?? {})]);
  for (const repo of [...repos].sort()) {
    out.push(...diffSection(asRecord(a?.repos[repo]), asRecord(b?.repos[repo]), repo));
  }
  return out;
}

function diffSection(before: Record<string, unknown>, after: Record<string, unknown>, repo: string | undefined): PendingKey[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: PendingKey[] = [];
  for (const key of [...keys].sort()) {
    const inBefore = Object.hasOwn(before, key);
    const inAfter = Object.hasOwn(after, key);
    let change: PendingKey["change"] | null = null;
    if (!inBefore) change = "added";
    else if (!inAfter) change = "removed";
    else if (!deepEqual(before[key], after[key])) change = "changed";
    if (change !== null) out.push(repo === undefined ? { key, change } : { key, repo, change });
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function deepEqual(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (x === null || y === null || typeof x !== "object" || typeof y !== "object") return false;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  if (Array.isArray(x)) {
    const ys = y as unknown[];
    return x.length === ys.length && x.every((v, i) => deepEqual(v, ys[i]));
  }
  const xo = x as Record<string, unknown>;
  const yo = y as Record<string, unknown>;
  const xk = Object.keys(xo);
  if (xk.length !== Object.keys(yo).length) return false;
  return xk.every((k) => Object.hasOwn(yo, k) && deepEqual(xo[k], yo[k]));
}
