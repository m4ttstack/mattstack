/**
 * The readiness checklist as output blocks: what `rt setup`, `rt setup plan`,
 * `rt setup status` and `rt verify` show a person. The plan itself is the
 * app's contract and is never changed here.
 */
import * as out from "../ui/out.ts";
import type { Block, RenderStatus } from "../ui/protocol.ts";
import { isSolo, type OrgRef, type Plan, type Row, type RowStatus } from "./contract.ts";

const ROW_STATUS: Record<Exclude<RowStatus, "missing">, RenderStatus> = {
  ready: "done",
  invalid: "failed",
  error: "warn",
  "needs-you": "needs-you",
  skipped: "skipped",
  checking: "pending",
};

/** A missing account or permission waits on the person; anything else missing is what apply installs. */
export function rowStatus(r: Pick<Row, "status" | "kind">): RenderStatus {
  if (r.status === "missing") return r.kind === "account" || r.kind === "permission" ? "needs-you" : "pending";
  return ROW_STATUS[r.status];
}

/** An account that blocks neither Install nor Finish, such as the forge a solo dev does not use. */
function isOptionalAccount(r: Row): boolean {
  return r.kind === "account" && !r.required && !r.finishGated;
}

/** What `rt setup status` and `rt verify` draw: on Just me an optional account nobody connected is off; a team Mac keeps needs-you. */
export function checklistStatus(r: Row, team: Pick<OrgRef, "slug" | "mode">): RenderStatus {
  return r.status === "missing" && isOptionalAccount(r) && isSolo(team) ? "off" : rowStatus(r);
}

/** The connect verb for a missing account row; only connect and oauth actions have one. */
export function accountConnectVerb(r: Pick<Row, "status" | "action">): string | null {
  if (r.status !== "missing") return null;
  if (r.action?.type !== "connect" && r.action?.type !== "oauth") return null;
  return `rt setup ${r.action.integration} connect`;
}

export function rowTitles(plan: Plan, ids: readonly string[]): string[] {
  const byId = new Map(plan.groups.flatMap((g) => g.rows).map((r) => [r.id, r.title] as const));
  return ids.map((id) => byId.get(id) ?? id);
}

function rowBlocks(r: Row, status: RenderStatus, mode: "plan" | "status"): Block[] {
  const blocks: Block[] = [out.line(status, r.title, r.detail)];
  if (r.action?.type === "choose" && r.action.footnote) blocks.push(out.callout("note", r.action.footnote));
  const verb = mode === "status" && status !== "off" ? accountConnectVerb(r) : null;
  if (verb) blocks.push(out.callout("next", out.cmd(verb)));
  return blocks;
}

/** An off row is left out of the count, so a group of nothing but off rows names that instead of a fraction. */
function readyCount(drawn: readonly { r: Row; status: RenderStatus }[]): string {
  const counted = drawn.filter((d) => d.status !== "off");
  if (counted.length === 0) return "all optional";
  return `${counted.filter((d) => d.r.status === "ready").length} of ${counted.length} ready`;
}

export function planBlocks(plan: Plan, mode: "plan" | "status"): Block[] {
  const sections = plan.groups
    .filter((g) => g.rows.length > 0)
    .map((g) => {
      const drawn = g.rows.map((r) => ({ r, status: checklistStatus(r, plan.team) }));
      return out.section(g.title, readyCount(drawn), ...drawn.flatMap(({ r, status }) => rowBlocks(r, status, mode)));
    });
  const install = plan.canInstall ? out.summary("done", "Install can run") : out.summary("needs-you", "Install is waiting on", rowTitles(plan, plan.requiredMissing));
  const finish =
    mode !== "status" ? [] : plan.finishBlockedBy.length === 0 ? [out.line("done", "Finish can run")] : [out.line("needs-you", "Finish is waiting on", rowTitles(plan, plan.finishBlockedBy).join(", "))];
  return [...sections, install, ...finish];
}
