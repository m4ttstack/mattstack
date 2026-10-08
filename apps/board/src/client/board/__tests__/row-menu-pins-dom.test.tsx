/** Pins of the one-row menu: what each MR state shows at the top level, and
    what each click does, flyout rows included. A row may move between the
    top level and a flyout; a click row may never go missing. */
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
      "post to slack",
      "---",
      "# agent actions",
      "review",
      "respond",
      "rebase locally",
      "> request review from…",
      "---",
      "> gitlab",
      "> slack",
      "> more",
    ]
  `);
  expect(await clickEach(ownIdle, ownEnv)).toMatchInlineSnapshot(`
    [
      "post to slack → post-slack",
      "review → launch:review",
      "respond → launch:respond",
      "rebase locally → launch:rebase-local",
      "kim → ask:review:kim",
      "jo → ask:review:jo",
      "merge → mr:merge",
      "rebase on target → mr:rebase",
      "set auto-merge → mr:setAutoMerge",
      "mark as draft → draft:true",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1418",
      "open MR post in slackno thread → (nothing) (stays open)",
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
      "[mark as looking | mark as commented | unmark approved]",
      "---",
      "# agent actions",
      "follow-up review",
      "ask kim's agent to respond",
      "---",
      "> all agent actions",
      "open in gitlab",
      "> slack",
      "add a note",
    ]
  `);
  expect(await clickEach(teammateReviewed, ownEnv)).toMatchInlineSnapshot(`
    [
      "mark as looking → react:eyes:false (stays open)",
      "mark as commented → react:speech_balloon:false (stays open)",
      "unmark approved → react:white_check_mark:true (stays open)",
      "follow-up review → launch:re-review",
      "ask kim's agent to respond → ask:respond:kim",
      "redo review → launch:review",
      "resume review → launch:resume-review",
      "view agent review → view-report:review",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1419",
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
      "redo response",
      "call doctor",
      "> request review from…",
      "---",
      "> all agent actions",
      "> gitlab",
      "copy for slack",
      "> more",
    ]
  `);
  expect(await clickEach(ownBusy, busyEnv)).toMatchInlineSnapshot(`
    [
      "focus review → launch:review:focus",
      "redo response → launch:respond",
      "call doctor → launch:doctor",
      "kim → ask:review:kim",
      "jo → ask:review:jo",
      "resume review → launch:resume-review",
      "resume response → launch:resume-respond",
      "mergedraft → (nothing) (stays open)",
      "rebase on targetup to date → (nothing) (stays open)",
      "set auto-mergedraft → (nothing) (stays open)",
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
      "post to slack",
      "---",
      "# agent actions",
      "review",
      "redo response",
      "call doctor",
      "rebase locally",
      "> request review from…",
      "---",
      "> all agent actions",
      "> gitlab",
      "> slack",
      "> more",
    ]
  `);
  expect(await clickEach(failedLanes, failedEnv)).toMatchInlineSnapshot(`
    [
      "post to slack → post-slack",
      "review → launch:review",
      "redo response → launch:respond",
      "call doctor → launch:doctor",
      "rebase locally → launch:rebase-local",
      "jo → ask:review:jo",
      "resume response → launch:resume-respond",
      "dismiss review line → dismiss:review",
      "dismiss doctor line → dismiss:doctor",
      "ask kim's agent to re-review → ask:re-review:kim",
      "mergenot mergeable yet → (nothing) (stays open)",
      "rebase on targetup to date → (nothing) (stays open)",
      "set auto-mergenot mergeable yet → (nothing) (stays open)",
      "mark as draft → draft:true",
      "open in gitlab → open:https://gitlab.example.com/acme/webapp/-/merge_requests/1422",
      "open MR post in slackno thread → (nothing) (stays open)",
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
      "agent actionsneed a local board",
      "---",
      "open in gitlab",
      "copy for slack",
      "add a note",
    ]
  `);
  expect(await clickEach(ownIdle, env)).toMatchInlineSnapshot(`
    [
      "agent actionsneed a local board → (nothing) (stays open)",
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
  const looking = [...document.querySelectorAll('[role="menuitem"]')].find(
    el => el.getAttribute('aria-label') === 'unmark looking'
  );
  expect(looking?.textContent?.endsWith('✓')).toBe(true);
});
