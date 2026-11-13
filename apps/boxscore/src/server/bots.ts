import { BUILTIN_BOT_PATTERNS } from '../shared/bots.js';
import type { SuspectedBot } from '../shared/types.js';
import { readSettings } from './config/index.js';
import { compileBotPatterns } from './metrics/stats.js';
import { storedLoginCanon } from './source/index.js';
import { getStore, mrKey } from './store/index.js';
import { inProjects } from './store/query.js';

export type { SuspectedBot };

/**
 * Scan every stored MR in a configured project (index authors + metrics note
 * authors/approvers) for usernames that match built-in or extra bot patterns, excluding
 * usernames already known as org roster members (any team, visible or hidden).
 *
 * GitHub logins ignore case, and GraphQL reports a bot without the `[bot]` suffix REST
 * adds, so on GitHub two spellings that match apart from those are one account, listed
 * under the first spelling that matches a pattern. GitLab spellings are compared exactly.
 */
export async function scanSuspectedBots(
  extraPatterns: string[]
): Promise<SuspectedBot[]> {
  const allPatterns = [
    ...BUILTIN_BOT_PATTERNS.map(p => new RegExp(p.source, 'i')),
    ...compileBotPatterns(extraPatterns),
  ];

  const settings = readSettings();
  const store = getStore();
  if (settings.baseUrl) store.adoptForgeHost(settings.baseUrl);
  // An empty project list reads every stored row, as the scan always has.
  const configured = inProjects(settings.projects);
  const indexRows = store
    .allIndexRows()
    .filter(r => settings.projects.length === 0 || configured(r.projectPath));
  const keys = indexRows.map(r => mrKey(r.projectPath, r.iid));
  const metricsRows = store.metricsByKeys(keys);

  const knownUsers = new Set(
    [...settings.orgRoster, ...settings.roster].map(r => r.username)
  );
  const canon = storedLoginCanon(settings, settings);
  const isKnown = (u: string) => knownUsers.has(canon ? canon(u) : u);
  const account = (u: string): string =>
    settings.forge === 'github' ? u.toLowerCase().replace(/\[bot\]$/, '') : u;
  const listed = new Set<string>();
  const matches: SuspectedBot[] = [];

  const check = (u: string | null) => {
    if (!u || listed.has(account(u)) || isKnown(u)) return;
    const pat = allPatterns.find(p => p.test(u));
    if (!pat) return;
    listed.add(account(u));
    matches.push({ username: u, matchedPattern: String(pat) });
  };

  for (const row of indexRows) check(row.authorUsername);
  for (const m of metricsRows) {
    for (const note of m.notes) check(note.authorUsername);
    for (const a of m.approvedByUsernames) check(a);
  }

  return matches;
}
