import { expect, test } from 'bun:test';

import { bulkActions, rowActions } from '../row-actions.ts';
import {
  actionEnvOf,
  busyEnv,
  failedEnv,
  failedLanes,
  mrx,
  ownBusy,
  ownEnv,
  ownIdle,
  teammateReviewed,
} from './menu-fixtures.ts';
import { MENU_STATES } from './menu-states.ts';

const keys = (mr: typeof ownIdle, env: typeof ownEnv) =>
  rowActions(mr, actionEnvOf(env, mr)).map(a => a.key);

const sections = (mr: typeof ownIdle, env: typeof ownEnv) =>
  rowActions(mr, actionEnvOf(env, mr)).map(a => `${a.section}:${a.key}`);

test('an idle own MR: every action, by section, in menu order', () => {
  expect(sections(ownIdle, ownEnv)).toEqual([
    'top:post-slack',
    'agent:review',
    'agent:respond',
    'agent:rebase-local',
    'agent:request-review',
    'gitlab:merge',
    'gitlab:rebase',
    'gitlab:setAutoMerge',
    'gitlab:mark-draft',
    'gitlab:open-gitlab',
    'slack:open-slack-post',
    'slack:copy',
    'more:note',
    'more:stand-down',
  ]);
});

test('an idle own MR blocks what its state cannot run, and hides session rows with nothing to act on', () => {
  const blocked = Object.fromEntries(
    rowActions(ownIdle, actionEnvOf(ownEnv, ownIdle))
      .filter(a => a.blocked)
      .map(a => [a.key, a.blocked])
  );
  expect(blocked).toEqual({ 'open-slack-post': 'no thread' });
});

test("a teammate's reviewed MR with a found thread", () => {
  expect(sections(teammateReviewed, ownEnv)).toEqual([
    'top:react-eyes',
    'top:react-speech_balloon',
    'top:unreact-white_check_mark',
    'agent:re-review',
    'agent:ask-respond',
    'sessions:review',
    'sessions:resume-review',
    'sessions:view-review',
    'gitlab:open-gitlab',
    'slack:open-slack-post',
    'slack:copy',
    'more:note',
  ]);
});

test('a remote board drops local-only rows and says why', () => {
  const actions = rowActions(
    ownIdle,
    actionEnvOf({ ...ownEnv, local: false }, ownIdle)
  );
  expect(actions.map(a => `${a.section}:${a.key}`)).toEqual([
    'agent:local-hint',
    'gitlab:open-gitlab',
    'slack:copy',
    'more:note',
  ]);
  expect(actions[0]?.blocked).toBe('need a local board');
});

test('follow-up review is the primary; a fresh review sits under sessions', () => {
  // Reviewed only on GitLab: a plain review, nothing to confirm.
  const mr = MENU_STATES['own broken']!.mr;
  const actions = rowActions(mr, actionEnvOf(ownEnv, mr));
  expect(actions.find(a => a.key === 're-review')?.section).toBe('agent');
  const fresh = actions.find(a => a.key === 'review');
  expect(fresh?.section).toBe('sessions');
  expect(fresh?.label).toBe('review');
  expect(fresh?.redo).toBeUndefined();
  // The board's own finished review: redo, which asks first.
  const done = { ...mr, review: { status: 'done' as const } };
  const redo = rowActions(done, actionEnvOf(ownEnv, done)).find(
    a => a.key === 'review'
  );
  expect(redo).toMatchObject({ label: 'redo review', redo: 'review' });
});

test('each lane shows exactly one primary row in agent, in every state', () => {
  const REVIEW = new Set(['review', 're-review', 'focus-review']);
  const RESPOND = new Set(['respond', 'focus-respond']);
  for (const [name, { mr, env }] of Object.entries(MENU_STATES)) {
    if (env.local === false) continue;
    const agent = rowActions(mr, actionEnvOf(env, mr)).filter(
      a => a.section === 'agent'
    );
    expect([name, agent.filter(a => REVIEW.has(a.key)).length]).toEqual([
      name,
      1,
    ]);
    const own = env.self !== null && mr.author.username === env.self;
    expect([name, agent.filter(a => RESPOND.has(a.key)).length]).toEqual([
      name,
      own ? 1 : 0,
    ]);
  }
});

