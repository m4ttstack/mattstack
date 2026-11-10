import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { hasQuestionForm as daemonHasQuestionForm } from '../../../../lib/daemon/question-form.ts';
import { hasQuestionForm } from '../question-form.ts';

// The board's copy of the daemon's AskUserQuestion detector must agree with
// it on every screen: the daemon's captured fixtures and the shapes its own
// tests build from them.
const FIXTURES = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
  'lib',
  'daemon',
  '__tests__',
  'fixtures'
);
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const single = fixture('question-form-single.txt');
const screens: Array<[string, string, boolean]> = [
  ['a single-question form', single, true],
  ['a multi-question form', fixture('question-form-multi.txt'), true],
  ['an inline-rendered form', fixture('question-form-inline.txt'), true],
  ['an idle prompt', fixture('pane-footer-1-shell.txt'), false],
  [
    'a form the session moved past',
    `${single}\n⏺ User answered Claude's questions:\n`,
    false,
  ],
  [
    'the vim-mode footer',
    single.replace(
      'Enter to select · ↑/↓ to navigate · Esc to cancel',
      '-- INSERT -- · Enter to select · ↑/↓ to navigate'
    ),
    true,
  ],
  [
    'transcript text quoting the footer',
    '⏺ quoting:\n  Enter to select · ↑/↓ to navigate · Esc to cancel\n❯ \n',
    false,
  ],
  ['an empty screen', '', false],
];

describe('hasQuestionForm (port of lib/daemon/question-form.ts)', () => {
  test.each(screens)('%s', (_name, screen, form) => {
    expect(hasQuestionForm(screen)).toBe(form);
    expect(daemonHasQuestionForm(screen)).toBe(form);
  });
});
