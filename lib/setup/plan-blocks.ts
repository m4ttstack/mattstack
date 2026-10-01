/**
 * The readiness checklist as output blocks: what `rt setup`, `rt setup plan`,
 * `rt setup status` and `rt verify` show a person. The plan itself is the
 * app's contract and is never changed here.
 */
import * as out from "../ui/out.ts";
import type { Block, RenderStatus } from "../ui/protocol.ts";
import type { Plan, Row, RowStatus } from "./contract.ts";

const ROW_STATUS: Record<Exclude<RowStatus, "missing">, RenderStatus> = {
  ready: "done",
  invalid: "failed",
  error: "failed",
  "needs-you": "needs-you",
  skipped: "skipped",
  checking: "pending",
};

/** A missing account or permission waits on the person; anything else missing is what apply installs. */
export function rowStatus(r: Pick<Row, "status" | "kind">): RenderStatus {
  if (r.status === "missing") return r.kind === "account" || r.kind === "permission" ? "needs-you" : "pending";
  return ROW_STATUS[r.status];
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

function rowBlocks(r: Row, mode: "plan" | "status"): Block[] {
  const blocks: Block[] = [out.line(rowStatus(r), r.title, r.detail)];
  if (r.action?.type === "choose" && r.action.footnote) blocks.push(out.callout("note", r.action.footnote));
  const verb = mode === "status" ? accountConnectVerb(r) : null;
  if (verb) blocks.push(out.callout("next", out.cmd(verb)));
  return blocks;
}

export function planBlocks(plan: Plan, mode: "plan" | "status"): Block[] {
  const sections = plan.groups.map((g) => {
    const ready = g.rows.filter((r) => r.status === "ready").length;
    return out.section(g.title, g.rows.length > 0 ? `${ready} of ${g.rows.length} ready` : undefined, ...g.rows.flatMap((r) => rowBlocks(r, mode)));
  });
  const install = plan.canInstall ? out.summary("done", "Install can run") : out.summary("needs-you", "Install is waiting on", rowTitles(plan, plan.requiredMissing));
  const finish =
    mode !== "status" ? [] : plan.finishBlockedBy.length === 0 ? [out.line("done", "Finish can run")] : [out.line("needs-you", "Finish is waiting on", rowTitles(plan, plan.finishBlockedBy).join(", "))];
  return [...sections, install, ...finish];
}
