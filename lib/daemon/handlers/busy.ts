/**
 * daemon:busy: whether a restart now would cut off work, so an automatic
 * update can wait for it. Not an MCP tool.
 */
import { busyReasons, type BusyProbes } from "../busy.ts";
import type { CommandResult } from "./types.ts";

export function createBusyHandlers(probes: BusyProbes): {
  "daemon:busy": () => Promise<CommandResult<"daemon:busy">>;
} {
  return {
    "daemon:busy": async () => {
      const reasons = busyReasons(probes);
      return { ok: true, data: { busy: reasons.length > 0, reasons } };
    },
  };
}
