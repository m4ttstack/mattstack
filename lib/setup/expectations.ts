/**
 * Every checklist step is expected on every path: before Install, before
 * Finish, skippable before Finish, or information only. The validators keep
 * their own shape; this pass raises it to the row's target and never lowers
 * a `required` a validator set.
 */

import type { Action, Group, Row } from "./contract.ts";

export type Target = "install" | "finish" | "skip" | "info";

export const ROW_TARGETS: Readonly<Record<string, Target>> = {
  "tool.editor": "install",
  "tool.chrome": "install",
  "home.backup": "install",
  "tool.state-backup": "install",
  "team.identity": "install",
  "perm.notifications": "install",
  "tool.herdr": "finish",
  "tool.claude": "finish",
  "tool.fast-browser": "finish",
  "tool.linear-mcp": "finish",
  "tool.extension": "finish",
  "tool.vsix": "finish",
  "tool.rt-link": "finish",
  "tool.shell": "finish",
  "tool.intercepts": "finish",
  "tool.proxy": "finish",
  "team.sync": "finish",
  "team.marketplace": "finish",
  "account.board-peering": "finish",
  "skills.overrides": "skip",
  "tool.chrome-signin": "skip",
  "tool.mission-control": "skip",
  "tool.path": "info",
  "team.push-access": "info",
};

const RECHECK_ACTION: Action = { type: "run", label: "Re-check", verb: ["setup", "status"] };

function isRecheck(a: Action): boolean {
  return a.type === "run" && a.verb.length === 2 && a.verb[0] === "setup" && a.verb[1] === "status";
}

function waitForFinish(r: Row): Row {
  return { ...r, finishGated: true, waivable: false, optionalNote: null };
}

function toTarget(r: Row, target: Target): Row {
  if (target === "info") {
    const { finishGated: _gated, waivable: _waivable, ...rest } = r;
    return { ...rest, required: false, information: true };
  }
  if (r.status === "ready" || r.status === "skipped") return { ...r, optionalNote: null };
  if (target === "skip") return { ...r, finishGated: true, waivable: true };
  if (r.required) return r;
  // An install row nobody can press anything on would strand Install, so it waits for Finish instead.
  if (target === "install" && r.action !== null && !isRecheck(r.action)) return { ...r, required: true, optionalNote: null };
  return waitForFinish(r);
}

export function applyExpectations(groups: Group[]): Group[] {
  return groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => {
      const target = ROW_TARGETS[r.id];
      if (!target) return r;
      const out = toTarget(r, target);
      return out.finishGated && out.action === null ? { ...out, action: RECHECK_ACTION } : out;
    }),
  }));
}
