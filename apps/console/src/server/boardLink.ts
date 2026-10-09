import { deckAppUrl } from '@mattstack/app-server/event-bridge';
import type { GateRow } from '@mattstack/rt-client';

import { waitingHandoff } from '../shared/handoff';

/** A found board url is kept a few minutes; a miss is retried sooner, so a
    deck that starts after the console is picked up. */
const HIT_TTL_MS = 5 * 60_000;
const MISS_TTL_MS = 30_000;

const HANDED_OFF = new Set(['review', 'receive-review']);

export interface BoardLinkDeps {
  boardOrigin: () => Promise<string | null>;
  runGates: (runId: string) => Promise<GateRow[] | null>;
  now: () => number;
}

/**
 * The board page for a review or respond run's waiting hand-off gate
 * (`<board>/?gate=<id>`), or null: for any other run, when no hand-off gate
 * waits, or when deck does not say where the board is.
 */
export function boardLinkResolver(deps: BoardLinkDeps) {
  let cached: { url: string | null; until: number } | null = null;

  async function origin(): Promise<string | null> {
    const now = deps.now();
    if (cached && now < cached.until) return cached.url;
    const url = await deps.boardOrigin();
    cached = { url, until: now + (url ? HIT_TTL_MS : MISS_TTL_MS) };
    return url;
  }

  return async (run: {
    id: string;
    work_type: string;
    status: string;
  }): Promise<string | null> => {
    if (!HANDED_OFF.has(run.work_type) || run.status !== 'running') return null;
    const gates = await deps.runGates(run.id);
    const gate = gates ? waitingHandoff(gates) : null;
    if (!gate) return null;
    const base = await origin();
    if (!base) return null;
    return `${base.replace(/\/+$/, '')}/?gate=${encodeURIComponent(gate.id)}`;
  };
}

export const liveBoardLinkDeps = (
  runGates: BoardLinkDeps['runGates']
): BoardLinkDeps => ({
  boardOrigin: () => deckAppUrl('board'),
  runGates,
  now: Date.now,
});
