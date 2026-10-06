import { useState } from 'react';

import { Button, Chip, TextField } from '@mattstack/tui-kit';

import { DECLINE_REASONS, type DeclineReason } from '../../../peer/envelope.ts';
import { AskGlyph } from '../ask-glyph.tsx';

const REASONS = Object.keys(DECLINE_REASONS) as DeclineReason[];

/** The card's row 4 while declining: an optional reason and note for the
    asker, then Cancel or Decline. */
export function AskDeclineForm({
  first,
  busy,
  onCancel,
  onDecline,
}: {
  /** The asker's first name. */
  first: string;
  busy: boolean;
  onCancel: () => void;
  onDecline: (reason: DeclineReason | null, note: string) => void;
}) {
  const [reason, setReason] = useState<DeclineReason | null>(null);
  const [note, setNote] = useState('');
  return (
    <form
      className="tui-ask-decline"
      aria-label={`Decline ${first}'s ask`}
      onSubmit={e => {
        e.preventDefault();
        onDecline(reason, note);
      }}
    >
      <p className="tui-ask-decline-label">
        Decline {first}'s ask. Tell {first} why? (optional)
      </p>
      <div className="tui-ask-decline-reasons" role="group" aria-label="reason">
        {REASONS.map(r => {
          const on = reason === r;
          return (
            <Chip
              key={r}
              as="button"
              intent={on ? 'accent' : 'muted'}
              aria-pressed={on}
              data-on={on || undefined}
              icon={on ? <AskGlyph name="check" size={11} /> : undefined}
              onClick={() => setReason(on ? null : r)}
            >
              {DECLINE_REASONS[r]}
            </Chip>
          );
        })}
      </div>
      <TextField
        className="tui-ask-decline-note"
        aria-label={`note for ${first}`}
        placeholder={`add a note for ${first}`}
        maxLength={500}
        value={note}
        onChange={e => setNote(e.target.value)}
      />
      <div className="tui-ask-decline-actions">
        <Button variant="subtle" intent="muted" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="filled"
          intent="bad"
          size="sm"
          busy={busy}
        >
          <AskGlyph name="ban" size={13} />
          Decline
        </Button>
      </div>
    </form>
  );
}
