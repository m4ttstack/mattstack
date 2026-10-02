import { expect, test } from 'bun:test';

import type { MenuEntry } from '../row-actions.ts';
import { mrx, ownEnv, ownIdle, teammateReviewed } from './menu-fixtures.ts';
import {
  clickItem,
  harness,
  menuLines,
  openActionMenu,
  openMenu,
  openSub,
  useMenuHarness,
} from './row-menu-harness.tsx';

useMenuHarness();

test('an own MR shows the short top level, flyouts last', async () => {
  await openMenu(ownIdle, ownEnv);
  expect(menuLines()).toEqual([
    '# !1418',
    'no thread, find it again',
    '---',
    '# agent actions',
    'review',
    'respond',
    'rebase locally',
    '---',
    '> sessions and reports',
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
  const pressed = [
    ...document.querySelectorAll(
      '[data-part="contextmenu-row"] [role="menuitem"]'
    ),
  ].map(el => [el.getAttribute('title'), el.getAttribute('aria-pressed')]);
  expect(pressed).toEqual([
    ['mark as looking', 'false'],
    ['mark as commented', 'false'],
    ['unmark approved', 'true'],
  ]);
  await clickItem('mark as looking');
  expect(harness.effects.map(e => e.effect)).toEqual(['react:eyes:false']);
  expect(harness.closed).toBe(false);
});

test('a blocked row in a flyout shows its reason and does not run', async () => {
  await openMenu(ownIdle, ownEnv);
  await openSub('slack');
  const post = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find(el => el.textContent?.includes('open MR post in slack'))!;
  expect(post.disabled).toBe(true);
  expect(post.textContent).toContain('no thread');
  await clickItem('open MR post in slack');
  expect(harness.effects).toEqual([]);
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

test('merge in the gitlab flyout still asks for a second click', async () => {
  await openMenu(ownIdle, ownEnv);
  await clickItem('merge');
  expect(harness.effects).toEqual([]);
  await clickItem('really merge?');
  expect(harness.effects.map(e => e.effect)).toEqual(['mr:merge']);
});
