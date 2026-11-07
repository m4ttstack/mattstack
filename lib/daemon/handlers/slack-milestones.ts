/**
 * lib/daemon/handlers/slack-milestones.ts: the daemon's real delivery for
 * milestones to a requester: a DM from rt.support when they are signed in,
 * the operator's desk when they are not.
 */

import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import { herdrRequest } from "../../herdr/client.ts";
import { getSetting } from "../../settings/resolve.ts";
import type { MilestoneDeps } from "../../slack/milestones.ts";
import { buddyStatus, dmRoomFor, isValidChatName, presenceForHandle, presenceThresholds, type RegistryDeps } from "../../state/index.ts";
import { defaultInboxDeps, postAndNotify } from "./chat.ts";

const DESK_TITLE = "Slack support";

export function realMilestoneDeps(deps: {
  db: Database;
  emitEvent: (topic: string, payload?: unknown) => unknown;
  log: Logger;
  notify: (title: string, message: string) => void;
  /** The registry probe behind online status; real by default, fakeable the way chat's is. */
  registryDeps?: RegistryDeps;
}): MilestoneDeps {
  const { db, emitEvent, log, notify, registryDeps } = deps;
  const chains = new Map<string, Promise<void>>();
  return {
    isOnline(handle) {
      const presence = presenceForHandle(handle, db);
      return presence !== null && buddyStatus(presence, Date.now(), presenceThresholds(), registryDeps) !== "offline";
    },
    async postDm(from, to, body) {
      const human = getSetting<string>("chat.humanHandle").value;
      if (!isValidChatName(human)) throw new Error(`chat.humanHandle setting is empty or invalid ("${human}")`);
      const { room } = dmRoomFor(from, to, human, db);
      postAndNotify(db, emitEvent, { room, handle: from, body, mentions: [to] }, defaultInboxDeps, herdrRequest, chains, log, 0);
    },
    async desk(body) {
      notify(DESK_TITLE, body);
    },
  };
}
