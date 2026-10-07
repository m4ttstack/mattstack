import { createContext, useContext, useMemo, useRef } from 'react';
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
  room,
  speakers,
  children,
}: Omit<BuddiesContextValue, 'byHandle' | 'nameOf' | 'lookOf'> & {
  buddies: RosterBuddy[];
  memberNames?: ReadonlyMap<string, string>;
  humanHandle?: string;
  /** The open room; looks settle per room. */
  room?: string;
  /** Who posted in the open room's first page of messages, first in line for
      a distinct look even after leaving the room. Unset until that page has
      loaded. */
  speakers?: readonly string[];
  children: ReactNode;
}) {
  // Looks follow what is on screen, so the people talking in the open room
  // get the most distinct hues first, then its quiet members, then everyone
  // else: the human, then each tier's roster entries in order of sign-in and
  // its off-roster ids alphabetically. Once the room's members and first page
  // have both loaded the order settles: anyone new is appended, so nobody's
  // look changes on screen while the room stays open. Joined to a string so a
  // poll with the same people keeps the memo.
  const order = useRef<{ room?: string; ids: string[]; settled: boolean }>({
    ids: [],
    settled: false,
  });
  const lookIds = useMemo(() => {
    const bySignIn = [...buddies]
      .sort((a, b) => a.signedInAt - b.signedInAt)
      .map(b => b.handle);
    const known = new Set(bySignIn);
    const tier = (ids: Iterable<string>) => {
      const set = new Set(ids);
      return [
        ...bySignIn.filter(h => set.has(h)),
        ...[...set].filter(h => !known.has(h)).sort(),
      ];
    };
    const fresh = [
      ...new Set([
        humanHandle,
        ...tier(speakers ?? []),
        ...tier(roomMembers),
        ...bySignIn,
      ]),
    ];
    const held = order.current;
    if (held.room !== room || !held.settled) {
      order.current = {
        room,
        ids: fresh,
        settled:
          room === undefined ||
          (speakers !== undefined && roomMembers.length > 0),
      };
    } else {
      const have = new Set(held.ids);
      held.ids = [...held.ids, ...fresh.filter(h => !have.has(h))];
    }
    return order.current.ids.join('\n');
  }, [buddies, roomMembers, speakers, humanHandle, room]);
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
