/** Slack's answers a reconnect fixes: the token itself is no good, or it
    lacks a scope the board needs, as opposed to one channel or message being
    out of reach. */
const AUTH_ERRORS = new Set([
  'missing_scope',
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
]);

/** The auth error code in a Slack failure line (`slack <method>: <code>`,
    optionally behind an `!<iid>: ` prefix), or null for any other failure. */
export function slackAuthError(line: string): string | null {
  const code = /slack [\w.]+: (\w+)/.exec(line)?.[1];
  return code && AUTH_ERRORS.has(code) ? code : null;
}

/** Why the board cannot use Slack right now, shown to the person: the stored
    token was rejected, or the secrets holding it could not be read. */
export type SlackIssue =
  { kind: 'rejected'; error: string } | { kind: 'unreadable'; detail: string };

/** What stops the board using Slack, for the person to fix, or null. A
    rejection counts only while the board still holds the rejected token,
    and an unreadable store only when the team or a tab names a Slack
    channel, so a board with no Slack set up never nags. */
export function slackIssueFor(o: {
  token: string | null;
  rejection: { token: string; error: string } | null;
  secretsFailure: string | null;
  channels: string[];
}): SlackIssue | null {
  if (o.token && o.rejection?.token === o.token)
    return { kind: 'rejected', error: o.rejection.error };
  if (!o.token && o.secretsFailure && o.channels.length > 0)
    return { kind: 'unreadable', detail: o.secretsFailure };
  return null;
}
