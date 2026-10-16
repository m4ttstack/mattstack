import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ciLeaseDir, ciLeaseFileName } from "../../packages/rt-client/src/index.ts";
import { shaMatches } from "./watch.ts";

export interface PersistedWatch {
  version: 1;
  mr: string;
  sha: string;
  pipelineId: number | null;
  pipelineStatus: string | null;
  lastResult: string | null;
  budgetMinutes: number | null;
  priorPipelineId: number | null;
  waitingSince: number | null;
  held: boolean;
  reclaims: number;
  updatedAt: number;
}

interface WatchStateOpts { dir?: string; now?: () => number }

export function watchStatePath(mrUrl: string, opts: { dir?: string } = {}): string {
  return join(opts.dir ?? ciLeaseDir(), "watch", ciLeaseFileName(mrUrl));
}

function fresh(mr: string, sha: string, priorPipelineId: number | null, now: number): PersistedWatch {
  return {
    version: 1, mr, sha, pipelineId: null, pipelineStatus: null, lastResult: null, budgetMinutes: null,
    priorPipelineId, waitingSince: null, held: false, reclaims: 0, updatedAt: now,
  };
}

function parse(raw: string): PersistedWatch | null {
  try {
    const v = JSON.parse(raw) as PersistedWatch;
    return v && v.version === 1 && typeof v.sha === "string" ? v : null;
  } catch {
    return null;
  }
}

export function readWatchState(mrUrl: string, sha: string, opts: WatchStateOpts = {}): PersistedWatch {
  const now = (opts.now ?? Date.now)();
  let stored: PersistedWatch | null = null;
  try {
    stored = parse(readFileSync(watchStatePath(mrUrl, opts), "utf8"));
  } catch {
    stored = null;
  }
  if (!stored) return fresh(mrUrl, sha, null, now);
  if (shaMatches(stored.sha, sha) || shaMatches(sha, stored.sha)) return stored;
  return fresh(mrUrl, sha, typeof stored.pipelineId === "number" ? stored.pipelineId : null, now);
}

export function writeWatchState(state: PersistedWatch, opts: WatchStateOpts = {}): void {
  const path = watchStatePath(state.mr, opts);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: (opts.now ?? Date.now)() }, null, 2));
  try {
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}
