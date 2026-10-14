import { expect, spyOn, test } from 'bun:test';

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
  ownerSlackRepos: ['shop'],
  slackEnabled: true,
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

const owned = (ledger: { posted?: string } = {}) =>
  mrx(1418, {
    rtRepo: 'shop',
    ownerTeams: [
      { team: 'billing', approved: true },
      { team: 'gadgets', approved: false },
      { team: 'ledger', approved: false, ...ledger },
    ],
  });

const picker = () => document.querySelector('[data-part="contextmenu"]');
const search = () =>
  picker()?.querySelector<HTMLInputElement>('input.tui-menu-ask-search') ??
  null;
const headings = () =>
  [...(picker()?.querySelectorAll('.tui-menu-ask-team') ?? [])].map(
    h => h.textContent
  );

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

test('one list: your team, the owning teams still to approve, then the rest', async () => {
  await openMenu(owned(), env);
  await clickItem('request review from…');
  expect(search()).not.toBeNull();
  expect(headings()).toEqual([
    'widgets · your team',
    'gadgets · code ownerneeds approval',
    'ledger · code ownerneeds approval',
    'billing · code ownerapproved',
  ]);
  expect(itemTexts()).toEqual([
    'kim',
    'Nia Okoro',
    'Sam Whitlow',
    'post to codeowners in slack…',
    'Ines Duarte',
  ]);
});

test('a person goes straight on to the ask', async () => {
  await openMenu(owned(), env);
  await clickItem('request review from…');
  await clickItem('Nia Okoro');
  expect(harness.effects).toEqual([{ effect: 'ask:review:nia', iid: 1418 }]);
});

test("an owning team with no board opens the Code Owner post", async () => {
  await openMenu(owned(), env);
  await clickItem('request review from…');
  await clickItem('post to codeowners in slack…');
  expect(harness.effects).toEqual([{ effect: 'post-slack', iid: 1418 }]);
});

test("once posted, the team's row opens the Slack thread", async () => {
  const open = spyOn(window, 'open').mockImplementation(() => null);
  try {
    await openMenu(owned({ posted: 'https://slack.example/p1' }), env);
    await clickItem('request review from…');
    await clickItem('posted in slack');
    expect(open).toHaveBeenCalledWith(
      'https://slack.example/p1',
      '_blank',
      'noopener'
    );
    expect(harness.effects).toEqual([]);
  } finally {
    open.mockRestore();
  }
});

test('the search narrows every section and keeps their headings', async () => {
  await openMenu(owned(), env);
  await clickItem('request review from…');
  await typeSearch('sa');
  expect(headings()).toEqual(['gadgets · code ownerneeds approval']);
  expect(itemTexts()).toEqual(['Sam Whitlow']);
  await typeSearch('ledger');
  expect(itemTexts()).toEqual(['post to codeowners in slack…']);
});

test('a search that matches nobody says so', async () => {
  await openMenu(owned(), env);
  await clickItem('request review from…');
  await typeSearch('zzz');
  expect(picker()!.textContent).toContain('nobody matches “zzz”');
});
