import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { ChatMessage, RoomSummary } from '@mattstack/rt-client';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import './icons';

import { DirectView } from './DirectView';
import { fetchMock, installFetchMock } from './test-utils';

const message = (id: number, room: string, handle: string): ChatMessage => ({
  id,
  room,
  handle,
  name: handle,
  body: `m${id}`,
  mentions: [],
  mentionNames: [],
  postedAt: id * 1000,
});

const room = (name: string, other: string): RoomSummary => ({
  room: name,
  memberCount: 2,
  unread: 0,
  mentions: 0,
  kind: 'dm',
  participants: { a: other, b: 'matt', aName: other, bName: 'matt' },
});

let draftChange: (hasDraft: boolean) => void;

async function renderView(onPick: (room: string | undefined) => void) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      messages: [message(1, 'dm-a', 'kai'), message(2, 'dm-b', 'remy')],
    }),
  });
  renderWithProviders(
    <DirectView
      rooms={[room('dm-a', 'kai'), room('dm-b', 'remy')]}
      me="matt"
      picked={undefined}
      onPick={onPick}
      composer={(target, _to, onDraftChange) => {
        draftChange = onDraftChange;
        return <div data-testid="target">{target}</div>;
      }}
    />
  );
  await screen.findByTestId('target');
}

beforeEach(() => installFetchMock());
afterEach(() => vi.restoreAllMocks());

test('starting a draft holds the reply on its conversation, and clearing it lets go', async () => {
  const onPick = vi.fn();
  await renderView(onPick);
  act(() => draftChange(true));
  expect(onPick).toHaveBeenLastCalledWith('dm-b');
  act(() => draftChange(false));
  expect(onPick).toHaveBeenLastCalledWith(undefined);
});

test('a click beside the cards leaves a draft where it is', async () => {
  const onPick = vi.fn();
  await renderView(onPick);
  act(() => draftChange(true));
  onPick.mockClear();
  fireEvent.click(screen.getByTestId('transcript-column'));
  expect(onPick).not.toHaveBeenCalled();
});
