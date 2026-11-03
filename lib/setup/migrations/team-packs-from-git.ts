import { realpathSync } from "fs";
import { join, resolve } from "path";
import { cswapConfigDirs } from "../../cswap.ts";
import { resolveTool } from "../../deps/resolve.ts";
import { heldCopy, runnableEngine } from "../../engine-floor.ts";
import { disableModelInvocationConfigDirs, readDisableModelInvocationChoices, reconcileDisableModelInvocation } from "../../skills/disable-model-invocation.ts";
import type { ApplyContext, StepOutcome } from "../apply.ts";
import type { MigrationEventId } from "../contract.ts";
import { writeGeneratedMarketplace } from "../generated-marketplace.ts";
import { claudeMessage, PACK_EXEC_TIMEOUT_MS, readServedPacks } from "../pack-cache.ts";
import { ADMIT_UNFLOORED, admit, installArgs, type Admission, type Admitted } from "../plugin-calls.ts";
import type { ExecResult } from "../probes.ts";
import { readSetupState, updateSetupState, type PendingMarketplaceMove } from "../state.ts";
import { marketplaceName, parseInstalledFrom } from "../steps/org-folder-marketplace.ts";
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

// Copied from steps/org-folder-marketplace.ts, which keeps them private: the record is the same one the org.folder converge finishes.
function pendingFor(ctx: ApplyContext, marketplace: string, configDir: string): PendingMarketplaceMove | null {
  return (readSetupState(ctx.p).orgMarketplaceMoves ?? []).find((m) => m.marketplace === marketplace && m.configDir === configDir) ?? null;
}

function setPending(ctx: ApplyContext, record: PendingMarketplaceMove | null, marketplace: string, configDir: string): void {
  updateSetupState(ctx.p, (s) => {
    const others = (s.orgMarketplaceMoves ?? []).filter((m) => !(m.marketplace === marketplace && m.configDir === configDir));
    const next = record ? [...others, record] : others;
    const { orgMarketplaceMoves: _dropped, ...rest } = s;
    return next.length ? { ...rest, orgMarketplaceMoves: next } : rest;
  });
}

function alreadyGone(res: ExecResult): boolean {
  return /not installed|not found/i.test(`${res.stdout}\n${res.stderr}`);
}

const pushOnce = (list: string[], item: string): void => {
  if (!list.includes(item)) list.push(item);
};

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
 * project's own settings.
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
    const reinstalled: string[] = [];
    const failures: string[] = [];
    const held: string[] = [];
    const leftAlone: string[] = [];
    let sawPacks = false;

    for (const slug of slugs) {
      const generated = await writeGeneratedMarketplace(ctx.p, slug);
      if (generated.skipped !== undefined) continue;
      const name = marketplaceName(ctx.p, generated.path);
      if (name === null) continue;
      const served = (await readServedPacks(ctx.p, slug)).packs;
      const admissionFor = (id: string): Admission => {
        const pack = served.find((x) => x.id === id);
        return pack ? admit(pack.floor, engine) : ADMIT_UNFLOORED;
      };

      for (const dir of configDirs) {
        const run = (args: string[]): Promise<ExecResult> => ctx.p.exec([...claude.exec!, ...args], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
        const listed = await run(["plugin", "list", "--json"]);
        const installed = listed.code === 0 ? parseInstalledFrom(listed.stdout, name) : null;
        if (installed === null) {
          failures.push(`Claude Code's plugin list in ${dir} could not be read (${claudeMessage(listed, `exited ${listed.code}`)})`);
          continue;
        }
        const pending = pendingFor(ctx, name, dir);
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
            pushOnce(leftAlone, pl.id);
          } else {
            todo.push({ pl, admission });
          }
        }
        if (todo.length === 0) continue;
        // What an earlier record names and this run does not reinstall stays recorded for the run that can.
        const kept = carried.filter((pl) => !todo.some((t) => t.pl === pl));
        setPending(ctx, { marketplace: name, dir: generated.path, configDir: dir, plugins: [...kept, ...todo.map((t) => t.pl)] }, name, dir);

        const unfinished: InstalledPlugin[] = [];
        for (const { pl, admission } of todo) {
          if (installed.includes(pl)) {
            const removed = await run(["plugin", "uninstall", pl.id, "--scope", "user", "--keep-data"]);
            if (removed.code !== 0 && !alreadyGone(removed)) {
              failures.push(`${pl.id} in ${dir} kept its old copy: ${claudeMessage(removed, `uninstall exited ${removed.code}`)}`);
              continue;
            }
          }
          const res = await run(installArgs(admission, pl.id, ["--scope", pl.scope]));
          if (res.code !== 0) {
            failures.push(`${pl.id} in ${dir} could not be reinstalled: ${claudeMessage(res, `install exited ${res.code}`)}`);
            unfinished.push(pl);
            continue;
          }
          if (!pl.enabled) {
            const off = await run(["plugin", "disable", pl.id]);
            if (off.code !== 0) {
              failures.push(`${pl.id} in ${dir} was reinstalled but could not be turned off again: ${claudeMessage(off, `disable exited ${off.code}`)}`);
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

    if (!sawPacks) {
      return failures.length > 0 ? { state: "failed", detail: failures.join("; ") } : { state: "skipped", detail: "No team plugins are installed on this Mac" };
    }

    const notes: string[] = [];
    if (reinstalled.length > 0) notes.push(`Reinstalled ${reinstalled.join(", ")} from the org repo.`);
    if (reapplyDisableModelInvocation(ctx)) notes.push("Some skills could not have model invocation disabled.");
    if (leftAlone.length > 0) notes.push(`${leftAlone.join(", ")} ${leftAlone.length === 1 ? "is" : "are"} installed for a project, so ${leftAlone.length === 1 ? "it keeps its" : "they keep their"} copy until the next version.`);
    notes.push(...held);
    if (failures.length > 0) notes.push(`Not finished: ${failures.join("; ")}.`);
    return { state: "done", detail: notes.join(" ") };
  },
};
