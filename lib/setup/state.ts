/**
 * Setup state — the durable record of what `rt setup apply` has already
 * materialized (marketplaces, plugins, links, extension editors), so a
 * re-run can diff against it instead of redoing idempotent work.
 * ~/.mattstack/rt/setup-state.json.
 */

import { dirname, join } from "path";
import type { Probes } from "./probes.ts";

export interface SetupState {
  /** 2 since `finishedAt` exists; older files are judged by parseSetupState. */
  v: 2;
  marketplaces: string[];
  plugins: string[];
  links: string[];
  extensionEditors: string[];
  /** Tools linked with `rt deps link --force`: reconcile() must never auto-unlink these just because a user copy showed up on PATH — force is exactly the user overriding that. */
  forcedLinks: string[];
  /** Ids of one-time migrations that completed (done or skipped) on this machine; a failed one is never recorded, so it runs again. */
  migrations: string[];
  lastApplyAt?: string;
  /** The rt version the last `rt setup update` run stamped, whatever its outcome. */
  lastUpdate?: { version: string; at: string };
  /** Whether the last full or `--from` run ended ok; `--only` retries and update runs leave it. mattstack.app reopens an unfinished setup at Done only when true. */
  lastApplyOk?: boolean;
  /** When setup finished on this Mac. mattstack.app reads this file directly (rt-tray's SetupCompletion). */
  finishedAt?: string;
}

const EMPTY_STATE: SetupState = { v: 2, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [], migrations: [] };

export function setupStatePath(home: string): string {
  return join(home, ".mattstack", "rt", "setup-state.json");
}

type StateProbes = Pick<Probes, "readFile" | "exists" | "home" | "now">;
type StateWriteProbes = StateProbes & Pick<Probes, "writeFile" | "mkdirp" | "rename">;

export interface LegacyFinishSignals {
  daemonInstalled: boolean;
  intentExists: boolean;
  now: () => Date;
}

/**
 * Parity anchor: rt-tray's SetupCompletion answers "finished" the same way,
 * and both are checked against lib/setup/fixtures/setup-finished.json.
 *
 * A file from before `finishedAt` (v1, or none at all) carries no Finish, so
 * it is judged by what the old app went on: with no setup in flight, a v1
 * file whose Install ran, or an installed daemon, reads finished. Anything
 * that is not a JSON object reads as empty.
 */
export function parseSetupState(raw: string | null, legacy: LegacyFinishSignals): SetupState {
  type Stored = Partial<Omit<SetupState, "v">> & { v?: unknown };
  let parsed: Stored | null = null;
  if (raw !== null) {
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...EMPTY_STATE };
      parsed = value as Stored;
    } catch {
      return { ...EMPTY_STATE };
    }
  }
  // Spread EMPTY_STATE under the parsed value so a state file written before
  // a field existed (e.g. forcedLinks) still backfills that field to [],
  // rather than leaving it undefined for every caller to guard against.
  const state: SetupState = { ...EMPTY_STATE, ...(parsed ?? {}), v: 2 };
  const version = typeof parsed?.v === "number" ? parsed.v : 1;
  // A pending team choice means a run is mid-setup, and lastApplyAt is
  // stamped by every run (a failed join, an --only retry, an update).
  if (version >= 2 || isSetupFinished(state) || legacy.intentExists) return state;
  if (typeof state.lastApplyAt === "string" && state.lastApplyAt !== "") state.finishedAt = state.lastApplyAt;
  else if (legacy.daemonInstalled) state.finishedAt = legacy.now().toISOString();
  return state;
}

/** The `v` a stored file was written with; 1 for one that predates the field or is not a JSON object. */
export function storedVersion(raw: string): number {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return 1;
    const v = (value as { v?: unknown }).v;
    return typeof v === "number" ? v : 1;
  } catch {
    return 1;
  }
}

export function readSetupState(p: StateProbes): SetupState {
  const dir = join(p.home, ".mattstack", "rt");
  return parseSetupState(p.readFile(setupStatePath(p.home)), {
    daemonInstalled: p.exists(join(dir, "daemon.json")),
    intentExists: p.exists(join(dir, "setup-intent.json")),
    now: p.now,
  });
}

export function isSetupFinished(state: SetupState): boolean {
  return typeof state.finishedAt === "string" && state.finishedAt !== "";
}

export function markSetupFinished(p: StateWriteProbes): SetupState {
  return updateSetupState(p, (s) => ({ ...s, finishedAt: p.now().toISOString() }));
}

export function updateSetupState(p: StateWriteProbes, patch: (s: SetupState) => SetupState): SetupState {
  const patched = patch(readSetupState(p));
  const deduped: SetupState = {
    ...patched,
    marketplaces: [...new Set(patched.marketplaces)],
    plugins: [...new Set(patched.plugins)],
    links: [...new Set(patched.links)],
    extensionEditors: [...new Set(patched.extensionEditors)],
    forcedLinks: [...new Set(patched.forcedLinks)],
    migrations: [...new Set(patched.migrations)],
  };
  const path = setupStatePath(p.home);
  p.mkdirp(dirname(path));
  // mattstack.app reads this file at launch; it must never see half a write.
  const tmp = `${path}.${process.pid}.tmp`;
  p.writeFile(tmp, JSON.stringify(deduped));
  p.rename(tmp, path);
  return deduped;
}
