import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { App } from '../App';
import { Rail } from './Rail';
import { syncedLabel } from './Topbar';

const { useLeaderboard, useUserDetail } = vi.hoisted(() => ({
  useLeaderboard: vi.fn(() => ({
    data: undefined,
    error: null,
    isFetching: false,
  })),
  useUserDetail: vi.fn(),
}));
vi.mock('../hooks/useLeaderboard', () => ({ useLeaderboard, useUserDetail }));

describe('Rail', () => {
  it('links settings out to the console boxscore section in a new tab', () => {
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <Rail active="leaderboard" />
      </QueryClientProvider>
    );
    const link = screen.getByRole('link', { name: /settings/i });
    expect(link.getAttribute('href')).toMatch(/\/settings#boxscore$/);
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('routes', () => {
  it('answers /settings with the not-found page', () => {
    const { hook } = memoryLocation({ path: '/settings' });
    renderWithProviders(
      <Router hook={hook}>
        <App />
      </Router>
    );
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});

describe('syncedLabel', () => {
  it('reads minutes since the data was generated', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(syncedLabel('2026-09-29T11:56:00Z', now)).toBe('Synced 4 min ago');
    expect(syncedLabel('2026-09-29T11:59:40Z', now)).toBe('Synced just now');
    expect(syncedLabel('2026-09-29T09:00:00Z', now)).toBe('Synced 3 h ago');
  });
});
