import { homedir } from 'os';

import { redactCredentials } from '@mattstack/rt-client';

const MAX_LENGTH = 240;

/** A herdr CLI failure as its runners word it: `herdr <args...> failed (N):
    <output>`. The args can be a whole agent command line, so the verb and
    the output are all the row keeps. */
const HERDR_FAILURE = /\bherdr (\S+)(?: (\S+))?.*? failed \((-?\d+)\): (.*)$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** What a lane's row says when its pane never came up: the launch's own
    cause, since "failed to launch" alone sends the reader to the logs. */
export function launchErrorMessage(
  lane: 'review' | 're-review' | 'respond' | 'doctor',
  err: unknown,
  home: string = process.env.HOME ?? homedir()
): string {
  const raw =
    err instanceof Error ? err.message : err == null ? '' : String(err);
  let text = redactCredentials(raw).replace(/\s+/g, ' ').trim();
  const herdr = HERDR_FAILURE.exec(text);
  if (herdr) {
    const [, verb, sub, code, cause] = herdr;
    text = `herdr ${[verb, sub].filter(Boolean).join(' ')} failed (${code}): ${cause}`;
  }
  if (home)
    text = text.replace(
      new RegExp(`${escapeRegExp(home)}(?=[/'"\\s]|$)`, 'g'),
      '~'
    );
  if (!text) return `failed to launch ${lane} pane`;
  return text.length > MAX_LENGTH
    ? `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…`
    : text;
}
