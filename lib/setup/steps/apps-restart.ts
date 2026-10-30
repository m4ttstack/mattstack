/**
 * `apps.restart`: the last thing every setup run does, so no app deck serves
 * keeps running code from before the run. The engine runs it at a run's end
 * whether the run ended ok or stopped at a failed step, and `rt setup finish`
 * runs the same restart through `restartServedApps`.
 *
 * Which apps count is deck's answer: its `/api/v1/apps` rows that rt
 * registered (`managedBy: "rt"`), run as a service and are switched on. Deck
 * itself (`managedBy: "deck"`) and a person's own apps (`user`) are never
 * restarted. Each one restarts through `deck restart <name>`, never a signal.
 *
 * A restart that fails is `partial`, never `failed`: the run's own outcome is
 * already decided by the steps before it.
 */

import { bundledToolPath, restartAppWithDeck } from "../../deps/resolve.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { MATTSTACK_REGISTRAR, readDeckApiPortFrom } from "./deck.ts";

export type ServedAppsList = { kind: "apps"; names: string[] } | { kind: "skip"; detail: string } | { kind: "error"; detail: string };

export interface AppsRestartSeams {
  listServedApps(p: Probes): Promise<ServedAppsList>;
  restartApp(p: Probes, name: string): Promise<boolean>;
}

interface DeckAppRow {
  name?: unknown;
  managedBy?: unknown;
  enabled?: unknown;
  record?: { kind?: unknown } | null;
}

const DECK_LIST_TIMEOUT_MS = 30_000;

/** The served-app names in a `/api/v1/apps` body, or null when the body is not that shape. */
export function servedAppNames(body: string): string[] | null {
  let rows: unknown;
  try {
    rows = (JSON.parse(body) as { apps?: unknown }).apps;
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  return (rows as DeckAppRow[])
    .filter((r) => typeof r.name === "string" && r.managedBy === MATTSTACK_REGISTRAR && r.enabled !== false && r.record?.kind === "service")
    .map((r) => r.name as string)
    .sort();
}

export async function listServedAppsFromDeck(p: Probes): Promise<ServedAppsList> {
  if (bundledToolPath(p, "deck") === null) return { kind: "skip", detail: "Deck is not in this build yet" };
  const port = readDeckApiPortFrom(p);
  if (port === null) return { kind: "skip", detail: "Deck is not running, so no apps to restart" };
  const res = await p.fetch(`http://127.0.0.1:${port}/api/v1/apps`, { timeoutMs: DECK_LIST_TIMEOUT_MS });
  if (res.status === 0) return { kind: "skip", detail: "Deck is not running, so no apps to restart" };
  if (res.status !== 200) return { kind: "error", detail: `Couldn't list your apps: deck answered ${res.status}` };
  const names = servedAppNames(res.body);
  if (names === null) return { kind: "error", detail: "Couldn't list your apps: deck's answer was unreadable" };
  return { kind: "apps", names };
}

export const REAL_APPS_RESTART_SEAMS: AppsRestartSeams = {
  listServedApps: listServedAppsFromDeck,
  restartApp: (p, name) => restartAppWithDeck(p, name),
};

const MANAGED_REMEDY = "Run deck restart --managed";

export async function restartServedApps(p: Probes, log: (line: string) => void, seams: AppsRestartSeams = REAL_APPS_RESTART_SEAMS): Promise<StepOutcome> {
  let listed: ServedAppsList;
  try {
    listed = await seams.listServedApps(p);
  } catch (err) {
    listed = { kind: "error", detail: `Couldn't list your apps: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (listed.kind === "skip") return { state: "skipped", detail: listed.detail };
  if (listed.kind === "error") return { state: "partial", detail: listed.detail, remedy: MANAGED_REMEDY };
  if (listed.names.length === 0) return { state: "skipped", detail: "No apps to restart" };

  const failed: string[] = [];
  for (const name of listed.names) {
    let ok = false;
    try {
      ok = await seams.restartApp(p, name);
    } catch (err) {
      log(`deck restart ${name} threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (ok) log(`Restarted ${name}`);
    else {
      log(`deck restart ${name} failed`);
      failed.push(name);
    }
  }
  if (failed.length === 0) return { state: "done", detail: `Restarted ${listed.names.join(", ")}` };
  const remedy = failed.length === 1 ? `Run deck restart ${failed[0]}` : MANAGED_REMEDY;
  return { state: "partial", detail: `Couldn't restart ${failed.join(", ")}`, remedy };
}

export function makeAppsRestartStep(seams: AppsRestartSeams = REAL_APPS_RESTART_SEAMS): StepDef {
  return {
    id: "apps.restart",
    title: "Restart your apps",
    kind: "rt",
    updateSafe: true,
    applies: () => true,
    run: (ctx: ApplyContext) => restartServedApps(ctx.p, (line) => ctx.log("apps.restart", line), seams),
  };
}

export const appsRestartStep = makeAppsRestartStep();
