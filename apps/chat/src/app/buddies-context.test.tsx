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

test("the open room's members take the first hues, in order of sign-in", () => {
  const palette = themePalette(6);
  const ctx = looksFor(['remy', 'ghost', 'kai']);
  expect(ctx.lookOf('kai')!.hue).toEqual(palette[0]);
  expect(ctx.lookOf('remy')!.hue).toEqual(palette[1]);
  expect(ctx.lookOf('ghost')!.hue).toEqual(palette[2]);
  expect(ctx.lookOf('old-1')!.hue).toEqual(palette[3]);
});

test('with no room open, everyone goes by sign-in and the human keeps accent', () => {
  const palette = themePalette(5);
  const ctx = looksFor([]);
  expect(ctx.lookOf('old-1')!.hue).toEqual(palette[0]);
  expect(ctx.lookOf('remy')!.hue).toEqual(palette[3]);
  expect(ctx.lookOf('matt')!.hue).toBe(ACCENT_LOOK);
  expect(ctx.lookOf('stranger')).toBeUndefined();
});

test('people talking in the room come before its quiet members', () => {
  const palette = themePalette(6);
  const ctx = looksFor(['kai', 'remy', 'old-2'], ['remy', 'left-room']);
  expect(ctx.lookOf('remy')!.hue).toEqual(palette[0]);
  expect(ctx.lookOf('left-room')!.hue).toEqual(palette[1]);
  expect(ctx.lookOf('old-2')!.hue).toEqual(palette[2]);
  expect(ctx.lookOf('kai')!.hue).toEqual(palette[3]);
  expect(ctx.lookOf('old-1')!.hue).toEqual(palette[4]);
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
        room={props.room}
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

test('once a room has loaded, a newcomer never moves anyone already on screen', () => {
  const { result, update } = renderRoom({
    room: 'rt',
    roomMembers: ['kai', 'remy'],
    speakers: ['remy'],
  });
  const kai = result.current.lookOf('kai');
  const remy = result.current.lookOf('remy');
  // old-1 signed in before both, so a fresh order would put it ahead of kai.
  update({
    room: 'rt',
    roomMembers: ['old-1', 'kai', 'remy'],
    speakers: ['remy'],
  });
  expect(result.current.lookOf('kai')).toEqual(kai);
  expect(result.current.lookOf('remy')).toEqual(remy);
});

test('until the first page loads, the order is still free to settle', () => {
  const { result, update } = renderRoom({
    room: 'rt',
    roomMembers: ['kai', 'remy'],
  });
  update({ room: 'rt', roomMembers: ['kai', 'remy'], speakers: ['remy'] });
  expect(result.current.lookOf('remy')!.hue).toEqual(themePalette(6)[0]);
});

test('switching rooms hands the new room the first hues', () => {
  const { result, update } = renderRoom({
    room: 'rt',
    roomMembers: ['kai'],
    speakers: ['kai'],
  });
  update({ room: 'board', roomMembers: ['remy'], speakers: ['remy'] });
  expect(result.current.lookOf('remy')!.hue).toEqual(themePalette(6)[0]);
});
