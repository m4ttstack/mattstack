/** The three review-signal reactions by role, as Slack emoji names (no colons).
    Adapt these to your workspace's convention — e.g. a custom `comment` emoji
    instead of the standard `speech_balloon`. */
export interface SlackEmojiConfig {
  looking: string;
  commented: string;
  approved: string;
}

/** Shared by the server config and the client (row marks, config modal
    placeholders) so the fallback the board applies is the one it displays. */
export const DEFAULT_SLACK_EMOJI: SlackEmojiConfig = {
  looking: 'eyes',
  commented: 'speech_balloon',
  approved: 'white_check_mark',
};

/** Other emoji that count as a role's mark, for channels that mark reviews
    their own way (e.g. `mr-approved` for approved). */
export type SlackEmojiAliases = Partial<
  Record<keyof SlackEmojiConfig, string[]>
>;

/** Who added each reaction, by emoji name: whether the board's own Slack
    user did, and the Slack user ids of everyone else. */
export type ReactedBy = Record<string, { you: boolean; others: string[] }>;

function aliasRoles(
  emoji: SlackEmojiConfig,
  aliases: SlackEmojiAliases
): Map<string, string> {
  const role = new Map<string, string>();
  for (const [r, names] of Object.entries(aliases) as Array<
    [keyof SlackEmojiConfig, string[]]
  >)
    for (const name of names) role.set(name, emoji[r]);
  return role;
}

/** Reactions with each alias swapped for its role's emoji, duplicates dropped. */
export function canonicalReactions(
  reactions: string[],
  emoji: SlackEmojiConfig,
  aliases: SlackEmojiAliases
): string[] {
  const role = aliasRoles(emoji, aliases);
  return [...new Set(reactions.map(name => role.get(name) ?? name))];
}

/** `reactedBy` keyed the way `canonicalReactions` keys names, merging the
    people behind a role's emoji and its aliases. */
export function canonicalReactedBy(
  reactedBy: ReactedBy,
  emoji: SlackEmojiConfig,
  aliases: SlackEmojiAliases
): ReactedBy {
  const role = aliasRoles(emoji, aliases);
  const out: ReactedBy = {};
  for (const [name, who] of Object.entries(reactedBy)) {
    const entry = (out[role.get(name) ?? name] ??= { you: false, others: [] });
    entry.you ||= who.you;
    for (const id of who.others)
      if (!entry.others.includes(id)) entry.others.push(id);
  }
  return out;
}
