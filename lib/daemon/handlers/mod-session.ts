/**
 * session:register, session:heartbeat, session:end and session:ack: the verbs
 * a mattstack-mods link calls over rt.sock. Every verb but register answers an
 * unknown or superseded link with the `unknown-link` failure code, which is the
 * one answer the mod re-registers on.
 *
 * session:report is the link's lifecycle report (resume, compact) for the one
 * session it registered; its context is a hint, never authority.
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
import type { Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import { pushModCommand, UNKNOWN_LINK, type ModLinks } from "../../agent-integrations/claude/mod-links.ts";
import { reportClaudeDelivered } from "../../agent-integrations/claude/messaging.ts";
import { reportClaudeLinkLifecycle, type LinkContext, type LinkLifecycleDeps } from "../../agent-integrations/claude/sessions.ts";

type Verb = "session:register" | "session:heartbeat" | "session:end" | "session:ack" | "session:push" | "session:report"
  | "session:delivered";
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

const LIFECYCLE_EVENTS = ["resume", "compact"] as const;

function reportContext(v: unknown): LinkContext | string {
  if (v === null || typeof v !== "object") return "context must be an object with cwd, root and pane";
  const c = v as Record<string, unknown>;
  if (!isText(c.cwd)) return "context.cwd must be a non-empty string";
  if (!isText(c.root)) return "context.root must be a non-empty string";
  if (c.pane !== null && !optionalText(c.pane)) return "context.pane must be a non-empty string, null or absent";
  return { cwd: c.cwd, root: c.root, ...(isText(c.pane) && { pane: c.pane }) };
}

export function createModSessionHandlers(deps: {
  links: ModLinks; push?: Push; lifecycle?: LinkLifecycleDeps; delivery?: { db?: Database; now?: () => number };
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
      if (!links.has(linkId)) return unknownLink();
      links.end(linkId);
      return { ok: true, data: {} };
    },

    "session:ack": async (payload) => {
      const { linkId, id } = record(payload);
      if (!isText(linkId)) return invalid("linkId must be a non-empty string");
      if (!isText(id)) return invalid("id must be a non-empty string");
      return links.ack(linkId, id).ok ? { ok: true, data: {} } : unknownLink();
    },

    "session:report": async (payload) => {
      const { linkId, event, context } = record(payload);
      if (!isText(linkId)) return invalid("linkId must be a non-empty string");
      if (!LIFECYCLE_EVENTS.includes(event as never)) return invalid(`event must be one of ${LIFECYCLE_EVENTS.join(", ")}`);
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
