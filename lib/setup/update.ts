/**
 * The decisions behind `rt setup update`, kept pure so the command handler
 * is a thin shell: whether to run at all, how to summarize a run, and what
 * to tell the person when something needs them.
 */

import { updateAttention, type UpdateOutcome } from "./apply.ts";
import type { Probes } from "./probes.ts";
import { isSetupFinished, readSetupState } from "./state.ts";

declare const RT_VERSION: string | undefined;

export const DEV_VERSION = "dev";

/** The compile-time `RT_VERSION` define, else the `RT_VERSION` env var, else `dev`. */
export function rtVersion(): string {
  if (typeof RT_VERSION !== "undefined" && RT_VERSION) return RT_VERSION;
  return process.env.RT_VERSION ?? DEV_VERSION;
}

/** `retry`: this version already ran here, and runs again only because a migration is still pending. */
export type UpdateDecision = { kind: "not-set-up" } | { kind: "current"; version: string } | { kind: "run"; retry?: true };

/** The migrations this Mac has not recorded (done or skipped), so an update run still owes them. */
export function pendingMigrationIds(applied: readonly string[], migrationIds: readonly string[]): string[] {
  return migrationIds.filter((id) => !applied.includes(id));
}

/**
 * "Finished" is the answer mattstack.app reopens setup on: until then the wizard owns the Mac, and an update run would re-apply steps to a half-configured machine and could overlap the wizard's own Install, which the update lock does not guard. A `dev` version never counts as current, so a source build re-applies every launch.
 * A stamped version still runs while any of `migrationIds` is pending, so a migration that failed or waited finishes at a later launch without a release or `--force`.
 */
export function decideUpdate(p: Pick<Probes, "exists" | "home" | "readFile" | "now">, version: string, force: boolean, migrationIds: readonly string[]): UpdateDecision {
  const state = readSetupState(p);
  if (!isSetupFinished(state)) return { kind: "not-set-up" };
  if (force || version === DEV_VERSION) return { kind: "run" };
  const last = state.lastUpdate;
  if (last && last.version === version) return pendingMigrationIds(state.migrations, migrationIds).length > 0 ? { kind: "run", retry: true } : { kind: "current", version };
  return { kind: "run" };
}

export const SETUP_UPDATE_CATEGORY = "setup_update";

export function updateNotification(version: string, outcomes: UpdateOutcome[]): { id: string; title: string; message: string } | null {
  const attention = updateAttention(outcomes);
  if (attention.length === 0) return null;
  return {
    id: `${SETUP_UPDATE_CATEGORY}:${version}`,
    title: `Setup needs you after the update to ${version}`,
    message: attention.map((o) => (o.detail ? `${o.id}: ${o.detail}` : o.id)).join(" · "),
  };
}
