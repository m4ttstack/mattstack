/**
 * `verify` — the apply run's own final check, over the SAME validators
 * `rt verify`/`composePlan` already run (post-install, `mode: "status"`).
 * Never a second verification path: this step's job is only to turn
 * `rowsToChecks`' output into one `StepOutcome`.
 */

import { composePlan } from "../plan.ts";
import { isTeamSyncFirstPullPending, ONE_TEAM_ROW_ID } from "../validators/rt-health.ts";
import { rowsToChecks } from "../../../commands/verify.ts";
import type { Row } from "../contract.ts";
import { BOARD_PEERING_ROW_ID } from "../validators/accounts.ts";
import type { ApplyContext } from "../apply.ts";
import type { StepDef, StepOutcome } from "../apply.ts";
import { toFailedOutcome } from "./step-utils.ts";

type CheckResult = ReturnType<typeof rowsToChecks>[number];

type MemberTask = { verb: "connect" | "install"; label: string };

const UNPEERED_NOTE = "Board not peered: ask the team owner to re-invite you";
const SEVERAL_TEAMS_NOTE = "More than one team on this Mac: open Setup status";

/**
 * Install never connects an account or installs a team-declared tool: both
 * wait on the member. So a required row of either kind that is simply not
 * set up yet is left for them, not an install failure; one that is set up
 * but broken (`invalid`, `error`) still is. A `tool.team.*` row is only
 * `missing` when its CLI is not installed, hence "install", not "connect".
 */
function memberTask(row: Row | undefined): MemberTask | null {
  if (!row || (row.status !== "missing" && row.status !== "needs-you")) return null;
  if (row.kind === "account") return { verb: "connect", label: row.title };
  if (row.id.startsWith("tool.team.")) return { verb: "install", label: row.title };
  return null;
}

/** The check names `outcomeFromChecks` would leave for the member rather than fail, for `settleChecks`' `leftForMember`. */
export function leftForMemberIn(rows: Row[]): (name: string) => boolean {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (name) => memberTask(byId.get(name)) !== null;
}

export function outcomeFromChecks(checks: CheckResult[], rows: Row[] = []): StepOutcome {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tasks: MemberTask[] = [];
  const failures: CheckResult[] = [];
  for (const c of checks) {
    if (c.status !== "fail" || c.severity !== "critical") continue;
    const task = memberTask(byId.get(c.name));
    if (task) tasks.push(task);
    else failures.push(c);
  }
  const note = [
    ...(["connect", "install"] as const)
      .map((verb) => [verb, tasks.filter((t) => t.verb === verb).map((t) => t.label)] as const)
      .filter(([, labels]) => labels.length > 0)
      .map(([verb, labels]) => `To ${verb}: ${labels.join(", ")}`),
    // Not required, so it never fails a check, but only the member can chase the owner for the token.
    ...(byId.get(BOARD_PEERING_ROW_ID)?.status === "needs-you" ? [UNPEERED_NOTE] : []),
    // Not required either, and nothing else tells a Mac that already has two zones.
    ...(byId.get(ONE_TEAM_ROW_ID)?.status === "needs-you" ? [SEVERAL_TEAMS_NOTE] : []),
  ].join(". ");
  if (failures.length > 0) {
    return {
      state: "failed",
      detail: `${failures.length} check${failures.length === 1 ? "" : "s"} failed: ${failures.map((f) => byId.get(f.name)?.title ?? f.name).join(", ")}${note ? `. ${note}` : ""}`,
      remedy: "Run rt verify for details",
    };
  }
  if (note) return { state: "needs-you", detail: note };
  const passed = checks.filter((c) => c.status === "pass").length;
  return { state: "done", detail: `${passed} check${passed === 1 ? "" : "s"} passed` };
}

/** Rows whose failure right after Install means "still booting", not "broken": services.start kickstarted the daemon seconds ago and its launchctl/worktrees sub-probes lag the ping, and a joiner's team.sync engine hasn't taken its first pull yet. */
const SETTLING_ROWS = new Set(["tool.daemon", "team.sync"]);
const SETTLE_ATTEMPTS = 5;
const SETTLE_INTERVAL_MS = 3000;

/**
 * Re-reads the checks while the only critical failures are settling rows;
 * any other failure is judged on the first read. team.sync is `required:
 * false`, so it never shows up as a critical failure; its first-pull state
 * instead reads as a `warn` the row marks itself, and that gets the same
 * re-read budget so a fresh join isn't judged before the engine boots.
 */
export async function settleChecks(
  read: () => Promise<CheckResult[]>,
  opts: { attempts: number; intervalMs: number; sleep: (ms: number) => Promise<void>; leftForMember?: (name: string) => boolean },
): Promise<CheckResult[]> {
  let checks = await read();
  for (let attempt = 1; attempt < opts.attempts; attempt++) {
    // Rows left for the member never settle on their own, so they neither end the wait nor extend it.
    const critical = checks.filter((c) => c.status === "fail" && c.severity === "critical" && !opts.leftForMember?.(c.name));
    // A critical failure nothing here can settle is a verdict, not a lag, and
    // must not be made to wait out team.sync's budget alongside it.
    if (critical.some((c) => !SETTLING_ROWS.has(c.name))) break;
    const teamSync = checks.find((c) => c.name === "team.sync");
    const firstPullPending = teamSync?.status === "warn" && isTeamSyncFirstPullPending(teamSync.detail);
    if (critical.length === 0 && !firstPullPending) break;
    await opts.sleep(opts.intervalMs);
    checks = await read();
  }
  return checks;
}

async function verifyRun(ctx: ApplyContext): Promise<StepOutcome> {
  let rows: Row[] = [];
  const read = async () => {
    const plan = await composePlan({
      p: ctx.p,
      secrets: ctx.secretPresence,
      ci: ctx.ci,
      mode: "status",
      teams: ctx.team.slug ? [ctx.team.slug] : [],
    });
    rows = plan.groups.flatMap((g) => g.rows);
    return rowsToChecks(plan, { ci: ctx.ci });
  };
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const checks = await settleChecks(read, { attempts: SETTLE_ATTEMPTS, intervalMs: SETTLE_INTERVAL_MS, sleep, leftForMember: (name) => leftForMemberIn(rows)(name) });
  return outcomeFromChecks(checks, rows);
}

async function verifyRunSafe(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await verifyRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const verifyStep: StepDef = {
  id: "verify",
  title: "Verify your setup",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: verifyRunSafe,
};
