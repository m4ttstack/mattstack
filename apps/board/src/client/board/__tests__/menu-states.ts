import type { BoardMRWithReview } from '../../types.ts';
import {
  busyEnv,
  failedEnv,
  failedLanes,
  type MenuEnv,
  mrx,
  ownBusy,
  ownEnv,
  ownIdle,
  ROSTER,
  teammateReviewed,
} from './menu-fixtures.ts';

const FOUND = {
  status: 'found',
  reactions: [] as string[],
  permalink: 'https://slack.example.com/archives/C1/p2',
  posted: true,
};

/** The MR states the row menu is checked against: a role (own, teammate,
    remote, seatless, Slack off) crossed with the lane and GitLab state that
    changes what the menu offers. */
export const MENU_STATES: Record<
  string,
  { mr: BoardMRWithReview; env: MenuEnv }
> = {
  'own fresh': {
    mr: mrx(2001, {
      mergeButton: { visible: true, disabled: false, loading: false },
      autoMergeButton: { visible: true, isActive: false },
      behindTarget: 0,
      slack: FOUND,
    }),
    env: ownEnv,
  },
  'own mid-flow': {
    mr: mrx(2002, {
      mergeButton: { visible: true, disabled: true, loading: false },
      autoMergeButton: { visible: true, isActive: true },
      behindTarget: 3,
      review: { status: 'reviewing', sessionId: 'rev-9' },
      respond: { status: 'done', sessionId: 'resp-9', reportReady: true },
      slack: { ...FOUND, reactions: ['eyes'] },
    }),
    env: ownEnv,
  },
  'own broken': {
    mr: mrx(2003, {
      blockers: { any: true, pipelineFailing: true, hasConflicts: true },
      reviews: { isApproved: false, required: 0, given: 1, reviewers: [] },
      respond: { status: 'error', sessionId: 'resp-8' },
      slack: FOUND,
    }),
    env: ownEnv,
  },
  'own no thread': { mr: ownIdle, env: ownEnv },
  'own draft': {
    mr: mrx(2004, { isDraft: true, behindTarget: 0, slack: FOUND }),
    env: ownEnv,
  },
  'own busy draft': { mr: ownBusy, env: busyEnv },
  'own failed lanes': { mr: failedLanes, env: failedEnv },
  teammate: { mr: teammateReviewed, env: ownEnv },
  'teammate fresh': {
    mr: mrx(2005, { author: { username: 'kim', name: 'Kim' }, slack: FOUND }),
    env: ownEnv,
  },
  remote: { mr: ownIdle, env: { ...ownEnv, local: false } },
  seatless: {
    mr: ownIdle,
    env: { self: null, slackEnabled: true, roster: ROSTER },
  },
  'slack off': { mr: ownIdle, env: { ...ownEnv, slackEnabled: false } },
};
