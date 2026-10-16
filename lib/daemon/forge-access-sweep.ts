/**
 * Applies forge access soon after the org's roles or roster change, whoever
 * wrote the change (the board, the console, a CLI verb). The comparison is a
 * local read; the forge is asked only when the wanted access moved since this
 * Mac last applied it. The same run re-encrypts the admin-only secrets for the
 * new owners and admins. A run the forge refused, or one that kept people off
 * the push list, comes back after FORGE_ACCESS_RETRY_MS, whether or not the
 * wanted access moved meanwhile.
 */

import type { Logger } from "pino";
import { isOrgAdmin } from "../../packages/rt-client/src/settings/org-roles.ts";
import type { SecretsSeams } from "../secrets/store.ts";
import { createRealTeamSecretsSeams } from "../secrets/team-store.ts";
import type { Probes } from "../setup/probes.ts";
import { cloneSlugs } from "../setup/team-settings.ts";
import { applyForgeAccessAndFollow, sharedBranchSentence, wantedFingerprint, type ForgeAccessReport } from "../team/forge-access-apply.ts";
import { roleFor } from "../team/roles.ts";
import { readTeamLocal } from "../team/team-local.ts";

export interface ForgeAccessSweepDeps {
  probes: Probes;
  slugs?: (p: Probes) => string[];
  run?: (p: Probes, slug: string, secrets: SecretsSeams) => ReturnType<typeof applyForgeAccessAndFollow>;
  secrets?: (slug: string) => SecretsSeams;
  fingerprint?: typeof wantedFingerprint;
  log: Pick<Logger, "info" | "warn">;
  now?: () => number;
}

export const FORGE_ACCESS_RETRY_MS = 30 * 60 * 1000;

function heldStep(report: ForgeAccessReport): string | null | undefined {
  if (report.kind === "refused") return report.manualSteps[0] ?? null;
  if (report.kind === "shared-branch") return sharedBranchSentence(report.branch);
  return undefined;
}

export function createForgeAccessSweep(deps: ForgeAccessSweepDeps): () => Promise<void> {
  const slugs = deps.slugs ?? cloneSlugs;
  const run = deps.run ?? ((p: Probes, slug: string, secrets: SecretsSeams) => applyForgeAccessAndFollow(p, slug, secrets));
  const secretsFor = deps.secrets ?? createRealTeamSecretsSeams;
  const fingerprint = deps.fingerprint ?? wantedFingerprint;
  const now = deps.now ?? Date.now;
  const retryAt = new Map<string, number>();
  const warnedFor = new Map<string, string>();
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      for (const slug of slugs(deps.probes)) {
        try {
          const local = readTeamLocal(deps.probes, slug);
          if (!local.rtMayManageMembership || !isOrgAdmin(roleFor(deps.probes, slug))) continue;
          const wanted = await fingerprint(deps.probes, slug);
          if (wanted === null) continue;
          const due = retryAt.get(slug);
          const at = now();
          if (due !== undefined ? at < due : wanted === local.forgeAccess?.fingerprint) continue;
          const { report, applied, admin } = await run(deps.probes, slug, secretsFor(slug));
          const step = heldStep(report);
          if (step !== undefined || (applied?.heldOff.length ?? 0) > 0 || applied?.incomplete) retryAt.set(slug, at + FORGE_ACCESS_RETRY_MS);
          else retryAt.delete(slug);
          if (step === undefined) warnedFor.delete(slug);
          else if (warnedFor.get(slug) !== wanted) {
            warnedFor.set(slug, wanted);
            deps.log.warn({ sweep: "forge-access", team: slug, kind: report.kind, ...(step ? { step } : {}) }, "forge access sweep could not apply for an org");
          }
          if (applied) deps.log.info({ sweep: "forge-access", team: slug, changed: applied.done.length, manual: applied.manualSteps.length, heldOff: applied.heldOff.length, reencrypted: admin?.reencrypted.length ?? 0 }, "forge access applied");
          if (admin?.failure) deps.log.warn({ sweep: "forge-access", team: slug, failure: admin.failure }, "admin-only secrets did not follow the role change");
        } catch (err) {
          deps.log.warn({ err, sweep: "forge-access", team: slug }, "forge access sweep failed for an org");
        }
      }
    } finally {
      running = false;
    }
  };
}
