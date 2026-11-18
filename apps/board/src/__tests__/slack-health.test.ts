import { describe, expect, test } from 'bun:test';

import { slackAuthError } from '../slack-health.ts';

describe('slackAuthError', () => {
  test('names the code when Slack rejects the token itself', () => {
    expect(slackAuthError('slack auth.test: token_revoked')).toBe(
      'token_revoked'
    );
    expect(
      slackAuthError('!601: slack conversations.history: invalid_auth')
    ).toBe('invalid_auth');
  });

  test('a token missing a scope needs a reconnect too', () => {
    expect(slackAuthError('slack conversations.list: missing_scope')).toBe(
      'missing_scope'
    );
  });

  test('a channel or message failure is not an auth failure', () => {
    expect(slackAuthError('slack chat.postMessage: not_in_channel')).toBeNull();
    expect(
      slackAuthError('slack conversations.replies: thread_not_found')
    ).toBeNull();
  });

  test('a network failure is not an auth failure', () => {
    expect(slackAuthError('fetch failed')).toBeNull();
  });
});
