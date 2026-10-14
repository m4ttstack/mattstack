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

const owned = (
  ledger: { posted?: string } = {},
  more: Array<Record<string, unknown>> = []
) =>
  mrx(1418, {
    rtRepo: 'shop',
    ownerTeams: [
      { team: 'billing', channel: 'pod-billing', approved: true },
      { team: 'gadgets', channel: 'pod-gadgets', approved: false },
      { team: 'ledger', channel: 'pod-ledger', approved: false, ...ledger },
      ...more,
    ] as never,
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
    'post in #pod-ledger…',
    'Ines Duarte',
  ]);
});

test('owners with no team follow in order: a channel by its name, a section with no channel to post in', async () => {
  await openMenu(
    owned({}, [
      { channel: 'intake-auto', approved: false },
      { section: 'SpareParts', approved: false },
    ]),
    env
  );
  await clickItem('request review from…');
  expect(headings().slice(2, 5)).toEqual([
    'ledger · code ownerneeds approval',
    '#intake-auto · code ownerneeds approval',
    'SpareParts · code ownerneeds approval',
  ]);
  expect(itemTexts().slice(3, 6)).toEqual([
    'post in #pod-ledger…',
    'post in #intake-auto…',
    'slack channel not known',
  ]);
  await clickItem('slack channel not known');
  expect(harness.effects).toEqual([]);
});

test('my team owning a section badges the your-team heading', async () => {
  await openMenu(
    owned({}, [
      { team: 'widgets', channel: 'pod-widgets', mine: true, approved: false },
    ]),
    env
  );
  await clickItem('request review from…');
  expect(headings()[0]).toBe('widgets · your teamneeds approval');
});

test('a person goes straight on to the ask', async () => {
  await openMenu(owned(), env);
  await clickItem('request review from…');
  await clickItem('Nia Okoro');
  expect(harness.effects).toEqual([{ effect: 'ask:review:nia', iid: 1418 }]);
});

test('an owning team with no board opens the Code Owner post on its channel', async () => {
  await openMenu(owned(), env);
  await clickItem('request review from…');
  await clickItem('post in #pod-ledger…');
  expect(harness.effects).toEqual([
    { effect: 'post-slack:pod-ledger', iid: 1418 },
  ]);
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
  expect(itemTexts()).toEqual(['post in #pod-ledger…']);
});

test('a search that matches nobody says so', async () => {
  await openMenu(owned(), env);
  await clickItem('request review from…');
  await typeSearch('zzz');
  expect(picker()!.textContent).toContain('nobody matches “zzz”');
});
