import type { Database } from 'bun:sqlite';

import { channelFromCodeownerSection } from '@mattstack/glance';
import { teamForChannel, type TeamDirectory } from '@mattstack/rt-client';

import type { OwnerRule } from './codeowner-posts.ts';
import { getKvValue, getStateDb, setKvValue } from './state/index.ts';

/** A team that owns a Code Owner section on an MR, and whether every rule of
    its sections is approved. */
export interface OwnerTeam {
  team: string;
  approved: boolean;
}

const NS = 'owner-teams';

interface Stored {
  updatedAt: string | null;
  teams: OwnerTeam[];
}

type OwnMr = { webUrl?: string | null; updatedAt: string | null };

/**
 * The other teams that own a section on an MR. A section reaches its team
 * through the Slack channel in its name, the same join the Code Owner posts
 * use, so a section with no channel or a channel no directory team claims
 * has no team to offer.
 */
export function ownerTeamsFromRules(
  rules: OwnerRule[],
  directory: TeamDirectory | undefined,
  ownTeam: string | null
): OwnerTeam[] {
  const approvedByTeam = new Map<string, boolean>();
  for (const rule of rules) {
    const channel = channelFromCodeownerSection(rule.section);
    const team = channel ? teamForChannel(directory, channel)?.name : null;
    if (!team || team === ownTeam) continue;
    approvedByTeam.set(
      team,
      (approvedByTeam.get(team) ?? true) && rule.approved
    );
  }
  return [...approvedByTeam].map(([team, approved]) => ({ team, approved }));
}

/**
 * Reads the Code Owner rules of each MR whose stored answer is older than
 * the MR itself. A failed read (null) stores nothing, so the next pass asks
 * again instead of pinning an empty answer.
 */
export async function refreshOwnerTeams<T extends OwnMr>(
  mrs: T[],
  deps: {
    readRules: (mr: T) => Promise<OwnerRule[] | null>;
    directory: TeamDirectory | undefined;
    ownTeam: string | null;
    db?: Database;
  }
): Promise<void> {
  const db = deps.db ?? getStateDb();
  for (const mr of mrs) {
    if (!mr.webUrl) continue;
    const stored = getKvValue<Stored | null>(NS, mr.webUrl, null, db);
    if (stored && stored.updatedAt === mr.updatedAt) continue;
    const rules = await deps.readRules(mr);
    if (!rules) continue;
    setKvValue(
      NS,
      mr.webUrl,
      {
        updatedAt: mr.updatedAt,
        teams: ownerTeamsFromRules(rules, deps.directory, deps.ownTeam),
      } satisfies Stored,
      db
    );
  }
}

export function attachOwnerTeams<T extends { webUrl?: string | null }>(
  mrs: T[],
  db: Database = getStateDb()
): Array<T & { ownerTeams?: OwnerTeam[] }> {
  return mrs.map(mr => {
    const stored = mr.webUrl
      ? getKvValue<Stored | null>(NS, mr.webUrl, null, db)
      : null;
    return stored ? { ...mr, ownerTeams: stored.teams } : mr;
  });
}
