import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { ScopeBar, ViewerChip, type ViewerInfo } from './Scope';

const INFO: ViewerInfo = {
  org: 'acme',
  activeTeam: 'widgets',
  viewer: {
    username: 'sam',
    name: 'Sam Rivera',
    role: 'admin',
    team: 'widgets',
    teams: ['widgets'],
  },
};

test('ViewerChip names you and your role', () => {
  renderWithProviders(<ViewerChip info={INFO} />);
  const who = screen.getByTestId('settings-viewer');
  expect(who).toHaveTextContent('Sam Rivera');
  expect(who).toHaveTextContent('org admin');
});

test('ScopeBar shows the org and the team, neither of them a control', () => {
  renderWithProviders(<ScopeBar info={INFO} />);
  expect(screen.getByTestId('org-scope')).toHaveTextContent('acme');
  expect(screen.getByTestId('team-scope')).toHaveTextContent('widgets');
  expect(screen.queryByRole('button')).toBeNull();
});

test('both draw nothing until rt answers', () => {
  renderWithProviders(
    <>
      <ViewerChip info={undefined} />
      <ScopeBar info={null} />
    </>
  );
  expect(screen.queryByTestId('settings-viewer')).toBeNull();
  expect(screen.queryByTestId('org-scope')).toBeNull();
});
