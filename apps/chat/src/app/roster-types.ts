import type { AgentStatus, BuddyStatus, PresenceRow } from '@mattstack/rt-client';

/** `/api/chat/buddies`' own shape: the daemon's `PresenceRow` plus the
    status it joins on, the room tags `chat.ts`'s handler inverts from a
    `who` call per room, and the live herdr pane `chat.ts` joins in by
    session id (title, workspace and tab labels, herdr's agent state) --
    `PresenceRow` itself has no such fields since rt-client cannot see herdr
    panes. A buddy with no pane carries none of the four. */
export type RosterBuddy = PresenceRow & {
  status: BuddyStatus;
  rooms: string[];
  paneTitle?: string;
  paneWorkspace?: string;
  paneTab?: string;
  agentStatus?: AgentStatus;
};
