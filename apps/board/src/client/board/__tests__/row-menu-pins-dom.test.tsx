/** Pins of the one-row menu as it stands before the shared action model:
    what each MR state shows and what each click does. These must pass
    unchanged while RowMenu moves onto ActionMenu. */
import { expect, test } from 'bun:test';

import {
  busyEnv,
  failedEnv,
  failedLanes,
  ownBusy,
  ownEnv,
  ownIdle,
  teammateReviewed,
} from './menu-fixtures.ts';
import {
  clickEach,
  clickItem,
  flush,
  harness,
  itemTexts,
  menuLines,
  openMenu,
  typeNote,
  useMenuHarness,
} from './row-menu-harness.tsx';

useMenuHarness();

test('own idle MR, local, slack thread not found, gitlab buttons up', async () => {
  await openMenu(ownIdle, ownEnv);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# !1418",
      "# agent actions",
      "review",
      "respond",
      "rebase locally",
      "resume reviewno sessionblocked",
      "resume responseno sessionblocked",
      "view agent reviewno report yetblocked",
      "view agent responseno report yetblocked",
      "dismiss review linenothing to dismissblocked",
      "dismiss respond linenothing to dismissblocked",
      "dismiss doctor linenothing to dismissblocked",
      "ask a reviewer's agent to re-reviewno peer reviewblocked",
      "request review from…",
      "---",
      "# gitlab",
      "merge",
      "rebase on target",
      "set auto-merge",
      "mark as draft",
      "open in gitlab",
      "---",
      "# slack",
      "no thread, find it again",
      "open MR post in slackno threadblocked",
      "post to slack",
      "copy for slack",
      "add a note",
      "auto-doctor: ignore this MR",
    ]
  `);
  expect(await clickEach(ownIdle, ownEnv)).toMatchInlineSnapshot(`
    [
      "review → launch:review",
      "respond → launch:respond",
      "rebase locally → launch:rebase-local",
      "resume reviewno sessionblocked → (nothing) (stays open)",
      "resume responseno sessionblocked → (nothing) (stays open)",
      "view agent reviewno report yetblocked → (nothing) (stays open)",
      "view agent responseno report yetblocked → (nothing) (stays open)",
      "dismiss review linenothing to dismissblocked → (nothing) (stays open)",
      "dismiss respond linenothing to dismissblocked → (nothing) (stays open)",
      "dismiss doctor linenothing to dismissblocked → (nothing) (stays open)",
      "ask a reviewer's agent to re-reviewno peer reviewblocked → (nothing) (stays open)",
      "request review from… → ask:review:kim",
      "merge → mr:merge",
      "rebase on target → mr:rebase",
      "set auto-merge → mr:setAutoMerge",
      "mark as draft → draft:true",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1418",
      "no thread, find it again → find-thread",
      "open MR post in slackno threadblocked → (nothing) (stays open)",
      "post to slack → post-slack",
      "copy for slack → copy",
      "add a note → note",
      "auto-doctor: ignore this MR → stand-down:true",
    ]
  `);
});

test("teammate's MR after my commented review, slack thread found", async () => {
  await openMenu(teammateReviewed, ownEnv);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# !1419",
      "# agent actions",
      "re-review",
      "ask kim's agent to respond",
      "resume review",
      "view agent review",
      "dismiss review linenothing to dismissblocked",
      "---",
      "# gitlab",
      "open in gitlab",
      "---",
      "# slack",
      "👀mark as looking",
      "💬mark as commented",
      "✅unmark approved✓",
      "open MR post in slack",
      "copy for slack",
      "add a note",
    ]
  `);
  expect(await clickEach(teammateReviewed, ownEnv)).toMatchInlineSnapshot(`
    [
      "re-review → launch:re-review",
      "ask kim's agent to respond → ask:respond:kim",
      "resume review → launch:resume-review",
      "view agent review → view-report:review",
      "dismiss review linenothing to dismissblocked → (nothing) (stays open)",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1419",
      "👀mark as looking → react:eyes:false (stays open)",
      "💬mark as commented → react:speech_balloon:false (stays open)",
      "✅unmark approved✓ → react:white_check_mark:true (stays open)",
      "open MR post in slack → open:https://slack.example.com/archives/C1/p1",
      "copy for slack → copy",
      "add a note → note",
    ]
  `);
});

