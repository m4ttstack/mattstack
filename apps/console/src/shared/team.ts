export interface TeamInvite {
  handle: string;
  teams: string[];
  expiresAt: string;
  state: 'invited' | 'replied' | 'expired';
}

export interface TeamMember {
  username: string;
  role?: string;
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
  token: string;
}

/** The label of the button that confirms every waiting teammate; null when nobody has replied. */
export function confirmLabel(invites: TeamInvite[]): string | null {
  const replied = invites.filter(invite => invite.state === 'replied');
  if (replied.length === 0) return null;
  return replied.length === 1 ? 'Approve' : `Approve ${replied.length}`;
}
