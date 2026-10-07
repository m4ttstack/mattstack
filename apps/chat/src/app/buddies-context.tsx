import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { HUMAN_HANDLE } from './human';
import { assignMemberLooks, type MemberLook } from './member-looks';
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
  /** The avatar creature and hue assigned to an id; unset for an id the
      roster and the open room never listed, which keeps its hashed look. */
  lookOf: (handle: string) => MemberLook | undefined;
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
  humanHandle = HUMAN_HANDLE,
  children,
}: Omit<BuddiesContextValue, 'byHandle' | 'nameOf' | 'lookOf'> & {
  buddies: RosterBuddy[];
  memberNames?: ReadonlyMap<string, string>;
  humanHandle?: string;
  children: ReactNode;
}) {
  // Looks go out to the human, then everyone in order of sign-in, oldest
  // first, so a newcomer never takes a look from someone already here; the
  // open room's members off the roster follow alphabetically. Joined to a
  // string so a poll with the same people keeps the memo.
  const lookIds = useMemo(() => {
    const listed = [...buddies]
      .sort((a, b) => a.signedInAt - b.signedInAt)
      .map(b => b.handle);
    const seen = new Set(listed);
    const others = roomMembers.filter(h => !seen.has(h)).sort();
    return [humanHandle, ...listed, ...others].join('\n');
  }, [buddies, roomMembers, humanHandle]);
  const looks = useMemo(
    () => assignMemberLooks(lookIds.split('\n'), humanHandle),
    [lookIds, humanHandle]
  );
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
      lookOf: handle => looks.get(handle),
    };
  }, [buddies, roomMembers, memberNames, now, reachable, actions, looks]);
  return (
    <BuddiesContext.Provider value={value}>{children}</BuddiesContext.Provider>
  );
}

export function useBuddies(): BuddiesContextValue | null {
  return useContext(BuddiesContext);
}
