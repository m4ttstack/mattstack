import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { AgentCard, AgentName } from './AgentName';
import { BuddiesProvider } from './buddies-context';
import type { RosterBuddy } from './roster-types';

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

const avatarFill = (el: HTMLElement) =>
  el.querySelector('svg[shape-rendering="crispEdges"]')!.getAttribute('fill');

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

test('the avatar seeds from the id, so two remys differ', () => {
  renderWithProviders(
    <>
      <div data-testid="old">
        <AgentName handle="remy" name="remy" />
      </div>
      <div data-testid="new">
        <AgentName handle="remy.m2p4" name="remy" />
      </div>
    </>
  );
  expect(avatarFill(screen.getByTestId('old'))).not.toBe(
    avatarFill(screen.getByTestId('new'))
  );
});

test('the hover card header shows the name, never the id', () => {
  renderWithProviders(<AgentCard buddy={row('remy.m2p4', 'remy')} now={NOW} />);
  const card = screen.getByTestId('detail-remy.m2p4');
  expect(card).toHaveTextContent('remy');
  expect(card).not.toHaveTextContent('m2p4');
});
