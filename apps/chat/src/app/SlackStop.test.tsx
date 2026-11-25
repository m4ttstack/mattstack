import { notifications } from '@mattstack/app-kit/notifications';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import './icons';

import { SlackChatsProvider, type SlackChat } from './slack-chats-context';
import { SlackStop } from './SlackStop';

const CHAT: SlackChat = {
  id: 7,
  room: 'dm-slack',
  name: 'alex',
  displayName: 'Alex Moreau',
};
const refresh = vi.fn();
const fetched = vi.fn();

beforeEach(() => {
  refresh.mockClear();
  fetched.mockReset();
  vi.stubGlobal('fetch', fetched);
});
afterEach(() => vi.unstubAllGlobals());

const bar = (live: boolean, chat = CHAT) => (
  <SlackChatsProvider chats={[chat]} refresh={refresh}>
    <SlackStop chat={chat} live={live} />
  </SlackChatsProvider>
);
const answer = (body: unknown, status = 200) =>
  fetched.mockResolvedValueOnce(Response.json(body, { status }));
const click = (name: string) =>
  userEvent.click(screen.getByRole('button', { name }));

test('Stop asks once in place, and Cancel puts it back', async () => {
  renderWithProviders(bar(true));
  await click('Stop');
  expect(
    screen.getByText("Ends it now. Alex's next request waits for you")
  ).toBeInTheDocument();
  await click('Cancel');
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  expect(fetched).not.toHaveBeenCalled();
});

test.each([
  [true, 'Stopped. Alex was told'],
  [false, 'Stopped. Alex was not told, check the DM'],
])(
  'told %s is said, and still is once the chat is closed',
  async (told, words) => {
    answer({ told });
    const { rerender } = renderWithProviders(bar(true));
    await click('Stop');
    await click('Stop chat');
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(JSON.parse(fetched.mock.calls[0]![1].body)).toEqual({
      conversation: 7,
    });
    expect(refresh).toHaveBeenCalled();
    rerender(bar(false));
    expect(screen.getByRole('status')).toHaveTextContent(words);
  }
);

test('a refusal shows its words and leaves Stop in place', async () => {
  const error = vi.spyOn(notifications, 'error').mockReturnValue('' as never);
  answer({ error: 'that chat is already closed' }, 409);
  renderWithProviders(bar(true));
  await click('Stop');
  await click('Stop chat');
  expect(
    await screen.findByRole('button', { name: 'Stop' })
  ).toBeInTheDocument();
  expect(error).toHaveBeenCalledWith(
    "Couldn't stop the chat: that chat is already closed"
  );
  expect(refresh).toHaveBeenCalled();
  error.mockRestore();
});

test('a chat that is over, or that rt gave no number, offers no Stop', () => {
  const { rerender } = renderWithProviders(bar(false));
  expect(screen.queryByRole('button')).toBeNull();
  rerender(bar(true, { ...CHAT, id: undefined }));
  expect(screen.queryByRole('button')).toBeNull();
});
