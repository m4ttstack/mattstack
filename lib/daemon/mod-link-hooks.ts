import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import type { ModLinksDeps } from "../agent-integrations/claude/mod-links.ts";
import { reportClaudeLinkLapsed } from "../agent-integrations/claude/sessions.ts";
import { continueSessionPresence } from "../agent-integrations/presence.ts";
import type { GatesStore } from "./gates-store.ts";

/**
 * The daemon's hooks on its mod-link registry. The binding has already moved
 * when `continued` and `sessionMoved` run, so a store that fails to follow it
 * is logged and never fails the register the mod is waiting on.
 */
export function modLinkHooks(deps: {
  log: Pick<Logger, "info" | "warn">;
  gates: Pick<GatesStore, "nativeQuestions">;
  db: () => Database;
}): Required<Pick<ModLinksDeps, "continued" | "sessionMoved" | "lapsed">> {
  const { log } = deps;
  return {
    continued: (sessionKey, from, to) => {
      try {
        deps.gates.nativeQuestions().carryGeneration(sessionKey, from, to);
      } catch (err) {
        log.warn({ err, sessionKey, from, to }, "mod link: the continued session's gate questions did not follow it");
      }
    },
    sessionMoved: (from, to) => {
      try {
        continueSessionPresence(from, to, { db: deps.db() });
      } catch (err) {
        log.warn({ err, from, to }, "mod link: the continued session's chat presence did not move");
      }
    },
    lapsed: (link) => {
      reportClaudeLinkLapsed(link, { db: deps.db() }).then(
        (outcome) => { if (outcome === "applied") log.info({ session: link.sessionId }, "mod link lapsed with its process gone; session signed out"); },
        (err) => log.warn({ err, session: link.sessionId }, "mod link: a lapsed link's session could not be signed out"),
      );
    },
  };
}
