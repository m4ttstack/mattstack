/**
 * session:register, session:heartbeat, session:end and session:ack: the verbs
 * a mattstack-mods link calls over rt.sock. Every verb but register answers an
 * unknown or superseded link with the `unknown-link` failure code, which is the
 * one answer the mod re-registers on.
 *
 * session:push sends a diagnostic `probe.*` command to a session's mod and
 * reports whether it was acked. Every other kind is refused: a real command
 * comes only from daemon code that has authorized its action, calling
 * pushModCommand in-process.
 */

import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import type { Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import { pushModCommand, UNKNOWN_LINK, type ModLinks } from "../../agent-integrations/claude/mod-links.ts";

type Verb = "session:register" | "session:heartbeat" | "session:end" | "session:ack" | "session:push";
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

export function createModSessionHandlers(deps: { links: ModLinks; push?: Push }): {
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
