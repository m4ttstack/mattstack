import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { OrgSync, StuckReason } from '../../shared/settings-sync';
import { client } from '../api';
import { POLL_MS, readApiError, retryOnce } from '../runs/useRuns';

export const SETTINGS_SYNC_KEY = ['settings-sync'];

const NO_ORGS: OrgSync[] = [];

/** Every org clone's sync state; the `settings-sync` socket frame refetches it, and the poll is the safety net for a dropped socket. */
export function useSettingsSync(): { orgs: OrgSync[]; loading: boolean } {
  const query = useQuery({
    queryKey: SETTINGS_SYNC_KEY,
    queryFn: async () => {
      const res = await client.api.settings.sync.$get();
      if (!res.ok) throw await readApiError(res, 'settings sync read failed');
      return (await res.json()) as { orgs: OrgSync[] };
    },
    retry: retryOnce,
    refetchInterval: POLL_MS,
  });
  return { orgs: query.data?.orgs ?? NO_ORGS, loading: query.isPending };
}

/** Runs the daemon's push round for one org; resolves to rt's message on failure, null on success. */
export function usePushSettings(): {
  push: (org: string) => Promise<string | null>;
  pending: boolean;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (org: string): Promise<string | null> => {
      const res = await client.api.settings.sync.push.$post({ json: { org } });
      if (res.ok) return null;
      const body = (await res.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      return typeof body?.error === 'string' ? body.error : 'The push failed';
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SETTINGS_SYNC_KEY }),
  });
  return {
    push: org =>
      mutation.mutateAsync(org).catch((err: unknown) => (err as Error).message),
    pending: mutation.isPending,
  };
}

export type FollowUp =
  | 'saved'
  | 'pushing'
  | 'pushed'
  | { stuck: StuckReason; detail: string | null };

export interface SaveRecord {
  key: string;
  repo?: string;
  /** `org` or `team:<name>`, as the daemon names the store. */
  store: string;
  at: number;
}

export function followUpFor(
  sync: OrgSync | undefined,
  save: SaveRecord
): FollowUp {
  if (!sync) return 'saved';
  if (sync.state.kind === 'stuck') {
    return { stuck: sync.state.reason, detail: sync.state.detail };
  }
  const waiting = sync.pending.some(
    entry =>
      'key' in entry &&
      entry.store === save.store &&
      entry.key === save.key &&
      entry.repo === save.repo
  );
  if (waiting) return 'pushing';
  if (sync.lastPushAt !== null && sync.lastPushAt >= save.at) return 'pushed';
  return 'saved';
}
