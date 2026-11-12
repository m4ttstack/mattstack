import { useCallback, useMemo, useRef, useState } from 'react';
import { notifications } from '@mattstack/app-kit/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ConfirmResult, TeamRead } from '../../shared/team';
import { client } from '../api';
import { POLL_MS, readApiError, retryOnce } from '../runs/useRuns';

export const TEAM_KEY = ['team'] as const;

/** rt's `isOrgAdmin`: only these roles can approve a teammate. */
const ADMIN_ROLES = new Set(['org-owner', 'admin']);

const NO_TEAMS: TeamRead[] = [];

/** The teams this viewer administers. A failed read carries no role, so it
    stays: dropping it would hide the one team whose read needs attention. */
export function adminTeams(teams: TeamRead[]): TeamRead[] {
  return teams.filter(t => !t.ok || ADMIN_ROLES.has(t.team.role ?? ''));
}

export function repliedHandles(teams: TeamRead[]) {
  return teams.flatMap(t =>
    t.ok
      ? t.team.invites
          .filter(i => i.state === 'replied')
          .map(i => ({ slug: t.slug, team: t.team.name, handle: i.handle }))
      : []
  );
}

/** The org teams this viewer administers and who waits on them. The Team
    page, the rail badge and the Runs toast read the same query. */
export function useTeam() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: TEAM_KEY,
    queryFn: async () => {
      const res = await client.api.team.$get();
      if (!res.ok) throw await readApiError(res, 'team read failed');
      return (await res.json()) as { teams: TeamRead[] };
    },
    retry: retryOnce,
    refetchInterval: POLL_MS,
  });
  const all = query.data?.teams;
  const teams = useMemo(() => (all ? adminTeams(all) : NO_TEAMS), [all]);
  const waiting = repliedHandles(teams).length;

  const [confirming, setConfirming] = useState<string | null>(null);
  // State lands a render late, so a double click would read it as free.
  const inFlight = useRef(false);

  const confirm = useCallback(
    async (slug: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setConfirming(slug);
      try {
        const res = await client.api.team.confirm.$post({ json: { slug } });
        if (!res.ok) throw await readApiError(res, 'approve failed');
        const result = (await res.json()) as ConfirmResult;
        if (result.added.length === 0) {
          notifications.error(result.warnings[0] ?? 'Nobody was added');
        } else {
          notifications.success(
            result.added.length === 1
              ? `Added ${result.added[0]}`
              : `Added ${result.added.length} people`
          );
        }
      } catch (err) {
        notifications.error((err as Error).message);
      } finally {
        inFlight.current = false;
        setConfirming(null);
        await queryClient.invalidateQueries({ queryKey: TEAM_KEY });
      }
    },
    [queryClient]
  );

  return {
    teams,
    waiting,
    loaded: query.isSuccess,
    failed: query.isError,
    updatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
    confirm,
    confirming,
  };
}
