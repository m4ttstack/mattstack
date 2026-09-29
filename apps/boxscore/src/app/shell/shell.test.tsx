import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { App } from '../App';
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

function renderAt(path: string) {
  const { hook } = memoryLocation({ path });
  return renderWithProviders(
    <Router hook={hook}>
      <App />
    </Router>
  );
}

describe('kit shell', () => {
  it('mounts the rail-less MattstackShell with the boxscore mark and a top-bar cluster', () => {
    const { container } = renderAt('/');
    expect(container.querySelector('header img')).toHaveAttribute(
      'src',
      '/favicon.svg'
    );
    expect(
      screen.queryByRole('navigation', { name: 'App sections' })
    ).not.toBeInTheDocument();
    const banner = screen.getByRole('banner');
    expect(banner).toHaveTextContent('boxscore/Leaderboard');
    expect(
      within(banner).queryByRole('button', { name: 'Apps' })
    ).not.toBeInTheDocument();
    const controls = Array.from(banner.querySelectorAll('button, a')).map(
      el => el.getAttribute('aria-label') ?? el.textContent
    );
    expect(controls).toEqual(['Refresh', 'Settings', 'Color scheme']);
  });

  it('links settings out to the console boxscore section in a new tab', () => {
    renderAt('/');
    const link = within(screen.getByRole('banner')).getByRole('link', {
      name: 'Settings',
    });
    expect(link.getAttribute('href')).toMatch(/\/settings#boxscore$/);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('keeps the same top bar on a person page', () => {
    renderAt('/user/srivera');
    const banner = within(screen.getByRole('banner'));
    expect(banner.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(
      banner.getByRole('button', { name: 'Color scheme' })
    ).toBeInTheDocument();
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
