import type { AgentStatus, BuddyStatus } from '@mattstack/rt-client';

import { formatElapsed } from './statusDetail';

/** What a human acts on: an agent waiting on them, one at work, one that
    finished its turn, one that has left. herdr's per-pane state is the
    source when the buddy has a pane; presence fills in when it does not. */
export type AgentState = 'blocked' | 'working' | 'done' | 'offline';

export const AGENT_STATE_WORD: Record<AgentState, string> = {
  blocked: 'Waiting on you',
  working: 'Working',
  done: 'Done',
  offline: 'Signed out',
};

/** Display order wherever agents are grouped or counted by state. */
export const AGENT_STATE_ORDER: AgentState[] = [
  'blocked',
  'working',
  'done',
  'offline',
];

export function agentState(b: {
  status: BuddyStatus;
  agentStatus?: AgentStatus;
}): AgentState {
  if (b.status === 'offline') return 'offline';
  switch (b.agentStatus) {
    case 'blocked':
      return 'blocked';
    case 'working':
      return 'working';
    case 'done':
    case 'idle':
      return 'done';
    default:
      return b.status === 'live' ? 'working' : 'done';
  }
}

const HERDR_DEFAULT_TAB_LABEL = /^\d+$/;

/** `workspace › tab`, where the agent's pane lives in herdr. herdr labels an
    unnamed tab with its number, which says nothing a person can find, so
    that label is dropped and the workspace stands alone. */
export function paneLocation(b: {
  paneWorkspace?: string;
  paneTab?: string;
}): string | undefined {
  if (!b.paneWorkspace) return undefined;
  const tab = b.paneTab?.trim();
  return tab && !HERDR_DEFAULT_TAB_LABEL.test(tab)
    ? `${b.paneWorkspace} › ${tab}`
    : b.paneWorkspace;
}

/** The state word, and for an agent that left, how long ago. A signed-in
    agent carries no age: its only timestamp is the last presence heartbeat,
    which says nothing about how long herdr's live state has held. */
export function stateLine(
  b: {
    status: BuddyStatus;
    agentStatus?: AgentStatus;
    signedOutAt?: number;
  },
  now: number
): string {
  const state = agentState(b);
  if (state === 'offline' && b.signedOutAt !== undefined) {
    return `${AGENT_STATE_WORD.offline} · ${formatElapsed(now - b.signedOutAt)} ago`;
  }
  return AGENT_STATE_WORD[state];
}

/** Parity anchor: lib/chat-room-name.ts's `slugifyChatName`, the rule rt
    names repo rooms with. */
function slugifyChatName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return slug || 'x';
}

/** Whether `room` is the room rt derives for `repo`: the slugified label,
    or a path-kind repo's two-segment form ending in it (`pool-gamma` for
    `gamma`, lib/chat-room.ts). Without the repo's identity the suffix rule
    also matches an unrelated room ending in `-<repo>` (`acme-api` for
    `api`); that only hides a chip, never shows a wrong one. */
export function isRoomForRepo(room: string, repo: string): boolean {
  const slug = slugifyChatName(repo);
  return room === slug || room.endsWith(`-${slug}`);
}
