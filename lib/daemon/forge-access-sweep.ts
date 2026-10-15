/**
 * Applies forge access soon after the org's roles or roster change, whoever
 * wrote the change (the board, the console, a CLI verb). The comparison is a
 * local read; the forge is asked only when the wanted access moved since this
 * Mac last applied it. The same run re-encrypts the admin-only secrets for the
 * new owners and admins (plan 4's followRosterChange).
 */

import type { Logger } from "pino";
import { isOrgAdmin } from "../../packages/rt-client/src/settings/org-roles.ts";
import type { SecretsSeams } from "../secrets/store.ts";
import { createRealTeamSecretsSeams } from "../secrets/team-store.ts";
import type { Probes } from "../setup/probes.ts";
import { cloneSlugs } from "../setup/steps/org.ts";
import { applyForgeAccessAndFollow, wantedFingerprint } from "../team/forge-access-apply.ts";
import { roleFor } from "../team/roles.ts";
import { readTeamLocal } from "../team/team-local.ts";

export interface ForgeAccessSweepDeps {
  probes: Probes;
  slugs?: (p: Probes) => string[];
  run?: (p: Probes, slug: string, secrets: SecretsSeams) => ReturnType<typeof applyForgeAccessAndFollow>;
  secrets?: (slug: string) => SecretsSeams;
  fingerprint?: typeof wantedFingerprint;
  log: Pick<Logger, "info" | "warn">;
}

export function createForgeAccessSweep(deps: ForgeAccessSweepDeps): () => Promise<void> {
  const slugs = deps.slugs ?? cloneSlugs;
  const run = deps.run ?? ((p: Probes, slug: string, secrets: SecretsSeams) => applyForgeAccessAndFollow(p, slug, secrets));
  const secretsFor = deps.secrets ?? createRealTeamSecretsSeams;
  const fingerprint = deps.fingerprint ?? wantedFingerprint;
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
          if (wanted === null || wanted === local.forgeAccess?.fingerprint) continue;
          const { applied, admin } = await run(deps.probes, slug, secretsFor(slug));
          if (applied) deps.log.info({ sweep: "forge-access", team: slug, changed: applied.done.length, manual: applied.manualSteps.length, reencrypted: admin?.reencrypted.length ?? 0 }, "forge access applied");
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
