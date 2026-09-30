/**
 * The decisions behind `rt setup update`, kept pure so the command handler
 * is a thin shell: whether to run at all, how to summarize a run, and what
 * to tell the person when something needs them.
 */

import { join } from "path";
import type { UpdateOutcome } from "./apply.ts";
import type { Probes } from "./probes.ts";
import { readSetupState } from "./state.ts";

declare const RT_VERSION: string | undefined;

export const DEV_VERSION = "dev";

/** The compile-time `RT_VERSION` define, else the `RT_VERSION` env var, else `dev`. */
export function rtVersion(): string {
  if (typeof RT_VERSION !== "undefined" && RT_VERSION) return RT_VERSION;
  return process.env.RT_VERSION ?? DEV_VERSION;
}

export type UpdateDecision = { kind: "not-set-up" } | { kind: "current"; version: string } | { kind: "run" };

/** daemon.json is the same file the tray's first-run detector keys on: without it, Install never finished, and an update run has nothing to re-apply. A `dev` version never counts as current, so a source build re-applies every launch. */
export function decideUpdate(p: Pick<Probes, "exists" | "home" | "readFile" | "now">, version: string, force: boolean): UpdateDecision {
  if (!p.exists(join(p.home, ".mattstack", "rt", "daemon.json"))) return { kind: "not-set-up" };
  if (force || version === DEV_VERSION) return { kind: "run" };
  const last = readSetupState(p).lastUpdate;
  if (last && last.version === version) return { kind: "current", version };
  return { kind: "run" };
}

const GROUPS: { label: string; states: UpdateOutcome["state"][] }[] = [
  { label: "ran", states: ["done", "partial"] },
  { label: "skipped", states: ["skipped"] },
  { label: "needs you", states: ["needs-you"] },
  { label: "failed", states: ["failed"] },
];

export function summarizeUpdate(outcomes: UpdateOutcome[]): string {
  const parts = GROUPS.map(({ label, states }) => ({ label, ids: outcomes.filter((o) => states.includes(o.state)).map((o) => o.id) }))
    .filter((g) => g.ids.length > 0)
    .map((g) => `${g.label}: ${g.ids.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : "nothing to do";
}

export const SETUP_UPDATE_CATEGORY = "setup_update";

export function updateNotification(version: string, outcomes: UpdateOutcome[]): { id: string; title: string; message: string } | null {
  const attention = outcomes.filter((o) => o.state === "needs-you" || o.state === "failed");
  if (attention.length === 0) return null;
  return {
    id: `${SETUP_UPDATE_CATEGORY}:${version}`,
    title: `Setup needs you after the update to ${version}`,
    message: attention.map((o) => (o.detail ? `${o.id}: ${o.detail}` : o.id)).join(" · "),
  };
}
