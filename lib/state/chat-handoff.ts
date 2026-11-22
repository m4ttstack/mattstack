/**
 * lib/state/chat-handoff.ts — a signed-in session that clears itself keeps
 * its chat identity: the old session begins a hand-off, the session the same
 * Claude process moves on to completes it.
 *
 * No timer ends a hand-off. Each read settles it against the Claude
 * registry: the pid died, or it moved past the one session that may
 * continue it, and the hand-off is over and the old row signs out.
 */

import { Database } from "bun:sqlite";
import { sessionForPid } from "../claude-registry.ts";
import { getStateDb } from "./db.ts";
import { bindIdentitySession } from "./identity-store.ts";
import { deleteKvValue, getKvValue, listKvValues, setKvValue, setKvValueCritical } from "./kv-blob.ts";
import { movePresenceSession, presenceForSession, signOut } from "./presence-store.ts";

const NS = "chat.handoff";

export interface Handoff {
  handle: string;
  fromSessionId: string;
  pid: number;
  nextSessionId?: string;
  startedAt: number;
  /** The old session's own sign-out already came and was held back for the hand-off. */
  oldEnded?: boolean;
}

export interface HandoffDeps { sessionForPid(pid: number): string | null; pidAlive(pid: number): boolean }

export const defaultHandoffDeps: HandoffDeps = {
  sessionForPid: (pid) => sessionForPid(pid),
  pidAlive: (pid) => {
    try { process.kill(pid, 0); } catch { return false; }
    return true;
  },
};

export type HandoffRefusal = { refused: "not-signed-in" | "already-handing-off" | "no-handoff" | "not-this-session" | "busy" };

export function handoffFromSession(sessionId: string, db: Database = getStateDb()): Handoff | null {
  return Object.values(listKvValues<Handoff>(NS, db)).find((h) => h.fromSessionId === sessionId) ?? null;
}

export function beginHandoff(
  a: { sessionId: string; pid: number; now?: number },
  db: Database = getStateDb(),
  deps: HandoffDeps = defaultHandoffDeps,
): Handoff | HandoffRefusal {
  const row = presenceForSession(a.sessionId, db);
  if (!row || row.signedOutAt !== undefined) return { refused: "not-signed-in" };
  // Complete trusts the pid to name the session's own process, so begin checks it.
  if (deps.sessionForPid(a.pid) !== a.sessionId) return { refused: "not-this-session" };
  // A record from this same session is an earlier reset that never finished; this begin replaces it.
  const existing = getKvValue<Handoff | null>(NS, row.handle, null, db);
  if (existing && existing.fromSessionId !== a.sessionId && pendingHandoffFor(row.handle, db, deps)) return { refused: "already-handing-off" };
  const handoff: Handoff = { handle: row.handle, fromSessionId: a.sessionId, pid: a.pid, startedAt: a.now ?? Date.now() };
  if (!setKvValueCritical(NS, row.handle, handoff, db)) return { refused: "busy" };
  return handoff;
}

function end(h: Handoff, db: Database): void {
  deleteKvValue(NS, h.handle, db);
  signOut(h.fromSessionId, Date.now(), db);
}

/** Ends a hand-off from this session without signing anything out; true when there was one. */
export function dropHandoffFrom(sessionId: string, db: Database = getStateDb()): boolean {
  const h = handoffFromSession(sessionId, db);
  if (!h) return false;
  deleteKvValue(NS, h.handle, db);
  return true;
}

/** Records that the old session's sign-out arrived and was held back; true when a pending hand-off from it exists. */
export function markOldSessionEnded(sessionId: string, db: Database = getStateDb()): boolean {
  const h = handoffFromSession(sessionId, db);
  if (!h) return false;
  setKvValue(NS, h.handle, { ...h, oldEnded: true }, db);
  return true;
}

export function pendingHandoffFor(handle: string, db: Database = getStateDb(), deps: HandoffDeps = defaultHandoffDeps): Handoff | null {
  const h = getKvValue<Handoff | null>(NS, handle, null, db);
  if (!h) return null;
  if (!deps.pidAlive(h.pid)) { end(h, db); return null; }
  const current = deps.sessionForPid(h.pid);
  if (current === h.fromSessionId) return h;
  if (current === null) return h;
  if (h.nextSessionId === undefined) {
    if (presenceForSession(current, db)) { end(h, db); return null; }
    const next = { ...h, nextSessionId: current };
    setKvValue(NS, handle, next, db);
    return next;
  }
  if (current !== h.nextSessionId || presenceForSession(h.nextSessionId, db)) { end(h, db); return null; }
  return h;
}

export function completeHandoff(
  a: { fromSessionId: string; sessionId: string },
  db: Database = getStateDb(),
  deps: HandoffDeps = defaultHandoffDeps,
): { handle: string } | HandoffRefusal {
  const recorded = handoffFromSession(a.fromSessionId, db);
  if (!recorded) return { refused: "no-handoff" };
  if (deps.sessionForPid(recorded.pid) !== a.sessionId) return { refused: "not-this-session" };
  const h = pendingHandoffFor(recorded.handle, db, deps);
  if (!h) return { refused: "no-handoff" };
  if (h.nextSessionId !== a.sessionId) return { refused: "not-this-session" };
  let moved = false;
  const move = db.transaction(() => {
    // A sign-in that reclaimed the row in the meantime leaves nothing to move.
    if (movePresenceSession(h.fromSessionId, a.sessionId, db) !== 1) return;
    bindIdentitySession(h.handle, a.sessionId, db);
    deleteKvValue(NS, h.handle, db);
    moved = true;
  });
  move.immediate();
  if (!moved) {
    deleteKvValue(NS, h.handle, db);
    return { refused: "no-handoff" };
  }
  return { handle: h.handle };
}

export function cancelHandoff(
  a: { fromSessionId: string },
  db: Database = getStateDb(),
  deps: HandoffDeps = defaultHandoffDeps,
): { signedOut: boolean } | HandoffRefusal {
  const h = handoffFromSession(a.fromSessionId, db);
  if (!h) return { refused: "no-handoff" };
  deleteKvValue(NS, h.handle, db);
  // An exit's sign-out and the mod's cancel race; whichever comes second signs the row out.
  if (!h.oldEnded && deps.sessionForPid(h.pid) === h.fromSessionId) return { signedOut: false };
  signOut(h.fromSessionId, Date.now(), db);
  return { signedOut: true };
}
