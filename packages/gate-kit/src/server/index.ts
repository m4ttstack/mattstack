import { realpathSync } from 'node:fs';

// GateOrigin is not yet on /gate (RT-180); migrate this line once it lands.
// eslint-disable-next-line no-restricted-imports
import type { GateOrigin } from '@mattstack/rt-client';

export type FocusResolution =
  { ok: true; paneId: string; tabId?: string } | { ok: false; reason: string };

/** Normalizes a path before comparing an origin's worktree against a live
    pane's cwd: a trailing slash, or any symlink either side reports in a
    different form (origin.worktree comes from a kernel-resolved
    process.cwd(); a pane cwd sourced from herdr can still carry the
    symlinked form, e.g. macOS's `/tmp` vs. its real `/private/tmp`), would
    otherwise fail an exact-string match on the SAME directory. realpath
    needs the path to exist; a torn-down worktree or a stale pane cwd must
    still normalize deterministically rather than throw, so a missing path
    falls back to the trimmed string, rewritten the way realpath itself
    would have on macOS -- the ONLY platform where `/tmp` is itself a
    symlink, so the rewrite must not apply elsewhere. */
export function normalizeWorktreePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  try {
    return realpathSync(trimmed);
  } catch {
    const isTmp = trimmed === '/tmp' || trimmed.startsWith('/tmp/');
    return process.platform === 'darwin' && isTmp
      ? `/private${trimmed}`
      : trimmed;
  }
}

export interface ResolveOriginFocusOpts {
  /** Thread origin.tabId into a paneId resolution -- the board's tab
      fallback wants it; console's pane:focus call has no use for it. */
  carryTabId?: boolean;
  /** The caller tried to list live panes and the call itself failed -- a
      different fact than an empty or non-matching list, so it gets its own
      reason instead of the misleading no-match one. */
  panesUnavailable?: boolean;
}

export const ORIGIN_PANE_CLOSED_REASON = 'the pane that asked this has closed';

/** Shared focus rule: origin.paneId while that pane is still listed live,
    else a worktree match against live pane cwds, else a human-readable
    reason for a disabled affordance or a 400 body. A gate's pane closes
    when its run finishes or is relaunched, and a stored id handed to herdr
    then only earns a raw not-found error. With the pane list unreadable the
    stored id is the best guess left, so it is returned as it was. */
export function resolveOriginFocus(
  origin: GateOrigin | undefined,
  panes: Array<{ paneId: string; cwd?: string }>,
  opts: ResolveOriginFocusOpts = {}
): FocusResolution {
  if (origin?.paneId) {
    const paneId = origin.paneId;
    const live = opts.panesUnavailable || panes.some(p => p.paneId === paneId);
    if (live) {
      return opts.carryTabId && origin.tabId !== undefined
        ? { ok: true, paneId, tabId: origin.tabId }
        : { ok: true, paneId };
    }
  }
  if (origin?.worktree) {
    if (opts.panesUnavailable) {
      return { ok: false, reason: 'could not list live panes' };
    }
    const target = normalizeWorktreePath(origin.worktree);
    const match = panes.find(
      p => p.cwd !== undefined && normalizeWorktreePath(p.cwd) === target
    );
    if (match) return { ok: true, paneId: match.paneId };
    return origin.paneId
      ? { ok: false, reason: ORIGIN_PANE_CLOSED_REASON }
      : { ok: false, reason: 'no live pane matches the origin worktree' };
  }
  if (origin?.paneId) return { ok: false, reason: ORIGIN_PANE_CLOSED_REASON };
  return { ok: false, reason: 'no origin on this gate' };
}

export interface PanesForOriginResult {
  panes: Array<{ paneId: string; cwd?: string }>;
  /** True when a worktree-fallback fetch was attempted and the daemon call
      itself failed, as opposed to succeeding with no matching pane. The
      caller needs this to word a "could not list panes" reason correctly
      instead of the misleading "no live pane matches". */
  fetchFailed: boolean;
}

/** Fetches live panes whenever the resolution has something to check them
    against: a stored `origin.paneId` is only worth focusing while it is
    still listed, and the worktree fallback needs the list outright. An
    origin naming neither never touches the pane list. */
export async function panesForOrigin(
  origin: GateOrigin | undefined,
  listPanes: () => Promise<{
    ok: boolean;
    data?: { panes: Array<{ paneId: string; cwd?: string }> } | null;
  }>
): Promise<PanesForOriginResult> {
  if (!origin?.paneId && !origin?.worktree)
    return { panes: [], fetchFailed: false };
  try {
    const res = await listPanes();
    return res.ok && res.data
      ? { panes: res.data.panes, fetchFailed: false }
      : { panes: [], fetchFailed: true };
  } catch {
    return { panes: [], fetchFailed: true };
  }
}
