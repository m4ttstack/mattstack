/**
 * Setup state — the durable record of what `rt setup apply` has already
 * materialized (marketplaces, plugins, links, extension editors), so a
 * re-run can diff against it instead of redoing idempotent work.
 * ~/.mattstack/rt/setup-state.json.
 */

import { dirname, join } from "path";
import type { Probes } from "./probes.ts";

export interface SetupState {
  /** 2 since `finishedAt` exists; a v1 file predates it (see readSetupState). */
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
  /** When the wizard's Finish ran. mattstack.app reads this file directly, so the rule in isSetupFinished is mirrored in rt-tray's SetupCompletion. */
  finishedAt?: string;
}

const EMPTY_STATE: SetupState = { v: 2, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [], migrations: [] };

function statePath(home: string): string {
  return join(home, ".mattstack", "rt", "setup-state.json");
}

export function readSetupState(p: Pick<Probes, "readFile" | "home">): SetupState {
  const raw = p.readFile(statePath(p.home));
  if (raw === null) return { ...EMPTY_STATE };
  let parsed: Partial<Omit<SetupState, "v">> & { v?: number };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return { ...EMPTY_STATE };
  }
  // Spread EMPTY_STATE under the parsed value so a state file written before
  // a field existed (e.g. forcedLinks) still backfills that field to [],
  // rather than leaving it undefined for every caller to guard against.
  const state: SetupState = { ...EMPTY_STATE, ...parsed, v: 2 };
  // A v1 file was written by an app that called setup complete once the
  // daemon ran, with no Finish on record. One whose Install ran is taken as
  // finished, so an upgrade never sends a working Mac back through setup.
  if ((parsed.v ?? 1) < 2 && state.finishedAt === undefined && state.lastApplyAt !== undefined) state.finishedAt = state.lastApplyAt;
  return state;
}

export function isSetupFinished(state: SetupState): boolean {
  return typeof state.finishedAt === "string" && state.finishedAt !== "";
}

export function markSetupFinished(p: Pick<Probes, "readFile" | "writeFile" | "mkdirp" | "home" | "now">): SetupState {
  return updateSetupState(p, (s) => ({ ...s, finishedAt: p.now().toISOString() }));
}

export function updateSetupState(p: Pick<Probes, "readFile" | "writeFile" | "mkdirp" | "home">, patch: (s: SetupState) => SetupState): SetupState {
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
  const path = statePath(p.home);
  p.mkdirp(dirname(path));
  p.writeFile(path, JSON.stringify(deduped));
  return deduped;
}
