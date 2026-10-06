import type { Viewer, ViewerRole } from '../../shared/types.js';
import type { RosterEntry } from './index.js';
import type { TeamMembership } from './team.js';

export interface ViewerInput {
  currentUser: string | null;
  roster: RosterEntry[];
  roles: unknown;
  team: TeamMembership | null;
}

function roleOf(roles: unknown, username: string): ViewerRole {
  if (typeof roles !== 'object' || roles === null || Array.isArray(roles))
    return 'self';
  const want = username.toLowerCase();
  const hit = Object.entries(roles as Record<string, unknown>).find(
    ([name]) => name.toLowerCase() === want
  );
  return hit?.[1] === 'team' ? 'team' : 'self';
}

export function resolveViewer(input: ViewerInput): Viewer {
  const want = input.currentUser?.toLowerCase();
  const entry =
    want === undefined
      ? undefined
      : input.roster.find(r => r.username.toLowerCase() === want);
  if (!input.team || !input.team.joined)
    return { username: entry?.username ?? input.currentUser, role: 'team' };
  if (!entry) return { username: null, role: 'self' };
  return {
    username: entry.username,
    role: roleOf(input.roles, entry.username),
  };
}
