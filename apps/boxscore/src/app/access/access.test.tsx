import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fixtureDetail, fixtureLeaderboard } from '../../server/fixture/index';
import { App } from '../App';

const { useLeaderboard, useUserDetail } = vi.hoisted(() => ({
  useLeaderboard: vi.fn(),
  useUserDetail: vi.fn(),
}));
vi.mock('../hooks/useLeaderboard', () => ({ useLeaderboard, useUserDetail }));

function useScenario(scenario: string) {
  process.env.BOXSCORE_FIXTURE_SCENARIO = scenario;
  useLeaderboard.mockReturnValue({
    data: fixtureLeaderboard(false),
    error: null,
    isFetching: false,
  });
}

beforeEach(() => {
  useScenario('self-view');
  useUserDetail.mockImplementation((username: string) => {
    const d = fixtureDetail(username, false);
    return d && d !== 'forbidden'
      ? { data: d, error: null, isLoading: false }
      : { data: undefined, error: new Error('forbidden'), isLoading: false };
  });
});
afterEach(() => {
  delete process.env.BOXSCORE_FIXTURE_SCENARIO;
});

function renderAt(path: string) {
  const location = memoryLocation({ path, record: true });
  const view = renderWithProviders(
    <Router hook={location.hook}>
      <App />
    </Router>
  );
  return { ...view, location };
}

const layer = (root: ParentNode, name: string) =>
  root.querySelector(`[data-parity="${name}"]`);

describe('Self view routing', () => {
  it('redirects / to your own page', async () => {
    const { location } = renderAt('/');
    await waitFor(() => expect(location.history!.at(-1)).toBe('/user/srivera'));
  });

  it("shows not-available for someone else's page, linking to yours", async () => {
    const { container } = renderAt('/user/someone-else/issuesCompleted');
    expect(
      await screen.findByText("This page isn't available to you")
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /your page/i })).toHaveAttribute(
      'href',
      '/user/srivera'
    );
    for (const name of [
      'Not Available',
      'NA Icon',
      'NA Title',
      'NA Body',
      'NA Button',
      'NA Button Icon',
      'NA Button Label',
    ]) {
      expect(layer(container, name)).not.toBeNull();
    }
  });

  it('treats a different-case URL as your own page', async () => {
    const { container } = renderAt('/user/SRivera');
    await waitFor(() =>
      expect(layer(container, 'Profile Header')).not.toBeNull()
    );
  });

  it('shows the locked page when the viewer is unidentified', async () => {
    useScenario('locked');
    const { container } = renderAt('/');
    expect(
      await screen.findByText("boxscore couldn't tell who you are")
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open console/i });
    expect(link).toBeVisible();
    expect(link.getAttribute('href')).toMatch(/\/settings#boxscore$/);
    expect(layer(container, 'Not Available')).not.toBeNull();
  });
});
