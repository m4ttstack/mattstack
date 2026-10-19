/**
 * The daemon's side of the data branch guard: on every Mac it asks origin
 * whether the org's data branch is still there (remembering its tip while it
 * is), and on an admin's Mac whether the org's data was merged into `main`.
 * Each finding is logged once until it changes; the setup rows show it.
 */

import type { Logger } from "pino";
import { isOrgAdmin } from "../../packages/rt-client/src/settings/org-roles.ts";
import type { Probes } from "../setup/probes.ts";
import { cloneSlugs } from "../setup/team-settings.ts";
import { checkDataBranch, checkMainForOrgData, GONE_SENTENCE, MERGED_SENTENCE } from "../team/data-branch-guard.ts";
import { roleFor } from "../team/roles.ts";

export interface OrgGuardSweepDeps {
  probes: Probes;
  log: Pick<Logger, "info" | "warn">;
  slugs?: (p: Probes) => string[];
  isAdmin?: (p: Probes, slug: string) => boolean;
  checkData?: typeof checkDataBranch;
  checkMain?: typeof checkMainForOrgData;
}

export const ORG_GUARD_INTERVAL_MS = 15 * 60 * 1000;

export function createOrgGuardSweep(deps: OrgGuardSweepDeps): () => Promise<void> {
  const slugs = deps.slugs ?? cloneSlugs;
  const isAdmin = deps.isAdmin ?? ((p: Probes, slug: string) => isOrgAdmin(roleFor(p, slug)));
  const checkData = deps.checkData ?? checkDataBranch;
  const checkMain = deps.checkMain ?? checkMainForOrgData;
  const logged = new Map<string, string>();
  let running = false;
  const once = (key: string, state: string | null, report: () => void): void => {
    if (state === null) {
      logged.delete(key);
      return;
    }
    if (logged.get(key) === state) return;
    logged.set(key, state);
    report();
  };
  return async () => {
    if (running) return;
    running = true;
    try {
      for (const slug of slugs(deps.probes)) {
        try {
          const data = await checkData(deps.probes, slug);
          if (data?.kind !== "unknown") {
            once(`data:${slug}`, data?.kind === "gone" || data?.kind === "lost" ? data.kind : null, () => {
              deps.log.warn({ sweep: "org-guard", team: slug, branch: data!.branch, copy: data!.kind === "gone" }, data!.kind === "gone" ? GONE_SENTENCE : "The org's data branch is gone from the forge, and this Mac's copy does not have it");
            });
          }
          if (!isAdmin(deps.probes, slug)) continue;
          const main = await checkMain(deps.probes, slug);
          if (main?.kind !== "unknown") {
            once(`main:${slug}`, main?.kind === "merged" ? main.files.join(",") : null, () => {
              deps.log.warn({ sweep: "org-guard", team: slug, files: main!.kind === "merged" ? main!.files.slice(0, 5) : [] }, MERGED_SENTENCE);
            });
          }
        } catch (err) {
          deps.log.warn({ err, sweep: "org-guard", team: slug }, "org guard check failed for an org");
        }
      }
    } finally {
      running = false;
    }
  };
}
