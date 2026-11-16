const LINEAR_ID_RE = /^[A-Za-z]+-\d+$/;
const PREFIX_RE = /^([A-Za-z]+-\d+)[-_]/;

/**
 * Extract a Linear ticket identifier from a git branch name.
 * Pass 1: exact segment match (e.g. "feature/acme-1287" → "ACME-1287")
 * Pass 2: prefix match (e.g. "feature/acme-1287-add-photos" → "ACME-1287")
 */
export function extractLinearId(branch: string): string | null {
  const segments = branch.split("/");

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (LINEAR_ID_RE.test(seg)) return seg.toUpperCase();
  }

  for (let i = segments.length - 1; i >= 0; i--) {
    const match = PREFIX_RE.exec(segments[i]!);
    if (match) return match[1]!.toUpperCase();
  }

  return null;
}
