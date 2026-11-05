import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { BuddiesProvider } from './buddies-context';
import type { DmPair } from './display-name';
import { DmNames, DmPairTitle, DmStack } from './DmPairTitle';
import type { RosterBuddy } from './roster-types';

const buddy: RosterBuddy = {
  sessionId: 's-kai',
  handle: 'kai.x1',
  baseHandle: 'kai',
  name: 'roster kai',
  signedInAt: 1,
  lastSeenAt: 1,
  status: 'live',
  rooms: [],
};

function renderNames(pair: DmPair, withProvider = true) {
  const names = (
    <div data-testid="names">
      <DmNames pair={pair} />
    </div>
  );
  renderWithProviders(
    withProvider ? (
      <BuddiesProvider
        buddies={[buddy]}
        roomMembers={[]}
        me={{ handle: 'alex', name: 'Alex' }}
        now={1}
        reachable
      >
        {names}
      </BuddiesProvider>
    ) : (
      names
    )
  );
  return screen.getByTestId('names');
}

test('the pair reads by the names it carries, comma separated', () => {
  expect(
    renderNames({ a: 'kai.x1', b: 'remy.y2', aName: 'kai', bName: 'remy' })
  ).toHaveTextContent(/^kai, remy$/);
});

test("the viewer's own name wins over the name the pair carries", () => {
  expect(
    renderNames({ a: 'alex', b: 'remy.y2', aName: 'alex', bName: 'remy' })
  ).toHaveTextContent(/^Alex, remy$/);
});

test('a side with no name falls to the roster, then to the id', () => {
  expect(renderNames({ a: 'kai.x1', b: 'stranger.z3' })).toHaveTextContent(
    /^roster kai, stranger\.z3$/
  );
});

test('outside a provider each side reads its carried name or its id', () => {
  expect(
    renderNames({ a: 'kai.x1', b: 'remy.y2', bName: 'remy' }, false)
  ).toHaveTextContent(/^kai\.x1, remy$/);
});

test('the stack draws one face for each end and hides from assistive tech', () => {
  const { container } = renderWithProviders(
    <DmStack pair={{ a: 'kai', b: 'remy' }} size={40} />
  );
  const stack = container.querySelector('[aria-hidden]')!;
  expect(stack.querySelectorAll('img')).toHaveLength(2);
});

test('the title is the names alone, the sidebar carries the faces', () => {
  const { container } = renderWithProviders(
    <DmPairTitle pair={{ a: 'kai', b: 'remy' }} />
  );
  expect(container.querySelectorAll('img')).toHaveLength(0);
  expect(container).toHaveTextContent('kai, remy');
});
