import { expect, test } from 'bun:test';

import { mrx } from './menu-fixtures.ts';
import {
  act,
  clickItem,
  harness,
  itemTexts,
  openMenu,
  useMenuHarness,
} from './row-menu-harness.tsx';

useMenuHarness();

const env = {
  self: 'pat',
  roster: ['pat', 'kim'],
  peers: ['kim', 'nia', 'sam', 'ines'],
  ownTeam: 'widgets',
  teams: [
    { name: 'billing', members: [{ username: 'ines', name: 'Ines Duarte' }] },
    {
      name: 'gadgets',
      members: [
        { username: 'nia', name: 'Nia Okoro' },
        { username: 'sam', name: 'Sam Whitlow' },
      ],
    },
    { name: 'ledger', members: [{ username: 'kofi' }] },
    { name: 'widgets', members: [{ username: 'pat' }, { username: 'kim' }] },
  ],
};

const owned = mrx(1418, {
  ownerTeams: [
    { team: 'gadgets', approved: false },
    { team: 'ledger', approved: false },
  ],
});

const picker = () => document.querySelector('[data-part="contextmenu"]');
const search = () =>
  picker()?.querySelector<HTMLInputElement>('input.tui-menu-ask-search') ??
  null;

const views = () => [
  ...(picker()?.querySelectorAll<HTMLElement>(
    '[data-part="segmented-option"]'
  ) ?? []),
];

async function showView(label: string): Promise<void> {
  const option = views().find(el => el.textContent === label);
  if (!option) throw new Error(`no view "${label}"`);
  await act(() => {
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function typeSearch(text: string): Promise<void> {
  const input = search();
  if (!input) throw new Error('no search box');
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!;
  await act(() => {
    setValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('an MR another team owns opens on code owners, each owning team under its heading', async () => {
  await openMenu(owned, env);
  await clickItem('request review from…');
  expect(search()).toBeNull();
  expect(views().map(el => [el.textContent, el.dataset.active])).toEqual([
    ['code owners', 'true'],
    ['all teams', undefined],
  ]);
  expect(itemTexts()).toEqual(['kim', 'Nia Okoro', 'Sam Whitlow']);
  const text = picker()!.textContent!;
  expect(text).toContain('gadgets');
  expect(text).toContain('needs approval');
  expect(text).toContain('ledger owns a section here but has no board');
  await clickItem('Nia Okoro');
  expect(harness.effects).toEqual([]);
  expect(itemTexts()).toEqual(['kim', 'really ask Nia Okoro?', 'Sam Whitlow']);
  await clickItem('really ask Nia Okoro?');
  expect(harness.effects).toEqual([{ effect: 'ask:review:nia', iid: 1418 }]);
});

test('all teams lists every team with someone to ask and narrows as you type', async () => {
  await openMenu(owned, env);
  await clickItem('request review from…');
  await showView('all teams');
  expect(itemTexts()).toEqual([
    'kim',
    'Ines Duarte',
    'Nia Okoro',
    'Sam Whitlow',
  ]);
  await typeSearch('gad');
  expect(itemTexts()).toEqual(['Nia Okoro', 'Sam Whitlow']);
  await clickItem('Sam Whitlow');
  expect(harness.effects).toEqual([]);
  await clickItem('really ask Sam Whitlow?');
  expect(harness.effects).toEqual([{ effect: 'ask:review:sam', iid: 1418 }]);
});

test('an MR no other team owns opens on all teams', async () => {
  await openMenu(mrx(1418), env);
  await clickItem('request review from…');
  expect(search()).not.toBeNull();
});

test('a search that matches nobody says so', async () => {
  await openMenu(mrx(1418), env);
  await clickItem('request review from…');
  await typeSearch('zzz');
  expect(picker()!.textContent).toContain('nobody matches');
});
