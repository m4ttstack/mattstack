/** The key a tab section is compared by. GitHub tags are lowercased owner
    tokens, so a GitHub tab matches case-insensitively; GitLab headers are
    exact. */
export function sectionKey(
  forge: 'gitlab' | 'github',
  section: string
): string {
  return forge === 'github' ? section.toLowerCase() : section;
}

/**
 * Whether a configured codeowners section exists in the project's CODEOWNERS,
 * and the closest existing name when it does not. `known` null means rt could
 * not say (older daemon, or no sweep yet): never unknown, never a suggestion,
 * so the board shows nothing it cannot stand behind. The prefix pass comes
 * first because the rename this guards against appends to the old name.
 */
export function sectionStatus(
  section: string,
  known: string[] | null,
  forge: 'gitlab' | 'github' = 'gitlab'
): { unknown: boolean; suggestion: string | null } {
  if (
    known === null ||
    known.some(k => sectionKey(forge, k) === sectionKey(forge, section))
  )
    return { unknown: false, suggestion: null };
  const needle = section.toLowerCase();
  const suggestion =
    known.find(k => k.toLowerCase().startsWith(needle)) ??
    known.find(k => k.toLowerCase().includes(needle)) ??
    null;
  return { unknown: true, suggestion };
}
