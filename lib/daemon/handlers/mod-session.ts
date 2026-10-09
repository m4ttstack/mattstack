/**
 * session:register, session:heartbeat, session:end and session:ack: the verbs
 * a mattstack-mods link calls over rt.sock. Every verb but register answers an
 * unknown or superseded link with the `unknown-link` failure code, which is the
 * one answer the mod re-registers on. A session:end from a link carrying the
 * presence block also ends the session's sign-in and detaches its binding.
 * rt.sock does not say who calls, so a register for a session that already
 * has a live link must name that link, or it is declined `transient`.
 *
 * session:report is the link's lifecycle report (resume, compact) for the one
 * session it registered; its context is a hint, never authority. A turn start
 * or end from the presence block sets the session's working or idle state.
 * An observation from a link that registered the observe block goes into the
 * shared observation store as the session's own reading; so does `dead` when
 * such a link ends. The end of a link carrying the policy block also marks
 * the running stage of each run the session owns abandoned.
 *
 * session:owned answers whether a block of the session's live link owns that
 * session's feature, for a CLI path that cannot read link state itself.
 *
 * session:delivered is the delivery block's report that its session handed a
 * delivery to the model. It settles only a delivery sent to the link's own
 * session at its binding's current generation.
 *
 * session:push sends a diagnostic `probe.*` command to a session's mod and
 * reports whether it was acked. Every other kind is refused: a real command
 * comes only from daemon code that has authorized its action, calling
 * pushModCommand in-process.
 */