test('own MR with lanes running, a broken pipeline, a draft and a stack above it', async () => {
  await openMenu(ownBusy, busyEnv);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# !1420",
      "# agent actions",
      "focus review",
      "relaunch response",
      "call doctor",
      "resume review",
      "resume response",
      "view agent reviewno report yetblocked",
      "view agent responseno report yetblocked",
      "dismiss review linenothing to dismissblocked",
      "dismiss respond linenothing to dismissblocked",
      "dismiss doctor linenothing to dismissblocked",
      "ask a reviewer's agent to re-reviewno peer reviewblocked",
      "request review from…",
      "---",
      "# gitlab",
      "mergedraftblocked",
      "rebase on targetup to dateblocked",
      "set auto-mergedraftblocked",
      "mark ready",
      "open in gitlab",
      "---",
      "# slack",
      "copy for slack",
      "edit note",
      "auto-doctor: ignore this stack",
    ]
  `);
  expect(await clickEach(ownBusy, busyEnv)).toMatchInlineSnapshot(`
    [
      "focus review → launch:review:focus",
      "relaunch response → launch:respond:focus",
      "call doctor → launch:doctor",
      "resume review → launch:resume-review",
      "resume response → launch:resume-respond",
      "view agent reviewno report yetblocked → (nothing) (stays open)",
      "view agent responseno report yetblocked → (nothing) (stays open)",
      "dismiss review linenothing to dismissblocked → (nothing) (stays open)",
      "dismiss respond linenothing to dismissblocked → (nothing) (stays open)",
      "dismiss doctor linenothing to dismissblocked → (nothing) (stays open)",
      "ask a reviewer's agent to re-reviewno peer reviewblocked → (nothing) (stays open)",
      "request review from… → ask:review:kim",
      "mergedraftblocked → (nothing) (stays open)",
      "rebase on targetup to dateblocked → (nothing) (stays open)",
      "set auto-mergedraftblocked → (nothing) (stays open)",
      "mark ready → draft:false",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1420",
      "copy for slack → copy",
      "edit note → note",
      "auto-doctor: ignore this stack → stand-down:true",
    ]
  `);
});

test('failed lanes, finished respond, conflicts and a peer review with comments', async () => {
  await openMenu(failedLanes, failedEnv);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# !1422",
      "# agent actions",
      "review",
      "restart response",
      "call doctor",
      "rebase locally",
      "resume reviewno sessionblocked",
      "resume response",
      "view agent reviewno report yetblocked",
      "view agent responseno report yetblocked",
      "dismiss review line",
      "dismiss respond linenothing to dismissblocked",
      "dismiss doctor line",
      "ask kim's agent to re-review",
      "request review from…",
      "---",
      "# gitlab",
      "mergenot mergeable yetblocked",
      "rebase on targetup to dateblocked",
      "set auto-mergenot mergeable yetblocked",
      "mark as draft",
      "open in gitlab",
      "---",
      "# slack",
      "find slack thread",
      "open MR post in slackno threadblocked",
      "post to slack",
      "copy for slack",
      "add a note",
      "re-enable auto-doctor",
    ]
  `);
  expect(await clickEach(failedLanes, failedEnv)).toMatchInlineSnapshot(`
    [
      "review → launch:review",
      "restart response → launch:respond",
      "call doctor → launch:doctor",
      "rebase locally → launch:rebase-local",
      "resume reviewno sessionblocked → (nothing) (stays open)",
      "resume response → launch:resume-respond",
      "view agent reviewno report yetblocked → (nothing) (stays open)",
      "view agent responseno report yetblocked → (nothing) (stays open)",
      "dismiss review line → dismiss:review",
      "dismiss respond linenothing to dismissblocked → (nothing) (stays open)",
      "dismiss doctor line → dismiss:doctor",
      "ask kim's agent to re-review → ask:re-review:kim",
      "request review from… → ask:review:jo",
      "mergenot mergeable yetblocked → (nothing) (stays open)",
      "rebase on targetup to dateblocked → (nothing) (stays open)",
      "set auto-mergenot mergeable yetblocked → (nothing) (stays open)",
      "mark as draft → draft:true",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1422",
      "find slack thread → find-thread",
      "open MR post in slackno threadblocked → (nothing) (stays open)",
      "post to slack → post-slack",
      "copy for slack → copy",
      "add a note → note",
      "re-enable auto-doctor → stand-down:false",
    ]
  `);
});

test('a remote board keeps only what needs no local server', async () => {
  const env = { ...ownEnv, local: false };
  await openMenu(ownIdle, env);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# !1418",
      "# agent actions",
      "agent actionsneed a local boardblocked",
      "view agent reviewno report yetblocked",
      "view agent responseno report yetblocked",
      "---",
      "# gitlab",
      "open in gitlab",
      "---",
      "# slack",
      "copy for slack",
      "add a note",
    ]
  `);
  expect(await clickEach(ownIdle, env)).toMatchInlineSnapshot(`
    [
      "agent actionsneed a local boardblocked → (nothing) (stays open)",
      "view agent reviewno report yetblocked → (nothing) (stays open)",
      "view agent responseno report yetblocked → (nothing) (stays open)",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1418",
      "copy for slack → copy",
      "add a note → note",
    ]
  `);
});

test('merge takes two clicks: the first arms it, the second merges', async () => {
  await openMenu(ownIdle, ownEnv);
  await clickItem('merge');
  expect(harness.effects).toEqual([]);
  expect(harness.closed).toBe(false);
  expect(itemTexts()).toContain('really merge?');
  await clickItem('really merge?');
  expect(harness.effects).toEqual([{ effect: 'mr:merge', iid: 1418 }]);
  expect(harness.closed).toBe(true);
});

test('alt-click on a launch opens the note box and Enter launches with the note', async () => {
  await openMenu(ownIdle, ownEnv);
  await clickItem('review', { altKey: true });
  expect(harness.effects).toEqual([]);
  expect(menuLines()).toMatchInlineSnapshot(`
    [
      "# note for review !1418",
      "[note box]",
      "↵ launch with note · ⇧↵ newline · esc back",
    ]
  `);
  await typeNote('focus on the migration');
  expect(harness.effects).toEqual([
    { effect: 'launch:review', iid: 1418, note: 'focus on the migration' },
  ]);
  expect(harness.closed).toBe(true);
});

test('a slack mark keeps the menu open and shows its check once the reply lands', async () => {
  await openMenu(teammateReviewed, ownEnv, {
    reactionsReply: ['eyes', 'white_check_mark'],
  });
  await clickItem('mark as looking');
  await flush();
  expect(harness.effects).toEqual([{ effect: 'react:eyes:false', iid: 1419 }]);
  expect(harness.closed).toBe(false);
  expect(
    itemTexts().some(t => t.includes('unmark looking') && t.endsWith('✓'))
  ).toBe(true);
});
