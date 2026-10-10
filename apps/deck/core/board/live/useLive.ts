import { useCallback, useRef, useState, type RefObject } from 'react';

import type { Row } from '../logic.ts';
import {
  deleteLive,
  dismissSetup,
  getSources,
  putLive,
  type SourceRow,
} from './live-api.ts';

export type LiveModalState = {
  row: Row;
  mode: 'go' | 'live' | 'failed';
  sources: SourceRow[] | null;
  error: string | null;
  picked: string | null;
  busy: boolean;
  opener: HTMLElement;
};

type Answer = { status: number; body: { error?: string } };

/** Main first, then worktrees most recently used first. */
function ordered(sources: SourceRow[]): SourceRow[] {
  const at = (s: SourceRow) =>
    s.lastActiveAt ? Date.parse(s.lastActiveAt) : 0;
  return [
    ...sources.filter(s => s.main),
    ...sources.filter(s => !s.main).sort((a, b) => at(b) - at(a)),
  ];
}

/** The source the row runs from (live), was being set up from (failed), or
    main for a row that is not live. Null when that worktree is not listed:
    never stand main in for a worktree the row actually names. */
export function rowSource(row: Row, sources: SourceRow[]): string | null {
  const main = sources.find(s => s.main)?.path ?? null;
  const worktree = (branch: string | null) =>
    branch == null
      ? null
      : (sources.find(s => !s.main && s.branch === branch)?.path ?? null);
  if (row.live) return row.live.main ? main : worktree(row.live.branch);
  if (row.liveSetup) return worktree(row.liveSetup.branch);
  return main;
}

export function useLive(
  refresh: () => Promise<unknown>,
  addToast: (msg: string) => void,
  fallbackFocusRef?: RefObject<HTMLElement | null>
) {
  const [modal, setModal] = useState<LiveModalState | null>(null);
  const modalRef = useRef<LiveModalState | null>(null);
  modalRef.current = modal;
  const openerCell = useRef<Element | null>(null);
  const openFallback = useRef<(() => HTMLElement | null) | null>(null);

  /** `live` forces the live modal for a live row whose source switch left a
      failed setup behind; `fallback` is where focus lands when the opener has
      gone by the time the modal closes. */
  const open = useCallback(
    (
      row: Row,
      opener: HTMLElement,
      opts: {
        mode?: 'live';
        fallback?: () => HTMLElement | null;
      } = {}
    ) => {
      const mode =
        opts.mode === 'live' && row.live
          ? 'live'
          : row.liveSetup?.state === 'failed'
            ? 'failed'
            : row.live
              ? 'live'
              : 'go';
      openerCell.current = opener.closest('td');
      openFallback.current = opts.fallback ?? null;
      setModal({
        row,
        mode,
        sources: null,
        error: null,
        picked: null,
        busy: false,
        opener,
      });
      void getSources(row.name).then(({ sources, error }) => {
        const list = ordered(sources);
        setModal(m =>
          m && m.row.name === row.name && m.sources == null
            ? { ...m, sources: list, error, picked: rowSource(row, list) }
            : m
        );
      });
    },
    []
  );

  // A refresh can swap the opener for another control in the same cell (go
  // live becomes the source button) or for nothing focusable (the setup
  // badge), so the cell and then the page are the fallbacks.
  const close = useCallback(() => {
    const opener = modalRef.current?.opener;
    const cell = openerCell.current;
    setModal(null);
    requestAnimationFrame(() => {
      const inCell = cell?.isConnected
        ? cell.querySelector<HTMLElement>('button:not([disabled])')
        : null;
      const target = opener?.isConnected
        ? opener
        : (inCell ??
          openFallback.current?.() ??
          fallbackFocusRef?.current ??
          null);
      target?.focus();
    });
  }, [fallbackFocusRef]);

  const pick = useCallback(
    (path: string) => setModal(m => m && { ...m, picked: path }),
    []
  );

  const run = useCallback(
    async (send: (m: LiveModalState) => Promise<Answer>): Promise<boolean> => {
      const m = modalRef.current;
      if (!m || m.busy) return false;
      setModal({ ...m, busy: true, error: null });
      const r = await send(m);
      if (r.status < 200 || r.status >= 300) {
        setModal(cur =>
          cur && cur.row.name === m.row.name
            ? {
                ...cur,
                busy: false,
                error: r.body.error || "That didn't work.",
              }
            : cur
        );
        return false;
      }
      await refresh();
      close();
      return true;
    },
    [close, refresh]
  );

  const submit = useCallback(async () => {
    await run(m => putLive(m.row.name, m.picked!));
  }, [run]);

  const stop = useCallback(async () => {
    if (await run(m => deleteLive(m.row.name))) addToast('Live mode stopped');
  }, [run, addToast]);

  const dismiss = useCallback(async () => {
    await run(m => dismissSetup(m.row.name));
  }, [run]);

  return { modal, open, close, pick, submit, stop, dismiss };
}

export type LiveState = ReturnType<typeof useLive>;
