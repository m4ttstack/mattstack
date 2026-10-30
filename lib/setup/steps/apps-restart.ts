/**
 * `apps.restart`: the last thing every setup run does, so no app deck serves
 * keeps running code from before the run. The engine runs it at a run's end
 * whether the run ended ok or stopped at a failed step, and `rt setup finish`
 * runs the same restart through `restartServedApps` when one is owed.
 *
 * Which apps count is deck's own answer: `deck restart --managed` restarts
 * every app it serves for rt (never deck itself, never a person's own app,
 * never a row this flavor does not serve) and prints one line per app.
 *
 * A restart that fails is `partial`, never `failed`: the run's own outcome is
 * already decided by the steps before it.
 */

import { bundledToolPath } from "../../deps/resolve.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { readSetupState, updateSetupState } from "../state.ts";
import { readDeckApiPortFrom } from "./deck.ts";

export interface AppsRestartSeams {
  sleep(ms: number): Promise<void>;
  /** Milliseconds, for the health wait's one deadline. */
  now(): number;
}

export const REAL_APPS_RESTART_SEAMS: AppsRestartSeams = { sleep: (ms) => Bun.sleep(ms), now: () => Date.now() };

const MANAGED_RESTART_TIMEOUT_MS = 180_000;
const EXEC_TIMEOUT_CODE = 124;
/** The whole health wait, however slowly deck answers: a hung deck must not hold the run's `done`. */
const HEALTH_DEADLINE_MS = 5_000;
const HEALTH_DELAY_MS = 500;
const HEALTH_FETCH_TIMEOUT_MS = 1_000;
const MANAGED_REMEDY = "Run deck restart --managed";
const NOT_RUNNING = "Deck is not running, so no apps to restart";

/** Deck's own lines: `restarted <name>` on stdout, `failed to restart <name> <dash> <error>` on stderr. */
export function parseManagedRestart(stdout: string, stderr: string): { restarted: string[]; failed: string[] } {
  const restarted = stdout
    .split("\n")
    .map((l) => /^restarted (\S+)$/.exec(l.trim())?.[1])
    .filter((n): n is string => n !== undefined);
  const failed = stderr
    .split("\n")
    .map((l) => /^failed to restart (\S+)(?:\s|$)/.exec(l.trim())?.[1])
    .filter((n): n is string => n !== undefined);
  return { restarted, failed };
}

/** Names among `apps` deck does not yet report healthy; a name deck no longer lists, or lists with no health probe, counts as settled. */
async function unsettled(p: Probes, port: number, apps: string[], timeoutMs: number): Promise<string[]> {
  const res = await p.fetch(`http://127.0.0.1:${port}/api/v1/apps`, { timeoutMs });
  if (res.status !== 200) return apps;
  let rows: Array<{ name?: unknown; health?: { ok?: unknown } | null }>;
  try {
    rows = (JSON.parse(res.body) as { apps?: typeof rows }).apps ?? [];
  } catch {
    return apps;
  }
  return apps.filter((name) => {
    const row = rows.find((r) => r.name === name);
    const health = row?.health ?? null;
    return health !== null && health.ok !== true;
  });
}

/** A short, bounded wait so whatever opens on `done` (P7's board) finds the apps answering. A slow one is logged, never a failure: deck did restart it. */
async function waitForHealthy(p: Probes, port: number, apps: string[], seams: AppsRestartSeams, log: (line: string) => void): Promise<void> {
  const deadline = seams.now() + HEALTH_DEADLINE_MS;
  const ask = () => unsettled(p, port, apps, Math.max(1, Math.min(HEALTH_FETCH_TIMEOUT_MS, deadline - seams.now())));
  let pending = await ask();
  while (pending.length > 0 && seams.now() + HEALTH_DELAY_MS < deadline) {
    await seams.sleep(HEALTH_DELAY_MS);
    pending = await ask();
  }
  if (pending.length > 0) log(`Still starting: ${pending.join(", ")}`);
}

