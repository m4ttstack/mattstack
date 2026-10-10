import { useCallback, useRef, useState } from 'react';

import type { Row } from '../logic.ts';
import { deleteLive, getSources, putLive, type SourceRow } from './live-api.ts';

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

/** The source the row runs from now, or main when it is not live. */
export function currentSource(row: Row, sources: SourceRow[]): string | null {
  const main = sources.find(s => s.main)?.path ?? null;
  const branch = row.live
    ? row.live.main
      ? null
      : row.live.branch
    : (row.liveSetup?.branch ?? null);
  if (branch == null) return main;
  return sources.find(s => !s.main && s.branch === branch)?.path ?? main;
}

export function useLive(
  refresh: () => Promise<unknown>,
  addToast: (msg: string) => void
) {
  const [modal, setModal] = useState<LiveModalState | null>(null);
  const modalRef = useRef<LiveModalState | null>(null);
  modalRef.current = modal;

  const open = useCallback((row: Row, opener: HTMLElement) => {
    const mode =
      row.liveSetup?.state === 'failed' ? 'failed' : row.live ? 'live' : 'go';
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
          ? { ...m, sources: list, error, picked: currentSource(row, list) }
          : m
      );
    });
  }, []);

  const close = useCallback(() => {
    const opener = modalRef.current?.opener;
    setModal(null);
    if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
  }, []);

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
                error: r.body.error ?? `failed (${r.status})`,
              }
            : cur
        );
        return false;
      }
      close();
      await refresh();
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
    await run(m => deleteLive(m.row.name));
  }, [run]);

  return { modal, open, close, pick, submit, stop, dismiss };
}

export type LiveState = ReturnType<typeof useLive>;
