import { resolveTool } from "../../deps/resolve.ts";
import { claudeMessage, enablePack, parsePluginList, PACK_EXEC_TIMEOUT_MS, type ClaudeRunner } from "../pack-cache.ts";
import { activeTeamPackId } from "../steps/plugins.ts";
import { claudeConfigDirs } from "../tools-install.ts";
import type { MigrationDef } from "./index.ts";

/**
 * Members who joined before setup turned the team's pack on had it left off
 * by rt itself, and the update run reads any disabled pack as the member's
 * choice. This one pass is what tells the two apart.
 */
export const enableTeamPackMigration: MigrationDef = {
  id: "2026-10-17-enable-team-pack",
  title: "Turn on your team's plugin",
  async run(ctx) {
    const id = activeTeamPackId(ctx);
    if (!id) return { state: "skipped", detail: "This Mac has no team plugin" };
    const claude = resolveTool(ctx.p, "claude");
    if (!claude.exec) return { state: "skipped", detail: "Claude Code is not installed" };

    let turnedOn = 0;
    for (const dir of claudeConfigDirs(ctx.p, [])) {
      const env = { CLAUDE_CONFIG_DIR: dir };
      const runner: ClaudeRunner = { run: (args, timeoutMs) => ctx.p.exec([...claude.exec!, ...args], { env, timeoutMs }) };
      const listed = await runner.run(["plugin", "list", "--json"], PACK_EXEC_TIMEOUT_MS);
      const installed = listed.code === 0 ? parsePluginList(listed.stdout) : null;
      if (!installed) return { state: "failed", detail: `Claude Code's plugin list could not be read (${claudeMessage(listed, `exited ${listed.code}`)})` };
      if (installed.find((entry) => entry.id === id)?.enabled !== false) continue;
      const enabled = await enablePack(runner, id, PACK_EXEC_TIMEOUT_MS);
      if (!enabled.ok) return { state: "failed", detail: `Turning on ${id} failed: ${enabled.detail}` };
      turnedOn++;
    }
    return turnedOn > 0 ? { state: "done", detail: `Turned on ${id}` } : { state: "skipped", detail: `${id} is already on or not installed` };
  },
};
