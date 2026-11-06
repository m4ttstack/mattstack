import { useEffect, useState } from 'react';

import type { BoardMR } from '../../data.ts';
import { isOwnMr } from '../../view.ts';
import { postAction } from '../api.ts';
import type { FlockMenuData } from './row-actions.ts';

/** `/flock/menu` shells out to Flock and rt, too slow to wait on per
    right-click: the board warms this cache for its own MRs, the menu paints
    from it at once, and each opening refreshes it in the background. */
const FRESH_MS = 30_000;

interface Entry {
  data?: FlockMenuData;
  at: number;
  pending?: Promise<void>;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function cachedFlockMenu(mrUrl: string): FlockMenuData | undefined {
  return entries.get(mrUrl)?.data;
}

function loadFlockMenu(
  mr: Pick<BoardMR, 'webUrl' | 'iid'>,
  { force = false }: { force?: boolean } = {}
): Promise<void> {
  const url = mr.webUrl;
  if (!url) return Promise.resolve();
  const entry = entries.get(url) ?? { at: 0 };
  entries.set(url, entry);
  if (entry.pending) return entry.pending;
  if (!force && entry.data && Date.now() - entry.at < FRESH_MS)
    return Promise.resolve();
  entry.pending = postAction('/flock/menu', { mrUrl: url, iid: mr.iid })
    .then(r => {
      if (!r.ok) return;
      const data = flockMenuData(r.body);
      if (!data) return;
      entry.data = data;
      entry.at = Date.now();
      for (const l of listeners) l();
    })
    .finally(() => {
      entry.pending = undefined;
    });
  return entry.pending;
}

/** The open menu's flock data: the cached copy straight away, then a fresh
    read once it answers. */
function useFlockMenu(
  mr: Pick<BoardMR, 'webUrl' | 'iid'>,
  wanted: boolean
): FlockMenuData | undefined {
  const { webUrl: url, iid } = mr;
  const [data, setData] = useState(() =>
    wanted && url ? cachedFlockMenu(url) : undefined
  );
  useEffect(() => {
    if (!wanted || !url) return;
    const sync = () => setData(cachedFlockMenu(url));
    listeners.add(sync);
    sync();
    void loadFlockMenu({ webUrl: url, iid }, { force: true });
    return () => {
      listeners.delete(sync);
    };
  }, [wanted, url, iid]);
  return data;
}

/** Keeps the seat's own MRs warm on a local board, re-read on each data
    refresh once their copy is older than FRESH_MS. */
function useFlockMenuWarmup(
  mrs: readonly BoardMR[] | undefined,
  local: boolean,
  self: string | null
): void {
  useEffect(() => {
    if (!local || !mrs) return;
    for (const mr of mrs) if (isOwnMr(mr, self)) void loadFlockMenu(mr);
  }, [mrs, local, self]);
}

function flockMenuData(body: unknown): FlockMenuData | undefined {
  const b = body as Partial<FlockMenuData> | null;
  if (!b || !Array.isArray(b.commands)) return undefined;
  return {
    installed: b.installed === true,
    tree: typeof b.tree === 'string' ? b.tree : null,
    resume: b.resume ?? null,
    commands: b.commands,
  };
}

function resetFlockMenuCache(): void {
  entries.clear();
  listeners.clear();
}

export {
  cachedFlockMenu,
  loadFlockMenu,
  resetFlockMenuCache,
  useFlockMenu,
  useFlockMenuWarmup,
};
