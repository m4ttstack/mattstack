import type {
  LeaderboardResponse,
  UserMetrics,
  UserRow,
  Viewer,
} from '../shared/types.js';

export const SELF_ONLY_MESSAGE =
  'You can see only your own page in boxscore. Ask your team owner for Team view.';

/** A Self view viewer asked for someone else (or anyone, unidentified). Routes answer 403. */
export class ViewerForbiddenError extends Error {
  override readonly name = 'ViewerForbiddenError';
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function canSeeUser(viewer: Viewer, username: string): boolean {
  if (viewer.role === 'team') return true;
  return viewer.username !== null && same(viewer.username, username);
}

function unranked(metrics: UserMetrics): UserMetrics {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(metrics))
    out[key] =
      typeof v === 'object' && v !== null && 'rank' in v
        ? { ...v, rank: null }
        : v;
  return out as unknown as UserMetrics;
}

export function unrankedRow(row: UserRow): UserRow {
  return { ...row, metrics: unranked(row.metrics) };
}

export function narrowForViewer<
  R extends { users: UserRow[]; leaders: LeaderboardResponse['leaders'] },
>(response: R, viewer: Viewer): R {
  if (viewer.role === 'team') return response;
  return {
    ...response,
    leaders: {},
    users: response.users
      .filter(u => canSeeUser(viewer, u.username))
      .map(unrankedRow),
  };
}