test('every blocked row carries a reason', () => {
  for (const { mr, env } of Object.values(MENU_STATES))
    for (const a of rowActions(mr, actionEnvOf(env, mr)))
      if ('blocked' in a)
        expect(typeof a.blocked === 'string' && a.blocked.length > 0).toBe(
          true
        );
});

test('a draft blocks merge and auto-merge, and offers mark ready', () => {
  const mr = MENU_STATES['own draft']!.mr;
  const by = Object.fromEntries(
    rowActions(mr, actionEnvOf(ownEnv, mr)).map(a => [a.key, a])
  );
  expect(by.merge?.blocked).toBe('draft');
  expect(by.setAutoMerge?.blocked).toBe('draft');
  expect(by['mark-ready']?.blocked).toBeUndefined();
  expect(by.rebase?.blocked).toBe('up to date');
});

test('a draft with auto-merge armed offers cancel auto-merge, unblocked', () => {
  const armedDraft = mrx(1418, {
    isDraft: true,
    mergeButton: { visible: false, disabled: false, loading: false },
    autoMergeButton: { visible: false, isActive: true },
  });
  const by = Object.fromEntries(
    rowActions(armedDraft, actionEnvOf(ownEnv, armedDraft)).map(a => [a.key, a])
  );
  expect(by.setAutoMerge).toBeUndefined();
  expect(by.cancelAutoMerge).toBeDefined();
  expect(by.cancelAutoMerge?.blocked).toBeUndefined();
  expect(by.merge?.blocked).toBe('draft');

  const armed = mrx(1419, {
    autoMergeButton: { visible: true, isActive: true },
  });
  const bulk = bulkActions(
    [armed, armedDraft],
    actionEnvOf(ownEnv, armed)
  ).find(e => e.key === 'cancelAutoMerge');
  expect(bulk?.targets.map(t => t.iid)).toEqual([1419, 1418]);
});

test('a running merge and rebase say so', () => {
  const mr = mrx(1418, {
    mergeButton: { visible: true, disabled: true, loading: true },
    rebaseButton: { visible: true, loading: true },
    autoMergeButton: { visible: true, isActive: false },
  });
  const by = Object.fromEntries(
    rowActions(mr, actionEnvOf(ownEnv, mr)).map(a => [a.key, a])
  );
  expect(by.merge?.blocked).toBe('merging');
  expect(by.rebase?.blocked).toBe('rebasing');
});

