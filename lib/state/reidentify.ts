/**
 * lib/state/reidentify.ts: verify-persisted moves of one identity-keyed row set
 * from one serialized identity to another.
 *
 * `setKvValue`/`persistOrWarn` swallow SQLITE_BUSY, so every move re-reads
 * before it reports success; a write that did not land is a refusal, never a
 * silent partial. A write that throws is a refusal too: one store's failure
 * must never stop the caller from moving the others.
 */

import type { Database } from "bun:sqlite";
import { isDeepStrictEqual } from "util";
import { deleteKvValue, getKvValue, getStateDb, hasKvValue, setKvValue } from "./index.ts";

export type StoreStatus = "moved" | "already" | "none" | "refused";

export interface StoreReport {
  store: string;
  status: StoreStatus;
  count: number;
  detail?: string;
}

const BOTH = "both populated";
const UNREADABLE = Symbol("unreadable");

function attempt(store: string, count: number, write: () => StoreReport): StoreReport {
  try {
    return write();
  } catch (err) {
    return { store, status: "refused", count, detail: String(err) };
  }
}

export function moveKvKey(ns: string, from: string, to: string, opts: { dryRun?: boolean } = {}): StoreReport {
  const store = `kv:${ns}`;
  const hasFrom = hasKvValue(ns, from);
  const hasTo = hasKvValue(ns, to);
  if (!hasFrom && hasTo) return { store, status: "already", count: 0 };
  if (!hasFrom) return { store, status: "none", count: 0 };
  const value = getKvValue<unknown>(ns, from, UNREADABLE);
  if (value === UNREADABLE) return { store, status: "refused", count: 1, detail: `unparseable value under ${from}` };
  // Equal values under both keys are what a move interrupted before its
  // delete leaves behind; only the delete is left to do.
  const interrupted = hasTo && isDeepStrictEqual(value, getKvValue<unknown>(ns, to, UNREADABLE));
  if (hasTo && !interrupted) return { store, status: "refused", count: 1, detail: BOTH };
  if (opts.dryRun) return { store, status: "moved", count: 1 };
  return attempt(store, 1, () => {
    if (!interrupted) {
      setKvValue(ns, to, value);
      if (!isDeepStrictEqual(getKvValue<unknown>(ns, to, UNREADABLE), value)) {
        return { store, status: "refused", count: 1, detail: `${to} did not persist` };
      }
    }
    deleteKvValue(ns, from);
    if (hasKvValue(ns, from)) return { store, status: "refused", count: 1, detail: `${from} did not delete` };
    return { store, status: "moved", count: 1 };
  });
}

function tableExists(db: Database, table: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row !== null && row !== undefined;
}

function countWhere(db: Database, table: string, col: string, value: string): number {
  // `table` and `col` are caller literals, never user input.
  return (db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`).get(value) as { c: number }).c;
}

export function moveTableRows(
  table: string,
  col: string,
  from: string,
  to: string,
  opts: { dryRun?: boolean; db?: Database } = {},
): StoreReport {
  const store = `${table}.${col}`;
  const db = opts.db ?? getStateDb();
  if (!tableExists(db, table)) return { store, status: "none", count: 0 };
  const fromCount = countWhere(db, table, col, from);
  const toCount = countWhere(db, table, col, to);
  if (fromCount === 0 && toCount > 0) return { store, status: "already", count: 0 };
  if (fromCount === 0) return { store, status: "none", count: 0 };
  if (toCount > 0) return { store, status: "refused", count: fromCount, detail: BOTH };
  if (opts.dryRun) return { store, status: "moved", count: fromCount };
  return attempt(store, fromCount, () => {
    db.run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, [to, from]);
    if (countWhere(db, table, col, from) !== 0 || countWhere(db, table, col, to) !== fromCount) {
      return { store, status: "refused", count: fromCount, detail: "rows did not persist under the new identity" };
    }
    return { store, status: "moved", count: fromCount };
  });
}

export function dropTableRows(table: string, col: string, from: string, opts: { dryRun?: boolean; db?: Database } = {}): StoreReport {
  const store = `${table}.${col}`;
  const db = opts.db ?? getStateDb();
  if (!tableExists(db, table)) return { store, status: "none", count: 0 };
  const fromCount = countWhere(db, table, col, from);
  if (fromCount === 0) return { store, status: "none", count: 0 };
  if (opts.dryRun) return { store, status: "moved", count: fromCount };
  return attempt(store, fromCount, () => {
    db.run(`DELETE FROM ${table} WHERE ${col} = ?`, [from]);
    if (countWhere(db, table, col, from) !== 0) return { store, status: "refused", count: fromCount, detail: "rows did not delete" };
    return { store, status: "moved", count: fromCount };
  });
}
