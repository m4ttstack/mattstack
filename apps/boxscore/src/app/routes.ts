import { useRoute } from 'wouter';

import { METRICS } from '../shared/metrics';
import type { MetricKey } from '../shared/types';

/** `as` is set on a route under `/as/<as>`: the page as that roster member's Self view shows it. */
export type AppRoute =
  | { name: 'leaderboard' }
  | { name: 'user'; username: string; as?: string }
  | { name: 'stat'; username: string; stat: MetricKey; as?: string }
  | { name: 'not-found' };

const NOT_FOUND: AppRoute = { name: 'not-found' };

/** wouter hands captured params back raw; a segment that is not valid
    percent-encoding must read as no match, not throw out of render. */
function decodeParam(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function decodeStat(raw: string): MetricKey | undefined {
  const decoded = decodeParam(raw);
  if (decoded === undefined) return undefined;
  return METRICS.some(m => m.key === decoded)
    ? (decoded as MetricKey)
    : undefined;
}

/**
 * The app's route table, as a hook: the current location in, a structured
 * route out. Follows console's `useAppRoute` shape (one `useRoute` per
 * candidate, checked most-specific first).
 */
export function useAppRoute(): AppRoute {
  const [isLeaderboard] = useRoute('/');
  const [isUser, userParams] = useRoute('/user/:name');
  const [isStat, statParams] = useRoute('/user/:name/:stat');
  const [isAs, asParams] = useRoute('/as/:as');
  const [isAsStat, asStatParams] = useRoute('/as/:as/:stat');
  const [isAsUser, asUserParams] = useRoute('/as/:as/user/:name');
  const [isAsUserStat, asUserStatParams] = useRoute('/as/:as/user/:name/:stat');

  if (isLeaderboard) return { name: 'leaderboard' };
  if (isStat) return personRoute(statParams.name, statParams.stat);
  if (isUser) return personRoute(userParams.name);
  if (isAs) return personRoute(asParams.as, undefined, asParams.as);
  if (isAsStat)
    return personRoute(asStatParams.as, asStatParams.stat, asStatParams.as);
  if (isAsUser)
    return personRoute(asUserParams.name, undefined, asUserParams.as);
  if (isAsUserStat)
    return personRoute(
      asUserStatParams.name,
      asUserStatParams.stat,
      asUserStatParams.as
    );
  return NOT_FOUND;
}

function personRoute(
  rawName: string | undefined,
  rawStat?: string,
  rawAs?: string
): AppRoute {
  const username = decodeParam(rawName ?? '');
  if (username === undefined) return NOT_FOUND;
  let as: string | undefined;
  if (rawAs !== undefined) {
    as = decodeParam(rawAs);
    if (as === undefined) return NOT_FOUND;
  }
  const preview = as === undefined ? {} : { as };
  if (rawStat === undefined) return { name: 'user', username, ...preview };
  const stat = decodeStat(rawStat);
  return stat === undefined
    ? NOT_FOUND
    : { name: 'stat', username, stat, ...preview };
}
