import { resolveTool } from "../../deps/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { DISABLE_MODEL_INVOCATION_SETTING, disableModelInvocationConfigDirs, readDisableModelInvocationChoices, reconcileDisableModelInvocation } from "../../skills/disable-model-invocation.ts";
import { SUPERPOWERS_FORK, isSuperseded } from "../base-plugins.ts";
import { parseMarketplaceList } from "../marketplace-list.ts";
import { PACK_EXEC_TIMEOUT_MS, claudeMessage, parsePluginList } from "../pack-cache.ts";
import type { ExecResult } from "../probes.ts";
import { readSetupState, updateSetupState, type SuperpowersDisabled } from "../state.ts";
import { claudeConfigDirs } from "../tools-install.ts";
import type { ApplyContext } from "../apply.ts";
import type { MigrationEventId } from "../contract.ts";
import type { MigrationDef } from "./index.ts";
import { dedupedConfigDirs } from "./team-packs-from-git.ts";

/**
 * Once per Mac: turn off the stock superpowers copies the mattstack fork
 * replaces, at user scope in every Claude config folder, and record each one
 * so `rt uninstall` can turn it back on. A copy the member turns on again
 * later is theirs; nothing re-runs this. It runs after `plugins.install`,
 * in the same run that adds the fork and in every retry; a folder
 * where rt has never installed the fork waits (`partial` runs again next
 * launch), so a Mac is never left with no superpowers. A folder where the
 * member turned the fork off, or removed it after rt installed it, keeps its
 * stock copy and holds nothing.
 */
const ID = "2026-11-18-superpowers-fork-swap";
const LOG_ID: MigrationEventId = `migration.${ID}`;

export const superpowersForkSwapMigration: MigrationDef = {
  id: ID,
  title: "Switch to mattstack's superpowers",
  needs: ["plugins.install"],
  async run(ctx) {
    const claude = resolveTool(ctx.p, "claude");
    if (!claude.exec) return { state: "skipped", detail: "Claude Code is not installed" };

    const disabled: SuperpowersDisabled[] = [];
    const failures: string[] = [];
    const waiting: string[] = [];
    const leftOn: string[] = [];
    const managed = new Set(claudeConfigDirs(ctx.p, []));
    const rtInstalledFork = readSetupState(ctx.p).plugins.includes(SUPERPOWERS_FORK);
    for (const dir of dedupedConfigDirs(ctx, "settings.json")) {
      const run = (args: string[]): Promise<ExecResult> => ctx.p.exec([...claude.exec!, ...args], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
      const listed = await run(["plugin", "list", "--json"]);
      const entries = listed.code === 0 ? parsePluginList(listed.stdout) : null;
      if (entries === null) {
        failures.push(`${dir}: could not list plugins (${claudeMessage(listed, `exited ${listed.code}`)})`);
        continue;
      }
      const stock = entries.filter((e) => isSuperseded(e.id) && e.enabled && (e.scope === undefined || e.scope === "user"));
      if (stock.length === 0) continue;
      const fork = entries.find((e) => e.id === SUPERPOWERS_FORK && (e.scope === undefined || e.scope === "user"));
      if (!fork?.enabled) {
        // plugins.install only installs into the folders claudeConfigDirs names, never again once the member turned the fork off or removed it, and never from a marketplace the folder has not registered.
        const anyFork = entries.some((e) => e.id === SUPERPOWERS_FORK);
        const installable = managed.has(dir) && !anyFork && !rtInstalledFork && (await hasMattstackMarketplace(run));
        (installable ? waiting : leftOn).push(dir);
        continue;
      }
      for (const entry of stock) {
        const off = await run(["plugin", "disable", entry.id, "--scope", "user"]);
        if (off.code !== 0) {
          failures.push(`${dir}: claude plugin disable ${entry.id} (${claudeMessage(off, `exited ${off.code}`)})`);
          continue;
        }
        const off1: SuperpowersDisabled = { configDir: dir, id: entry.id };
        disabled.push(off1);
        // Recorded as each one lands, so a run cut short still leaves uninstall what it needs.
        updateSetupState(ctx.p, (s) => {
          const had = s.superpowersDisabled ?? [];
          return had.some((h) => h.configDir === off1.configDir && h.id === off1.id) ? s : { ...s, superpowersDisabled: [...had, off1] };
        });
      }
    }

    try {
      carrySkillChoices(ctx);
    } catch (err) {
      return { state: "partial", detail: `Could not carry disabled skills over to ${SUPERPOWERS_FORK} (${err instanceof Error ? err.message : String(err)}); trying again next launch` };
    }
    if (failures.length > 0) return { state: "failed", detail: `Could not switch every Claude config folder to mattstack's superpowers: ${failures.join("; ")}` };
    if (waiting.length > 0) return { state: "partial", detail: `Waiting for mattstack's superpowers to install before turning off the stock copy in ${waiting.join(", ")}` };
    const leftNote = leftOn.length > 0 ? `; left the stock copy on in ${leftOn.join(", ")}, where mattstack's superpowers is not on` : "";
    if (disabled.length === 0) return { state: "skipped", detail: `No stock superpowers was turned off${leftNote}` };
    return { state: "done", detail: `Turned off ${disabled.map((d) => d.id).join(", ")}; mattstack's superpowers serves the superpowers skills now${leftNote}` };
  },
};

/**
 * Skills the member kept Claude from invoking under a stock copy stay that way
 * under the fork. Works from the record, so a later run picks up a copy an
 * earlier run turned off but could not carry. A fork choice the member made
 * before the swap ever carried anything is theirs and is left alone.
 */
function carrySkillChoices(ctx: ApplyContext): void {
  const state = readSetupState(ctx.p);
  const carried = state.superpowersSkillsCarried;
  const pending = [...new Set((state.superpowersDisabled ?? []).map((d) => d.id))].filter((id) => !(carried ?? []).includes(id));
  if (pending.length === 0) return;
  const choices = readDisableModelInvocationChoices();
  const theirs = carried === undefined && Object.hasOwn(choices, SUPERPOWERS_FORK);
  if (!theirs) {
    const had = choices[SUPERPOWERS_FORK] ?? [];
    const names = [...new Set([...had, ...pending.flatMap((id) => choices[id] ?? [])])];
    if (names.length > had.length) {
      setSetting(DISABLE_MODEL_INVOCATION_SETTING, { ...choices, [SUPERPOWERS_FORK]: names }, "user");
      reconcileDisableModelInvocation({ configDirs: disableModelInvocationConfigDirs(ctx.p.env, ctx.p.home), choices: { [SUPERPOWERS_FORK]: names } });
    }
  }
  updateSetupState(ctx.p, (s) => ({ ...s, superpowersSkillsCarried: [...(s.superpowersSkillsCarried ?? []), ...pending] }));
}

/** A listing rt cannot read counts as registered, so a passing hiccup waits a launch rather than giving up on the swap. */
async function hasMattstackMarketplace(run: (args: string[]) => Promise<ExecResult>): Promise<boolean> {
  const res = await run(["plugin", "marketplace", "list", "--json"]);
  const listed = res.code === 0 ? parseMarketplaceList(res.stdout) : null;
  return listed === null || listed.some((m) => m.name === "mattstack");
}