function clearOwed(p: Probes): void {
  try {
    updateSetupState(p, ({ appsRestartOwed: _, ...s }) => s);
  } catch {
    // Finish restarts once more next time; nothing is lost.
  }
}

async function restart(p: Probes, log: (line: string) => void, seams: AppsRestartSeams): Promise<StepOutcome> {
  const deck = bundledToolPath(p, "deck");
  if (deck === null) return { state: "skipped", detail: "Deck is not in this build yet" };
  const port = readDeckApiPortFrom(p);
  if (port === null) return { state: "skipped", detail: NOT_RUNNING };

  const r = await p.exec([deck, "restart", "--managed"], { timeoutMs: MANAGED_RESTART_TIMEOUT_MS });
  const { restarted, failed } = parseManagedRestart(r.stdout, r.stderr);
  for (const name of restarted) log(`Restarted ${name}`);
  for (const name of failed) log(`deck restart ${name} failed`);

  if (r.code === EXEC_TIMEOUT_CODE) return { state: "partial", detail: "Deck took too long to restart your apps", remedy: MANAGED_REMEDY };
  if (failed.length > 0) {
    const remedy = failed.length === 1 ? `Run deck restart ${failed[0]}` : MANAGED_REMEDY;
    return { state: "partial", detail: `Couldn't restart ${failed.join(", ")}`, remedy };
  }
  if (r.code !== 0) {
    const said = `${r.stderr}\n${r.stdout}`;
    if (said.includes("still starting")) return { state: "skipped", detail: "Deck is still starting your apps" };
    if (/isn't running|not running/i.test(said)) return { state: "skipped", detail: NOT_RUNNING };
    const first = said.trim().split("\n")[0] || `exit ${r.code}`;
    return { state: "partial", detail: `Deck couldn't restart your apps: ${first}`, remedy: MANAGED_REMEDY };
  }
  if (restarted.length === 0) return { state: "skipped", detail: "No apps to restart" };

  await waitForHealthy(p, port, restarted, seams, log);
  return { state: "done", detail: `Restarted ${restarted.join(", ")}` };
}

/** Clears the owed mark once nothing is left stale: on done, or when there was nothing deck could restart. A partial keeps it, so Finish tries again. */
export async function restartServedApps(p: Probes, log: (line: string) => void, seams: AppsRestartSeams = REAL_APPS_RESTART_SEAMS): Promise<StepOutcome> {
  let outcome: StepOutcome;
  try {
    outcome = await restart(p, log, seams);
  } catch (err) {
    outcome = { state: "partial", detail: `Deck couldn't restart your apps: ${err instanceof Error ? err.message : String(err)}`, remedy: MANAGED_REMEDY };
  }
  if (outcome.state === "done" || outcome.state === "skipped") clearOwed(p);
  return outcome;
}

/**
 * As a run's end step it settles the owed mark whatever its outcome: the run's
 * own restart is the one it owes, and a Finish that retried a partial one
 * would restart the board just as P7 opens it.
 */
export function makeAppsRestartStep(seams: AppsRestartSeams = REAL_APPS_RESTART_SEAMS): StepDef {
  return {
    id: "apps.restart",
    title: "Restart your apps",
    kind: "rt",
    updateSafe: true,
    applies: () => true,
    async run(ctx: ApplyContext) {
      const outcome = await restartServedApps(ctx.p, (line) => ctx.log("apps.restart", line), seams);
      clearOwed(ctx.p);
      return outcome;
    },
  };
}

export const appsRestartStep = makeAppsRestartStep();

/** Called by an `--only` run that ended ok: it restarts nothing itself, so Finish owes one. */
export function oweAppsRestart(p: Probes): void {
  updateSetupState(p, (s) => ({ ...s, appsRestartOwed: true }));
}

export function appsRestartOwed(p: Probes): boolean {
  return readSetupState(p).appsRestartOwed === true;
}
