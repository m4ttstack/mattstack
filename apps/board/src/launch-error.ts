import { homedir } from 'os';

import { redactCredentials } from '@mattstack/rt-client';

const MAX_LENGTH = 240;

/** What a lane's row says when its pane never came up: the launch's own
    cause, since "failed to launch" alone sends the reader to the logs.
    The generic phrase stays the fallback, and it is one of the texts the
    state db's v3 migration knows to clear. */
export function launchErrorMessage(
  lane: 'review' | 're-review' | 'respond' | 'doctor',
  err: unknown,
  home: string = process.env.HOME ?? homedir()
): string {
  const raw =
    err instanceof Error ? err.message : err == null ? '' : String(err);
  let text = redactCredentials(raw).replace(/\s+/g, ' ').trim();
  if (home) text = text.split(home).join('~');
  if (!text) return `failed to launch ${lane} pane`;
  return text.length > MAX_LENGTH
    ? `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…`
    : text;
}
