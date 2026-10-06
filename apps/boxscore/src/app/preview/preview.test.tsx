import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fixtureDetail, fixtureLeaderboard } from '../../server/fixture/index';
import { ApiError } from '../api';
import { App } from '../App';

const { useLeaderboard, useUserDetail } = vi.hoisted(() => ({
  useLeaderboard: vi.fn(),
  useUserDetail: vi.fn(),
}));
vi.mock('../hooks/useLeaderboard', () => ({ useLeaderboard, useUserDetail }));

beforeEach(() => {
  // A react-query result keeps its identity across renders; App's effects rely on that.
  const results = new Map<string | null, unknown>();
  const unknown = {
    data: undefined,
    error: new ApiError('unknown user: ghost', 404),
    isFetching: false,
  };
  useLeaderboard.mockImplementation((_selection, viewAs: string | null) => {
    if (viewAs === 'ghost') return unknown;
    if (!results.has(viewAs))
      results.set(viewAs, {
        data: fixtureLeaderboard(false, viewAs ?? undefined),
        error: null,
        isFetching: false,
      });
    return results.get(viewAs);
  });
  useUserDetail.mockImplementation(
    (
      username: string,
      _selection: unknown,
      _generatedAt: string,
      viewAs: string | null
    ) => {
      const d = fixtureDetail(username, false, viewAs ?? undefined);
      return d && d !== 'forbidden'
        ? { data: d, error: null, isLoading: false }
        : { data: undefined, error: new Error('forbidden'), isLoading: false };
    }
  );
});
afterEach(() => {
  delete process.env.BOXSCORE_FIXTURE_SCENARIO;
});

const layer = (root: ParentNode, name: string) =>
  root.querySelector<HTMLElement>(`[data-parity="${name}"]`);

function renderAt(path: string) {
  const location = memoryLocation({ path, record: true });
  return renderWithProviders(
    <Router hook={location.hook}>
      <App />
    </Router>
  );
}

const banner = () => screen.queryByText(/^Previewing .*'s Self view$/);
const previewButton = () =>
  screen.queryByRole('link', { name: 'Preview Self view' });

describe('previewing a member’s Self view', () => {
  it('lands /as/<u> on their person page, as they would see it', async () => {
    const { container } = renderAt('/as/nvance');
    await waitFor(() => expect(layer(container, 'Name')).not.toBeNull());
    expect(layer(container, 'Name')).toHaveTextContent('Nora Vance');
    expect(useLeaderboard).toHaveBeenCalledWith(expect.anything(), 'nvance');
    expect(useUserDetail).toHaveBeenCalledWith(
      'nvance',
      expect.anything(),
      expect.any(String),
      'nvance'
    );
    expect(layer(container, 'Back Link')).toBeNull();
    expect(layer(container, 'Summary')).toBeNull();
  });

  it("shows the not-available page for someone else's page under /as/<u>", async () => {
    renderAt('/as/nvance/user/srivera');
    const notice = await screen.findByText("This page isn't available to you");
    expect(notice).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Your page' })).toHaveAttribute(
      'href',
      '/as/nvance'
    );
  });

  it('keeps every stat rail link under the /as/<u> prefix', async () => {
    const { container } = renderAt('/as/nvance/mrsMerged');
    await waitFor(() => expect(layer(container, 'Stat Rail')).not.toBeNull());
    const links = within(layer(container, 'Stat Rail')!).getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links)
      expect(link.getAttribute('href')).toMatch(/^\/as\/nvance\/[A-Za-z]+$/);
    expect(
      within(layer(container, 'Crumbs')!).getByText('Nora Vance')
    ).toBeInTheDocument();
  });

  it('shows the banner, with a way back to Team view, only while previewing', async () => {
    renderAt('/as/nvance/mrsMerged');
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(banner()).toHaveTextContent("Previewing Nora Vance's Self view");
    expect(screen.getByRole('link', { name: 'Exit preview' })).toHaveAttribute(
      'href',
      '/user/nvance'
    );
  });

  it('shows no banner in Team view', async () => {
    const { container } = renderAt('/user/nvance/mrsMerged');
    await waitFor(() => expect(layer(container, 'Name')).not.toBeNull());
    expect(banner()).toBeNull();
  });

  it('offers the preview from a Team view person page', async () => {
    const { container } = renderAt('/user/nvance/mrsMerged');
    await waitFor(() => expect(layer(container, 'Name')).not.toBeNull());
    expect(previewButton()).toHaveAttribute('href', '/as/nvance');
  });

  it('does not offer the preview while previewing', async () => {
    const { container } = renderAt('/as/nvance');
    await waitFor(() => expect(layer(container, 'Name')).not.toBeNull());
    expect(previewButton()).toBeNull();
  });

  it('does not offer the preview in a real Self view', async () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'self-view';
    const { container } = renderAt('/user/srivera');
    await waitFor(() => expect(layer(container, 'Name')).not.toBeNull());
    expect(previewButton()).toBeNull();
  });

  it('ignores /as/<u> for a real Self viewer, who keeps their own links', async () => {
    process.env.BOXSCORE_FIXTURE_SCENARIO = 'self-view';
    renderAt('/as/nvance');
    await screen.findByText("This page isn't available to you");
    expect(screen.getByRole('link', { name: 'Your page' })).toHaveAttribute(
      'href',
      '/user/srivera'
    );
    expect(banner()).toBeNull();
  });

  it('shows not-found for an unknown member', async () => {
    renderAt('/as/ghost');
    expect(
      await screen.findByText('Nothing lives at this address.')
    ).toBeInTheDocument();
  });
});
