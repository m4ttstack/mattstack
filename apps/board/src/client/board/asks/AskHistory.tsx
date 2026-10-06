import { Chip } from '@mattstack/tui-kit';

import type { AskCardData } from '../../types.ts';
import { AskGlyph } from '../ask-glyph.tsx';
import { ago } from '../format.ts';
import { historyOutcome } from './ask-copy.ts';

/** The last two weeks of handled asks, then who starts without asking. */
export function AskHistory({
  history,
  alwaysAllow,
  names,
  now,
  onAllow,
}: {
  history: AskCardData[];
  alwaysAllow: string[];
  /** Roster display names by username. */
  names: ReadonlyMap<string, string>;
  now: number;
  onAllow: (username: string, allow: boolean) => void;
}) {
  return (
    <>
      {history.length === 0 ? (
        <p className="tui-asks-empty">Nothing handled in the last two weeks.</p>
      ) : (
        <ul className="tui-ask-history" aria-label="handled asks">
          {history.map(a => {
            const outcome = historyOutcome(a);
            return (
              <li key={a.id} className="tui-ask-history-row">
                <div className="tui-ask-who">
                  <span className="tui-ask-name">{a.fromName ?? a.from}</span>
                  <span className="tui-ask-phrase">{a.kind}</span>
                  <span className="tui-ask-age">
                    {ago(new Date(a.handled?.at ?? a.receivedAt).toISOString(), now)}
                  </span>
                </div>
                <div className="tui-ask-history-mr">
                  <span className="tui-ask-iid">!{a.iid}</span>{' '}
                  {a.title ?? a.mrUrl}
                </div>
                <div className="tui-ask-outcome" data-tone={outcome.tone}>
                  {outcome.text}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {alwaysAllow.length > 0 && (
        <section className="tui-ask-allowed" aria-label="Always allowed">
          <h3 className="tui-ask-allowed-head">Always allowed</h3>
          <div className="tui-ask-allowed-chips">
            {alwaysAllow.map(u => {
              const name = names.get(u) ?? u;
              return (
                <Chip key={u} intent="muted" className="tui-ask-allowed-chip">
                  {name}
                  <button
                    type="button"
                    className="tui-ask-allowed-remove"
                    aria-label={`stop always allowing ${name}`}
                    onClick={() => onAllow(u, false)}
                  >
                    <AskGlyph name="x" size={11} />
                  </button>
                </Chip>
              );
            })}
          </div>
          <p className="tui-ask-allowed-hint">
            Their asks start without waiting for you. Remove someone to confirm
            theirs again.
          </p>
        </section>
      )}
    </>
  );
}
