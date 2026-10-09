import { expect, test } from 'bun:test';

import { MR_URL, mrx } from './menu-fixtures.ts';
import {
  allItemLabels,
  clickItem,
  harness,
  itemTexts,
  openMenu,
  openSub,
  useMenuHarness,
} from './row-menu-harness.tsx';

useMenuHarness();

const URL = MR_URL(1418);

test('own MR with free roster members offers the picker and fires the ask', async () => {
  await openMenu(mrx(1418), { self: 'pat', roster: ['pat', 'kim', 'jo'] });
  await openSub('request review from…');
  // The submenu lists only the free members -- never the author.
  expect(itemTexts().some(t => t.includes('pat'))).toBe(false);
  await clickItem('kim');
  expect(harness.effects).toEqual([{ effect: 'ask:review:kim', iid: 1418 }]);
});

test('engaged peers block the item with a reason', async () => {
  await openMenu(
    mrx(1418, {
      peerReviews: [
        {
          mrUrl: URL,
          iid: 1418,
          reviewer: 'kim',
          status: 'reviewing',
          updatedAt: 1,
        },
        {
          mrUrl: URL,
          iid: 1418,
          reviewer: 'jo',
          status: 'done',
          outcome: 'comment',
          updatedAt: 1,
        },
      ],
    }),
    { self: 'pat', roster: ['pat', 'kim', 'jo'] }
  );
  await openSub('all agent actions');
  const ask = itemTexts().find(t => t.includes('request review from'));
  expect(ask).toContain('everyone engaged');
  await clickItem('request review from');
  expect(harness.effects).toEqual([]);
});

test('with no teammate board connected, the ask says so', async () => {
  await openMenu(mrx(1418, {}), {
    self: 'pat',
    roster: ['pat', 'kim', 'jo'],
    peers: ['pat'],
  });
  await openSub('all agent actions');
  const ask = itemTexts().find(t => t.includes('request review from'));
  expect(ask).toContain('no teammate boards connected');
});

test("a commented review on a teammate's MR offers the respond ask", async () => {
  await openMenu(
    mrx(1418, {
      author: { username: 'kim', name: 'Kim' },
      review: { status: 'done', outcome: 'comment' },
    }),
    { self: 'pat', roster: ['pat', 'kim'] }
  );
  await clickItem("ask kim's agent to respond");
  expect(harness.effects).toEqual([{ effect: 'ask:respond:kim', iid: 1418 }]);
});

test('the respond ask is blocked without a commented review of mine', async () => {
  await openMenu(mrx(1418, { author: { username: 'kim', name: 'Kim' } }), {
    self: 'pat',
    roster: ['pat', 'kim'],
  });
  const ask = itemTexts().find(t => t.includes('agent to respond'));
  expect(ask).toContain('no finished review with comments');
  await clickItem('agent to respond');
  expect(harness.effects).toEqual([]);
});

test('a known enrollment list narrows the picker to enrolled members', async () => {
  await openMenu(mrx(1418), {
    self: 'pat',
    roster: ['pat', 'kim', 'jo'],
    peers: ['kim'],
  });
  await openSub('request review from…');
  expect(itemTexts().some(t => t.includes('kim'))).toBe(true);
  expect(itemTexts().some(t => t.includes('jo'))).toBe(false);
});

test("the stand-down item is hidden on someone else's MR", async () => {
  await openMenu(mrx(1418), { self: 'kim', roster: ['pat'] });
  expect((await allItemLabels()).some(t => t.includes('auto-doctor'))).toBe(
    false
  );
});

test('a standalone MR offers "ignore this MR" and fires on: true', async () => {
  await openMenu(mrx(1418), { self: 'pat', roster: ['pat'] });
  await clickItem('auto-doctor: ignore this MR');
  expect(harness.effects).toEqual([{ effect: 'stand-down:true', iid: 1418 }]);
});

test('an MR with its own descendants offers "ignore this stack" instead', async () => {
  const mr = mrx(1418);
  const child = mrx(1500, { isStacked: true, targetBranch: 'f-1418' });
  await openMenu(mr, { self: 'pat', roster: ['pat'], allMrs: [mr, child] });
  await clickItem('auto-doctor: ignore this stack');
  expect(harness.effects).toEqual([{ effect: 'stand-down:true', iid: 1418 }]);
});

test('once stood down, the item flips to re-enable and fires on: false', async () => {
  await openMenu(mrx(1418, { standDown: true }), {
    self: 'pat',
    roster: ['pat'],
  });
  await clickItem('re-enable auto-doctor');
  expect(harness.effects).toEqual([{ effect: 'stand-down:false', iid: 1418 }]);
});
