import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import './icons';

import { BuddiesProvider } from './buddies-context';
import { NewSlackChatDialog } from './NewSlackChatDialog';
import type { RosterBuddy } from './roster-types';
import { fetchMock, installFetchMock } from './test-utils';

const PEOPLE = [
  {
    name: 'Tucker Hale',
    person: 'U0TUCKER',
    title: 'Support lead',
    avatarId: 'U0TUCKER',
    avatarVersion: 'v1',
  },
  { name: 'Lucia Tucci', person: 'U0LUCIA' },
  { name: 'Sam Example', person: 'U0SAM' },
];

function answer(url: string, body: unknown, status = 200) {
  fetchMock.mockImplementation(async (u: string) =>
    String(u) === url
      ? new Response(JSON.stringify(body), { status })
      : new Response(JSON.stringify({}))
  );
}

beforeEach(() => {
  installFetchMock();
  answer('/api/chat/slack-people', { people: PEOPLE });
});

function agent(handle: string, over: Partial<RosterBuddy> = {}): RosterBuddy {
  return {
    sessionId: `s-${handle}`,
    handle,
    baseHandle: handle,
    name: handle,
    signedInAt: 1,
    lastSeenAt: 1,
    status: 'live',
    rooms: [],
    ...over,
  };
}

function open(
  onStarted = vi.fn(),
  onClose = vi.fn(),
  agents: RosterBuddy[] = []
) {
  renderWithProviders(
    <BuddiesProvider buddies={agents} roomMembers={[]} now={10} reachable>
      <NewSlackChatDialog opened onClose={onClose} onStarted={onStarted} />
    </BuddiesProvider>
  );
  return { onStarted, onClose };
}

const startButton = () => screen.getByRole('button', { name: 'Start' });

test('Start stays disabled until a recipient and a brief are set, with no hint copy', async () => {
  open();
  expect(startButton()).toBeDisabled();
  expect(screen.queryByText('Pick a person to start')).toBeNull();

  await userEvent.type(screen.getByLabelText('Recipient'), 'tuc');
  await userEvent.click(
    await screen.findByRole('option', { name: /Tucker Hale/ })
  );
  expect(startButton()).toBeDisabled();
  expect(screen.queryByText('Add a brief to start')).toBeNull();

  await userEvent.type(screen.getByLabelText('Brief'), 'Help with the deck');
  expect(startButton()).toBeEnabled();
});

test('the title and lede are named after the support persona', async () => {
  answer('/api/chat/slack-people', { people: PEOPLE, persona: 'Mabel' });
  open();
  expect(await screen.findByText('Mabel Support Chat')).toBeInTheDocument();
  expect(
    screen.getByText(/Let Mabel chat with a teammate/)
  ).toBeInTheDocument();
});

test('with no persona the title is plain Support Chat', async () => {
  open();
  expect(await screen.findByText('Support Chat')).toBeInTheDocument();
});

test('a picked recipient becomes a chip, and its remove button brings the search back', async () => {
  open();
  await userEvent.type(screen.getByLabelText('Recipient'), 'tuc');
  await userEvent.click(
    await screen.findByRole('option', { name: /Tucker Hale/ })
  );
  expect(screen.getByText('Tucker Hale')).toBeInTheDocument();
  expect(screen.queryByPlaceholderText('Search teammates')).toBeNull();

  const dialog = screen.getByRole('dialog');
  const remove = dialog.querySelector('.mantine-Pill-remove') as HTMLElement;
  await userEvent.click(remove);
  const search = await screen.findByPlaceholderText('Search teammates');
  expect(search).toHaveValue('');
  expect(startButton()).toBeDisabled();
});

test('a person with a Slack picture shows it, and one without shows the app face', async () => {
  open();
  await userEvent.type(screen.getByLabelText('Recipient'), 'tuc');
  const options = await screen.findAllByRole('option');
  const [tucker, lucia] = options as [HTMLElement, HTMLElement];

  const photo = within(tucker).getByTestId('person-photo');
  expect(photo).toHaveAttribute('src', '/api/chat/slack-avatar/U0TUCKER?v=v1');

  expect(within(lucia).queryByTestId('person-photo')).toBeNull();
  const face = within(lucia).getByRole('presentation');
  expect(face.tagName).toBe('IMG');
  expect(face.getAttribute('src')).toMatch(/^data:/);
});

test('a picture that will not load gives way to the app face', async () => {
  open();
  await userEvent.type(screen.getByLabelText('Recipient'), 'hale');
  const option = await screen.findByRole('option', { name: /Tucker\s*Hale/ });
  const photo = within(option).getByTestId('person-photo');
  photo.dispatchEvent(new Event('error'));
  await waitFor(() =>
    expect(within(option).queryByTestId('person-photo')).toBeNull()
  );
});

test('the search reads names only, so a title matches no one', async () => {
  open();
  await userEvent.type(screen.getByLabelText('Recipient'), 'support');
  expect(await screen.findByText('No one matches')).toBeInTheDocument();
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  await userEvent.clear(screen.getByLabelText('Recipient'));
  await userEvent.type(screen.getByLabelText('Recipient'), 'tucker');
  const [only] = await screen.findAllByRole('option');
  expect(only).toHaveTextContent('Tucker Hale');
  expect(only!.querySelector('mark')).toHaveTextContent('Tucker');
});

