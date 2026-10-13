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
  peers: ['kim', 'lea', 'sam', 'ines'],
  ownTeam: 'widgets',
  teams: [
    { name: 'billing', members: [{ username: 'ines', name: 'Ines Duarte' }] },
    {
      name: 'gadgets',
      members: [
        { username: 'lea', name: 'Lea Thorne' },
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
  expect(itemTexts()).toEqual([
    'code owners',
    'all teams',
    'kim',
    'Lea Thorne',
    'Sam Whitlow',
  ]);
  const text = picker()!.textContent!;
  expect(text).toContain('gadgets');
  expect(text).toContain('needs approval');
  expect(text).toContain('ledger owns a section here but has no board');
  await clickItem('Lea Thorne');
  expect(harness.effects).toEqual([{ effect: 'ask:review:lea', iid: 1418 }]);
});

test('all teams lists every team with someone to ask and narrows as you type', async () => {
  await openMenu(owned, env);
  await clickItem('request review from…');
  await clickItem('all teams');
  expect(itemTexts()).toEqual([
    'code owners',
    'all teams',
    'kim',
    'Ines Duarte',
    'Lea Thorne',
    'Sam Whitlow',
  ]);
  await typeSearch('gad');
  expect(itemTexts()).toEqual([
    'code owners',
    'all teams',
    'Lea Thorne',
    'Sam Whitlow',
  ]);
  await clickItem('Sam Whitlow');
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
