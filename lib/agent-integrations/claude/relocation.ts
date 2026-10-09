/**
 * Whether a session's mattstack-mods `relocation` block answers
 * EnterWorktree's relocation prompt itself, so the daemon's key-pressing
 * seams (the herd watchdog, the reconciler, the announce watcher) stand
 * down for it.
 *
 * The block answers path mode only: a name-mode EnterWorktree learns its
 * path from the create hook after the permission check, so for a window
 * after a create-hook announcement the session keeps today's seams.
 */

import type { Database } from "bun:sqlite";
import type { SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { listBindingsAtPane, listBindingsByNativeValue } from "../session-store.ts";
import { installedModLinks, type ModLinks } from "./mod-links.ts";
import { modPath } from "./mod-path.ts";

/** As long as the announce watcher's own window, so a name-mode dialog stays the watcher's. */
export const CREATE_WINDOW_MS = 8_000;

export type RelocationInSession = {
  /** A create hook announced a name-mode tree for this native session id. */
  noteCreate(sessionId: string): void;
  /** True when a bound session at `sessionId` or `paneRef` has the block live and no create announcement is in its window. */
  answers(target: { sessionId?: string; paneRef?: string }): boolean;
};

export type RelocationInSessionDeps = {
  db: () => Database;
  links?: () => ModLinks | null;
  now?: () => number;
  windowMs?: number;
};

export function createRelocationInSession(deps: RelocationInSessionDeps): RelocationInSession {
  const links = deps.links ?? installedModLinks;
  const now = deps.now ?? Date.now;
  const windowMs = deps.windowMs ?? CREATE_WINDOW_MS;
  const creates = new Map<string, number>();

  function inCreateWindow(sessionId: string): boolean {
    const at = creates.get(sessionId);
    if (at === undefined) return false;
    if (now() - at <= windowMs) return true;
    creates.delete(sessionId);
    return false;
  }

  function bindingsFor(target: { sessionId?: string; paneRef?: string }): SessionBinding[] {
    const db = deps.db();
    return [
      ...(target.sessionId !== undefined ? listBindingsByNativeValue(db, target.sessionId) : []),
      ...(target.paneRef !== undefined ? listBindingsAtPane(db, target.paneRef) : []),
    ];
  }

  return {
    noteCreate(sessionId) {
      creates.set(sessionId, now());
    },
    answers(target) {
      try {
        const registry = links();
        const live = bindingsFor(target).filter((b) => modPath(b, "relocation", registry));
        return live.length > 0 && !live.some((b) => inCreateWindow(b.native.value));
      } catch {
        // Unreadable bindings keep today's seams.
        return false;
      }
    },
  };
}