test('typing never asks the server again: the list is read once on open', async () => {
  open();
  await userEvent.type(screen.getByLabelText('Recipient'), 'tucker');
  await screen.findAllByRole('option');
  const peopleCalls = fetchMock.mock.calls.filter(
    ([u]) => u === '/api/chat/slack-people'
  );
  expect(peopleCalls).toHaveLength(1);
});

test('Start sends the person id and the brief, then hands over the new room', async () => {
  const { onStarted, onClose } = open();
  answer('/api/chat/slack-start', { conversation: 3, room: 'dm-new' });
  await userEvent.type(screen.getByLabelText('Recipient'), 'tuc');
  await userEvent.click(
    await screen.findByRole('option', { name: /Tucker Hale/ })
  );
  await userEvent.type(screen.getByLabelText('Brief'), 'Help with the deck');
  await userEvent.click(startButton());

  await waitFor(() => expect(onStarted).toHaveBeenCalledWith('dm-new'));
  expect(onClose).toHaveBeenCalled();
  const [, init] = fetchMock.mock.calls.find(
    ([u]) => u === '/api/chat/slack-start'
  )!;
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({
    person: 'U0TUCKER',
    brief: 'Help with the deck',
  });
});

test('Keep an agent posted becomes a removable chip, and Start sends notify', async () => {
  const { onStarted } = open(vi.fn(), vi.fn(), [agent('alexa'), agent('bo')]);
  answer('/api/chat/slack-start', { conversation: 3, room: 'dm-new' });
  await userEvent.type(screen.getByLabelText('Recipient'), 'tuc');
  await userEvent.click(
    await screen.findByRole('option', { name: /Tucker Hale/ })
  );
  await userEvent.type(screen.getByLabelText('Brief'), 'Help');

  await userEvent.click(screen.getByPlaceholderText('Updates go to your desk'));
  await userEvent.click(await screen.findByRole('option', { name: /alexa/ }));
  const dialog = screen.getByRole('dialog');
  expect(dialog.querySelectorAll('.mantine-Pill-remove')).toHaveLength(2);

  await userEvent.click(startButton());
  await waitFor(() => expect(onStarted).toHaveBeenCalledWith('dm-new'));
  const [, init] = fetchMock.mock.calls.find(
    ([u]) => u === '/api/chat/slack-start'
  )!;
  expect(JSON.parse(init.body)).toEqual({
    person: 'U0TUCKER',
    brief: 'Help',
    notify: 'alexa',
  });
});

test('removing the agent chip returns the picker and drops notify', async () => {
  open(vi.fn(), vi.fn(), [agent('alexa')]);
  answer('/api/chat/slack-start', { conversation: 3, room: 'dm-new' });
  await userEvent.click(screen.getByPlaceholderText('Updates go to your desk'));
  await userEvent.click(await screen.findByRole('option', { name: /alexa/ }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(
    dialog.querySelector('.mantine-Pill-remove') as HTMLElement
  );
  expect(
    await screen.findByPlaceholderText('Updates go to your desk')
  ).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Recipient'), 'tuc');
  await userEvent.click(
    await screen.findByRole('option', { name: /Tucker Hale/ })
  );
  await userEvent.type(screen.getByLabelText('Brief'), 'Help');
  await userEvent.click(startButton());
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.find(([u]) => u === '/api/chat/slack-start')
    ).toBeDefined()
  );
  const [, init] = fetchMock.mock.calls.find(
    ([u]) => u === '/api/chat/slack-start'
  )!;
  expect(JSON.parse(init.body)).not.toHaveProperty('notify');
});

test('a refused start keeps the form open and says why', async () => {
  const { onStarted, onClose } = open();
  answer(
    '/api/chat/slack-start',
    { error: 'No repo is set for Slack chats' },
    409
  );
  await userEvent.type(screen.getByLabelText('Recipient'), 'tuc');
  await userEvent.click(
    await screen.findByRole('option', { name: /Tucker Hale/ })
  );
  await userEvent.type(screen.getByLabelText('Brief'), 'Help');
  await userEvent.click(startButton());

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No repo is set for Slack chats'
  );
  expect(onStarted).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test('a failed people read is shown in the picker', async () => {
  answer(
    '/api/chat/slack-people',
    { error: "Slack isn't connected on this machine" },
    502
  );
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Slack isn't connected on this machine"
  );
});

test('the brief asks what the support agent should help with, by its configured name', async () => {
  answer('/api/chat/slack-people', { people: PEOPLE, persona: 'Mabel' });
  open();
  expect(
    await screen.findByPlaceholderText('What should Mabel help with?')
  ).toBeInTheDocument();
});

test('with no name from the server the brief stays neutral', async () => {
  open();
  expect(
    await screen.findByPlaceholderText('What should the agent help with?')
  ).toBeInTheDocument();
});

test('Cancel closes without starting', async () => {
  const { onClose, onStarted } = open();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalled();
  expect(onStarted).not.toHaveBeenCalled();
});
