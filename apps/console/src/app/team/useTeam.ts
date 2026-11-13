import { useCallback, useMemo } from 'react';
import { notifications } from '@mattstack/app-kit/notifications';
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import type {
  AdminSecretsUpdate,
  ConfirmResult,
  TeamRead,
} from '../../shared/team';
import { client } from '../api';
import { readApiError, retryOnce } from '../runs/useRuns';
import { TEAM_KEY } from './teamKey';

export { TEAM_KEY };

/** About once a minute: a reply waits for a person, not a pipeline. */
export const TEAM_POLL_MS = 60_000;

/** rt's `isOrgAdmin`: only these roles can approve a teammate. */
const ADMIN_ROLES = new Set(['org-owner', 'admin']);

const NO_TEAMS: TeamRead[] = [];

/** The teams this viewer administers. A failed read carries no role, so it
    shows only beside a team that proves the viewer is an org admin. */
export function adminTeams(teams: TeamRead[]): TeamRead[] {
  const isAdmin = (t: TeamRead) => t.ok && ADMIN_ROLES.has(t.team.role ?? '');
  if (!teams.some(isAdmin)) return NO_TEAMS;
  return teams.filter(t => !t.ok || isAdmin(t));
}

/** Teams whose admin-only secrets still open for an older set of admins. */
export function staleAccess(teams: TeamRead[]) {
  return teams.flatMap(t =>
    t.ok && t.team.adminSecrets?.state === 'needs-sync'
      ? [{ slug: t.slug, team: t.team.name }]
      : []
  );
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

/** Polling stops once a read shows this viewer administers nothing; the
    `mattstack.org` save invalidates the query, which checks again. */
export function teamPollInterval(data: { teams: TeamRead[] } | undefined) {
  if (data && adminTeams(data.teams).length === 0) return false;
  return TEAM_POLL_MS;
}

/** The org teams this viewer administers and who waits on them. The Team
    page, the rail badge and the Runs toast read the same query. */
export function useTeam() {
  const query = useQuery({
    queryKey: TEAM_KEY,
    queryFn: async () => {
      const res = await client.api.team.$get();
      if (!res.ok) throw await readApiError(res, 'team read failed');
      return (await res.json()) as { teams: TeamRead[] };
    },
    retry: retryOnce,
    refetchInterval: q => teamPollInterval(q.state.data),
  });
  const all = query.data?.teams;
  const teams = useMemo(() => (all ? adminTeams(all) : NO_TEAMS), [all]);
  const waiting = repliedHandles(teams).length;

  return {
    teams,
    waiting,
    loaded: query.isSuccess,
    failed: query.isError,
    updatedAt: query.dataUpdatedAt,
    refetch: query.refetch,
  };
}

/** Approve and Update access both rewrite the org's `.sops.yaml`, so every
    write to one org runs under this key and one count guards them both,
    held by the query client across navigation. */
export const teamWriteKey = (slug: string) => ['team', 'write', slug];

type WriteKind = 'confirm' | 'update';

function confirmNotices(result: ConfirmResult) {
  if (result.added.length === 0) {
    notifications.error(result.warnings[0] ?? 'Nobody was added');
    return;
  }
  notifications.success(
    result.added.length === 1
      ? `Added ${result.added[0]}`
      : `Added ${result.added.length} people`
  );
  if (result.warnings[0]) notifications.warning(result.warnings[0]);
}

/** `adminSecretsBlocks` in rt's commands/team.ts, in console's words. */
function updateNotices(slug: string, result: AdminSecretsUpdate) {
  if (result.state === 'unused') {
    notifications.info('No admin-only secrets to update');
    return;
  }
  const changed =
    result.state === 'updated' ||
    result.token === 'seeded' ||
    result.token === 'replaced';
  if (changed) notifications.success('Admin access updated');
  if (result.token === 'differs') {
    notifications.warning({
      title: "The org's admin token differs from this Mac's",
      message: `Keep theirs unless yours is newer: rt team admin-secrets --team ${slug} --replace-token`,
    });
  } else if (!changed) {
    notifications.info('Admin access was already current');
  }
  if (result.withoutKey.length > 0) {
    notifications.warning(
      `${result.withoutKey.join(', ')} cannot open them yet: no age key on the roster`
    );
  }
  if (result.removed > 0) {
    notifications.warning({
      title: 'Anyone taken off keeps what they already opened',
      message: 'Change the switchboard admin token',
    });
  }
}

async function post<T>(
  call: () => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>,
  fallback: string
): Promise<T> {
  const res = await call();
  if (!res.ok) throw await readApiError(res, fallback);
  return (await res.json()) as T;
}

function useTeamWrite(slug: string, kind: WriteKind, run: () => Promise<void>) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: teamWriteKey(slug),
    meta: { kind },
    mutationFn: async () => {
      try {
        await run();
      } catch (err) {
        notifications.error((err as Error).message);
      } finally {
        // Held until the refetch lands, so a row cannot be approved twice
        // while it still shows as waiting.
        await queryClient
          .invalidateQueries({ queryKey: TEAM_KEY })
          .catch(() => undefined);
      }
    },
  });
  const { mutate } = mutation;
  return useCallback(() => {
    if (isTeamWriting(queryClient, slug)) return;
    mutate();
  }, [queryClient, slug, mutate]);
}

function isTeamWriting(queryClient: QueryClient, slug: string) {
  return queryClient.isMutating({ mutationKey: teamWriteKey(slug) }) > 0;
}

/** The writes for one org: Approve runs `members sync`, Update access runs
    `admin-secrets`; only one runs at a time, from any caller. */
export function useTeamWrites(slug: string) {
  const confirm = useTeamWrite(slug, 'confirm', async () =>
    confirmNotices(
      await post<ConfirmResult>(
        () => client.api.team.confirm.$post({ json: { slug } }),
        'approve failed'
      )
    )
  );
  const updateAccess = useTeamWrite(slug, 'update', async () =>
    updateNotices(
      slug,
      await post<AdminSecretsUpdate>(
        () => client.api.team['admin-secrets'].$post({ json: { slug } }),
        'update failed'
      )
    )
  );
  return {
    confirm,
    updateAccess,
    busy: useTeamWriting(slug),
    confirming: useTeamWriting(slug, 'confirm'),
    updating: useTeamWriting(slug, 'update'),
  };
}

function useTeamWriting(slug: string, kind?: WriteKind): boolean {
  return (
    useIsMutating({
      mutationKey: teamWriteKey(slug),
      ...(kind ? { predicate: m => m.options.meta?.kind === kind } : {}),
    }) > 0
  );
}
