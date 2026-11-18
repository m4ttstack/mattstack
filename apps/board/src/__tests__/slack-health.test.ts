import { describe, expect, test } from 'bun:test';

import { slackAuthError, slackIssueFor } from '../slack-health.ts';

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

describe('slackIssueFor', () => {
  test('a rejected token is reported while the board still holds it', () => {
    expect(
      slackIssueFor({
        token: 'xoxp-a',
        rejection: { token: 'xoxp-a', error: 'token_revoked' },
        secretsFailure: null,
        channels: ['code-review'],
      })
    ).toEqual({ kind: 'rejected', error: 'token_revoked' });
  });

  test('a new token clears an old rejection', () => {
    expect(
      slackIssueFor({
        token: 'xoxp-b',
        rejection: { token: 'xoxp-a', error: 'token_revoked' },
        secretsFailure: null,
        channels: ['code-review'],
      })
    ).toBeNull();
  });

  test('an unreadable store counts when only a tab names a Slack channel', () => {
    expect(
      slackIssueFor({
        token: null,
        rejection: null,
        secretsFailure: 'sops failed',
        channels: ['tab-only-channel'],
      })
    ).toEqual({ kind: 'unreadable', detail: 'sops failed' });
  });

  test('an unreadable store is not reported when no Slack channel is set up', () => {
    expect(
      slackIssueFor({
        token: null,
        rejection: null,
        secretsFailure: 'sops failed',
        channels: [],
      })
    ).toBeNull();
  });
});
