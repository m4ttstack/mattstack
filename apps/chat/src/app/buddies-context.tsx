import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import type { RosterBuddy } from './roster-types';

export interface BuddyActions {
  /** Insert `@handle` into the composer (the buddy is in the open room). */
  mention: (handle: string) => void;
  /** Open the DM room with `handle` and move to it. */
  dm: (handle: string) => void;
  /** Bring the buddy's herdr pane to the front (only when it has one). */
  focusPane?: (paneId: string) => void;
}

export interface BuddiesContextValue {
  /** Keyed by identity id: two agents that share a display name are two entries. */
  byHandle: Map<string, RosterBuddy>;
  /** Ids in the open room: decides whether a card offers @mention or DM. */
  roomMembers: string[];
  now: number;
  reachable: boolean;
  actions?: BuddyActions;
  /** Display name for an id: the roster's, then the open room's members', then the id. */
  nameOf: (handle: string) => string;
}

const BuddiesContext = createContext<BuddiesContextValue | null>(null);

/** The one place presence is looked up by id, so `AgentName` can render
    anywhere an identity appears (roster, sender, chip, DM pair) with the same
    data the roster has. Outside a provider a name is just a name. */
export function BuddiesProvider({
  buddies,
  roomMembers,
  memberNames,
  now,
  reachable,
  actions,
  children,
}: Omit<BuddiesContextValue, 'byHandle' | 'nameOf'> & {
  buddies: RosterBuddy[];
  memberNames?: ReadonlyMap<string, string>;
  children: ReactNode;
}) {
  const value = useMemo<BuddiesContextValue>(() => {
    const byHandle = new Map(buddies.map(b => [b.handle, b]));
    return {
      byHandle,
      roomMembers,
      now,
      reachable,
      actions,
      nameOf: handle =>
        byHandle.get(handle)?.name ?? memberNames?.get(handle) ?? handle,
    };
  }, [buddies, roomMembers, memberNames, now, reachable, actions]);
  return (
    <BuddiesContext.Provider value={value}>{children}</BuddiesContext.Provider>
  );
}

export function useBuddies(): BuddiesContextValue | null {
  return useContext(BuddiesContext);
}
