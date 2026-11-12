/** GitLab doesn't flag note authors as bots, so infer it from the username:
    service accounts (`service_account_…`, `project_<id>_bot_…`, `group_<id>_bot_…`),
    a delimited "bot" token (`review-bot`, `alert_bot`), and the deleted-user
    `ghost` placeholder. Conservative on purpose — "bot" mid-word (e.g. "abbott")
    is not treated as a bot, so real people's general comments aren't hidden. */
export function isBotUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  return (
    /^service_account_/i.test(username) ||
    /^(project|group)_\d+_bot/i.test(username) ||
    /(^|[._-])bot([._-]|\d|$)/i.test(username) ||
    /^ghost$/i.test(username) ||
    /\[bot\]$/i.test(username)
  );
}

/** A note author is a bot if config lists their username or display name (the
    escape hatch for named integration bots), or the username-heuristic flags it. */
export function isBotAuthor(
  author:
    | { username?: string | null; name?: string | null; bot?: boolean }
    | null
    | undefined,
  configBots: Set<string>
): boolean {
  if (!author) return false;
  if (author.bot === true) return true;
  if (author.username && configBots.has(author.username.toLowerCase()))
    return true;
  if (author.name && configBots.has(author.name.toLowerCase())) return true;
  return isBotUsername(author.username);
}
