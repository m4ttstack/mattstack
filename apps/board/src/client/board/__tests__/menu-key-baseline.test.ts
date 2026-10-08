import { expect, test } from 'bun:test';

import { rowActions } from '../row-actions.ts';
import { actionEnvOf } from './menu-fixtures.ts';
import { MENU_STATES } from './menu-states.ts';

const BASELINE: Record<string, string[]> = {
  'own fresh': [
    'copy',
    'mark-draft',
    'merge',
    'note',
    'open-gitlab',
    'open-slack-post',
    'react-eyes',
    'react-speech_balloon',
    'react-white_check_mark',
    'request-review',
    'respond',
    'review',
    'setAutoMerge',
    'stand-down',
  ],
  'own mid-flow': [
    'cancelAutoMerge',
    'copy',
    'focus-review',
    'mark-draft',
    'note',
    'open-gitlab',
    'open-slack-post',
    'react-speech_balloon',
    'react-white_check_mark',
    'rebase',
    'rebase-local',
    'request-review',
    'respond',
    'resume-respond',
    'resume-review',
    'stand-down',
    'unreact-eyes',
    'view-respond',
  ],
  'own broken': [
    'copy',
    'dismiss-respond',
    'doctor',
    'mark-draft',
    'note',
    'open-gitlab',
    'open-slack-post',
    're-review',
    'react-eyes',
    'react-speech_balloon',
    'react-white_check_mark',
    'rebase-local',
    'request-review',
    'respond',
    'resume-respond',
    'review',
    'stand-down',
  ],
  'own no thread': [
    'copy',
    'mark-draft',
    'merge',
    'note',
    'open-gitlab',
    'post-slack',
    'rebase',
    'rebase-local',
    'request-review',
    'respond',
    'review',
    'setAutoMerge',
    'stand-down',
  ],
  'own draft': [
    'copy',
    'mark-ready',
    'note',
    'open-gitlab',
    'open-slack-post',
    'react-eyes',
    'react-speech_balloon',
    'react-white_check_mark',
    'request-review',
    'respond',
    'review',
    'stand-down',
  ],
  'own busy draft': [
    'copy',
    'doctor',
    'focus-review',
    'mark-ready',
    'note',
    'open-gitlab',
    'request-review',
    // Its response's pane is gone: a redo, never a focus that refuses.
    'respond',
    'resume-respond',
    'resume-review',
    'stand-down',
  ],
  'own failed lanes': [
    'copy',
    'dismiss-doctor',
    'dismiss-review',
    'doctor',
    'mark-draft',
    'note',
    'nudge-kim',
    'open-gitlab',
    'post-slack',
    'rebase-local',
    'request-review',
    'respond',
    'resume-respond',
    'review',
    'stand-down',
  ],
  teammate: [
    'ask-respond',
    'copy',
    'note',
    'open-gitlab',
    'open-slack-post',
    're-review',
    'react-eyes',
    'react-speech_balloon',
    'resume-review',
    'unreact-white_check_mark',
    'view-review',
  ],
  'teammate fresh': [
    'copy',
    'note',
    'open-gitlab',
    'open-slack-post',
    'react-eyes',
    'react-speech_balloon',
    'react-white_check_mark',
    'review',
  ],
  remote: ['copy', 'note', 'open-gitlab', 'stand-down'],
  seatless: ['copy', 'note', 'open-gitlab', 'review', 'seat-hint'],
  'slack off': [
    'copy',
    'mark-draft',
    'merge',
    'note',
    'open-gitlab',
    'rebase',
    'rebase-local',
    'request-review',
    'respond',
    'review',
    'setAutoMerge',
    'stand-down',
  ],
};

/** Keys the redesign removes on purpose, per state. A remote board cannot
    run them: their server routes refuse non-local requests. */
const DELIBERATE_DROPS: Record<string, string[]> = {
  remote: ['stand-down'],
};

for (const [name, { mr, env }] of Object.entries(MENU_STATES)) {
  test(`${name}: every action offered before is still offered`, () => {
    const now = new Set(rowActions(mr, actionEnvOf(env, mr)).map(a => a.key));
    const dropped = new Set(DELIBERATE_DROPS[name] ?? []);
    const missing = (BASELINE[name] ?? []).filter(
      k => !now.has(k) && !dropped.has(k)
    );
    expect(missing).toEqual([]);
  });
}

test('every state in the table has a baseline', () => {
  expect(Object.keys(BASELINE).sort()).toEqual(Object.keys(MENU_STATES).sort());
});
