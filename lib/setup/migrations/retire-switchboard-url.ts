import { join } from "path";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, unsetSetting } from "../../settings/write.ts";
import { boardRoots, sourceBoardRoots } from "../../team/board-token.ts";
import type { Probes } from "../probes.ts";
import type { MigrationDef } from "./index.ts";

function dropUserLatch(): boolean {
  const stored = getSetting<Record<string, unknown>>("rt.integrations").value;
  if (!stored || !("switchboardUrl" in stored)) return false;
  const { switchboardUrl: _retired, ...rest } = stored;
  if (Object.keys(rest).length === 0) unsetSetting("rt.integrations", "user");
  else setSetting("rt.integrations", rest, "user");
  return true;
}

/** A config.json the board cannot parse is the board's to report; this leaves it untouched. */
function dropBoardFileUrl(p: Probes, root: string): boolean {
  const path = join(root, "config.json");
  const raw = p.readFile(path);
  if (raw === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const config = parsed as Record<string, unknown>;
  if (!("switchboard" in config)) return false;
  const block = config.switchboard;
  const kept = block !== null && typeof block === "object" && !Array.isArray(block) ? Object.fromEntries(Object.entries(block).filter(([field]) => field !== "url")) : {};
  if (Object.keys(kept).length === 0) delete config.switchboard;
  else config.switchboard = kept;
  p.writeFile(`${path}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
  p.rename(`${path}.tmp`, path);
  return true;
}

export const retireSwitchboardUrlMigration: MigrationDef = {
  id: "2026-10-02-retire-switchboard-url",
  title: "Forget the old switchboard address",
  async run(ctx) {
    const machine = unsetSetting("board.switchboardUrl", "machine");
    const user = dropUserLatch();
    const files = [...new Set(boardRoots(ctx.p, sourceBoardRoots()))].map((root) => dropBoardFileUrl(ctx.p, root));
    if (!machine && !user && !files.includes(true)) return { state: "skipped", detail: "No old switchboard address on this Mac" };
    return { state: "done", detail: "Removed the old switchboard address" };
  },
};