import type { Database } from "bun:sqlite";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import { MOD_BLOCKS, type ModBlock, type Observation, type Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import { pushModCommand, UNKNOWN_LINK, type ModLinks } from "../../agent-integrations/claude/mod-links.ts";
import { reportClaudeDelivered } from "../../agent-integrations/claude/messaging.ts";
import {
  abandonClaudeLinkStages, claudeModOwns, recordClaudeModObservation, reportClaudeLinkEnded, reportClaudeLinkLifecycle, type LinkContext, type LinkLifecycleDeps,
} from "../../agent-integrations/claude/sessions.ts";
import { getStateDb } from "../../state/db.ts";

type Verb = "session:register" | "session:heartbeat" | "session:end" | "session:ack" | "session:push" | "session:report"
  | "session:delivered" | "session:owned";
type Push = (sessionId: string, kind: string, data: unknown) => Promise<Outcome<{ acked: boolean }>>;
/** CommandResult's shape, spelled here because ./types.ts reaches setup modules through the daemon's snapshot types. */
type Result<K extends Verb> =
  | { ok: true; data: Commands[K]["data"] }
  | { ok: false; error: string; failure: { code: string; message: string } };

const declined = (code: string, message: string, error = message) => ({ ok: false as const, error, failure: { code, message } });
const invalid = (message: string) => declined("invalid", message);
const unknownLink = () => declined("unknown-link", UNKNOWN_LINK, "unknown link");

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const optionalText = (v: unknown): boolean => v === undefined || isText(v);
const record = (payload: unknown): Record<string, unknown> =>
  payload !== null && typeof payload === "object" ? payload as Record<string, unknown> : {};

function registrationProblem(p: Record<string, unknown>): string | undefined {
  for (const field of ["sessionId", "cwd", "root", "claudeCode", "plugin"] as const) {
    if (!isText(p[field])) return `${field} must be a non-empty string`;
  }
  if (!optionalText(p.pane)) return "pane must be a non-empty string when present";
  if (!optionalText(p.previousSessionId)) return "previousSessionId must be a non-empty string when present";
  if (!optionalText(p.previousLinkId)) return "previousLinkId must be a non-empty string when present";
  if (!Array.isArray(p.blocks) || !p.blocks.every((b) => typeof b === "string")) return "blocks must be a list of block names";
  return undefined;
}

const END_ATTEMPTS = 3;
const END_RETRY_MS = 250;

const LIFECYCLE_EVENTS = ["resume", "compact"] as const;
const TURN_EVENTS = { "turn-start": "working", "turn-end": "idle" } as const;
const isTurnEvent = (v: unknown): v is keyof typeof TURN_EVENTS => typeof v === "string" && Object.hasOwn(TURN_EVENTS, v);

const MOD_EXECUTIONS = ["working", "idle", "blocked"] as const;
const BACKGROUNDS = ["active", "inactive", "unknown"] as const;

/** A turn's own states only: a mod never reports its session dead (session:end does) or its job done. */
function modReading(v: unknown): Pick<Observation, "execution" | "background"> | string {
  if (v === null || typeof v !== "object") return "observation must be an object with execution and background";
  const o = v as Record<string, unknown>;
  if (!MOD_EXECUTIONS.includes(o.execution as never)) return `observation.execution must be one of ${MOD_EXECUTIONS.join(", ")}`;
  if (!BACKGROUNDS.includes(o.background as never)) return `observation.background must be one of ${BACKGROUNDS.join(", ")}`;
  return { execution: o.execution as Observation["execution"], background: o.background as Observation["background"] };
}

function reportContext(v: unknown): LinkContext | string {
  if (v === null || typeof v !== "object") return "context must be an object with cwd, root and pane";
  const c = v as Record<string, unknown>;
  if (!isText(c.cwd)) return "context.cwd must be a non-empty string";
  if (!isText(c.root)) return "context.root must be a non-empty string";
  if (c.pane !== null && !optionalText(c.pane)) return "context.pane must be a non-empty string, null or absent";
  return { cwd: c.cwd, root: c.root, ...(isText(c.pane) && { pane: c.pane }) };
}

export function createModSessionHandlers(deps: {
  links: ModLinks; push?: Push; lifecycle?: LinkLifecycleDeps; delivery?: { db?: Database; now?: () => number }; endRetryMs?: number;
}): {
  [K in Verb]: (payload: unknown) => Promise<Result<K>>;
} {
  const { links } = deps;
  const push: Push = deps.push ?? ((sessionId, kind, data) => pushModCommand(sessionId, kind, data, { links }));
  return {
    "session:register": async (payload) => {
      const p = record(payload);
      const problem = registrationProblem(p);
      if (problem) return invalid(problem);
      const registered = links.register(p as Commands["session:register"]["payload"]);
      if (!registered.ok) return declined(registered.error.code, registered.error.message);
      return { ok: true, data: registered.data };
    },

    "session:heartbeat": async (payload) => {
      const { linkId } = record(payload);
      if (!isText(linkId)) return invalid("linkId must be a non-empty string");
      return links.heartbeat(linkId).ok ? { ok: true, data: {} } : unknownLink();
    },

    "session:end": async (payload) => {
      const { linkId } = record(payload);
      if (!isText(linkId)) return invalid("linkId must be a non-empty string");
      const link = links.view(linkId);
      if (!link) return unknownLink();
      links.end(linkId);
      // Before the sign-out, which detaches the binding and so moves its generation on.
      if (link.blocks.includes("observe")) {
        try {
          await recordClaudeModObservation(link, { execution: "dead", background: "unknown" }, deps.lifecycle);
        } catch (err) {
          deps.lifecycle?.log?.("the ended session's observation was not recorded", { sessionId: link.sessionId, err: String(err) });
        }
      }
      if (link.blocks.includes("policy")) {
        try {
          await abandonClaudeLinkStages(link, deps.lifecycle);
        } catch (err) {
          deps.lifecycle?.log?.("the ended session's running stages were not marked abandoned", { sessionId: link.sessionId, err: String(err) });
        }
      }
      // The mod sends session:end once and the ended link never lapses, so this is the sign-out's only chance.
      for (let attempt = 1; ; attempt++) {
        try {
          await reportClaudeLinkEnded(link, deps.lifecycle);
          return { ok: true, data: {} };
        } catch (err) {
          if (attempt >= END_ATTEMPTS) {
            const message = `the session's sign-out failed: ${err instanceof Error ? err.message : String(err)}`;
            return declined("transient", message);
          }
          await Bun.sleep(deps.endRetryMs ?? END_RETRY_MS);
        }
      }
    },

    "session:ack": async (payload) => {
      const { linkId, id } = record(payload);
      if (!isText(linkId)) return invalid("linkId must be a non-empty string");
      if (!isText(id)) return invalid("id must be a non-empty string");
      return links.ack(linkId, id).ok ? { ok: true, data: {} } : unknownLink();
    },

    "session:report": async (payload) => {
      const { linkId, event, context, observation } = record(payload);
      if (!isText(linkId)) return invalid("linkId must be a non-empty string");
      if (event === "observation") {
        const reading = modReading(observation);
        if (typeof reading === "string") return invalid(reading);
        const link = links.view(linkId);
        if (!link) return unknownLink();
        if (!link.blocks.includes("observe")) return declined("refused", "this link did not register the observe block, so rt takes no observation from it");
        return { ok: true, data: { outcome: await recordClaudeModObservation(link, reading, deps.lifecycle) } };
      }
      if (isTurnEvent(event)) {
        const counted = links.setExecution(linkId, TURN_EVENTS[event]);
        if (!counted.ok) return unknownLink();
        return { ok: true, data: { outcome: counted.data ? "applied" : "unbound" } };
      }
      if (!LIFECYCLE_EVENTS.includes(event as never)) {
        return invalid(`event must be one of ${[...LIFECYCLE_EVENTS, ...Object.keys(TURN_EVENTS), "observation"].join(", ")}`);
      }
      const where = reportContext(context);
      if (typeof where === "string") return invalid(where);
      const link = links.view(linkId);
      if (!link) return unknownLink();
      const outcome = await reportClaudeLinkLifecycle(link, event as "resume" | "compact", where, deps.lifecycle);
      return { ok: true, data: { outcome } };
    },

    "session:delivered": async (payload) => {
      const { linkId, deliveryId } = record(payload);
      if (!isText(linkId)) return invalid("linkId must be a non-empty string");
      if (!isText(deliveryId)) return invalid("deliveryId must be a non-empty string");
      const link = links.view(linkId);
      if (!link) return unknownLink();
      const settled = reportClaudeDelivered(link, deliveryId, deps.delivery);
      return settled.ok ? { ok: true, data: {} } : declined(settled.error.code, settled.error.message);
    },

    "session:owned": async (payload) => {
      const { sessionId, block } = record(payload);
      if (!isText(sessionId)) return invalid("sessionId must be a non-empty string");
      if (!MOD_BLOCKS.includes(block as ModBlock)) return invalid(`block must be one of ${MOD_BLOCKS.join(", ")}`);
      const db = deps.lifecycle?.db ?? getStateDb();
      return { ok: true, data: { owned: claudeModOwns(sessionId, block as ModBlock, db, links) } };
    },

    "session:push": async (payload) => {
      const { sessionId, kind, data } = record(payload);
      if (!isText(sessionId)) return invalid("sessionId must be a non-empty string");
      if (!isText(kind)) return invalid("kind must be a non-empty string");
      if (!kind.startsWith("probe.")) return declined("refused", `session:push sends only probe.* commands, not ${kind}`);
      const pushed = await push(sessionId, kind, data ?? null);
      return pushed.ok ? { ok: true, data: pushed.data } : declined(pushed.error.code, pushed.error.message);
    },
  };
}
