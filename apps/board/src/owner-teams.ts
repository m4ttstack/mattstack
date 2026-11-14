import type { Database } from 'bun:sqlite';

import { channelFromCodeownerSection } from '@mattstack/glance';
import {
  rtCommand,
  teamForChannel,
  type TeamDirectory,
} from '@mattstack/rt-client';
import type { OwnerRule } from './codeowner-posts.ts';
import { getKvValue, getStateDb, setKvValue } from './state/index.ts';

/** An owner of Code Owner sections on an MR, and whether every rule of its
    sections is approved; null while the MR has changed since the read. A
    directory team owns the sections whose channel it claims (`mine` when it
    is the active team); a channel no team claims stands alone, and so does a
    section naming no channel. `posted` links the MR's review request in the
    owner's channel. */
export interface OwnerTeam {
  team?: string;
  /** A GitHub `@login` owner: one person, not a team. */
  person?: string;
  channel?: string;
  section?: string;
  mine?: true;
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

/** A directory team's GitHub team as a comparable token. */
const githubTeamToken = (value: string) =>
  value.replace(/^@/, '').toLowerCase();

function githubTeamFor(
  directory: TeamDirectory | undefined,
  token: string
): string | undefined {
  const want = githubTeamToken(token);
  return Object.entries(directory?.teams ?? {}).find(
    ([, entry]) =>
      entry.github?.team && githubTeamToken(entry.github.team) === want
  )?.[0];
}

/**
 * The owners of an MR's sections, in CODEOWNERS order. On GitLab a section
 * reaches its team through the Slack channel in its name, the same join the
 * Code Owner posts use. On GitHub a rule's section is an owner token: a
 * `@login` is a person, and an `@org/team` reaches its team through the
 * directory's `github.team`.
 */
export function ownerTeamsFromRules(
  rules: OwnerRule[],
  directory: TeamDirectory | undefined,
  ownTeam: string | null,
  posts: Record<string, { permalink?: string | null }> = {},
  forge: 'gitlab' | 'github' = 'gitlab'
): OwnerTeam[] {
  if (forge === 'github') return githubOwnerTeams(rules, directory, ownTeam);
  const byKey = new Map<string, OwnerTeam>();
  for (const rule of rules) {
    const channel = channelFromCodeownerSection(rule.section) ?? undefined;
    const team = channel ? teamForChannel(directory, channel)?.name : undefined;
    const key = team
      ? `team:${team}`
      : channel
        ? `channel:${channel}`
        : `section:${rule.section}`;
    const prior = byKey.get(key);
    const posted =
      prior?.posted ?? (channel ? posts[channel]?.permalink : undefined);
    byKey.set(key, {
      ...(team ? { team } : {}),
      ...(prior?.channel || channel
        ? { channel: prior?.channel ?? channel }
        : { section: rule.section }),
      ...(team && team === ownTeam ? { mine: true as const } : {}),
      approved: (prior?.approved ?? true) && rule.approved,
      ...(posted ? { posted } : {}),
    });
  }
  return [...byKey.values()];
}

function githubOwnerTeams(
  rules: OwnerRule[],
  directory: TeamDirectory | undefined,
  ownTeam: string | null
): OwnerTeam[] {
  const byKey = new Map<string, OwnerTeam>();
  for (const rule of rules) {
    const token = rule.section;
    const person = token.startsWith('@') && !token.includes('/');
    const team = person ? undefined : githubTeamFor(directory, token);
    const key = team ? `team:${team}` : `section:${token}`;
    const prior = byKey.get(key);
    byKey.set(key, {
      ...(team ? { team } : {}),
      ...(person ? { person: token.slice(1) } : {}),
      section: prior?.section ?? token,
      ...(team && team === ownTeam ? { mine: true as const } : {}),
      approved: (prior?.approved ?? true) && rule.approved,
    });
  }
  return [...byKey.values()];
}

/** A GitHub PR's Code Owner rules from the daemon, or why they could not be
    read. An unknown set (no CODEOWNERS file, say) reads as no owners. */
export async function readGithubOwnerRules(
  repoName: string,
  iid: number,
  command: typeof rtCommand = rtCommand
): Promise<
  | { ok: true; rules: OwnerRule[] }
  | { ok: false; status: number; message: string }
> {
  const res = await command<{
    rules: Array<{ type: string; section: string | null; approved: boolean }>;
    unknownReason?: string;
  }>('mr:owner-rules', { repoName, iid }, { timeoutMs: 30_000 });
  if (!res.ok || !res.data) {
    return {
      ok: false,
      status: 502,
      message: `could not read code owners from GitHub: ${res.error ?? 'no answer'}`,
    };
  }
  if (res.data.unknownReason) return { ok: true, rules: [] };
  return {
    ok: true,
    rules: res.data.rules.flatMap(rule =>
      rule.type === 'CODE_OWNER' && rule.section
        ? [{ section: rule.section, approved: rule.approved === true }]
        : []
    ),
  };
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
    forge?: 'gitlab' | 'github';
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
      config.posts?.(mr.webUrl!),
      config.forge
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
