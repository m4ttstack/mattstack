import type { Probes } from "../setup/probes.ts";
import { canonicalHandle } from "./board-peers.ts";
import { openReply } from "./invite-crypto.ts";
import { readInviteRecords } from "./invite-records.ts";
import { base64ToKey, isValidAgePublicKey } from "./members.ts";
import type { RelayClient } from "./relay-client.ts";

export type InviteState = "invited" | "replied" | "expired";

export interface InviteStatus {
  handle: string;
  teams: string[];
  expiresAt: string;
  state: InviteState;
}

export interface InviteStatusResult {
  invites: InviteStatus[];
  relayFailed: boolean;
}

/**
 * Reads every outstanding invite's state from the relay without writing kv
 * or warning. A reply counts only when it opens to a well-formed age key, the
 * same test `membersSync` applies, and it wins over expiry because sync adds it.
 */
export async function readInviteStatuses(
  p: Pick<Probes, "readFile" | "home">,
  slug: string,
  deps: {
    relay: Pick<RelayClient, "readReply">;
    roster: { username: string; teams?: string[] }[];
    now: number;
    open?: typeof openReply;
  },
): Promise<InviteStatusResult> {
  const open = deps.open ?? openReply;
  const records = readInviteRecords(p, slug);
  let relayFailed = false;

  const invites = await Promise.all(
    Object.entries(records).map(async ([handle, rec]): Promise<InviteStatus> => {
      const teams = deps.roster.find((r) => canonicalHandle(r.username) === canonicalHandle(handle))?.teams ?? [];
      const base = { handle, teams, expiresAt: rec.expiresAt };

      let replied = false;
      try {
        const reply = await deps.relay.readReply(rec.id, rec.creatorSecret);
        if (reply !== "none") {
          try {
            const opened = await open(reply.blob, base64ToKey(rec.keyB64), rec.id);
            replied = isValidAgePublicKey(opened.agePublicKey);
          } catch {
            replied = false;
          }
        }
      } catch {
        relayFailed = true;
      }

      if (replied) return { ...base, state: "replied" };
      return { ...base, state: Date.parse(rec.expiresAt) >= deps.now ? "invited" : "expired" };
    }),
  );

  invites.sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
  return { invites, relayFailed };
}
