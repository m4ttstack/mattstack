import { legacyItems, parseEvidence } from '@mattstack/rt-client/evidence';

export const LEGACY_IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

interface LegacyImageInput {
  evidence: string | null;
  path: string;
  realpath: (p: string) => string | null;
  evidenceRoot: string;
}

/** A caller-supplied path is served only when the run's own legacy evidence
    names it and its resolved location stays inside the evidence root. The
    resolved path is what a caller must read: resolving again would reopen the
    window for a link swapped after the check. */
export function legacyImagePath({
  evidence,
  path,
  realpath,
  evidenceRoot,
}: LegacyImageInput): string | null {
  const parsed = parseEvidence(evidence);
  if (parsed.version !== 0) return null;
  const named = legacyItems(parsed.links).some(
    i => i.kind === 'image' && i.value === path
  );
  if (!named) return null;
  const resolved = realpath(path);
  if (resolved === null) return null;
  const rootReal = (realpath(evidenceRoot) ?? evidenceRoot).replace(/\/$/, '');
  return resolved.startsWith(`${rootReal}/`) ? resolved : null;
}

export function legacyImageAllowed(input: LegacyImageInput): boolean {
  return legacyImagePath(input) !== null;
}
