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

/** Reactions with each alias swapped for its role's emoji, duplicates dropped. */
export function canonicalReactions(
  reactions: string[],
  emoji: SlackEmojiConfig,
  aliases: SlackEmojiAliases
): string[] {
  const role = new Map<string, string>();
  for (const [r, names] of Object.entries(aliases) as Array<
    [keyof SlackEmojiConfig, string[]]
  >)
    for (const name of names) role.set(name, emoji[r]);
  return [...new Set(reactions.map(name => role.get(name) ?? name))];
}
