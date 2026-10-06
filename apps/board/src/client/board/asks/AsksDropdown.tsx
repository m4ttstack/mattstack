import { useEffect, useMemo, useRef, useState } from 'react';

import type { DeclineReason } from '../../../peer/envelope.ts';
import type { AskCardData, BoardData } from '../../types.ts';
import { AskGlyph } from '../ask-glyph.tsx';
import { AskCard, AskConfirm } from './AskCard.tsx';
import { AskHistory } from './AskHistory.tsx';

const CONFIRM_MS = 4000;

export interface AsksHandlers {
  /** Rejects with the route's words when the board would not start it. */
  onAccept(id: string, alwaysAllow: boolean): Promise<void>;
  onDecline(id: string, reason: DeclineReason | null, note: string): Promise<void>;
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
    await onAccept(id, alwaysAllow);
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
    await onDecline(id, reason, note);
    setGone(g => new Set(g).add(id));
  };

  const now = Date.now();
  return (
    <div className="tui-asks">
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
        Asks run on this Mac with your Claude usage.
      </footer>
    </div>
  );
}
