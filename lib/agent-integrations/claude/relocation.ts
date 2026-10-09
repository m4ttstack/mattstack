/**
 * Whether a session's mattstack-mods `relocation` block answers
 * EnterWorktree's relocation prompt itself, so the daemon's key-pressing
 * seams (the herd watchdog, the reconciler, the announce watcher) stand
 * down for it.
 *
 * The block answers path mode only: a name-mode EnterWorktree learns its
 * path from the create hook after the permission check, so for a window
 * after a create-hook announcement the session keeps today's seams.
 *
 * The watchdog and the reconciler read a screen whose dialog may predate
 * any answer, so they stand down only once the mod has actually asked
 * (`worktree:registered` answered for the session recently): a lost or slow
 * call leaves them pressing as before.
 */

import type { Database } from "bun:sqlite";
import type { SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { listBindingsAtPane, listBindingsByNativeValue } from "../session-store.ts";
import { installedModLinks, type ModLinks } from "./mod-links.ts";
import { modPath } from "./mod-path.ts";

/** As long as the announce watcher's own window, so a name-mode dialog stays the watcher's. */
export const CREATE_WINDOW_MS = 8_000;
/** How long a recorded `worktree:registered` answer keeps the screen-reading seams down. */
export const ANSWER_WINDOW_MS = 20_000;

export type RelocationAnswer = { path: string; at: number };

export type RelocationInSession = {
  /** A create hook announced a name-mode tree for this native session id. */
  noteCreate(sessionId: string): void;
  /** `worktree:registered` answered this native session id about `path` (canonical). */
  noteAnswer(sessionId: string, path: string): void;
  /** True when a bound session at `sessionId` or `paneRef` has the block live and no create announcement is in its window. */
  answers(target: { sessionId?: string; paneRef?: string }): boolean;
  /** `answers`, and the mod recorded a `worktree:registered` answer for that session within the answer window. */
  answered(target: { sessionId?: string; paneRef?: string }): boolean;
};

export type RelocationInSessionDeps = {
  db: () => Database;
  links?: () => ModLinks | null;
  now?: () => number;
  windowMs?: number;
  answerWindowMs?: number;
};

export function createRelocationInSession(deps: RelocationInSessionDeps): RelocationInSession {
  const links = deps.links ?? installedModLinks;
  const now = deps.now ?? Date.now;
  const windowMs = deps.windowMs ?? CREATE_WINDOW_MS;
  const answerWindowMs = deps.answerWindowMs ?? ANSWER_WINDOW_MS;
  const creates = new Map<string, number>();
  const answersBySession = new Map<string, RelocationAnswer>();

  function within<T>(map: Map<string, T>, sessionId: string, at: (v: T) => number, ms: number): boolean {
    const value = map.get(sessionId);
    if (value === undefined) return false;
    if (now() - at(value) <= ms) return true;
    map.delete(sessionId);
    return false;
  }

  function bindingsFor(target: { sessionId?: string; paneRef?: string }): SessionBinding[] {
    const db = deps.db();
    return [
      ...(target.sessionId !== undefined ? listBindingsByNativeValue(db, target.sessionId) : []),
      ...(target.paneRef !== undefined ? listBindingsAtPane(db, target.paneRef) : []),
    ];
  }

  /** The block-live bindings at the target, none when any is inside its create window. */
  function liveOutsideCreate(target: { sessionId?: string; paneRef?: string }): SessionBinding[] {
    try {
      const registry = links();
      const live = bindingsFor(target).filter((b) => modPath(b, "relocation", registry));
      return live.some((b) => within(creates, b.native.value, (at) => at, windowMs)) ? [] : live;
    } catch {
      // Unreadable bindings keep today's seams.
      return [];
    }
  }

  return {
    noteCreate(sessionId) {
      creates.set(sessionId, now());
    },
    noteAnswer(sessionId, path) {
      answersBySession.set(sessionId, { path, at: now() });
    },
    answers(target) {
      return liveOutsideCreate(target).length > 0;
    },
    answered(target) {
      return liveOutsideCreate(target).some((b) => within(answersBySession, b.native.value, (a) => a.at, answerWindowMs));
    },
  };
}
