import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { getCurrentBranch } from "../git-ops.ts";
import { getStateDb } from "../state/db.ts";
import { deleteKvValue, getKvValue, listKvValues, setKvValue } from "../state/kv-blob.ts";
import { readLedger } from "./ledger.ts";

export const PROGRESS_NS = "plan-progress";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const LEDGER_ROOT = join(".superpowers", "sdd");

export interface PlanRecord {
  tree: string;
  branch: string;
  plan: string;
  stem: string;
  done: number;
  total: number;
  latest: string;
  firstSeen: number;
  lastSeen: number;
  finishedAt: number | null;
}

export type PlanState = "running" | "done" | "tree-gone";

export interface PlanView extends PlanRecord {
  state: PlanState;
}

export interface ProgressDeps {
  db: Database;
  now: () => number;
  branchOf: (tree: string) => string | null;
  exists: (path: string) => boolean;
}

export function defaultDeps(): ProgressDeps {
  return { db: getStateDb(), now: Date.now, branchOf: getCurrentBranch, exists: existsSync };
}

const keyOf = (tree: string, stem: string): string => `${tree}\u0000${stem}`;
const ledgerDirOf = (tree: string, stem: string): string => join(tree, LEDGER_ROOT, stem);
/** A disposed tree no longer resolves, so canonicalize its nearest existing ancestor and keep the rest. */
function normalizeTree(tree: string): string {
  const abs = resolve(tree);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(normalizeTree(parent), basename(abs));
  }
}

function liveStems(tree: string): string[] {
  try {
    return readdirSync(join(tree, LEDGER_ROOT), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(tree, LEDGER_ROOT, e.name, "progress.md")))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function recordTree(treeArg: string, deps: ProgressDeps = defaultDeps()): PlanRecord[] {
  const tree = normalizeTree(treeArg);
  const now = deps.now();
  const { db } = deps;

  const all = listKvValues<PlanRecord>(PROGRESS_NS, db);
  for (const [key, rec] of Object.entries(all)) {
    if (now - rec.lastSeen > RETENTION_MS) {
      deleteKvValue(PROGRESS_NS, key, db);
      delete all[key];
    }
  }

  const branch = deps.branchOf(tree);
  const touched: PlanRecord[] = [];
  const live = new Set<string>();

  for (const stem of liveStems(tree)) {
    live.add(stem);
    const key = keyOf(tree, stem);
    const reading = readLedger(tree, ledgerDirOf(tree, stem));
    const prior = getKvValue<PlanRecord | null>(PROGRESS_NS, key, null, db);
    const rec: PlanRecord = {
      tree,
      branch: branch ?? prior?.branch ?? "",
      plan: reading.planRef,
      stem,
      done: reading.done,
      total: reading.total,
      latest: reading.latest,
      firstSeen: prior?.firstSeen ?? now,
      lastSeen: now,
      finishedAt: null,
    };
    setKvValue(PROGRESS_NS, key, rec, db);
    all[key] = rec;
    touched.push(rec);
  }

  for (const rec of Object.values(all)) {
    if (rec.tree !== tree || rec.finishedAt !== null || live.has(rec.stem)) continue;
    if (branch === null || branch !== rec.branch) continue;
    const finished: PlanRecord = { ...rec, finishedAt: now, done: rec.total };
    setKvValue(PROGRESS_NS, keyOf(tree, rec.stem), finished, db);
    touched.push(finished);
  }

  return touched;
}

function stateOf(rec: PlanRecord, deps: ProgressDeps): PlanState {
  if (rec.finishedAt !== null) return "done";
  return deps.exists(ledgerDirOf(rec.tree, rec.stem)) ? "running" : "tree-gone";
}

function matchesPlan(rec: PlanRecord, plan: string): boolean {
  const asked = resolve(rec.tree, plan);
  if (rec.plan && resolve(rec.tree, rec.plan) === asked) return true;
  return rec.stem === basename(plan).replace(/\.md$/, "");
}

export function listPlans(filter: { tree?: string; plan?: string }, deps: ProgressDeps = defaultDeps()): PlanView[] {
  const tree = filter.tree === undefined ? undefined : normalizeTree(filter.tree);
  return Object.values(listKvValues<PlanRecord>(PROGRESS_NS, deps.db))
    .filter((rec) => tree === undefined || rec.tree === tree)
    .filter((rec) => filter.plan === undefined || matchesPlan(rec, filter.plan))
    .map((rec) => ({ ...rec, state: stateOf(rec, deps) }))
    .sort((a, b) => b.lastSeen - a.lastSeen || a.stem.localeCompare(b.stem));
}
