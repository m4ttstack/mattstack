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

/** How long the state line's state has held: the last heartbeat for a
    signed-in buddy, the sign-out for one that left. */
export function stateSince(
  b: { status: BuddyStatus; lastSeenAt: number; signedOutAt?: number },
  now: number
): string {
  const at =
    b.status === 'offline' && b.signedOutAt !== undefined
      ? b.signedOutAt
      : b.lastSeenAt;
  return formatElapsed(now - at);
}
