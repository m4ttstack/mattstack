import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import { BuddiesProvider, useBuddies } from './buddies-context';
import type { Me } from './human';
import type { RosterBuddy } from './roster-types';

function row(handle: string, name: string): RosterBuddy {
  return {
    sessionId: `s-${handle}`,
    handle,
    baseHandle: handle,
    name,
    signedInAt: 1,
    lastSeenAt: 1,
    status: 'offline',
    rooms: [],
  };
}

function context({
  buddies = [],
  memberNames,
  me,
}: {
  buddies?: RosterBuddy[];
  memberNames?: ReadonlyMap<string, string>;
  me?: Me;
}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BuddiesProvider
      buddies={buddies}
      roomMembers={[]}
      memberNames={memberNames}
      me={me}
      now={10}
      reachable
    >
      {children}
    </BuddiesProvider>
  );
  return renderHook(() => useBuddies()!, { wrapper }).result.current;
}

test('outside a provider there is no context', () => {
  expect(renderHook(() => useBuddies()).result.current).toBeNull();
});

test('byHandle keys on the id, so a shared name stays two entries', () => {
  const ctx = context({
    buddies: [row('remy', 'remy'), row('remy.x', 'remy')],
  });
  expect([...ctx.byHandle.keys()]).toEqual(['remy', 'remy.x']);
});

test('nameOf reads the viewer, then the roster, then the room, then the id', () => {
  const ctx = context({
    buddies: [row('kai.1', 'kai'), row('alex', 'on the roster')],
    memberNames: new Map([
      ['kai.1', 'room kai'],
      ['ghost.2', 'ghost'],
    ]),
    me: { handle: 'alex', name: 'Alex' },
  });
  expect(ctx.nameOf('alex')).toBe('Alex');
  expect(ctx.nameOf('kai.1')).toBe('kai');
  expect(ctx.nameOf('ghost.2')).toBe('ghost');
  expect(ctx.nameOf('stranger')).toBe('stranger');
});

test('selfName answers only for the viewer', () => {
  const ctx = context({ me: { handle: 'alex', name: 'Alex' } });
  expect(ctx.selfName('alex')).toBe('Alex');
  expect(ctx.selfName('kai')).toBeUndefined();
  expect(context({}).selfName('alex')).toBeUndefined();
});
