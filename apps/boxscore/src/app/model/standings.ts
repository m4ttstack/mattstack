import {
  metricByKey,
  metricRank,
  metricValue,
  type MetricDescriptor,
} from '../../shared/metrics';
import type { MetricKey, UserRow } from '../../shared/types';

export interface Ranked {
  user: UserRow;
  value: number | null;
  rank: number | null;
  isLeader: boolean;
  isYou: boolean;
}

export function descriptor(key: MetricKey): MetricDescriptor {
  const d = metricByKey(key);
  if (!d) throw new Error(`unknown metric ${key}`);
  return d;
}

function rankedUsers(users: UserRow[], d: MetricDescriptor): UserRow[] {
  return users.filter(u => u.resolved && metricRank(u.metrics, d) !== null);
}

/** A missing value, or a zero where more is better, reads as quiet; a zero latency or revert rate is a good result. */
export function isQuietValue(key: MetricKey, value: number | null): boolean {
  return value === null || (value === 0 && descriptor(key).better === 'desc');
}

/** At least two ranked users, all sharing rank 1: nobody leads. */
export function isFullTie(users: UserRow[], key: MetricKey): boolean {
  const d = descriptor(key);
  const ranked = rankedUsers(users, d);
  return ranked.length > 1 && ranked.every(u => metricRank(u.metrics, d) === 1);
}

export function leaderOf(users: UserRow[], key: MetricKey): UserRow | null {
  if (isFullTie(users, key)) return null;
  const d = descriptor(key);
  return (
    rankedUsers(users, d).find(u => metricRank(u.metrics, d) === 1) ?? null
  );
}

export function rankedFor(users: UserRow[], key: MetricKey): Ranked[] {
  const d = descriptor(key);
  const tie = isFullTie(users, key);
  const rows: Ranked[] = users
    .filter(u => u.resolved)
    .map(user => {
      const rank = metricRank(user.metrics, d);
      return {
        user,
        value: metricValue(user.metrics, d),
        rank,
        isLeader: !tie && rank === 1,
        isYou: user.isCurrentUser,
      };
    });
  const order = (r: Ranked) =>
    r.value === null ? Infinity : (r.rank ?? Number.MAX_SAFE_INTEGER);
  return rows.sort((a, b) => order(a) - order(b));
}

export function you(users: UserRow[]): UserRow | null {
  return users.find(u => u.isCurrentUser) ?? null;
}
