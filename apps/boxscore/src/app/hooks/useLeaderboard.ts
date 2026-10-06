import { useQuery } from '@tanstack/react-query';

import {
  client,
  readOrThrow,
  selectionQuery,
  type DetailResult,
  type LeaderboardResult,
  type RangeSelection,
} from '../api';

const viewAsQuery = (viewAs: string | null): Record<string, string> =>
  viewAs === null ? {} : { viewAs };

/** Cache-only read: matches the probe the old fetchLeaderboard({cacheOnly:true}) made before deciding whether to start a refresh job. */
export function useLeaderboard(
  selection: RangeSelection,
  viewAs: string | null
) {
  return useQuery({
    queryKey: ['leaderboard', selection, viewAs],
    queryFn: async () => {
      const res = await client.api.leaderboard.$get({
        query: {
          ...selectionQuery(selection),
          cacheOnly: '1',
          ...viewAsQuery(viewAs),
        },
      });
      return readOrThrow<LeaderboardResult>(res, 'leaderboard');
    },
    // Matches the old one-shot fetch: no silent retries before an error reaches the UI.
    retry: false,
  });
}

/** `generatedAt` keys the evidence to the standings it explains, so a finished refresh refetches it. */
export function useUserDetail(
  username: string,
  selection: RangeSelection,
  generatedAt: string,
  viewAs: string | null
) {
  return useQuery({
    queryKey: ['detail', username, selection, generatedAt, viewAs],
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === username &&
      previousQuery.queryKey[2] === selection &&
      previousQuery.queryKey[4] === viewAs
        ? previous
        : undefined,
    queryFn: async () => {
      const res = await client.api.detail.$get({
        query: {
          ...selectionQuery(selection),
          user: username,
          ...viewAsQuery(viewAs),
        },
      });
      return readOrThrow<DetailResult>(res, 'user detail');
    },
    retry: false,
  });
}
