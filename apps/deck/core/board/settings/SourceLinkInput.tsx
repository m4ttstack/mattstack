import { useEffect, useRef, useState } from 'react';

import { Button, TextField } from '@mattstack/tui-kit';
import type { Row } from '../logic.ts';
import type { BoardState } from '../useBoardState.ts';
import { escapeClearsDraft } from './escape.ts';

/** Inline path input for link and relink. The server is the only validator,
    so a refused path comes back as text under the input, which stays open
    for a fix. */
export function SourceLinkInput({
  row,
  board,
  done,
  autoFocus = false,
}: {
  row: Row;
  board: BoardState;
  /** Set for a disclosure the person opened (relink): Escape closes only
      it. Without it, an empty Escape falls through and closes the modal. */
  done?: () => void;
  /** Only when the person just asked for it: an input that is always shown
      must not take focus from the modal's close button. */
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // The input is disabled while the request runs, which drops its focus.
  useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);

  const submit = async () => {
    const workingDirectory = value.trim();
    if (!workingDirectory) return;
    setBusy(true);
    const message = await board.linkSource(row, workingDirectory);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setValue('');
    done?.();
  };

  return (
    <span className="settings-inline-form settings-grow">
      <TextField
        className="settings-link-input"
        value={value}
        onChange={ev => {
          setValue(ev.target.value);
          setError(null);
        }}
        placeholder="/path/to/source"
        aria-label={`source path for ${row.name}`}
        error={error}
        disabled={busy}
        inputRef={inputRef}
        onKeyDown={ev => {
          if (ev.key === 'Enter') submit();
          if (ev.key !== 'Escape') return;
          if (done) {
            ev.stopPropagation();
            setValue('');
            setError(null);
            done();
            return;
          }
          escapeClearsDraft(ev, value, () => {
            setValue('');
            setError(null);
          });
        }}
      />
      <Button disabled={value.trim() === '' || busy} onClick={submit}>
        Link
      </Button>
    </span>
  );
}
