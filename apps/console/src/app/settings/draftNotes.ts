export const ORG_ROLES_KEY = 'mattstack.org';

function listed(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/** A warning about what a draft value means, beyond its schema check. */
export function draftNote(key: string, value: unknown): string | null {
  if (key !== ORG_ROLES_KEY) return null;
  if (value === null || typeof value !== 'object') return null;
  const roles = value as { owners?: unknown; admins?: unknown };
  if (listed(roles.admins) && !listed(roles.owners)) {
    return 'No owners listed, so every admin is an org owner';
  }
  return null;
}
