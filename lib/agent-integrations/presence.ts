/**
 * Chat presence that follows a bound session's lifecycle, for every harness.
 *
 * Each integration reports its own lifecycle here: Claude Code through its
 * hooks (rt chat sign-out --ended, rt chat lifecycle), Codex through its app
 * server's thread events (reportSessionGone), and every harness's launches
 * and resumes through the shared launcher. Presence stays keyed by
 * the native session, so a session's identity is whatever it signed in as:
 * a resume or a compaction keeps it, and a fresh session in a reused pane
 * has none until it signs in.
 *
 * An event names the attachment generation it came from. One from an
 * attachment that has since been replaced (a resume in another pane, then the
 * old process exiting) changes nothing, so it can never sign out or move the
 * session's current attachment. Nothing here runs while
 * agent.integrations.enabled is off.
 */

import type { Database } from "bun:sqlite";
import type { NativeSessionRef, SessionBinding } from "../../packages/rt-client/src/agent-integrations.ts";
import { deleteChatSession } from "../chat-session.ts";
import type { InboxBinding } from "../claude-registry.ts";
import { getStateDb } from "../state/db.ts";
import { movePresencePane, presenceForSession, signOut, touchLastSeen, type RegistryDeps } from "../state/presence-store.ts";
import { integrationsEnabled } from "./context.ts";
import { createSessionStore, isDetachedAttachment, listBindingsByNativeValue, listEveryAttachedBinding } from "./session-store.ts";

export type PresenceEvent = "start" | "resume" | "compact" | "end";

export type PresenceDeps = {
  db?: Database;
  now?: () => number;
  enabled?: () => boolean;
  deleteSessionFile?: (sessionId: string) => void;
};

function sameSession(a: SessionBinding, b: SessionBinding): boolean {
  return a.native.harness === b.native.harness && a.native.profile === b.native.profile
    && a.native.kind === b.native.kind && a.native.value === b.native.value;
}

/**
 * - start: a session began on this attachment. Its pane is taken off any
 *   earlier session's presence, so a reused pane lends nobody's identity.
 * - resume: the same native session continues on this attachment, keeping its
 *   identity; a signed-in presence moves to the attachment's pane.
 * - compact: the same session, same attachment; only its heartbeat moves.
 * - end: the session ended on this attachment. The binding is detached, so
 *   nothing is delivered to it, and its presence is signed out.
 */
export async function applySessionPresence(binding: SessionBinding, event: PresenceEvent, deps: PresenceDeps = {}): Promise<void> {
  if (!(deps.enabled ?? integrationsEnabled)()) return;
  const db = deps.db ?? getStateDb();
  const store = createSessionStore(db);
  const current = store.get(binding.key);
  if (!current || !sameSession(current, binding) || current.attachment.generation !== binding.attachment.generation) return;
  if (isDetachedAttachment(current)) return;
  const sessionId = current.native.value;
  const now = (deps.now ?? Date.now)();
  const row = presenceForSession(sessionId, db);
  const signedIn = row !== null && row.signedOutAt === undefined;

  if (event === "end") {
    if (!store.detach(current.key, current.attachment.generation).ok) return;
    if (signedIn) signOut(sessionId, now, db);
    (deps.deleteSessionFile ?? deleteChatSession)(sessionId);
    return;
  }
  if (event !== "compact") {
    const pane = current.attachment.pane ?? null;
    if (row !== null ? row.pane !== (pane ?? undefined) : pane !== null) movePresencePane(sessionId, pane, db);
  }
  if (signedIn) touchLastSeen(sessionId, now, db);
}

/**
 * A harness's native transport reports that a bound session is gone, with no
 * process of its own to report it (a Codex thread its app server unloaded or
 * closed). The current attachment changes only when `generation`, where
 * given, is still current.
 * - unloaded: nothing runs input sent to the session, so the binding is
 *   detached and its presence reads offline; it stays signed in, so a resume
 *   that attaches it again brings it back as it was.
 * - ended: the session ended, as a SessionEnd does: detached and signed out.
 * Returns whether anything changed.
 */
export async function reportSessionGone(
  native: NativeSessionRef, event: "unloaded" | "ended", generation: number | undefined, deps: PresenceDeps = {},
): Promise<boolean> {
  if (!(deps.enabled ?? integrationsEnabled)()) return false;
  const db = deps.db ?? getStateDb();
  const store = createSessionStore(db);
  const current = store.find(native);
  if (!current || isDetachedAttachment(current)) return false;
  if (generation !== undefined && current.attachment.generation !== generation) return false;
  if (event === "ended") {
    await applySessionPresence(current, "end", deps);
    const now = store.get(current.key);
    return now !== null && isDetachedAttachment(now);
  }
  return store.detach(current.key, current.attachment.generation).ok;
}

/** Whether a harness's messaging connection is up now: an id, null while it has none, undefined when the harness has no connection to wait for. */
export type HarnessConnection = (harness: string) => string | null | undefined;

const ON_CONNECTION = new WeakSet<InboxBinding>();

/** A session whose liveness is its harness's connection, in the registry's shape; no process or socket backs it. */
function connected(): InboxBinding {
  const entry: InboxBinding = { pid: 0, socketPath: "", status: undefined };
  ON_CONNECTION.add(entry);
  return entry;
}

/**
 * Presence liveness (buddy status, reclaim and prune) for sessions outside
 * Claude Code's registry: with agent.integrations.enabled on, an attached
 * session whose harness keeps a messaging connection is alive while that
 * connection is up and the harness does not report the session itself gone
 * (`sessionLive`). A harness with no connection to read, Claude Code
 * included, keeps the registry's answer, which wins wherever it has one.
 */
export function withHarnessLiveness(
  base: RegistryDeps,
  opts: {
    db: () => Database; connection: HarnessConnection; enabled?: () => boolean;
    sessionLive?: (binding: SessionBinding) => boolean | undefined;
  },
): RegistryDeps {
  const on = opts.enabled ?? integrationsEnabled;
  const live = (b: SessionBinding) => !isDetachedAttachment(b) && typeof opts.connection(b.native.harness) === "string"
    && opts.sessionLive?.(b) !== false;
  return {
    resolve: (sessionId) => {
      const found = base.resolve(sessionId);
      if (found || !on()) return found;
      return listBindingsByNativeValue(opts.db(), sessionId).some(live) ? connected() : null;
    },
    alive: (entry) => ON_CONNECTION.has(entry) || base.alive(entry),
    resolveAll: () => {
      const all = base.resolveAll();
      if (!on()) return all;
      const merged = new Map(all);
      for (const b of listEveryAttachedBinding(opts.db())) {
        if (!merged.has(b.native.value) && live(b)) merged.set(b.native.value, connected());
      }
      return merged;
    },
  };
}
