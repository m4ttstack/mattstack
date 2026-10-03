import { expect, test } from 'bun:test';

import type { MenuEntry } from '../row-actions.ts';
import { mrx, ownEnv, ownIdle, teammateReviewed } from './menu-fixtures.ts';
import {
  act,
  clickItem,
  harness,
  menuLines,
  openActionMenu,
  openMenu,
  openSub,
  pressEnter,
  typeNote,
  useMenuHarness,
} from './row-menu-harness.tsx';

useMenuHarness();

test('an own MR shows the short top level, flyouts last', async () => {
  await openMenu(ownIdle, ownEnv);
  expect(menuLines()).toEqual([
    '# !1418',
    'post to slack',
    '---',
    '# agent actions',
    'review',
    'respond',
    'rebase locally',
    '> request review from…',
    '---',
    '> gitlab',
    '> slack',
    '> more',
  ]);
});

test('a flyout opens with its rows in it', async () => {
  await openMenu(ownIdle, ownEnv);
  expect(
    document.querySelector('[data-part="contextmenu-submenu"]')
  ).toBeNull();
  await openSub('gitlab');
  const panel = document.querySelector('[data-part="contextmenu-submenu"]');
  expect(panel?.getAttribute('aria-label')).toBe('gitlab for !1418');
  expect(
    [...panel!.querySelectorAll('[role="menuitem"]')].map(el => el.textContent)
  ).toEqual([
    'merge',
    'rebase on target',
    'set auto-merge',
    'mark as draft',
    'open in gitlab',
  ]);
  expect(harness.closed).toBe(false);
});

test('the reaction row toggles a mark and keeps the menu open', async () => {
  await openMenu(teammateReviewed, ownEnv, {
    reactionsReply: ['white_check_mark', 'eyes'],
  });
  expect(menuLines()[1]).toBe(
    '[mark as looking | mark as commented | unmark approved]'
  );
  const toggles = [
    ...document.querySelectorAll(
      '[data-part="contextmenu-row"] [role="menuitem"]'
    ),
  ].map(el => [el.getAttribute('title'), el.textContent?.endsWith('✓')]);
  expect(toggles).toEqual([
    ['mark as looking', false],
    ['mark as commented', false],
    ['unmark approved', true],
  ]);
  expect(
    document.querySelector('[data-part="contextmenu-row"] [aria-pressed]')
  ).toBeNull();
  await clickItem('mark as looking');
  expect(harness.effects.map(e => e.effect)).toEqual(['react:eyes:false']);
  expect(harness.closed).toBe(false);
});

test('Enter on a reaction keeps focus on it through the write, and the arrows still move', async () => {
  let land!: () => void;
  const reactionsHeld = new Promise<void>(resolve => {
    land = resolve;
  });
  await openMenu(teammateReviewed, ownEnv, {
    reactionsReply: ['white_check_mark', 'eyes'],
    reactionsHeld,
  });
  const toggle = (title: string) =>
    document.querySelector<HTMLButtonElement>(
      `[data-part="contextmenu-row"] [title="${title}"]`
    );
  const eyes = toggle('mark as looking')!;
  await act(() => eyes.focus());
  await pressEnter(eyes);

  expect(harness.effects.map(e => e.effect)).toEqual(['react:eyes:false']);
  expect(eyes.hasAttribute('disabled')).toBe(false);
  expect(eyes.getAttribute('aria-disabled')).toBe('false');
  expect(eyes.getAttribute('aria-busy')).toBe('true');
  expect(document.activeElement).toBe(eyes);

  await act(async () => {
    land();
    await reactionsHeld;
  });
  expect(toggle('unmark looking')).toBe(eyes);
  expect(eyes.isConnected).toBe(true);
  expect(eyes.hasAttribute('aria-busy')).toBe(false);
  expect(document.activeElement).toBe(eyes);

  await act(() =>
    eyes.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    )
  );
  expect(document.activeElement).toBe(toggle('mark as commented'));
});

test('a blocked reaction is aria-disabled, names its reason, and does not run', async () => {
  const reaction = (
    key: string,
    label: string,
    blocked?: string
  ): MenuEntry => ({
    key,
    section: 'top',
    label,
    glyph: null,
    blocked,
  });
  await openActionMenu([
    reaction('react-eyes', 'mark as looking', 'no thread'),
    reaction('react-speech_balloon', 'mark as commented', ' '),
    reaction('react-white_check_mark', 'mark as approved'),
  ]);
  const toggles = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-part="contextmenu-row"] [role="menuitem"]'
    ),
  ].map(el => [
    el.getAttribute('aria-disabled'),
    el.hasAttribute('disabled'),
    el.getAttribute('aria-label'),
    el.title,
  ]);
  expect(toggles).toEqual([
    [
      'true',
      false,
      'mark as looking (no thread)',
      'mark as looking (no thread)',
    ],
    [
      'true',
      false,
      'mark as commented (blocked)',
      'mark as commented (blocked)',
    ],
    ['false', false, 'mark as approved', 'mark as approved'],
  ]);
  await clickItem('mark as looking');
  await clickItem('mark as commented');
  expect(harness.effects).toEqual([]);
  await clickItem('mark as approved');
  expect(harness.effects.map(e => e.effect)).toEqual([
    'react-white_check_mark',
  ]);
});

