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

export interface TeamView {
  slug: string;
  name: string;
  role: string | null;
  members: TeamMember[];
  invites: TeamInvite[];
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

/** The label of the button that confirms every waiting teammate; null when nobody has replied. */
export function confirmLabel(invites: TeamInvite[]): string | null {
  const replied = invites.filter(invite => invite.state === 'replied');
  if (replied.length === 0) return null;
  if (replied.length === 1) return `Add ${replied[0]!.handle}`;
  return `Add ${replied.length} people`;
}
