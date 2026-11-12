import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { failed, invite, serveTeams, team } from './teamTestData';

vi.mock('../api', async () => (await import('./teamTestData')).apiMock());

const { adminTeams, teamPollInterval, TEAM_POLL_MS, useTeam } =
  await import('./useTeam');

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.clearAllMocks());

describe('adminTeams', () => {
  it('keeps org owners and admins and drops members and team owners', () => {
    const kept = adminTeams([
      team('a', { role: 'org-owner' }),
      team('b', { role: 'admin' }),
      team('c', { role: 'member' }),
      team('d', { role: 'owner' }),
      team('e', { role: null }),
    ]);
    expect(kept.map(t => t.slug)).toEqual(['a', 'b']);
  });

  it('keeps a failed read beside a team I administer', () => {
    expect(
      adminTeams([team('a'), failed('x', 'boom')]).map(t => t.slug)
    ).toEqual(['a', 'x']);
  });

  it('drops a failed read when no team proves I administer', () => {
    expect(adminTeams([failed('x', 'boom')])).toEqual([]);
    expect(
      adminTeams([team('c', { role: 'member' }), failed('x', 'boom')])
    ).toEqual([]);
  });
});

describe('teamPollInterval', () => {
  it('polls about once a minute while a team is mine to manage', () => {
    expect(teamPollInterval(undefined)).toBe(TEAM_POLL_MS);
    expect(teamPollInterval({ teams: [team('a')] })).toBe(60_000);
  });

  it('stops once a read shows no team I administer', () => {
    expect(teamPollInterval({ teams: [] })).toBe(false);
    expect(teamPollInterval({ teams: [team('c', { role: 'member' })] })).toBe(
      false
    );
  });
});

describe('useTeam', () => {
  it('counts replied invites across admin teams only', async () => {
    serveTeams([
      team('a', {
        invites: [invite('alice', 'replied'), invite('carol', 'invited')],
      }),
      team('b', { role: 'admin', invites: [invite('bo', 'replied')] }),
      team('c', { role: 'member', invites: [invite('zed', 'replied')] }),
    ]);
    const { result } = renderHook(() => useTeam(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.teams.map(t => t.slug)).toEqual(['a', 'b']);
    expect(result.current.waiting).toBe(2);
  });
});
