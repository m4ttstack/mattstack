import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { AgentCard, AgentName } from './AgentName';
import { BuddiesProvider } from './buddies-context';
import type { RosterBuddy } from './roster-types';
import { SlackChatsProvider } from './slack-chats-context';

const NOW = 1_700_000_000_000;

function row(handle: string, name: string): RosterBuddy {
  return {
    sessionId: `s-${handle}`,
    handle,
    baseHandle: name,
    name,
    signedInAt: NOW - 60_000,
    lastSeenAt: NOW - 1_000,
    status: 'live',
    rooms: ['rt'],
  };
}

const face = (id: string) =>
  screen.getByTestId(id).querySelector('img')!.getAttribute('src');

test('the label is the name: prop, then roster row, then member directory, then the id', () => {
  renderWithProviders(
    <BuddiesProvider
      buddies={[row('remy.m2p4', 'remy')]}
      roomMembers={[]}
      memberNames={new Map([['kai.x9z1', 'kai']])}
      now={NOW}
      reachable
    >
      <div data-testid="prop">
        <AgentName handle="ghost.q1w2" name="ghost" />
      </div>
      <div data-testid="roster">
        <AgentName handle="remy.m2p4" />
      </div>
      <div data-testid="member">
        <AgentName handle="kai.x9z1" />
      </div>
      <div data-testid="legacy">
        <AgentName handle="max" />
      </div>
    </BuddiesProvider>
  );
  expect(screen.getByTestId('prop')).toHaveTextContent(/^ghost$/);
  expect(screen.getByTestId('roster')).toHaveTextContent(/^remy$/);
  expect(screen.getByTestId('member')).toHaveTextContent(/^kai$/);
  expect(screen.getByTestId('legacy')).toHaveTextContent(/^max$/);
});

test('a face comes from the handle, whether or not a display name is known', () => {
  renderWithProviders(
    <>
      <div data-testid="bare">
        <AgentName handle="remy.m2p4" />
      </div>
      <div data-testid="named-by-prop">
        <AgentName handle="remy.m2p4" name="Someone Else" />
      </div>
      <BuddiesProvider buddies={[]} roomMembers={[]} now={NOW} reachable>
        <div data-testid="no-names">
          <AgentName handle="remy.m2p4" />
        </div>
      </BuddiesProvider>
      <BuddiesProvider
        buddies={[row('remy.m2p4', 'Roster Name')]}
        roomMembers={['remy.m2p4']}
        memberNames={new Map([['remy.m2p4', 'Member Name']])}
        now={NOW}
        reachable
      >
        <div data-testid="names">
          <AgentName handle="remy.m2p4" />
        </div>
      </BuddiesProvider>
    </>
  );
  const expected = face('bare');
  expect(expected).toMatch(/^data:image\/svg\+xml/);
  expect(face('named-by-prop')).toBe(expected);
  expect(face('no-names')).toBe(expected);
  expect(face('names')).toBe(expected);
});

test('an id suffix keeps the same face, and different names differ', () => {
  renderWithProviders(
    <>
      <div data-testid="old">
        <AgentName handle="remy" />
      </div>
      <div data-testid="new">
        <AgentName handle="remy.m2p4" />
      </div>
      <div data-testid="other">
        <AgentName handle="kai" />
      </div>
    </>
  );
  expect(face('old')).toBe(face('new'));
  expect(face('other')).not.toBe(face('old'));
});

test('Slack handles keep their whole handle as the seed, so teammates differ', () => {
  renderWithProviders(
    <>
      <div data-testid="one">
        <AgentName handle="slack.t1.u1" />
      </div>
      <div data-testid="two">
        <AgentName handle="slack.t1.u2" />
      </div>
    </>
  );
  expect(face('one')).not.toBe(face('two'));
});

test('a known Slack picture replaces the face, and a broken one falls back', () => {
  const chats = [
    {
      room: 'dm-1',
      handle: 'slack.t1.u1',
      avatarId: 'u1',
      avatarVersion: 'abc',
    },
  ];
  renderWithProviders(
    <SlackChatsProvider chats={chats}>
      <div data-testid="slack">
        <AgentName handle="slack.t1.u1" />
      </div>
    </SlackChatsProvider>
  );
  expect(face('slack')).toBe('/api/chat/slack-avatar/u1?v=abc');
  fireEvent.error(screen.getByTestId('slack').querySelector('img')!);
  expect(face('slack')).toMatch(/^data:image\/svg\+xml/);
});

test("the card's status line reads herdr's state and its location reads workspace › tab", () => {
  renderWithProviders(
    <AgentCard
      buddy={{
        ...row('jay', 'jay'),
        status: 'idle',
        agentStatus: 'blocked',
        paneWorkspace: 'boxscore',
        paneTab: 'metrics hardening',
      }}
      now={NOW}
    />
  );
  expect(screen.getByTestId('status-jay')).toHaveTextContent(
    /^Waiting on you$/
  );
  expect(screen.getByTestId('where-jay')).toHaveTextContent(
    'boxscore › metrics hardening'
  );
});

test("an away message reads as a quote, so it can't pass for a pane title", () => {
  renderWithProviders(
    <AgentCard
      buddy={{ ...row('ava', 'ava'), statusText: 'release coordinator' }}
      now={NOW}
    />
  );
  expect(screen.getByTestId('away-ava')).toHaveTextContent(
    '“release coordinator”'
  );
});

test('a buddy with no herdr pane falls back to repo and branch for its location', () => {
  renderWithProviders(
    <AgentCard
      buddy={{ ...row('kai', 'kai'), repo: 'rt', branch: 'chat-identity' }}
      now={NOW}
    />
  );
  expect(screen.getByTestId('where-kai')).toHaveTextContent(
    'rt · chat-identity'
  );
});

test('the hover card header shows the name, never the id', () => {
  renderWithProviders(<AgentCard buddy={row('remy.m2p4', 'remy')} now={NOW} />);
  const card = screen.getByTestId('detail-remy.m2p4');
  expect(card).toHaveTextContent('remy');
  expect(card).not.toHaveTextContent('m2p4');
});
