/**
 * Brings the org repo's forge access in line with the org's roles on each
 * update run, on a Mac whose role runs the org and whose operator turned on
 * `rtMayManageMembership`. Update-safe: it only adds access and sets the data
 * branch's push list, never lowering anyone, and a second run changes
 * nothing. When the roles moved, the admin-only secrets follow.
 */

import { isOrgAdmin } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { applyForgeAccessAndFollow, sharedBranchSentence } from "../../team/forge-access-apply.ts";
import { roleFor } from "../../team/roles.ts";
import { readTeamLocal } from "../../team/team-local.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import { cloneSlugs } from "../team-settings.ts";
import { toFailedOutcome } from "./step-utils.ts";

export const forgeAccessStepSeams = { run: applyForgeAccessAndFollow };

async function run(ctx: ApplyContext): Promise<StepOutcome> {
  const slugs = cloneSlugs(ctx.p).filter((slug) => isOrgAdmin(roleFor(ctx.p, slug)) && readTeamLocal(ctx.p, slug).rtMayManageMembership);
  if (slugs.length === 0) return { state: "skipped", detail: "rt does not manage forge access on this Mac" };
  const notes: string[] = [];
  const manual: string[] = [];
  const secretFailures: string[] = [];
  const shared: string[] = [];
  for (const slug of slugs) {
    const { report, applied, admin } = await forgeAccessStepSeams.run(ctx.p, slug, ctx.teamSecrets(slug));
    if (report.kind === "refused") manual.push(...report.manualSteps);
    if (report.kind === "shared-branch") shared.push(`${slug}: ${sharedBranchSentence(report.branch)}`);
    const changed = [...(applied?.done ?? []), ...(admin && admin.reencrypted.length > 0 ? ["re-encrypted the admin-only secrets for the current owners and admins"] : [])];
    if (changed.length > 0) notes.push(`${slug}: ${changed.join("; ")}`);
    manual.push(...(applied?.manualSteps ?? []));
    if (admin?.failure) secretFailures.push(`${slug}: rt could not lock the admin-only secrets to the current owners and admins`);
  }
  if (manual.length > 0) {
    return { state: "partial", detail: [...notes, ...secretFailures, ...shared, "The forge refused part of it"].join("; "), remedy: "Run rt team forge-access to see the steps" };
  }
  if (secretFailures.length > 0) return { state: "partial", detail: [...notes, ...secretFailures, ...shared].join("; "), remedy: "Run rt team admin-secrets" };
  if (shared.length > 0) return { state: "needs-you", detail: [...notes, ...shared].join("; ") };
  return { state: "done", detail: notes.length > 0 ? notes.join("; ") : "Forge access already matches the org's roles" };
}

export const orgForgeAccessStep: StepDef = {
  id: "org.forge-access",
  title: "Match forge access to the org's roles",
  kind: "rt",
  updateSafe: true,
  applies: () => true,
  run: async (ctx) => {
    try {
      return await run(ctx);
    } catch (err) {
      return toFailedOutcome(err);
    }
  },
};
