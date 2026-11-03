import { realpathSync } from "fs";
import { join, resolve } from "path";
import { cswapConfigDirs } from "../../cswap.ts";
import { resolveTool } from "../../deps/resolve.ts";
import { heldCopy, runnableEngine } from "../../engine-floor.ts";
import { orgDirUnder } from "../../rt-paths.ts";
import { disableModelInvocationConfigDirs, readDisableModelInvocationChoices, reconcileDisableModelInvocation } from "../../skills/disable-model-invocation.ts";
import type { ApplyContext, StepOutcome } from "../apply.ts";
import type { MigrationEventId } from "../contract.ts";
import { writeGeneratedMarketplace } from "../generated-marketplace.ts";
import { claudeMessage, PACK_EXEC_TIMEOUT_MS, readServedPacks } from "../pack-cache.ts";
import { ADMIT_UNFLOORED, admit, installArgs, type Admission, type Admitted } from "../plugin-calls.ts";
import type { ExecResult } from "../probes.ts";
import type { PendingMarketplaceMove } from "../state.ts";
import { ORG_FOLDER_REMEDY } from "../steps/org-folder.ts";
import { catalogPluginIds, marketplaceName, parseInstalledFrom, pendingFor, setPending } from "../steps/org-folder-marketplace.ts";
import { cloneSlugs } from "../team-settings.ts";
import { claudeConfigDirs } from "../tools-install.ts";
import type { MigrationDef } from "./index.ts";

const ID = "2026-11-02-team-packs-from-git";
const LOG_ID: MigrationEventId = `migration.${ID}`;

type InstalledPlugin = PendingMarketplaceMove["plugins"][number];

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** A cswap session dir can share the default dir's plugins folder through a symlink, and one plugin set must be reinstalled once. */
function dedupedConfigDirs(ctx: ApplyContext): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of claudeConfigDirs(ctx.p, cswapConfigDirs(ctx.p))) {
    const key = realOrResolved(join(dir, "plugins"));
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }
  return dirs;
}

function alreadyGone(res: ExecResult): boolean {
  return /not installed|not found/i.test(`${res.stdout}\n${res.stderr}`);
}

const pushOnce = (list: string[], item: string): void => {
  if (!list.includes(item)) list.push(item);
};

/** "a is" / "a, b are", with the pronoun pair that agrees. */
function naming(ids: string[]): { list: string; is: string; was: string; it: string; its: string } {
  const one = ids.length === 1;
  return { list: ids.join(", "), is: one ? "is" : "are", was: one ? "was" : "were", it: one ? "it" : "they", its: one ? "it keeps its" : "they keep their" };
}

