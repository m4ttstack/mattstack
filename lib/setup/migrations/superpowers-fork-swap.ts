import { resolveTool } from "../../deps/resolve.ts";
import { isSuperseded } from "../base-plugins.ts";
import { PACK_EXEC_TIMEOUT_MS, claudeMessage, parsePluginList } from "../pack-cache.ts";
import type { ExecResult } from "../probes.ts";
import { updateSetupState, type SuperpowersDisabled } from "../state.ts";
import type { MigrationDef } from "./index.ts";
import { dedupedConfigDirs } from "./team-packs-from-git.ts";

const FORK_ID = "superpowers@mattstack";

/**
 * Once per Mac: turn off the stock superpowers copies the mattstack fork
 * replaces, at user scope in every Claude config folder, and record each one
 * so `rt uninstall` can turn it back on. A copy the member turns on again
 * later is theirs; nothing re-runs this. A folder where the fork is not on
 * yet waits (`partial` runs again next launch, after `plugins.install`), so
 * a Mac is never left with no superpowers.
 */
export const superpowersForkSwapMigration: MigrationDef = {
  id: "2026-11-18-superpowers-fork-swap",
  title: "Switch to mattstack's superpowers",
  async run(ctx) {
    const claude = resolveTool(ctx.p, "claude");
    if (!claude.exec) return { state: "skipped", detail: "Claude Code is not installed" };

    const disabled: SuperpowersDisabled[] = [];
    const failures: string[] = [];
    const waiting: string[] = [];
    for (const dir of dedupedConfigDirs(ctx)) {
      const run = (args: string[]): Promise<ExecResult> => ctx.p.exec([...claude.exec!, ...args], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
      const listed = await run(["plugin", "list", "--json"]);
      const entries = listed.code === 0 ? parsePluginList(listed.stdout) : null;
      if (entries === null) {
        failures.push(`${dir}: could not list plugins (${claudeMessage(listed, `exited ${listed.code}`)})`);
        continue;
      }
      const stock = entries.filter((e) => isSuperseded(e.id) && e.enabled && (e.scope === undefined || e.scope === "user"));
      if (stock.length === 0) continue;
      const fork = entries.find((e) => e.id === FORK_ID);
      if (!fork?.enabled) {
        waiting.push(dir);
        continue;
      }
      for (const entry of stock) {
        const off = await run(["plugin", "disable", entry.id]);
        if (off.code !== 0) {
          failures.push(`${dir}: claude plugin disable ${entry.id} (${claudeMessage(off, `exited ${off.code}`)})`);
          continue;
        }
        disabled.push({ configDir: dir, id: entry.id });
      }
    }

    if (disabled.length > 0) updateSetupState(ctx.p, (s) => ({ ...s, superpowersDisabled: [...(s.superpowersDisabled ?? []), ...disabled] }));
    if (failures.length > 0) return { state: "failed", detail: `Could not switch every Claude config folder to mattstack's superpowers: ${failures.join("; ")}` };
    if (waiting.length > 0) return { state: "partial", detail: `Waiting for mattstack's superpowers to install before turning off the stock copy in ${waiting.join(", ")}` };
    if (disabled.length === 0) return { state: "skipped", detail: "No stock superpowers was turned on" };
    return { state: "done", detail: `Turned off ${disabled.map((d) => d.id).join(", ")}; mattstack's superpowers serves the superpowers skills now` };
  },
};
