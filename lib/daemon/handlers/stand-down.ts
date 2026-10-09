/**
 * board:stand-down, board:stand-down-state and session:stood-down: the
 * board's stand-down of a Claude pane through that session's mattstack-mods
 * `board` block.
 *
 * board:stand-down pushes `stand-down` only to the session whose live link
 * names the pane and carries the `board` block, which the mod starts only in
 * a pane the board launched. Any other answer is `acked: false`, and the
 * board then takes its own path once. rt.sock does not say who calls, so
 * this verb can end a board pane's turn for any local caller. It carries no
 * text of the caller's: the block only ends the turn and submits its own
 * fixed notice, and it reaches no other session.
 *
 * session:stood-down is the block's report of where the stand-down left its
 * session, accepted only from a live link carrying the block.
 */

import type { StandDownState, Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import { pushModCommand, UNKNOWN_LINK, type ModLinks } from "../../agent-integrations/claude/mod-links.ts";

type Verb = "board:stand-down" | "board:stand-down-state" | "session:stood-down";
/** CommandResult's shape, spelled here because ./types.ts reaches setup modules through the daemon's snapshot types. */
type Result<K extends Verb> =
  | { ok: true; data: Commands[K]["data"] }
  | { ok: false; error: string; failure: { code: string; message: string } };

/** Sends `kind` to the session under the command id `id`, so the block's report can be matched to it. */
export type StandDownPush = (sessionId: string, kind: string, data: unknown, id: string) => Promise<Outcome<{ acked: boolean }>>;

/** How long board:stand-down waits after the ack for the block to say whether background work is finishing. */
export const STAND_DOWN_REPORT_MS = 2_000;
const REPORT_POLL_MS = 50;
const KEPT = 500;
const STATES: readonly StandDownState[] = ["stood-down", "stood-down-background", "background-finished"];

const declined = (code: string, message: string, error = message) => ({ ok: false as const, error, failure: { code, message } });
const invalid = (message: string) => declined("invalid", message);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const record = (payload: unknown): Record<string, unknown> =>
  payload !== null && typeof payload === "object" ? payload as Record<string, unknown> : {};

export function createStandDownHandlers(deps: {
  links: ModLinks; push?: StandDownPush; now?: () => number; sleep?: (ms: number) => Promise<void>;
}): { [K in Verb]: (payload: unknown) => Promise<Result<K>> } {
  const { links } = deps;
  const push: StandDownPush = deps.push
    ?? ((sessionId, kind, data, id) => pushModCommand(sessionId, kind, data, { links, newId: () => id }));
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
  // Insertion order is age: the oldest entries go first once either map is full.
  const byCommand = new Map<string, StandDownState>();
  const bySession = new Map<string, StandDownState>();
  const keep = <V>(map: Map<string, V>, key: string, value: V) => {
    map.delete(key);
    map.set(key, value);
    while (map.size > KEPT) map.delete(map.keys().next().value!);
  };

  return {
    "board:stand-down": async (payload) => {
      const { pane } = record(payload);
      if (!isText(pane)) return invalid("pane must be a non-empty string");
      const link = links.list().filter((l) => l.pane === pane && l.blocks.includes("board")).at(-1);
      if (!link) return { ok: true, data: { acked: false } };
      const id = crypto.randomUUID();
      const pushed = await push(link.sessionId, "stand-down", {}, id);
      if (!pushed.ok || !pushed.data.acked) return { ok: true, data: { acked: false } };
      const deadline = now() + STAND_DOWN_REPORT_MS;
      for (;;) {
        const state = byCommand.get(id);
        if (state !== undefined) return { ok: true, data: { acked: true, sessionId: link.sessionId, state } };
        if (now() >= deadline) return { ok: true, data: { acked: true, sessionId: link.sessionId } };
        await sleep(REPORT_POLL_MS);
      }
    },

    "board:stand-down-state": async (payload) => {
      const { sessionId } = record(payload);
      if (!isText(sessionId)) return invalid("sessionId must be a non-empty string");
      if (!links.linkOf(sessionId)) return { ok: true, data: { state: "ended" } };
      return { ok: true, data: { state: bySession.get(sessionId) ?? null } };
    },

    "session:stood-down": async (payload) => {
      const { linkId, commandId, state } = record(payload);
      if (!isText(linkId)) return invalid("linkId must be a non-empty string");
      if (!isText(commandId)) return invalid("commandId must be a non-empty string");
      if (!STATES.includes(state as StandDownState)) return invalid(`state must be one of ${STATES.join(", ")}`);
      const link = links.view(linkId);
      if (!link) return declined("unknown-link", UNKNOWN_LINK, "unknown link");
      if (!link.blocks.includes("board")) return declined("refused", "this link did not register the board block, so rt takes no stand-down report from it");
      keep(byCommand, commandId, state as StandDownState);
      keep(bySession, link.sessionId, state as StandDownState);
      return { ok: true, data: {} };
    },
  };
}
