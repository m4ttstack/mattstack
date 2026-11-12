export interface TeamInvite {
  handle: string;
  teams: string[];
  expiresAt: string;
  state: 'invited' | 'replied' | 'expired';
}

export const MEMBER_ROLES = [
  'org-owner',
  'admin',
  'owner',
  'member',
  'unknown',
] as const;

/** rt's role kind for one roster member; absent from an rt older than the field. */
export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface TeamMember {
  username: string;
  role?: MemberRole;
  peered: boolean | null;
}

export const ADMIN_SECRETS_STATES = [
  'current',
  'needs-sync',
  'needs-you',
  'not-this-mac',
  'unknown',
] as const;

/** Whether the org's admin-only secrets open for exactly its current owners
    and admins; `needs-sync` is fixed by `rt team admin-secrets`. */
export interface AdminSecretsView {
  state: (typeof ADMIN_SECRETS_STATES)[number];
  detail: string | null;
}

export interface TeamView {
  slug: string;
  name: string;
  role: string | null;
  /** The viewer's active team, the one `members` lists; null means the whole org. */
  activeTeam: string | null;
  /** The switchboard did not answer, so replies may be waiting unseen. */
  relayFailed: boolean;
  members: TeamMember[];
  invites: TeamInvite[];
  /** Null unless the viewer is an org owner or admin. */
  adminSecrets: AdminSecretsView | null;
}

export type TeamRead =
  | { slug: string; ok: true; team: TeamView }
  | { slug: string; ok: false; error: string };

/** `warnings` is rt's stderr, one line each; a sync that adds nobody still answers 200. */
export interface ConfirmResult {
  added: string[];
  pending: string[];
  warnings: string[];
}

export interface AdminSecretsUpdate {
  state: 'unused' | 'current' | 'updated';
  holders: string[];
  withoutKey: string[];
  /** How many keys lost access. */
  removed: number;
  token: string;
}

const canonical = (handle: string) => handle.trim().toLowerCase();

/** rt puts an invitee on the roster before the invite is made, so a
    member with an open invite shows only as that invite. */
export function settledMembers(team: TeamView): TeamMember[] {
  const invited = new Set(team.invites.map(i => canonical(i.handle)));
  return team.members.filter(m => !invited.has(canonical(m.username)));
}

/** The label of the button that confirms every waiting teammate; null when nobody has replied. */
export function confirmLabel(invites: TeamInvite[]): string | null {
  const replied = invites.filter(invite => invite.state === 'replied');
  if (replied.length === 0) return null;
  return replied.length === 1 ? 'Approve' : `Approve ${replied.length}`;
}
