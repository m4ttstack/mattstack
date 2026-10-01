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

type SeenRow = {
  status: BuddyStatus;
  lastSeenAt: number;
  signedOutAt?: number;
};

/** The age presence can vouch for: the last heartbeat (sign-in or a
    delivery) for a signed-in buddy, the sign-out for one that left. It is
    not how long herdr's state has held; herdr reports no such time. */
export function seenElapsed(b: SeenRow, now: number): string {
  const at =
    b.status === 'offline' && b.signedOutAt !== undefined
      ? b.signedOutAt
      : b.lastSeenAt;
  return formatElapsed(now - at);
}

/** `seen 3m ago`, or `13m ago` after a sign-out word. */
export function seenAgo(b: SeenRow, now: number): string {
  const elapsed = seenElapsed(b, now);
  return b.status === 'offline' ? `${elapsed} ago` : `seen ${elapsed} ago`;
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
