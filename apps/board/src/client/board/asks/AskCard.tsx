import { useState } from 'react';

import { Alert, Button, SelectBox } from '@mattstack/tui-kit';
import type { DeclineReason } from '../../../peer/envelope.ts';
import type { AskCardData } from '../../types.ts';
import { AskGlyph } from '../ask-glyph.tsx';
import { ago } from '../format.ts';
import { AgentGlyph } from '../icons.tsx';
import { MemberInvadr } from '../MemberInvadr.tsx';
import { MrLinks } from '../MrLinks.tsx';
import {
  askedPhrase,
  confirmLine,
  firstName,
  verbLabel,
  verbLane,
} from './ask-copy.ts';
import { AskDeclineForm } from './AskDeclineForm.tsx';

const errorText = (err: unknown) =>
  err instanceof Error && err.message ? err.message : 'something went wrong';

/** The one line a card shrinks to once its go-ahead started the agent. */
export function AskConfirm({
  ask,
  onFocus,
}: {
  ask: AskCardData;
  onFocus: (mrUrl: string) => void;
}) {
  return (
    <div className="tui-ask-confirm" data-ask-id={ask.id} role="status">
      <AskGlyph name="circle-check" size={14} />
      <span className="tui-ask-confirm-text">
        {confirmLine(ask.kind, ask.iid)}
      </span>
      <button
        type="button"
        className="tui-ask-link"
        onClick={() => onFocus(ask.mrUrl)}
      >
        <AgentGlyph />
        focus
      </button>
    </div>
  );
}

/** One waiting ask: who asked for what, on which MR, and the go-ahead. */
export function AskCard({
  ask,
  flash,
  now,
  onAccept,
  onDecline,
}: {
  ask: AskCardData;
  flash: boolean;
  now: number;
  onAccept: (id: string, alwaysAllow: boolean) => Promise<void>;
  onDecline: (
    id: string,
    reason: DeclineReason | null,
    note: string
  ) => Promise<void>;
}) {
  const [declining, setDeclining] = useState(false);
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = firstName(ask.fromName, ask.from);
  const run = async (kind: 'accept' | 'decline', act: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await act();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article
      className={flash ? 'tui-ask-card tui-ask-flash' : 'tui-ask-card'}
      data-ask-id={ask.id}
      aria-label={`${ask.fromName ?? ask.from} ${askedPhrase(ask.kind)} on !${ask.iid}`}
    >
      <div className="tui-ask-who">
        <MemberInvadr id={ask.from} className="tui-ask-avatar" />
        <span className="tui-ask-name">{ask.fromName ?? ask.from}</span>
        <span className="tui-ask-phrase">
          {askedPhrase(ask.kind)} ·{' '}
          <span className="tui-ask-iid">!{ask.iid}</span>
        </span>
        <span className="tui-ask-age">
          {ago(new Date(ask.receivedAt).toISOString(), now)}
        </span>
      </div>
      <div className="tui-ask-mr">
        <span className="tui-ask-title">{ask.title ?? ask.mrUrl}</span>
        <MrLinks
          mr={{
            webUrl: ask.mrUrl,
            iid: ask.iid,
            ...(ask.sourceBranch ? { sourceBranch: ask.sourceBranch } : {}),
            ...(ask.title ? { title: ask.title } : {}),
          }}
        />
      </div>
      {ask.note && <p className="tui-ask-card-note">{ask.note}</p>}
      {error && (
        <Alert intent="bad" className="tui-ask-error">
          {error}
        </Alert>
      )}
      {declining ? (
        <AskDeclineForm
          first={first}
          busy={busy === 'decline'}
          onCancel={() => setDeclining(false)}
          onDecline={(reason, note) =>
            void run('decline', () => onDecline(ask.id, reason, note))
          }
        />
      ) : (
        <div className="tui-ask-actions">
          <Button
            variant="filled"
            intent={verbLane(ask.kind) === 'respond' ? 'ok' : 'accent'}
            size="sm"
            busy={busy === 'accept'}
            onClick={() =>
              void run('accept', () => onAccept(ask.id, alwaysAllow))
            }
          >
            <AgentGlyph />
            {verbLabel(ask.kind)}
          </Button>
          <Button
            variant="subtle"
            intent="muted"
            size="sm"
            disabled={busy !== null}
            onClick={() => setDeclining(true)}
          >
            Decline
          </Button>
          <label className="tui-ask-allow">
            <SelectBox
              checked={alwaysAllow}
              onToggle={() => setAlwaysAllow(a => !a)}
              aria-label={`always allow ${first}`}
            />
            <span aria-hidden>always allow {first}</span>
          </label>
        </div>
      )}
    </article>
  );
}
