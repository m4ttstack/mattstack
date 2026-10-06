import { useEffect, useState } from 'react';

import { ConfirmDialog, TextField } from '@mattstack/tui-kit';
import type { AskKind } from '../types.ts';
import { AskGlyph } from './ask-glyph.tsx';
import { verbLane } from './asks/ask-copy.ts';

const TITLE_VERB: Record<AskKind, string> = {
  review: 'review',
  're-review': 're-review',
  respond: 'respond on',
};

/** Every ask confirms here before it goes: what it does on the teammate's
    Mac, and an optional note they read with it. */
export function AskConfirmDialog({
  open,
  kind,
  reviewerName,
  subject,
  onSend,
  onCancel,
}: {
  open: boolean;
  kind: AskKind;
  /** The teammate's first name; empty reads as "your teammate". */
  reviewerName: string;
  /** "!1271" for one MR, "3 MRs" for a bulk ask. */
  subject: string;
  onSend: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) setNote('');
  }, [open]);
  const who = reviewerName || 'your teammate';
  return (
    <ConfirmDialog
      open={open}
      intent={verbLane(kind) === 'respond' ? 'ok' : 'accent'}
      confirmVariant="filled"
      title={`Ask ${who}'s agent to ${TITLE_VERB[kind]} ${subject}?`}
      confirmLabel={
        <>
          <AskGlyph name="send" size={13} />
          Send ask
        </>
      }
      cancelLabel="Cancel"
      onConfirm={() => onSend(note)}
      onCancel={onCancel}
    >
      <div className="tui-ask-send-body">
        <p className="tui-ask-send-copy">
          It runs on {who}'s Mac with {who}'s Claude usage, once {who} says go
          ahead.
        </p>
        <TextField
          label={`Note for ${who} (optional)`}
          maxLength={500}
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSend(note);
            }
          }}
        />
      </div>
    </ConfirmDialog>
  );
}
