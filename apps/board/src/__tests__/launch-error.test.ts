import { describe, expect, test } from 'bun:test';

import { launchErrorMessage } from '../launch-error.ts';

describe('launchErrorMessage', () => {
  test('carries the real cause, with the home dir shortened to ~', () => {
    const err = new Error(
      'herdr not found at /Users/ada/.local/bin/herdr (install via `rt setup` / brew)'
    );
    expect(launchErrorMessage('review', err, '/Users/ada')).toBe(
      'herdr not found at ~/.local/bin/herdr (install via `rt setup` / brew)'
    );
  });

  test('strips credentials a cause carries', () => {
    const token = 'glpat-' + 'A'.repeat(20);
    const err = new Error(
      `clone failed: https://oauth2:${token}@gitlab.com/acme/api.git`
    );
    const message = launchErrorMessage('respond', err, '/Users/ada');
    expect(message).not.toContain(token);
    expect(message).toBe(
      'clone failed: https://[redacted]@gitlab.com/acme/api.git'
    );
  });

  test('folds a multi-line cause onto one line and caps its length', () => {
    const err = new Error(`herdr tab create failed (1):\n  ${'x'.repeat(400)}`);
    const message = launchErrorMessage('doctor', err, '/Users/ada');
    expect(message).not.toContain('\n');
    expect(message.startsWith('herdr tab create failed (1): xxx')).toBe(true);
    expect(message.length).toBeLessThanOrEqual(240);
    expect(message.endsWith('…')).toBe(true);
  });

  test('a herdr failure leads with its verb and cause, not the command it echoed', () => {
    const err = new Error(
      `agent:start failed: herdr pane run w1:p1 cd '/r' && ACME_TOKEN=x claude --settings '{"hooks":{}}' '${'review this MR '.repeat(20)}' failed (127): claude: command not found`
    );
    expect(launchErrorMessage('review', err, '/Users/ada')).toBe(
      'herdr pane run failed (127): claude: command not found'
    );
  });

  test('shortens the home dir only at a path boundary', () => {
    expect(
      launchErrorMessage(
        'review',
        new Error(`no such file /Users/ada/x or /Users/adam/y in '/Users/ada'`),
        '/Users/ada'
      )
    ).toBe(`no such file ~/x or /Users/adam/y in '~'`);
    expect(
      launchErrorMessage('review', new Error('cwd is /Users/ada'), '/Users/ada')
    ).toBe('cwd is ~');
  });

  test('falls back to the lane phrase when the cause says nothing', () => {
    expect(launchErrorMessage('re-review', new Error('  '), '/Users/ada')).toBe(
      'failed to launch re-review pane'
    );
    expect(launchErrorMessage('review', undefined, '/Users/ada')).toBe(
      'failed to launch review pane'
    );
  });
});
