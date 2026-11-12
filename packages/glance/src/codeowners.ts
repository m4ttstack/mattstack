/**
 * Section headers of a GitLab CODEOWNERS file: a line whose first non-blank
 * character opens a bracket, optionally prefixed with `^` for an optional
 * section. The approvals-count suffix (`[Name][2]`) and trailing default
 * owners are not part of the name. GitLab merges same-named sections
 * case-insensitively and keeps the first heading's casing, so this does too;
 * the kept text is what the approval rule's `section` carries and what
 * consumers match exactly.
 */
export function parseCodeownerSections(text: string): string[] {
  const byKey = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\^?\[([^\]]*)\]/.exec(raw.trimStart());
    if (!m) continue;
    const name = m[1]!.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()].sort();
}

/**
 * The Slack channel a section name carries (`Acme - #pod-acme` gives
 * `pod-acme`), or null. A hash only opens a channel at the start of the name
 * or after whitespace, so `C#Tools` carries none.
 */
export function channelFromCodeownerSection(section: string): string | null {
  const matches = [...section.matchAll(/(?:^|\s)#([A-Za-z0-9][A-Za-z0-9_-]*)/g)];
  const last = matches.at(-1);
  return last ? last[1]!.toLowerCase() : null;
}

/** Where GitHub looks for CODEOWNERS, highest precedence first. */
export const GITHUB_CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;

/**
 * The owners a GitHub CODEOWNERS file names: `@login` and `@org/team`
 * tokens after each rule's pattern, lowercased because GitHub matches
 * owners case-insensitively, deduped and sorted. Email owners are dropped
 * because a review request can never name one, so they cannot join a PR's
 * review requests. Trailing `# comments` are ignored.
 */
export function parseGitHubCodeowners(text: string): string[] {
  const owners = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (line.length === 0) continue;
    for (const token of line.split(/\s+/).slice(1)) {
      if (token.startsWith('@')) owners.add(token.toLowerCase());
    }
  }
  return [...owners].sort();
}
