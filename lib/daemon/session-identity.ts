import { sessionForPid } from "../claude-registry";
import { lazyChildLogger } from "../daemon-logger";
import { listRooms } from "../state/chat-store";
import { presenceForSession } from "../state/presence-store";

const log = lazyChildLogger("worktree-kill");

export interface SessionIdentity {
  sessionId: string;
  handle?: string;
  pane?: string;
  rooms: string[];
}

export interface IdentifyDeps {
  sessionForPid: (pid: number) => string | null;
  presenceForSession: (sessionId: string) => { handle: string; pane?: string | null } | null;
  listRooms: (handle: string) => { room: string }[];
}

const defaultDeps: IdentifyDeps = {
  sessionForPid: (pid) => sessionForPid(pid),
  presenceForSession: (sessionId) => presenceForSession(sessionId),
  listRooms: (handle) => listRooms(handle),
};

export function identifySession(pid: number, deps: IdentifyDeps = defaultDeps): SessionIdentity | null {
  let sessionId: string | null;
  try {
    sessionId = deps.sessionForPid(pid);
  } catch (err) {
    log.warn({ err, pid }, "session lookup failed");
    return null;
  }
  if (!sessionId) return null;

  const identity: SessionIdentity = { sessionId, rooms: [] };
  try {
    const presence = deps.presenceForSession(sessionId);
    if (!presence) return identity;
    identity.handle = presence.handle;
    if (presence.pane) identity.pane = presence.pane;
    identity.rooms = deps.listRooms(presence.handle).map((r) => r.room);
  } catch (err) {
    log.warn({ err, pid }, "session identity lookup failed");
  }
  return identity;
}

export function sessionDisplayName(pid: number, label: string, identity: SessionIdentity | null): string {
  return identity?.handle ?? `pid ${pid} (${label})`;
}
