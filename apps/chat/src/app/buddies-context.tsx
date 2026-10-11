import { createContext, useContext, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

import { HUMAN_HANDLE } from './human';
import {
  assignMemberLooks,
  settleRoomLooks,
  type MemberLook,
} from './member-looks';
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
  speakers,
  children,
}: Omit<BuddiesContextValue, 'byHandle' | 'nameOf' | 'lookOf'> & {
  buddies: RosterBuddy[];
  memberNames?: ReadonlyMap<string, string>;
  humanHandle?: string;
  /** Who posted in the open room's first page of messages, so an
      off-roster poster still gets a look. */
  speakers?: readonly string[];
  children: ReactNode;
}) {
  // One look per person for the whole session, whatever room is open: the
  // human, then the roster by sign-in, then off-roster ids alphabetically.
  // The order only ever grows, so nobody's look changes once it is shown.
  // Joined to a string so a poll with the same people keeps the memo.
  const order = useRef<string[]>([]);
  const lookIds = useMemo(() => {
    const bySignIn = [...buddies]
      .sort((a, b) => a.signedInAt - b.signedInAt)
      .map(b => b.handle);
    const known = new Set(bySignIn);
    const extras = [...new Set([...(speakers ?? []), ...roomMembers])]
      .filter(h => !known.has(h))
      .sort();
    const have = new Set(order.current);
    for (const h of [humanHandle, ...bySignIn, ...extras])
      if (!have.has(h)) {
        have.add(h);
        order.current.push(h);
      }
    return order.current.join('\n');
  }, [buddies, roomMembers, speakers, humanHandle]);
  const looks = useMemo(
    () =>
      settleRoomLooks(assignMemberLooks(lookIds.split('\n'), humanHandle), [
        humanHandle,
        ...(speakers ?? []),
        ...roomMembers,
      ]),
    [lookIds, humanHandle, speakers, roomMembers]
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
