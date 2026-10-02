import { getSetting } from "../../settings/resolve.ts";
import { findCronTrigger, installCronTrigger, peerTrigger } from "../cron-install.ts";
import type { MigrationDef } from "./index.ts";

export const boardPeerTriggerMigration: MigrationDef = {
  id: "2026-10-01-board-peer-trigger",
  title: "Start peer asks as soon as they arrive",
  async run() {
    if (getSetting<{ enabled?: boolean }>("board.peerAsks").value?.enabled !== true) {
      return { state: "skipped", detail: "Automatic peer asks are off" };
    }
    const triage = findCronTrigger("board-triage");
    if (!triage) return { state: "skipped", detail: "Board triage isn't installed on this Mac" };
    installCronTrigger(peerTrigger(triage.run));
    return { state: "done", detail: "Peer asks now start as soon as they arrive" };
  },
};
