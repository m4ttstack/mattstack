/**
 * herdr:start: lets the apps (board, gitq), which cannot import rt's lib/,
 * make sure the visible herdr server is up before launching into it.
 */
import { startHerdr, type HerdrStartResult } from "../../herdr/start.ts";
import type { CommandResult } from "./types.ts";

export function createHerdrHandlers(opts: { start?: () => Promise<HerdrStartResult> } = {}):
  { "herdr:start": (payload: unknown) => Promise<CommandResult<"herdr:start">> } {
  const start = opts.start ?? startHerdr;
  return {
    "herdr:start": async (_payload: unknown): Promise<CommandResult<"herdr:start">> => ({ ok: true, data: await start() }),
  };
}
