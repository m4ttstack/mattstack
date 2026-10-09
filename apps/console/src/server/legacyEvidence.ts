import { legacyItems, parseEvidence } from '@mattstack/rt-client/evidence';

export const LEGACY_IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** A caller-supplied path is served only when the run's own legacy evidence
    names it and its resolved location stays inside the evidence root. */
export function legacyImageAllowed({
  evidence,
  path,
  realpath,
  evidenceRoot,
}: {
  evidence: string | null;
  path: string;
  realpath: (p: string) => string | null;
  evidenceRoot: string;
}): boolean {
  const parsed = parseEvidence(evidence);
  if (parsed.version !== 0) return false;
  const named = legacyItems(parsed.links).some(
    i => i.kind === 'image' && i.value === path
  );
  if (!named) return false;
  const resolved = realpath(path);
  if (resolved === null) return false;
  const rootReal = (realpath(evidenceRoot) ?? evidenceRoot).replace(/\/$/, '');
  return resolved.startsWith(`${rootReal}/`);
}
