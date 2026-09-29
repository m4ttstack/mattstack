import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('opens the settings tooltip on hover, beside the rail rather than inside it', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <div data-testid="frame">
          <Rail active="leaderboard" />
        </div>
      </QueryClientProvider>
    );
    const link = screen.getByRole('link', { name: /settings/i });
    await user.hover(link);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Opens console › boxscore');
    expect(tip.parentElement).toBe(screen.getByTestId('frame'));
    expect(link).toHaveAttribute('data-parity', 'Nav Settings (console)');
    await user.unhover(link);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

function renderRail() {
  return renderWithProviders(
    <QueryClientProvider client={new QueryClient()}>
      <Rail active="leaderboard" />
    </QueryClientProvider>
  );
}

const schemeAttr = () =>
  document.documentElement.getAttribute('data-mantine-color-scheme');

function mockOsScheme(initial: 'light' | 'dark') {
  let dark = initial === 'dark';
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  vi.stubGlobal('matchMedia', (query: string) => {
    const isDarkQuery = query.includes('prefers-color-scheme: dark');
    return {
      get matches() {
        return isDarkQuery ? dark : false;
      },
      media: query,
      onchange: null,
      addListener: (l: (e: MediaQueryListEvent) => void) => listeners.add(l),
      removeListener: (l: (e: MediaQueryListEvent) => void) =>
        listeners.delete(l),
      addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) =>
        listeners.add(l),
      removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) =>
        listeners.delete(l),
      dispatchEvent: () => false,
    };
  });
  return (next: 'light' | 'dark') => {
    dark = next === 'dark';
    act(() => {
      for (const l of listeners)
        l({
          matches: dark,
          media: '(prefers-color-scheme: dark)',
        } as MediaQueryListEvent);
    });
  };
}

describe('Rail brand and colour scheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('shows the boxscore brand icon in the mark slot', () => {
    const { container } = renderRail();
    const img = container.querySelector('[data-parity="Mark"] img');
    expect(img).toHaveAttribute('src', '/favicon.svg');
  });

  it('offers system, light and dark, and applies and persists each', async () => {
    const user = userEvent.setup();
    renderRail();
    const pick = async (label: string) => {
      await user.click(screen.getByRole('button', { name: 'Color scheme' }));
      await user.click(screen.getByRole('menuitem', { name: label }));
    };
    const stored = () =>
      JSON.parse(window.localStorage.getItem('ui-color-scheme') ?? 'null');

    await user.click(screen.getByRole('button', { name: 'Color scheme' }));
    expect(
      screen.getAllByRole('menuitem').map(i => i.textContent?.trim())
    ).toEqual(['System', 'Light', 'Dark']);
    await user.keyboard('{Escape}');

    await pick('Dark');
    expect(stored()).toBe('dark');
    expect(schemeAttr()).toBe('dark');

    await pick('Light');
    expect(stored()).toBe('light');
    expect(schemeAttr()).toBe('light');

    await pick('System');
    expect(stored()).toBe('auto');
  });

  it('follows the OS scheme live while set to system', () => {
    const setOs = mockOsScheme('light');
    window.localStorage.setItem('ui-color-scheme', JSON.stringify('auto'));
    renderRail();
    expect(schemeAttr()).toBe('light');
    setOs('dark');
    expect(schemeAttr()).toBe('dark');
    setOs('light');
    expect(schemeAttr()).toBe('light');
  });

  it('keeps an explicit choice when the OS scheme changes', () => {
    const setOs = mockOsScheme('light');
    window.localStorage.setItem('ui-color-scheme', JSON.stringify('light'));
    renderRail();
    setOs('dark');
    expect(schemeAttr()).toBe('light');
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
