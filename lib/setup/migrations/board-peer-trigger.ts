import { resolveTool } from "../../deps/resolve.ts";
import { getSetting } from "../../settings/resolve.ts";
import { installCronTrigger, peerTrigger } from "../cron-install.ts";
import type { MigrationDef } from "./index.ts";

export const boardPeerTriggerMigration: MigrationDef = {
  id: "2026-10-01-board-peer-trigger",
  title: "Start peer asks as soon as they arrive",
  async run(ctx) {
    if (getSetting<{ enabled?: boolean }>("board.peerAsks").value?.enabled !== true) {
      return { state: "skipped", detail: "Automatic peer asks are off" };
    }
    if (resolveTool(ctx.p, "board").exec === null) return { state: "skipped", detail: "Board isn't installed on this Mac" };
    installCronTrigger(peerTrigger());
    return { state: "done", detail: "Peer asks now start as soon as they arrive" };
  },
};
