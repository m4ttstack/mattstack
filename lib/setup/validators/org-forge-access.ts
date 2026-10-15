import { readForgeAccess, type ForgeAccessReport } from "../../team/forge-access-apply.ts";
import { diffLines, hasChanges, limitSentence } from "../../team/forge-access-plan.ts";
import { row, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";

export const FORGE_ACCESS_ROW_ID = "org.forge-access";

const BASE = {
  id: FORGE_ACCESS_ROW_ID,
  kind: "access" as const,
  title: "Forge access",
  why: "Who can push the org's data branch, and who can reach its repo on the forge, follow the org's roles. rt only adds access; it never lowers anyone's.",
  required: false,
  recheck: "on-activate" as const,
};

/** Shown on Macs whose role runs the org. A forge that cannot be read turns into one row, so the accounts group never fails over it. */
export async function forgeAccessRow(p: Probes, org: string, read: (p: Probes, org: string) => Promise<ForgeAccessReport> = readForgeAccess): Promise<Row | null> {
  let report: ForgeAccessReport;
  try {
    report = await read(p, org);
  } catch (err) {
    return row({ ...BASE, status: "error", detail: `rt could not check forge access: ${err instanceof Error ? err.message : String(err)}`, action: { type: "run", label: "Re-check", verb: ["setup", "status"] } });
  }
  switch (report.kind) {
    case "not-admin":
    case "no-forge":
    case "not-yet":
      return null;
    case "trial":
      return row({ ...BASE, status: "skipped", detail: `Forge access waits while this Mac is on the trial branch ${report.branch}` });
    case "refused":
      return row({ ...BASE, status: "needs-you", detail: "rt could not check who has access to the org's repo on the forge", action: { type: "steps", label: "Show steps…", steps: report.manualSteps } });
    case "ready": {
      const limit = limitSentence(report.pushList, report.branch);
      if (!hasChanges(report.diff)) return row({ ...BASE, status: "ready", detail: limit ?? "Forge access matches the org's roles" });
      const detail = `The forge differs from the org's roles: ${diffLines(report.diff, report.branch).join("; ")}`;
      if (!report.managing) return row({ ...BASE, status: "needs-you", detail, action: { type: "run", label: "Let rt manage it", verb: ["team", "manage-membership", "on", "--team", org] } });
      if (report.lastManualSteps.length > 0) return row({ ...BASE, status: "needs-you", detail, action: { type: "steps", label: "Show steps…", steps: report.lastManualSteps } });
      return row({ ...BASE, status: "needs-you", detail, action: { type: "run", label: "Apply now", verb: ["team", "forge-access", "--apply", "--team", org] } });
    }
  }
}