/** A failure here only warns: the reinstalled copies are in place either way. */
function reapplyDisableModelInvocation(ctx: ApplyContext): boolean {
  try {
    const choices = readDisableModelInvocationChoices();
    if (Object.keys(choices).length === 0) return false;
    const { warnings } = reconcileDisableModelInvocation({ configDirs: disableModelInvocationConfigDirs(ctx.p.env, ctx.p.home), choices });
    for (const warning of warnings) ctx.log(LOG_ID, `disabled skills: ${warning}`);
    return warnings.length > 0;
  } catch (err) {
    ctx.log(LOG_ID, `disabled skills: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }
}

/**
 * Team packs installed while the org marketplace was a folder of directory
 * sources keep the copy that install made, and `claude plugin update` at the
 * same version changes nothing. This one pass re-points each config dir at the
 * generated marketplace and uninstalls and reinstalls every user-scope pack
 * from it, so the cached copy Claude now loads is the committed one. A project
 * or local install is left on its copy: redoing it would rewrite that
 * project's own settings. Any failure returns `failed`, which leaves the
 * migration unrecorded so a later update runs it again; a pack it already
 * reinstalled is reinstalled again then, which changes nothing.
 */
export const teamPacksFromGitMigration: MigrationDef = {
  id: ID,
  title: "Reinstall your team plugins from the org repo",
  async run(ctx): Promise<StepOutcome> {
    const slugs = cloneSlugs(ctx.p);
    if (slugs.length === 0) return { state: "skipped", detail: "This Mac has no org clone" };
    const claude = resolveTool(ctx.p, "claude");
    if (!claude.exec) return { state: "skipped", detail: "Claude Code is not installed" };

    const engine = ctx.engine ? ctx.engine() : runnableEngine();
    const configDirs = dedupedConfigDirs(ctx);
    const prefixFor = (dir: string): string => (dir === configDirs[0] && ctx.p.env.CLAUDE_CONFIG_DIR === undefined ? "" : `CLAUDE_CONFIG_DIR=${dir} `);
    const reinstalled: string[] = [];
    const failures: string[] = [];
    /** What to run by hand for a pack this run uninstalled and could not put back. */
    const commands: string[] = [];
    const held: string[] = [];
    const projectCopies: string[] = [];
    const handedBack: string[] = [];
    const offCatalog: string[] = [];
    const droppedFromRecord: string[] = [];
    let sawPacks = false;

    for (const slug of slugs) {
      const generated = await writeGeneratedMarketplace(ctx.p, slug);
      if (generated.skipped !== undefined) {
        // An org with no marketplace at all has no packs to move; one that declares a marketplace has packs left on their copies.
        if (marketplaceName(ctx.p, orgDirUnder(ctx.p.home, slug)) !== null) failures.push(`rt could not write this Mac's copy of the ${slug} marketplace (${generated.skipped})`);
        continue;
      }
      const name = marketplaceName(ctx.p, generated.path);
      const catalog = name === null ? null : catalogPluginIds(ctx.p, generated.path, name);
      if (name === null || catalog === null) {
        failures.push(`rt could not read this Mac's copy of the ${slug} marketplace at ${generated.path}`);
        continue;
      }
      const served = (await readServedPacks(ctx.p, slug)).packs;
      const admissionFor = (id: string): Admission => {
        const pack = served.find((x) => x.id === id);
        return pack ? admit(pack.floor, engine) : ADMIT_UNFLOORED;
      };

      for (const dir of configDirs) {
        const run = (args: string[]): Promise<ExecResult> => ctx.p.exec([...claude.exec!, ...args], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
        const listed = await run(["plugin", "list", "--json"]);
        const installedAll = listed.code === 0 ? parseInstalledFrom(listed.stdout, name) : null;
        if (installedAll === null) {
          failures.push(`Claude Code's plugin list in ${dir} could not be read (${claudeMessage(listed, `exited ${listed.code}`)})`);
          continue;
        }
        // A pack the catalog no longer lists (its team retired, or it was never shared) could never be reinstalled, so it stays on its copy.
        for (const pl of installedAll) if (!catalog.has(pl.id)) pushOnce(offCatalog, pl.id);
        const installed = installedAll.filter((pl) => catalog.has(pl.id));
        if (installedAll.length > installed.length) sawPacks = true;

        let pending = pendingFor(ctx, name, dir);
        const gone = (pending?.plugins ?? []).filter((pl) => !catalog.has(pl.id));
        if (pending && gone.length > 0) {
          for (const pl of gone) pushOnce(droppedFromRecord, pl.id);
          const listedOnes = pending.plugins.filter((pl) => catalog.has(pl.id));
          pending = listedOnes.length > 0 ? { ...pending, plugins: listedOnes } : null;
          setPending(ctx, pending, name, dir);
        }
        const carried = (pending?.plugins ?? []).filter((pl) => !installed.some((i) => i.id === pl.id));
        const plugins = [...installed, ...carried];
        if (plugins.length === 0) continue;
        sawPacks = true;

        const added = await run(["plugin", "marketplace", "add", generated.path]);
        if (added.code !== 0) {
          failures.push(`claude plugin marketplace add ${generated.path} in ${dir}: ${claudeMessage(added, `exited ${added.code}`)}`);
          continue;
        }

        const todo: { pl: InstalledPlugin; admission: Admitted }[] = [];
        for (const pl of plugins) {
          const admission = admissionFor(pl.id);
          if (!admission.ok) {
            const pack = served.find((x) => x.id === pl.id)!;
            pushOnce(held, heldCopy(pack.name, pack.servedVersion, admission.floor));
          } else if (pl.scope !== "user") {
            pushOnce(installed.includes(pl) ? projectCopies : handedBack, pl.id);
          } else {
            todo.push({ pl, admission });
          }
        }
        if (todo.length === 0) continue;
        // What an earlier record names and this run does not reinstall stays recorded for the run that can.
        const kept = carried.filter((pl) => !todo.some((t) => t.pl === pl));
        setPending(ctx, { marketplace: name, dir: generated.path, configDir: dir, plugins: [...kept, ...todo.map((t) => t.pl)] }, name, dir);

        const prefix = prefixFor(dir);
        const unfinished: InstalledPlugin[] = [];
        for (const { pl, admission } of todo) {
          if (installed.includes(pl)) {
            const removed = await run(["plugin", "uninstall", pl.id, "--scope", "user", "--keep-data"]);
            if (removed.code !== 0 && !alreadyGone(removed)) {
              failures.push(`${pl.id} in ${dir} kept its old copy: ${claudeMessage(removed, `uninstall exited ${removed.code}`)}`);
              continue;
            }
          }
          const install = installArgs(admission, pl.id, ["--scope", pl.scope]);
          const res = await run(install);
          if (res.code !== 0) {
            failures.push(`${pl.id} in ${dir} could not be reinstalled: ${claudeMessage(res, `install exited ${res.code}`)}`);
            commands.push(`${prefix}claude ${install.join(" ")}`);
            if (!pl.enabled) commands.push(`${prefix}claude plugin disable ${pl.id}`);
            unfinished.push(pl);
            continue;
          }
          if (!pl.enabled) {
            const off = await run(["plugin", "disable", pl.id]);
            if (off.code !== 0) {
              failures.push(`${pl.id} in ${dir} was reinstalled but could not be turned off again: ${claudeMessage(off, `disable exited ${off.code}`)}`);
              commands.push(`${prefix}claude plugin disable ${pl.id}`);
              unfinished.push(pl);
              continue;
            }
          }
          pushOnce(reinstalled, pl.id);
        }
        const left = [...kept, ...unfinished];
        setPending(ctx, left.length > 0 ? { marketplace: name, dir: generated.path, configDir: dir, plugins: left } : null, name, dir);
      }
    }

    if (!sawPacks && droppedFromRecord.length === 0 && failures.length === 0) return { state: "skipped", detail: "No team plugins are installed on this Mac" };

    const notes: string[] = [];
    if (reinstalled.length > 0) notes.push(`Reinstalled ${reinstalled.join(", ")} from the org repo.`);
    if (reinstalled.length > 0 && reapplyDisableModelInvocation(ctx)) notes.push("Some skills could not have model invocation disabled.");
    if (projectCopies.length > 0) {
      const n = naming(projectCopies);
      notes.push(`${n.list} ${n.is} installed for a project, so ${n.its} copy until the next version.`);
    }
    if (handedBack.length > 0) {
      const n = naming(handedBack);
      notes.push(`${n.list} ${n.was} removed by an earlier update and must be reinstalled from the project that used ${handedBack.length === 1 ? "it" : "them"}.`);
    }
    if (offCatalog.length > 0) {
      const n = naming(offCatalog);
      notes.push(`${n.list} ${n.is} not in the org's marketplace any more, so ${n.its} copy.`);
    }
    if (droppedFromRecord.length > 0) {
      const n = naming(droppedFromRecord);
      notes.push(`${n.list} ${n.is} not in the org's marketplace any more, so ${n.it} cannot be reinstalled.`);
    }
    notes.push(...held);
    if (failures.length === 0) return { state: "done", detail: notes.join(" ") };
    notes.push(`Not finished: ${failures.join("; ")}.`);
    const remedy = commands.length > 0 ? `Run ${commands.join(", then ")}, then rt setup update --force` : ORG_FOLDER_REMEDY;
    return { state: "failed", detail: notes.join(" "), remedy };
  },
};
