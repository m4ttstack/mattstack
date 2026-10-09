import { useEffect, useMemo, useRef, useState, type Ref } from 'react';

import type { DeclineReason } from '../../../peer/envelope.ts';
import type { AskCardData, BoardData } from '../../types.ts';
import { AskGlyph } from '../ask-glyph.tsx';
import { AskCard, AskConfirm } from './AskCard.tsx';
import { AskHistory } from './AskHistory.tsx';

const CONFIRM_MS = 4000;

export interface AsksHandlers {
  /** Rejects with the route's words when the board would not start it. */
  onAccept(id: string, alwaysAllow: boolean): Promise<void>;
  onDecline(
    id: string,
    reason: DeclineReason | null,
    note: string
  ): Promise<void>;
  onAllow(username: string, allow: boolean): Promise<void>;
  onFocus(mrUrl: string): void;
}

export interface AsksDropdownProps extends AsksHandlers {
  asks: NonNullable<BoardData['asks']>;
  flashId: string | null;
  /** Roster display names by username, for the always-allowed chips. */
  names?: ReadonlyMap<string, string>;
  /** How long an accepted card stays as its one-line confirm. */
  confirmMs?: number;
  /** Shows a failed go-ahead or decline whose card left before its error
      could be read there. */
  onNotice?(message: string): void;
  /** The dropdown's root, which takes focus when it opens. */
  rootRef?: Ref<HTMLDivElement>;
  /** Opens on history rather than the waiting list. */
  initialView?: 'list' | 'history';
}

/** The asks dropdown's body: what waits, or the last two weeks. */
export function AsksDropdown({
  asks,
  flashId,
  names,
  confirmMs = CONFIRM_MS,
  initialView = 'list',
  onNotice,
  rootRef,
  onAccept,
  onDecline,
  onAllow,
  onFocus,
}: AsksDropdownProps) {
  const [view, setView] = useState(initialView);
  // Accepted asks keep their place as a confirm line after the next reload
  // has moved them to history, until their hold runs out.
  const [held, setHeld] = useState<ReadonlyMap<string, AskCardData>>(new Map());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // A failure's alert lives on its card, so a card the reload took away
  // hands its words on rather than dropping them.
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map());
  const remember = (id: string, err: unknown) =>
    setFailed(f =>
      new Map(f).set(
        id,
        err instanceof Error && err.message
          ? err.message
          : 'something went wrong'
      )
    );
  const forget = (id: string) =>
    setFailed(f => {
      if (!f.has(id)) return f;
      const next = new Map(f);
      next.delete(id);
      return next;
    });
  useEffect(() => {
    const lost = [...failed].filter(
      ([id]) => !asks.pending.some(a => a.id === id)
    );
    if (lost.length === 0) return;
    for (const [, message] of lost) onNotice?.(message);
    setFailed(f => {
      const next = new Map(f);
      for (const [id] of lost) next.delete(id);
      return next;
    });
  }, [failed, asks.pending, onNotice]);

  const allNames = useMemo(() => {
    const m = new Map(names ?? []);
    for (const a of [...asks.pending, ...asks.history])
      if (a.fromName && !m.has(a.from)) m.set(a.from, a.fromName);
    return m;
  }, [names, asks]);

  const shown = useMemo(() => {
    const byId = new Map<string, AskCardData>();
    for (const a of held.values()) byId.set(a.id, a);
    for (const a of asks.pending) if (!byId.has(a.id)) byId.set(a.id, a);
    return [...byId.values()]
      .filter(a => !gone.has(a.id))
      .sort((a, b) => a.receivedAt - b.receivedAt);
  }, [held, gone, asks.pending]);
  const waiting = shown.filter(a => !held.has(a.id)).length;

  const accept = async (id: string, alwaysAllow: boolean) => {
    const card = asks.pending.find(a => a.id === id);
    try {
      await onAccept(id, alwaysAllow);
    } catch (err) {
      remember(id, err);
      throw err;
    }
    forget(id);
    if (!card) return;
    setHeld(h => new Map(h).set(id, card));
    timers.current.push(
      setTimeout(() => {
        setGone(g => new Set(g).add(id));
        setHeld(h => {
          const next = new Map(h);
          next.delete(id);
          return next;
        });
      }, confirmMs)
    );
  };
  const decline = async (
    id: string,
    reason: DeclineReason | null,
    note: string
  ) => {
    try {
      await onDecline(id, reason, note);
    } catch (err) {
      remember(id, err);
      throw err;
    }
    forget(id);
    setGone(g => new Set(g).add(id));
  };

  const now = Date.now();
  return (
    <div className="tui-asks" ref={rootRef} tabIndex={-1}>
      <header className="tui-asks-head">
        {view === 'history' ? (
          <>
            <button
              type="button"
              className="tui-asks-back"
              aria-label="back to waiting asks"
              onClick={() => setView('list')}
            >
              <AskGlyph name="chevron-left" size={14} />
            </button>
            <h2 className="tui-asks-title">History</h2>
            <span className="tui-asks-count">last two weeks</span>
          </>
        ) : (
          <>
            <h2 className="tui-asks-title">Asks for your agent</h2>
            <span className="tui-asks-count">
              {waiting > 0 ? `${waiting} waiting` : 'nothing waiting'}
            </span>
            <button
              type="button"
              className="tui-ask-link tui-asks-history-link"
              onClick={() => setView('history')}
            >
              history
            </button>
          </>
        )}
      </header>
      <div className="tui-asks-body">
        {view === 'history' ? (
          <AskHistory
            history={asks.history}
            alwaysAllow={asks.alwaysAllow}
            names={allNames}
            now={now}
            onAllow={(u, allow) => void onAllow(u, allow)}
          />
        ) : shown.length === 0 ? (
          <div className="tui-asks-empty">
            <AskGlyph name="inbox" size={18} />
            <p>No one has asked for your agent.</p>
          </div>
        ) : (
          shown.map(a =>
            held.has(a.id) ? (
              <AskConfirm key={a.id} ask={a} onFocus={onFocus} />
            ) : (
              <AskCard
                key={a.id}
                ask={a}
                flash={a.id === flashId}
                now={now}
                onAccept={accept}
                onDecline={decline}
              />
            )
          )
        )}
      </div>
      <footer className="tui-asks-foot">
        <AskGlyph name="cpu" size={12} />
        Asks run on this Mac with your agent usage.
      </footer>
    </div>
  );
}