test('a blocked row in a flyout shows its reason and does not run', async () => {
  await openMenu(ownIdle, ownEnv);
  await openSub('slack');
  const post = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find(el => el.textContent?.includes('open MR post in slack'))!;
  expect(post.getAttribute('aria-disabled')).toBe('true');
  expect(post.textContent).toContain('no thread');
  await clickItem('open MR post in slack');
  expect(harness.effects).toEqual([]);
});

test('a blocked row shows its reason without a blocked tag; one with no reason keeps the tag', async () => {
  const blocked = (key: string, reason: string): MenuEntry => ({
    key,
    section: 'gitlab',
    label: key,
    glyph: null,
    blocked: reason,
  });
  await openActionMenu(
    [blocked('merge', 'needs approval'), blocked('rebase', ' ')],
    { flat: true }
  );
  const row = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      el => el.textContent?.startsWith(label)
    )!;
  const tagOf = (el: HTMLElement) =>
    el.querySelector('[data-part="contextmenu-hint"]')?.textContent ?? null;

  expect(row('merge').getAttribute('aria-disabled')).toBe('true');
  expect(row('merge').textContent).toBe('mergeneeds approval');
  expect(tagOf(row('merge'))).toBeNull();
  expect(row('rebase').getAttribute('aria-disabled')).toBe('true');
  expect(tagOf(row('rebase'))).toBe('blocked');
});

test('a remote board says agent actions once, on the row that needs a local board', async () => {
  await openMenu(ownIdle, { ...ownEnv, local: false });
  const lines = menuLines();
  expect(lines.slice(0, 2)).toEqual([
    '# !1418',
    'agent actionsneed a local board',
  ]);
  expect(lines).not.toContain('# agent actions');
});

test('a one-row section renders inline, not as a flyout', async () => {
  await openMenu(
    mrx(1418, { author: { username: 'kim', name: 'Kim' } }),
    ownEnv
  );
  const lines = menuLines();
  expect(lines).toContain('open in gitlab');
  expect(lines).not.toContain('> gitlab');
  expect(lines).toContain('add a note');
  expect(lines).not.toContain('> more');
});

test('flat draws every section inline under its heading, with no flyouts', async () => {
  const entry = (key: string, section: MenuEntry['section']): MenuEntry => ({
    key,
    section,
    label: key,
    glyph: null,
  });
  const entries = [
    entry('review', 'agent'),
    entry('resume', 'agent'),
    entry('merge', 'gitlab'),
    entry('rebase', 'gitlab'),
    entry('copy', 'slack'),
    entry('note', 'slack'),
  ];
  await openActionMenu(entries, { flat: true });
  expect(menuLines()).toEqual([
    '# 2 selected',
    '# agent actions',
    'review',
    'resume',
    '---',
    '# gitlab',
    'merge',
    'rebase',
    '---',
    '# slack',
    'copy',
    'note',
  ]);
  expect(document.querySelector('[data-part="contextmenu-sub"]')).toBeNull();
});

test('flat still draws a row from any section, under its bulk heading', async () => {
  const entry = (key: string, section: MenuEntry['section']): MenuEntry => ({
    key,
    section,
    label: key,
    glyph: null,
  });
  await openActionMenu(
    [
      entry('find', 'top'),
      entry('resume', 'sessions'),
      entry('note', 'more'),
      entry('merge', 'gitlab'),
    ],
    { flat: true }
  );
  expect(menuLines()).toEqual([
    '# 2 selected',
    '# agent actions',
    'resume',
    '---',
    '# gitlab',
    'merge',
    '---',
    '# slack',
    'find',
    'note',
  ]);
});

test('alt-click on a launch inside a flyout opens the note box first', async () => {
  await openMenu(teammateReviewed, ownEnv);
  await clickItem('resume review', { altKey: true });
  expect(harness.effects).toEqual([]);
  expect(menuLines()).toEqual([
    '# note for resume review !1419',
    '[note box]',
    '↵ launch with note · ⇧↵ newline · esc back',
  ]);
  await typeNote('pick up at the tests');
  expect(harness.effects).toEqual([
    { effect: 'launch:resume-review', iid: 1419, note: 'pick up at the tests' },
  ]);
  expect(harness.closed).toBe(true);
});

test('merge in the gitlab flyout still asks for a second click', async () => {
  await openMenu(ownIdle, ownEnv);
  await clickItem('merge');
  expect(harness.effects).toEqual([]);
  await clickItem('really merge?');
  expect(harness.effects.map(e => e.effect)).toEqual(['mr:merge']);
});
