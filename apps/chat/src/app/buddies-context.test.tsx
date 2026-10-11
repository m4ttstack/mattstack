import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import { BuddiesProvider, useBuddies } from './buddies-context';
import { ACCENT_LOOK, themePalette } from './member-looks';
import type { RosterBuddy } from './roster-types';

function row(handle: string, signedInAt: number): RosterBuddy {
  return {
    sessionId: `s-${handle}`,
    handle,
    baseHandle: handle,
    name: handle,
    signedInAt,
    lastSeenAt: signedInAt,
    status: 'offline',
    rooms: [],
  };
}

const buddies = [
  row('old-1', 1),
  row('old-2', 2),
  row('kai', 3),
  row('remy', 4),
];

function looksFor(roomMembers: string[], speakers?: string[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BuddiesProvider
      buddies={buddies}
      roomMembers={roomMembers}
      speakers={speakers}
      now={10}
      reachable
    >
      {children}
    </BuddiesProvider>
  );
  return renderHook(() => useBuddies()!, { wrapper }).result.current;
}

test('everyone goes by sign-in and the human keeps accent', () => {
  const palette = themePalette(6);
  const ctx = looksFor(['remy', 'kai']);
  expect(ctx.lookOf('old-1')!.hue).toEqual(palette[0]);
  expect(ctx.lookOf('remy')!.hue).toEqual(palette[3]);
  expect(ctx.lookOf('matt')!.hue).toBe(ACCENT_LOOK);
  expect(ctx.lookOf('stranger')).toBeUndefined();
});

test('off-roster ids in the room come after the roster', () => {
  const ctx = looksFor(['kai', 'ghost'], ['left-room']);
  const palette = themePalette(6);
  expect(ctx.lookOf('ghost')!.hue).toEqual(palette[4]);
  expect(ctx.lookOf('left-room')!.hue).toEqual(palette[5]);
});

interface RoomProps {
  room: string;
  roomMembers: string[];
  speakers?: string[];
}

function renderRoom(initial: RoomProps) {
  let props = initial;
  const { result, rerender } = renderHook(() => useBuddies()!, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <BuddiesProvider
        buddies={buddies}
        roomMembers={props.roomMembers}
        speakers={props.speakers}
        now={10}
        reachable
      >
        {children}
      </BuddiesProvider>
    ),
  });
  return {
    result,
    update: (next: RoomProps) => {
      props = next;
      rerender();
    },
  };
}

test("switching rooms never changes anyone's look", () => {
  const { result, update } = renderRoom({
    room: 'rt',
    roomMembers: ['kai'],
    speakers: ['kai'],
  });
  const before = ['kai', 'remy', 'old-1'].map(h => result.current.lookOf(h));
  update({ room: 'board', roomMembers: ['remy'], speakers: ['remy', 'new'] });
  expect(['kai', 'remy', 'old-1'].map(h => result.current.lookOf(h))).toEqual(
    before
  );
  expect(result.current.lookOf('new')).toBeDefined();
});
