import {
  ORIGIN_PANE_CLOSED_REASON,
  resolveOriginFocus,
} from '@mattstack/gate-kit/server';
import type { GateOrigin } from '@mattstack/rt-client';

export interface FocusLane {
  paneId?: string;
  tabId?: string;
}

export type GateFocusTarget =
  { ok: true; paneId?: string; tabId?: string } | { ok: false; reason: string };

/** Where "focus pane" on a gate should land. The origin pane wins while it
    is live; once it has closed, the MR's current board lane (a re-review or
    respond pane launched since) stands in, then any live pane in the origin
    worktree. `livePanes` null means the pane list could not be read, so the
    stored ids are the best guess left. A dead origin's ids are never handed
    back: herdr only answers them with a raw not-found error. */
export function resolveGateFocusTarget(
  origin: GateOrigin | undefined,
  livePanes: Array<{ paneId: string; cwd?: string }> | null,
  lanes: FocusLane[]
): GateFocusTarget {
  const isLive = (paneId: string) =>
    livePanes?.some(p => p.paneId === paneId) ?? false;

  if (origin?.paneId && (livePanes === null || isLive(origin.paneId))) {
    return origin.tabId !== undefined
      ? { ok: true, paneId: origin.paneId, tabId: origin.tabId }
      : { ok: true, paneId: origin.paneId };
  }

  const lane = lanes.find(l => l.paneId && isLive(l.paneId));
  if (lane?.paneId) {
    return lane.tabId
      ? { ok: true, paneId: lane.paneId, tabId: lane.tabId }
      : { ok: true, paneId: lane.paneId };
  }

  if (origin?.worktree) {
    if (livePanes === null)
      return {
        ok: false,
        reason: 'could not list panes to match the origin worktree',
      };
    const byWorktree = resolveOriginFocus(
      { worktree: origin.worktree },
      livePanes
    );
    if (byWorktree.ok) return byWorktree;
  }

  if (origin?.paneId) return { ok: false, reason: ORIGIN_PANE_CLOSED_REASON };
  if (origin?.worktree)
    return { ok: false, reason: 'no live pane matches the origin worktree' };
  return { ok: false, reason: 'no origin on this gate' };
}
