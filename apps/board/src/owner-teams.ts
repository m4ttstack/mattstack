import type { Database } from 'bun:sqlite';

import { channelFromCodeownerSection } from '@mattstack/glance';
import { teamForChannel, type TeamDirectory } from '@mattstack/rt-client';
import type { OwnerRule } from './codeowner-posts.ts';
import { getKvValue, getStateDb, setKvValue } from './state/index.ts';

/** A team that owns a Code Owner section on an MR, and whether every rule of
    its sections is approved; null while the MR has changed since the read.
    `posted` links the MR's review request in one of the team's channels. */
export interface OwnerTeam {
  team: string;
  approved: boolean | null;
  posted?: string;
}

/** The MR's Code Owner posts by channel, as the post dialog records them. */
type PostsByChannel = (
  mrUrl: string
) => Record<string, { permalink?: string | null }>;

const NS = 'owner-rules';

interface Stored {
  seen: string;
  rules: OwnerRule[];
}

type OwnMr = {
  webUrl?: string | null;
  updatedAt: string | null;
  reviews?: { approvedBy?: ReadonlyArray<{ username: string }> };
};

/** What a stored read was taken against. An approval never moves an MR's
    updatedAt, so who has approved is part of it. */
function seenKey(mr: OwnMr): string {
  const approvers = (mr.reviews?.approvedBy ?? []).map(a => a.username).sort();
  return `${mr.updatedAt ?? ''}|${approvers.join(',')}`;
}

/**
 * The other teams that own a section on an MR. A section reaches its team
 * through the Slack channel in its name, the same join the Code Owner posts
 * use, so a section with no channel or a channel no directory team claims
 * has no team to offer.
 */
export function ownerTeamsFromRules(
  rules: OwnerRule[],
  directory: TeamDirectory | undefined,
  ownTeam: string | null,
  posts: Record<string, { permalink?: string | null }> = {}
): OwnerTeam[] {
  const byTeam = new Map<string, OwnerTeam>();
  for (const rule of rules) {
    const channel = channelFromCodeownerSection(rule.section);
    const team = channel ? teamForChannel(directory, channel)?.name : null;
    if (!channel || !team || team === ownTeam) continue;
    const prior = byTeam.get(team);
    const posted = prior?.posted ?? posts[channel]?.permalink ?? undefined;
    byTeam.set(team, {
      team,
      approved: (prior?.approved ?? true) && rule.approved,
      ...(posted ? { posted } : {}),
    });
  }
  return [...byTeam.values()];
}

/**
 * Reads the Code Owner rules of each MR that changed since its stored read.
 * A failed read (null) stores nothing, so the next pass asks again instead
 * of pinning an empty answer.
 */
export async function refreshOwnerTeams<T extends OwnMr>(
  mrs: T[],
  deps: {
    readRules: (mr: T) => Promise<OwnerRule[] | null>;
    db?: Database;
  }
): Promise<void> {
  const db = deps.db ?? getStateDb();
  for (const mr of mrs) {
    if (!mr.webUrl) continue;
    const seen = seenKey(mr);
    if (getKvValue<Stored | null>(NS, mr.webUrl, null, db)?.seen === seen)
      continue;
    const rules = await deps.readRules(mr);
    if (!rules) continue;
    setKvValue(NS, mr.webUrl, { seen, rules } satisfies Stored, db);
  }
}

/** Each MR with its owning teams, from the stored rules and the directory
    and active team as they are now. An MR never read is left as it is. One
    that changed since its read keeps its teams, which rarely move, but not
    their approval, which the change may have flipped. */
export function attachOwnerTeams<T extends OwnMr>(
  mrs: T[],
  config: {
    directory?: TeamDirectory;
    ownTeam?: string | null;
    posts?: PostsByChannel;
  },
  db: Database = getStateDb()
): Array<T & { ownerTeams?: OwnerTeam[] }> {
  return mrs.map(mr => {
    const stored = mr.webUrl
      ? getKvValue<Stored | null>(NS, mr.webUrl, null, db)
      : null;
    if (!stored) return mr;
    const teams = ownerTeamsFromRules(
      stored.rules,
      config.directory,
      config.ownTeam ?? null,
      config.posts?.(mr.webUrl!)
    );
    return {
      ...mr,
      ownerTeams:
        stored.seen === seenKey(mr)
          ? teams
          : teams.map(t => ({ ...t, approved: null })),
    };
  });
}
