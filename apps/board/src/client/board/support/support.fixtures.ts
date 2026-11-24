import type { SupportPart } from '@mattstack/rt-client';
import type { SupportRead } from '../../../support.ts';
import type { HelpMr, HelpRequest } from './support-model.ts';

export const NOW = 1_795_500_000_000;

export const READY: SupportRead = {
  availability: {
    state: 'ready',
    host: 'Alex Moreau',
    away: false,
    persona: 'Maude',
  },
  persona: 'Maude',
  hostDm: 'https://slack.com/app_redirect?channel=U0ALEX',
};

export const AWAY: SupportRead = {
  ...READY,
  availability: {
    state: 'ready',
    host: 'Alex Moreau',
    away: true,
    persona: 'Maude',
  },
};

export const NO_SLACK: SupportRead = {
  ...READY,
  availability: {
    state: 'disabled',
    reason: 'Connect Slack first',
    host: 'Alex Moreau',
    persona: 'Maude',
  },
};

export const VERSIONS: SupportPart = {
  key: 'versions',
  label: 'Versions',
  value: 'rt 2.41.0, app 2.41.0, board 0.1.8, macOS 26.1',
};

export const SETUP: SupportPart = {
  key: 'setup',
  label: 'Setup rows that need attention',
  value: 'accounts.slack',
};

export const MR: HelpMr = {
  url: 'https://gitlab.example.com/acme/shop/-/merge_requests/1374',
  ref: '!1374',
  state: 'needs review',
};

export const MR_PART: SupportPart = {
  key: 'mr',
  label: 'MR',
  value: `${MR.url} (${MR.state})`,
};

export const WORDS = 'The board shows no rows after I joined the team.';
export const MORE_WORDS = `${WORDS} It says synced, and reloading does nothing.`;

export function request(
  state: HelpRequest['state'],
  extra: Partial<HelpRequest> = {}
): HelpRequest {
  return {
    id: `req-${state}`,
    direction: 'out',
    peer: 'alex',
    org: 'git.example.com/acme/mattstack',
    text: WORDS,
    parts: [VERSIONS],
    slackUserId: 'U0ADA',
    state,
    reason: null,
    persona: 'Maude',
    dmLink: null,
    conversationId: null,
    gateId: null,
    statusAt: NOW,
    sentAt: NOW,
    receivedAt: NOW,
    updatedAt: NOW,
    away: false,
    ...extra,
  };
}

export const DM = 'slack://user?team=T0ACME&id=U0ALEX';
