import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  useLeaderboard.mockReturnValue({
    data: fixtureLeaderboard(false),
    error: null,
    isFetching: false,
  });
  useUserDetail.mockImplementation((username: string) => {
    const detail = fixtureDetail(username, false);
    return detail
      ? { data: detail, error: null, isLoading: false }
      : {
          data: undefined,
          error: new Error(`unknown user: ${username}`),
          isLoading: false,
        };
  });
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
  root.querySelector<HTMLElement>(`[data-parity="${name}"]`);

describe('person page', () => {
  it('switches between people in leaderboard order, keeping the stat', async () => {
    const user = userEvent.setup();
    const { container, location } = renderAt('/user/srivera/issuesCompleted');

    expect(layer(container, 'Sel Label')).toHaveTextContent(
      '2 of 7 · Sam Rivera'
    );
    const prev = screen.getByRole('link', { name: 'Previous person' });
    const next = screen.getByRole('link', { name: 'Next person' });
    expect(prev).toHaveAttribute('href', '/user/nvance/issuesCompleted');
    expect(next).toHaveAttribute('href', '/user/pnair/issuesCompleted');

    await user.click(prev);
    expect(location.history.at(-1)).toBe('/user/nvance/issuesCompleted');
  });

  it('disables the step past either end of the roster', () => {
    renderAt('/user/nvance/issuesCompleted');
    expect(
      screen.getByRole('button', { name: 'Previous person' })
    ).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Next person' })).toHaveAttribute(
      'href',
      '/user/srivera/issuesCompleted'
    );
  });

  it('disables next on the last person', () => {
    renderAt('/user/radeyemi/issuesCompleted');
    expect(screen.getByRole('button', { name: 'Next person' })).toBeDisabled();
  });

  it('summarises leads, top 3 places, median rank and coding days', () => {
    const { container } = renderAt('/user/srivera/issuesCompleted');
    const leads = layer(container, 'Sum Leads')!;
    expect(layer(leads, 'V')).toHaveTextContent('1');
    expect(layer(leads, 'Sum Sub')).toHaveTextContent('MRs reviewed');
    const top3 = layer(container, 'Sum Top 3')!;
    expect(top3).toHaveTextContent('13of 16');
    const median = layer(container, 'Sum Median rank')!;
    expect(layer(median, 'V')).toHaveTextContent('#2');
    expect(layer(median, 'U')).toHaveTextContent('of 7');
    expect(screen.getByText('streak 1d, best 5d')).toBeInTheDocument();
  });

  it('shows the Issues done panel with its counts and the first nine issues', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/user/srivera/issuesCompleted');
    const panel = layer(container, 'Panel · Issues done')!;
    const chips = [...panel.querySelectorAll('[data-parity^="Chip "]')].map(
      c => c.textContent
    );
    expect(chips).toEqual([
      '48counted',
      '4excluded by state',
      '96outside window',
    ]);

    const rows = () => panel.querySelectorAll('[data-parity^="Ev Row "]');
    expect(rows()).toHaveLength(9);
    expect(layer(panel, 'Count')).toHaveTextContent('Showing 9 of 48');

    const issue = within(panel).getByRole('link', { name: 'APP-1345' });
    expect(issue).toHaveAttribute(
      'href',
      'https://linear.example.com/acme/issue/APP-1345'
    );
    expect(within(panel).getByRole('link', { name: '!15605' })).toHaveAttribute(
      'href',
      expect.stringMatching(/merge_requests\/15605$/)
    );

    await user.click(
      within(panel).getByRole('button', { name: 'Show all 48' })
    );
    expect(rows()).toHaveLength(48);
  });

  it('filters the evidence rows by any cell', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/user/srivera/issuesCompleted');
    const panel = layer(container, 'Panel · Issues done')!;
    await user.type(
      within(panel).getByRole('textbox', { name: 'Filter 48 issues' }),
      'trailer'
    );
    const ids = [...panel.querySelectorAll('[data-parity="id"]')].map(
      n => n.textContent
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(9);
    for (const row of panel.querySelectorAll('[data-parity^="Ev Row "]'))
      expect(row.textContent?.toLowerCase()).toContain('trailer');
  });

  it('opens the stat rail rows as links to that stat', () => {
    renderAt('/user/srivera/issuesCompleted');
    const rail = screen.getByRole('navigation', { name: 'Stats' });
    expect(
      within(rail).getByRole('link', { name: /MRs merged/ })
    ).toHaveAttribute('href', '/user/srivera/mrsMerged');
    expect(
      within(rail).getByRole('link', { name: /Issues done/ })
    ).toHaveAttribute('aria-current', 'page');
  });

  it('opens Issues done when the route names no stat', () => {
    const { container } = renderAt('/user/srivera');
    expect(layer(container, 'Panel · Issues done')).not.toBeNull();
  });

  it('answers an unknown person with the not-found page', () => {
    renderAt('/user/nobody/issuesCompleted');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});