test('merge and auto-merge stay blocked while glance hides their buttons', () => {
  const mr = mrx(1418, {
    mergeButton: { visible: false, disabled: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
  });
  const by = Object.fromEntries(
    rowActions(mr, actionEnvOf(ownEnv, mr)).map(a => [a.key, a])
  );
  expect(by.merge?.blocked).toBe('not mergeable yet');
  expect(by.setAutoMerge?.blocked).toBe('not mergeable yet');
});

test("gitlab rows follow glance's buttons", () => {
  const armed = mrx(1418, {
    autoMergeButton: { visible: true, isActive: true },
  });
  const armedKeys = rowActions(armed, actionEnvOf(ownEnv, armed)).map(
    a => a.key
  );
  expect(armedKeys).toContain('cancelAutoMerge');
  expect(armedKeys).not.toContain('setAutoMerge');
  const raised = mrx(1418, {
    mergeButton: { visible: true, disabled: true, loading: false },
    statusDetail: 'ci_still_running',
    rebaseButton: { visible: true, loading: false },
    behindTarget: 0,
  });
  const by = Object.fromEntries(
    rowActions(raised, actionEnvOf(ownEnv, raised)).map(a => [a.key, a])
  );
  expect(by.rebase).toBeDefined();
  expect(by.rebase?.blocked).toBeUndefined();
  expect(by.merge?.blocked).toBe('pipeline running');
});

test('a null behind count leaves rebase on target enabled', () => {
  const mr = mrx(1418, { behindTarget: null });
  const rebase = rowActions(mr, actionEnvOf(ownEnv, mr)).find(
    a => a.key === 'rebase'
  );
  expect(rebase).toBeDefined();
  expect(rebase?.blocked).toBeUndefined();
});

test('auto-doctor ignore is blocked when triage is off and no doctor runs', () => {
  const off = rowActions(
    ownIdle,
    actionEnvOf({ ...ownEnv, triageEnabled: false }, ownIdle)
  );
  expect(off.find(a => a.key === 'stand-down')?.blocked).toBe(
    'auto-doctor is off'
  );
  const running = mrx(1418, { doctor: { status: 'diagnosing' } });
  const live = rowActions(
    running,
    actionEnvOf({ ...ownEnv, triageEnabled: false }, running)
  );
  expect(live.find(a => a.key === 'stand-down')?.blocked).toBeUndefined();
  const unknown = rowActions(ownIdle, actionEnvOf(ownEnv, ownIdle));
  expect(unknown.find(a => a.key === 'stand-down')?.blocked).toBeUndefined();
  const stood = mrx(1418, { standDown: true });
  const reenable = rowActions(
    stood,
    actionEnvOf({ ...ownEnv, triageEnabled: false }, stood)
  );
  expect(reenable.find(a => a.key === 'stand-down')?.blocked).toBeUndefined();
});

test("a teammate's MR without my commented review blocks the respond ask", () => {
  const mr = MENU_STATES['teammate fresh']!.mr;
  const ask = rowActions(mr, actionEnvOf(ownEnv, mr)).find(
    a => a.key === 'ask-respond'
  );
  expect(ask?.label).toBe("ask kim's agent to respond");
  expect(ask?.blocked).toBe('no finished review with comments');
});

test('the respond ask names an author whose board takes no asks', () => {
  const ask = rowActions(
    teammateReviewed,
    actionEnvOf({ ...ownEnv, peers: ['pat'] }, teammateReviewed)
  ).find(a => a.key === 'ask-respond');
  expect(ask?.blocked).toBe("author's board isn't taking asks");
});

test('an outstanding ask blocks request review and leaves no re-review placeholder', () => {
  const mr = mrx(1418, {
    sentNudge: { display: 'requested', reviewer: 'kim' },
  });
  const by = Object.fromEntries(
    rowActions(mr, actionEnvOf(ownEnv, mr)).map(a => [a.key, a])
  );
  expect(by['request-review']?.blocked).toBe('ask already sent');
  expect(by['nudge-none']).toBeUndefined();
});

test('a teammate respond report and a live teammate lane error stay reachable', () => {
  const mr = mrx(1430, {
    author: { username: 'kim', name: 'Kim' },
    respond: { status: 'error', reportReady: true },
    doctor: { status: 'error' },
  });
  const keys = rowActions(mr, actionEnvOf(ownEnv, mr)).map(a => a.key);
  expect(keys).toContain('view-respond');
  expect(keys).toContain('dismiss-respond');
  expect(keys).toContain('dismiss-doctor');
});

test('the bulk menu never targets a blocked row and keeps its three headings', () => {
  const draft = MENU_STATES['own draft']!.mr;
  const inSlack = {
    ...ownIdle,
    slack: { status: 'found' as const, reactions: [], posted: true },
  };
  const entries = bulkActions([inSlack, draft], actionEnvOf(ownEnv, inSlack));
  expect(entries.some(e => e.key === 'setAutoMerge')).toBe(false);
  expect(new Set(entries.map(e => e.section))).toEqual(
    new Set(['agent', 'gitlab', 'slack'])
  );
});

test('only the bulk-capable actions carry a bulk label', () => {
  const bulk = Object.fromEntries(
    rowActions(ownIdle, actionEnvOf(ownEnv, ownIdle))
      .filter(a => a.bulk)
      .map(a => [a.key, a.bulk])
  );
  expect(bulk).toEqual({
    review: 'review',
    'request-review': 'request review from…',
    merge: 'merge',
    rebase: 'rebase on target',
    setAutoMerge: 'set auto-merge',
    'mark-draft': 'mark as draft',
  });
});

test('running lanes focus their pane and carry no note or bulk', () => {
  const actions = rowActions(ownBusy, actionEnvOf(busyEnv, ownBusy));
  const focusReview = actions.find(a => a.key === 'focus-review');
  expect(focusReview?.request).toEqual({
    kind: 'launch',
    flow: 'review',
    intent: 'focus',
  });
  expect(focusReview?.notable).toBeUndefined();
  expect(focusReview?.bulk).toBeUndefined();
  // The response's pane is gone: a redo, not a focus that would refuse.
  expect(actions.find(a => a.key === 'focus-respond')).toBeUndefined();
  expect(actions.find(a => a.key === 'respond')).toMatchObject({
    label: 'redo response',
    redo: 'respond',
    request: { kind: 'launch', flow: 'respond' },
  });
  expect(actions.find(a => a.key === 'doctor')).toMatchObject({
    label: 'call doctor',
    lane: 'doctor',
    notable: true,
    bulk: 'call doctor',
    request: { kind: 'launch', flow: 'doctor' },
  });
  expect(actions.find(a => a.key === 'stand-down')?.label).toBe(
    'auto-doctor: ignore this stack'
  );
});

test('merge arms before it fires; a slack mark stays open and knows its state', () => {
  const idle = rowActions(ownIdle, actionEnvOf(ownEnv, ownIdle));
  expect(idle.find(a => a.key === 'merge')?.confirm).toBe('really merge?');
  const mates = rowActions(
    teammateReviewed,
    actionEnvOf(ownEnv, teammateReviewed)
  );
  expect(mates.find(a => a.key === 'unreact-white_check_mark')).toMatchObject({
    label: 'unmark approved',
    marked: true,
    keepOpen: true,
    glyph: { kind: 'emoji', glyph: '✅' },
    request: {
      kind: 'react',
      emoji: 'white_check_mark',
      glyph: '✅',
      remove: true,
    },
  });
});

test('request review from… carries its picker; asks name their reviewer', () => {
  const actions = rowActions(failedLanes, actionEnvOf(failedEnv, failedLanes));
  expect(actions.find(a => a.key === 'request-review')).toMatchObject({
    request: { kind: 'ask', ask: 'review' },
    pick: {
      title: 'request review from',
      aria: 'request review',
      options: [{ value: 'jo' }],
    },
  });
  expect(actions.find(a => a.key === 'nudge-kim')?.request).toEqual({
    kind: 'ask',
    ask: 're-review',
    reviewer: 'kim',
  });
  const dismiss = actions.filter(a => a.key.startsWith('dismiss-'));
  expect(dismiss.map(a => a.key)).toEqual(['dismiss-review', 'dismiss-doctor']);
  expect(dismiss.some(a => a.blocked)).toBe(false);
});

const visible = { visible: true, disabled: false, loading: false };
const env3 = (allMrs: ReturnType<typeof mrx>[]) => ({
  local: true,
  slackEnabled: true,
  self: 'pat',
  roster: ['pat', 'kim', 'jo'],
  allMrs,
});
const a = mrx(201, { mergeButton: visible, behindTarget: 2 });
const b = mrx(202, { mergeButton: visible, isDraft: true });
const c = mrx(203, {
  author: { username: 'kim', name: 'Kim' },
  blockers: { any: true, pipelineFailing: true },
});

test('bulk shows only what fits every checked MR, in the mock order, with no counts', () => {
  const entries = bulkActions([a, b, c], env3([a, b, c]));
  expect(entries.map(e => `${e.key} | ${e.label}`)).toEqual([
    'review | review',
  ]);
  expect(entries.every(e => e.hint === undefined)).toBe(true);
});

test('an action acts on the MRs that need it and skips the ones already there', () => {
  const entries = bulkActions([a, b, c], env3([a, b, c]));
  const byKey = Object.fromEntries(
    entries.map(e => [e.key, e.targets.map(t => t.iid)])
  );
  expect(byKey.review).toEqual([201, 202, 203]);
  expect(entries.every(e => e.selected === 3)).toBe(true);
  const mine = bulkActions([a, b], env3([a, b]));
  expect(mine.find(e => e.key === 'rebase')?.targets.map(t => t.iid)).toEqual([
    201,
  ]);
});

test('bulk rebase skips an MR whose behind count is unknown', () => {
  const behind = mrx(301, { behindTarget: 2 });
  const unknown = mrx(302, { behindTarget: null });
  const rebase = bulkActions([behind, unknown], env3([behind, unknown])).find(
    e => e.key === 'rebase'
  );
  expect(rebase?.targets.map(t => t.iid)).toEqual([301]);
});

test('one checked MR that cannot take an action hides it', () => {
  const keys = bulkActions([a, b, c], env3([a, b, c])).map(e => e.key);
  for (const k of ['merge', 'request-review', 'mark-ready', 'mark-draft'])
    expect(keys).not.toContain(k);
});

test('merge always confirms; launches confirm only past three', () => {
  const m1 = mrx(211, { mergeButton: visible });
  const m2 = mrx(212, { mergeButton: visible });
  const m3 = mrx(218, { mergeButton: visible });
  const four = [a, m1, m2, m3];
  const entries = bulkActions(four, env3(four));
  expect(entries.find(e => e.key === 'merge')?.confirm).toBe('really merge 4?');
  expect(entries.find(e => e.key === 'review')?.confirm).toBe(
    'really start 4 reviews?'
  );
  const three = bulkActions([a, b, m1], env3([a, b, m1]));
  expect(three.find(e => e.key === 'review')?.confirm).toBeUndefined();
});

test('nothing fits when no checked MR needs any bulk action', () => {
  const running = (iid: number) =>
    mrx(iid, {
      author: { username: 'kim', name: 'Kim' },
      review: { status: 'reviewing' },
    });
  const r1 = running(214);
  const r2 = running(215);
  const env = { ...env3([r1, r2]), slackEnabled: false };
  expect(bulkActions([r1, r2], env)).toEqual([]);
});

test('a remote board has no bulk actions', () => {
  expect(bulkActions([a, b], { ...env3([a, b]), local: false })).toEqual([]);
});

test('a checked MR stacked on an open MR blocks merge for the selection', () => {
  const child = mrx(205, {
    isStacked: true,
    targetBranch: 'f-201',
    mergeButton: visible,
  });
  const sibling = mrx(219, { mergeButton: visible });
  const all = [a, b, c, sibling, child];
  const blocked = bulkActions([sibling, child], env3(all)).find(
    e => e.key === 'merge'
  );
  expect(blocked?.blocked).toBe('!205 sits on !201, which is still open');
  const parentGone = bulkActions(
    [sibling, child],
    env3([b, c, sibling, child])
  ).find(e => e.key === 'merge');
  expect(parentGone?.blocked).toBeUndefined();
});

test('mark wins over unmark until every checked thread has the mark', () => {
  const found = (iid: number, reactions: string[]) =>
    mrx(iid, { slack: { status: 'found', reactions, posted: true } });
  const e = found(206, ['eyes']);
  const f = found(207, []);
  const mixed = bulkActions([e, f], env3([e, f])).map(x => x.key);
  expect(mixed).toContain('react-eyes');
  expect(mixed).not.toContain('unreact-eyes');
  expect(
    bulkActions([e, f], env3([e, f]))
      .find(x => x.key === 'react-eyes')
      ?.targets.map(t => t.iid)
  ).toEqual([207]);
  const g = found(208, ['eyes']);
  const both = bulkActions([e, g], env3([e, g]));
  expect(both.find(x => x.key === 'unreact-eyes')?.label).toBe(
    'unmark looking'
  );
  expect(both.map(x => x.key)).not.toContain('react-eyes');
});

test('a checked MR with no slack thread hides the marks', () => {
  const found = mrx(216, {
    slack: { status: 'found', reactions: [], posted: true },
  });
  const missing = mrx(217, {
    slack: { status: 'notfound', reactions: [], posted: false },
  });
  const entries = bulkActions([found, missing], env3([found, missing]));
  expect(entries.filter(x => x.key.includes('react-'))).toEqual([]);
  expect(entries.map(x => x.key)).not.toContain('find-thread');
});

test('bulk slack marks follow the ladder, not first-seen order', () => {
  const found = (iid: number, reactions: string[]) =>
    mrx(iid, { slack: { status: 'found', reactions, posted: true } });
  const h = found(209, ['eyes']);
  const i = found(210, []);
  const slackKeys = bulkActions([h, i], env3([h, i]))
    .filter(e => e.section === 'slack')
    .map(e => e.key);
  expect(slackKeys).toEqual([
    'react-eyes',
    'react-speech_balloon',
    'react-white_check_mark',
  ]);
});

test('request review from… lists each person once, asked only where they are not already on it', () => {
  const entry = bulkActions([a, b], env3([a, b])).find(
    e => e.key === 'request-review'
  );
  expect(entry?.pick?.options).toEqual([{ value: 'kim' }, { value: 'jo' }]);
  expect(entry?.pickTargets?.get('kim')?.map(t => t.iid)).toEqual([201, 202]);
  const kimOn = mrx(213, {
    peerReviews: [
      {
        mrUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/213',
        iid: 213,
        reviewer: 'kim',
        status: 'reviewing',
        updatedAt: 1,
      },
    ],
  });
  const mixed = bulkActions([a, kimOn], env3([a, kimOn])).find(
    e => e.key === 'request-review'
  );
  expect(mixed?.pickTargets?.get('kim')?.map(t => t.iid)).toEqual([201]);
  expect(mixed?.pickTargets?.get('jo')?.map(t => t.iid)).toEqual([201, 213]);
});

test('one-row-only actions never reach the bulk menu', () => {
  const keys = bulkActions([a, b, c], env3([a, b, c])).map(e => e.key);
  for (const k of [
    'respond',
    'rebase-local',
    'stand-down',
    'open-gitlab',
    'post-slack',
    'copy',
    'note',
  ])
    expect(keys).not.toContain(k);
});

const AUTHOR_ONLY = [
  'merge',
  'rebase',
  'setAutoMerge',
  'cancelAutoMerge',
  'doctor',
  'focus-doctor',
  'rebase-local',
  'respond',
  'focus-respond',
  'resume-respond',
  'post-slack',
];

const brokenAndMergeable = (over: Record<string, unknown> = {}) =>
  mrx(230, {
    mergeButton: visible,
    rebaseButton: { visible: true, loading: false },
    behindTarget: 4,
    autoMergeButton: { visible: true, isActive: false },
    blockers: { any: true, pipelineFailing: true, hasConflicts: true },
    respond: { status: 'done', sessionId: 'resp-9' },
    slack: { status: 'notfound', reactions: [], posted: false },
    ...over,
  });

test("someone else's MR offers no author-only action", () => {
  const theirs = brokenAndMergeable({
    author: { username: 'kim', name: 'Kim' },
  });
  const offered = keys(theirs, ownEnv);
  for (const k of AUTHOR_ONLY) expect(offered).not.toContain(k);
  expect(offered).toContain('open-gitlab');
});

test("someone else's armed auto-merge cannot be cancelled from the menu", () => {
  const theirs = brokenAndMergeable({
    author: { username: 'kim', name: 'Kim' },
    autoMergeButton: { visible: true, isActive: true },
  });
  expect(keys(theirs, ownEnv)).not.toContain('cancelAutoMerge');
});

test('the same broken, mergeable MR offers every author-only action to its author', () => {
  const offered = keys(brokenAndMergeable(), ownEnv);
  for (const k of [
    'merge',
    'rebase',
    'setAutoMerge',
    'doctor',
    'rebase-local',
    'respond',
    'resume-respond',
    'post-slack',
  ])
    expect(offered).toContain(k);
});

test('an "all" board treats nothing as own', () => {
  const offered = keys(brokenAndMergeable(), { ...ownEnv, self: null });
  for (const k of AUTHOR_ONLY) expect(offered).not.toContain(k);
});

test("bulk never offers an author-only action once someone else's MR is checked", () => {
  const mine = brokenAndMergeable();
  const theirs = brokenAndMergeable({
    iid: 231,
    webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/231',
    author: { username: 'kim', name: 'Kim' },
  });
  const entries = bulkActions([mine, theirs], env3([mine, theirs]));
  for (const k of AUTHOR_ONLY) expect(entries.map(e => e.key)).not.toContain(k);
});

test('a seatless board says where author actions went, and nothing more', () => {
  const actions = rowActions(
    brokenAndMergeable(),
    actionEnvOf({ ...ownEnv, self: null }, brokenAndMergeable())
  );
  const hint = actions.find(a => a.key === 'seat-hint');
  expect(hint?.blocked).toBe(
    'set your seat in board settings to act on your own MRs'
  );
  expect(hint?.bulk).toBeUndefined();
  expect(keys(brokenAndMergeable(), ownEnv)).not.toContain('seat-hint');
  expect(
    keys(brokenAndMergeable(), { ...ownEnv, self: null, local: false })
  ).not.toContain('seat-hint');
});

const REPO = 'gitlab.example.com/acme/webapp';
const ownersEnv = { ...ownEnv, ownerSlackRepos: [REPO] };
const inOptedRepo = (over: Record<string, unknown> = {}) =>
  mrx(240, { rtRepo: REPO, ...over });

const notFound = { status: 'notfound', reactions: [], posted: false };
const found = {
  status: 'found',
  reactions: [],
  permalink: 'https://x',
  posted: true,
};
const postItem = (mr: typeof ownIdle, env: typeof ownEnv = ownersEnv) =>
  rowActions(mr, actionEnvOf(env, mr)).find(a => a.key === 'post-slack');

test('slack posting is one item: no code owners item, no find item', () => {
  for (const mr of [
    inOptedRepo({ slack: notFound }),
    inOptedRepo({ slack: found }),
    mrx(242, { slack: notFound }),
  ]) {
    const offered = keys(mr, ownersEnv);
    expect(offered.filter(k => k === 'post-slack')).toHaveLength(1);
    expect(offered).not.toContain('post-owners');
    expect(offered).not.toContain('find-thread');
  }
});

test('an own MR not yet in slack leads with post to slack', () => {
  for (const [mr, env] of [
    [inOptedRepo({ slack: notFound }), ownersEnv],
    [mrx(260, { slackChannel: 'code-review', slack: notFound }), ownEnv],
  ] as const) {
    const post = postItem(mr, env)!;
    expect(post.section).toBe('top');
    expect(post.label).toBe('post to slack');
    expect(post.blocked).toBeUndefined();
    expect(post.request).toEqual({ kind: 'post-slack' });
    expect(post.bulk).toBeUndefined();
  }
});

test('posted to only some code owners, the item offers the rest', () => {
  const post = postItem(
    inOptedRepo({ slack: found, ownerPostsLeft: ['pod-docs'] })
  )!;
  expect(post.label).toBe('post to other codeowners…');
  expect(post.section).toBe('slack');
  expect(post.blocked).toBeUndefined();
});

test('a team thread found outside the dialog still offers the other code owners', () => {
  const post = postItem(inOptedRepo({ slack: found }))!;
  expect(post.label).toBe('post to other codeowners…');
  expect(post.blocked).toBeUndefined();
});

test('posted everywhere the dialog offered, the item is blocked', () => {
  const post = postItem(inOptedRepo({ slack: found, ownerPostsLeft: [] }))!;
  expect(post.blocked).toBe('posted');
});

test('outside an opted-in repo a found thread blocks the post', () => {
  const post = postItem(mrx(261, { slack: found }), ownEnv)!;
  expect(post.label).toBe('post to slack');
  expect(post.blocked).toBe('posted');
});

test('no slack post without slack, off the local board, or on a teammate MR', () => {
  expect(
    keys(inOptedRepo(), { ...ownersEnv, slackEnabled: false })
  ).not.toContain('post-slack');
  expect(keys(inOptedRepo(), { ...ownersEnv, local: false })).not.toContain(
    'post-slack'
  );
  const theirs = inOptedRepo({ author: { username: 'kim', name: 'Kim' } });
  expect(keys(theirs, ownersEnv)).not.toContain('post-slack');
});

const topKeys = (mr: typeof ownIdle) =>
  rowActions(mr, actionEnvOf(ownEnv, mr))
    .filter(a => a.section === 'top')
    .map(a => a.key);

test('an own MR with a found thread leads with the reactions', () => {
  const mr = mrx(261, {
    slack: {
      status: 'found',
      reactions: [],
      permalink: 'https://slack.example.com/archives/C1/p2',
      posted: true,
    },
  });
  expect(topKeys(mr).every(k => k.startsWith('react-'))).toBe(true);
  expect(topKeys(mr).length).toBeGreaterThan(0);
  expect(postItem(mr, ownEnv)!.section).toBe('slack');
});

test("a teammate's MR with no thread has nothing to lead with", () => {
  const mr = mrx(262, {
    author: { username: 'kim', name: 'Kim' },
    slack: { status: 'notfound', reactions: [], posted: false },
  });
  expect(topKeys(mr)).toEqual([]);
  expect(keys(mr, ownEnv)).not.toContain('post-slack');
});

const rereviewKeys = (peers?: string[]) => {
  const reviewed = mrx(1418, {
    peerReviews: [
      { reviewer: 'tom', status: 'done', outcome: 'comment' },
      { reviewer: 'mira', status: 'done', outcome: 'comment' },
    ],
  });
  return rowActions(
    reviewed,
    actionEnvOf({ ...ownEnv, ...(peers ? { peers } : {}) }, reviewed)
  )
    .map(a => a.key)
    .filter(k => k.startsWith('nudge-'));
};

test('a teammate outside peers gets no re-review item', () => {
  expect(rereviewKeys(['tom'])).toEqual(['nudge-tom']);
});

test('without a peers list every finished reviewer is offered a re-review', () => {
  expect(rereviewKeys()).toEqual(['nudge-tom', 'nudge-mira']);
});

test('rebase locally shows only on a tab whose launch reaches a doctor skill', () => {
  const broken = MENU_STATES['own broken']!.mr;
  const on = (tab: string, tabs: string[] | undefined) =>
    rowActions(
      { ...broken, doctorSkillTabs: tabs },
      { ...actionEnvOf(ownEnv, broken), tab }
    ).map(a => a.key);
  expect(on('team', undefined)).toContain('rebase-local');
  expect(on('team', ['team'])).toContain('rebase-local');
  expect(on('team', ['other'])).not.toContain('rebase-local');
  expect(on('team', [])).not.toContain('rebase-local');
});

test('call doctor says what it does at the api tier', () => {
  const broken = MENU_STATES['own broken']!.mr;
  const doctor = rowActions(
    broken,
    actionEnvOf({ ...ownEnv, doctorTier: 'api' }, broken)
  ).find(a => a.key === 'doctor');
  expect(doctor?.label).toBe('call doctor (CI only)');
  expect(doctor?.bulk).toBe('call doctor (CI only)');
});

test('a running doctor whose pane is gone offers redo, not focus', () => {
  const mr = mrx(2101, {
    blockers: { any: true, pipelineFailing: true },
    doctor: { status: 'watching' },
    orphan: { state: 'gone' } as never,
  });
  const actions = rowActions(mr, actionEnvOf(ownEnv, mr));
  expect(actions.find(a => a.key === 'focus-doctor')).toBeUndefined();
  expect(actions.find(a => a.key === 'doctor')).toMatchObject({
    label: 'redo doctor',
    redo: 'doctor',
  });
});

test("a gone pane on a row with a running review stays the review's", () => {
  const mr = mrx(2102, {
    blockers: { any: true, pipelineFailing: true },
    review: { status: 'reviewing' },
    doctor: { status: 'watching' },
    orphan: { state: 'gone' } as never,
  });
  const actions = rowActions(mr, actionEnvOf(ownEnv, mr));
  expect(actions.find(a => a.key === 'focus-doctor')?.label).toBe(
    'focus doctor'
  );
});

test("a stale pane from another run never reads as the doctor's", () => {
  const mr = mrx(2103, {
    blockers: { any: true, pipelineFailing: true },
    doctor: { status: 'watching', agentId: 'doc-1' },
    orphan: { state: 'gone', agentId: 'old-review' } as never,
  });
  const actions = rowActions(mr, actionEnvOf(ownEnv, mr));
  expect(actions.find(a => a.key === 'focus-doctor')?.label).toBe(
    'focus doctor'
  );
  const dead = {
    ...mr,
    orphan: { state: 'gone', agentId: 'doc-1' } as never,
  };
  expect(
    rowActions(dead, actionEnvOf(ownEnv, dead)).find(a => a.key === 'doctor')
      ?.label
  ).toBe('redo doctor');
});
